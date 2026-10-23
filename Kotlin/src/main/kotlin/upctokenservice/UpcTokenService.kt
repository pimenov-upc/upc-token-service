package upctokenservice

import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.atomic.AtomicLong

/** Standard UPC Token Service resource URLs. */
object UpcTokenServiceResource {
    const val Test = "https://ecg.test.upc.ua"
    const val Production = "https://secure.upc.ua"
}

typealias UpcTokenServiceEnvironment = String
typealias UpcTokenServiceResponse = String

/** Configuration for [UpcTokenService]. Timeout is measured in milliseconds. */
data class UpcTokenServiceOptions(
    val merchantId: String,
    val terminalId: String,
    val timeout: Long? = null,
    val logging: Boolean = false,
)

data class TokenRequest(
    val trackingId: String,
    val tokenId: String,
)

data class CardDetails(
    val cardNum: String,
    val expMonth: String,
    val expYear: String,
    val cvNum: String? = null,
)

data class CreateTokenRequest(
    val trackingId: String,
    val card: CardDetails,
)

enum class TokenReasonCode {
    DEVICE_LOST,
    DEVICE_STOLEN,
    SUSPECTED_FRAUD,
    ACCOUNT_CLOSED,
    NOT_FRAUD,
    DEVICE_FOUND,
    OTHER,
}

data class UpdateTokenRequest(
    val trackingId: String,
    val tokenId: String,
    val reasonCode: TokenReasonCode? = null,
    val reason: String? = null,
)

data class CardContentRequest(
    val trackingId: String,
    val contentId: String,
    val brand: String? = null,
)

data class CardMetadataRequest(
    val trackingId: String,
    val tokenId: String,
)

/** HTTP error raised when UPC responds with a non-success status. */
class FetchError(
    val status: Int,
    val url: String,
    val responseBody: String? = null,
    message: String = "Request failed with status $status",
) : IOException(message)

private const val DEFAULT_TIMEOUT_MS = 60_000L
private const val XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
private const val XML_SCHEMA = "https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"
private const val XML_ROOT_OPEN =
    "<ECommerceConnect xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\" " +
        "xmlns:noNamespaceSchemaLocation=\"$XML_SCHEMA\" " +
        "xmlns:xenc=\"http://www.w3.org/2001/04/xmlenc#\" " +
        "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" " +
        "xsi:noNamespaceSchemaLocation=\"$XML_SCHEMA\">"
private const val MAX_LOG_LENGTH = 2_000

private val messageId = AtomicLong()

private val apiPaths = mapOf(
    "createToken" to "/go/token/create",
    "refreshToken" to "/go/token/refresh",
    "deleteToken" to "/go/token/delete",
    "getTokenStatus" to "/go/token/status",
    "suspendToken" to "/go/token/suspend",
    "resumeToken" to "/go/token/resume",
    "getCardContent" to "/go/card/content",
    "getCardMetadata" to "/go/card/metadata",
)

/**
 * Synchronous HTTP client for the UPC Token Service XML API.
 *
 * [resource] accepts `test`, `production`, or a custom base HTTPS URL. API
 * paths are appended automatically. The client uses only the JDK HTTP client.
 */
class UpcTokenService(
    resource: String,
    val options: UpcTokenServiceOptions,
) {
    private val baseUrl = resolveBaseUrl(resource)
    private val timeoutMs = options.timeout ?: DEFAULT_TIMEOUT_MS
    private val httpClient: HttpClient

    init {
        validateNonEmpty(options.merchantId, "merchantId")
        validateNonEmpty(options.terminalId, "terminalId")
        validateMaxLength(options.merchantId, 35, "merchantId")
        validateMaxLength(options.terminalId, 35, "terminalId")
        require(timeoutMs > 0) { "timeout must be greater than 0 milliseconds." }
        httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(timeoutMs))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build()
    }

    /** Creates a UPC token for a card. */
    fun createToken(request: CreateTokenRequest): UpcTokenServiceResponse {
        validateTrackingId(request.trackingId)
        validateNonEmpty(request.card.cardNum, "card.cardNum")
        validateNonEmpty(request.card.expMonth, "card.expMonth")
        validateNonEmpty(request.card.expYear, "card.expYear")

        val card = linkedMapOf<String, Any?>(
            "CardNum" to request.card.cardNum,
            "ExpYear" to request.card.expYear,
            "ExpMonth" to request.card.expMonth,
        )
        request.card.cvNum?.let { card["CVNum"] = it }
        return send("createToken", "XMLCreateTokenRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "Card" to card,
        ))
    }

    /** Refreshes an existing token and obtains fresh payment token data. */
    fun refreshToken(request: TokenRequest): UpcTokenServiceResponse {
        validateTokenRequest(request.trackingId, request.tokenId)
        return send("refreshToken", "XMLRefreshTokenRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "UPCToken" to linkedMapOf("tokenId" to request.tokenId),
        ))
    }

    /** Permanently deletes a token. Deleted tokens cannot be resumed. */
    fun deleteToken(request: UpdateTokenRequest): UpcTokenServiceResponse {
        validateTokenRequest(request.trackingId, request.tokenId)
        return send("deleteToken", "XMLDeleteTokenRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "UpdateTokenRequest" to updateTokenPayload(request.tokenId, request.reasonCode, request.reason),
        ))
    }

    /** Retrieves the current state of a token. */
    fun getTokenStatus(request: TokenRequest): UpcTokenServiceResponse {
        validateTokenRequest(request.trackingId, request.tokenId)
        return send("getTokenStatus", "XMLTokenStatusRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "UPCToken" to linkedMapOf("tokenId" to request.tokenId),
        ))
    }

    /** Suspends a token, allowing it to be resumed later. */
    fun suspendToken(request: UpdateTokenRequest): UpcTokenServiceResponse {
        validateTokenRequest(request.trackingId, request.tokenId)
        return send("suspendToken", "XMLSuspendTokenRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "UpdateTokenRequest" to updateTokenPayload(request.tokenId, request.reasonCode, request.reason),
        ))
    }

    /** Resumes a previously suspended token. */
    fun resumeToken(request: UpdateTokenRequest): UpcTokenServiceResponse {
        validateTokenRequest(request.trackingId, request.tokenId)
        return send("resumeToken", "XMLResumeTokenRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "UpdateTokenRequest" to updateTokenPayload(request.tokenId, request.reasonCode, request.reason),
        ))
    }

    /** Retrieves card content by its content ID. */
    fun getCardContent(request: CardContentRequest): UpcTokenServiceResponse {
        validateTrackingId(request.trackingId)
        validateNonEmpty(request.contentId, "contentId")
        val payload = linkedMapOf<String, Any?>(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "contentId" to request.contentId,
        )
        request.brand?.let { payload["Brand"] = it }
        return send("getCardContent", "XMLGetCardContentRequest", payload)
    }

    /** Retrieves card metadata for a token. */
    fun getCardMetadata(request: CardMetadataRequest): UpcTokenServiceResponse {
        validateTokenRequest(request.trackingId, request.tokenId)
        return send("getCardMetadata", "XMLGetCardMetadataRequest", linkedMapOf(
            "MerchantID" to options.merchantId,
            "TerminalID" to options.terminalId,
            "trackingId" to request.trackingId,
            "UPCToken" to linkedMapOf("tokenId" to request.tokenId),
        ))
    }

    private fun updateTokenPayload(
        tokenId: String,
        reasonCode: TokenReasonCode?,
        reason: String?,
    ): Map<String, Any?> = linkedMapOf<String, Any?>(
        "UPCToken" to linkedMapOf("tokenId" to tokenId),
    ).apply {
        reasonCode?.let { put("reasonCode", it.name) }
        reason?.let { put("reason", it) }
    }

    private fun send(pathKey: String, operation: String, payload: Map<String, Any?>): String {
        val endpoint = checkNotNull(apiPaths[pathKey])
        val url = "$baseUrl$endpoint"
        val xml = createXmlRequest(operation, payload)
        if (options.logging) {
            println("[UPC Token Service] POST $url ($operation)")
            println("[UPC Token Service] Request Content-Type: application/xml")
            println("[UPC Token Service] Request XML for $operation: ${redactXmlForLog(xml)}")
        }

        try {
            val request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMillis(timeoutMs))
                .header("Content-Type", "application/xml")
                .POST(HttpRequest.BodyPublishers.ofString(xml))
                .build()
            val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
            val responseXml = response.body()
            if (response.statusCode() !in 200..299) {
                throw FetchError(response.statusCode(), url, responseXml)
            }

            if (options.logging) {
                val headers = response.headers()
                val contentType = headers.firstValue("content-type").orElse("not provided")
                val contentLength = headers.firstValue("content-length").orElse("not provided")
                val requestId = headers.firstValue("x-request-id")
                    .orElseGet {
                        headers.firstValue("x-correlation-id").orElseGet {
                            headers.firstValue("correlation-id").orElse("not provided")
                        }
                    }
                val loggedBody = if (responseXml.isEmpty()) "[empty response body]" else redactXmlForLog(responseXml)
                println(
                    "[UPC Token Service] HTTP ${response.statusCode()} response for $operation " +
                        "(Content-Type: $contentType; Content-Length: $contentLength; " +
                        "Request-ID: $requestId; Empty: ${responseXml.isEmpty()}): $loggedBody",
                )
            }
            return responseXml
        } catch (error: Exception) {
            if (error is InterruptedException) {
                Thread.currentThread().interrupt()
            }
            val status = (error as? FetchError)?.status?.toString() ?: "unavailable"
            if (options.logging) {
                System.err.println("[UPC Token Service] $operation failed (HTTP $status): ${error.message}")
            }
            throw error
        }
    }

    private fun createXmlRequest(operation: String, payload: Map<String, Any?>): String {
        val body = payload.entries.joinToString(separator = "") { (name, value) ->
            serializeXmlElement(name, value)
        }
        return "$XML_HEADER$XML_ROOT_OPEN<Message id=\"${messageId.incrementAndGet()}\" version=\"1.0\">" +
            "<$operation>$body</$operation></Message></ECommerceConnect>"
    }

    private fun serializeXmlElement(name: String, value: Any?): String {
        if (value == null) return ""
        if (value is Map<*, *>) {
            val children = value.entries.joinToString(separator = "") { (childName, childValue) ->
                serializeXmlElement(childName.toString(), childValue)
            }
            return "<$name>$children</$name>"
        }
        return "<$name>${escapeXml(value.toString())}</$name>"
    }

    private fun redactXmlForLog(xml: String): String {
        val sensitiveTags = "CardNum|CVNum|TokenNumber|TAVV|tokenId"
        val redacted = Regex("(<(?:$sensitiveTags)\\b[^>]*>)[\\s\\S]*?(</(?:$sensitiveTags)\\s*>)", RegexOption.IGNORE_CASE)
            .replace(xml, "$1[REDACTED]$2")
        val withoutEncodedData = Regex("<encodedData\\b[^>]*>[\\s\\S]*?</encodedData\\s*>", RegexOption.IGNORE_CASE)
            .replace(redacted, "<encodedData>[OMITTED]</encodedData>")
        return if (withoutEncodedData.length > MAX_LOG_LENGTH) {
            withoutEncodedData.take(MAX_LOG_LENGTH) + "…[truncated]"
        } else {
            withoutEncodedData
        }
    }

    private fun validateTokenRequest(trackingId: String, tokenId: String) {
        validateTrackingId(trackingId)
        validateNonEmpty(tokenId, "tokenId")
    }

    private fun validateTrackingId(trackingId: String) {
        validateNonEmpty(trackingId, "trackingId")
        validateMaxLength(trackingId, 10, "trackingId")
    }

    private fun resolveBaseUrl(resource: String): String {
        val resourceUrl = when (resource) {
            "test" -> UpcTokenServiceResource.Test
            "production" -> UpcTokenServiceResource.Production
            else -> resource
        }
        val uri = try {
            URI(resourceUrl)
        } catch (error: Exception) {
            throw IllegalArgumentException("resource must be a valid UPC HTTPS URL or environment name.", error)
        }
        require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
            "UPC Token Service resource must use HTTPS."
        }
        require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") {
            "Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically."
        }
        require(uri.rawQuery == null && uri.rawFragment == null) {
            "Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically."
        }
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "https://${uri.host}$port"
    }

    private fun validateNonEmpty(value: String, name: String) {
        require(value.isNotBlank()) { "$name must not be empty." }
    }

    private fun validateMaxLength(value: String, maxLength: Int, name: String) {
        require(value.length <= maxLength) { "$name must not exceed $maxLength characters." }
    }

    private fun escapeXml(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")
}
