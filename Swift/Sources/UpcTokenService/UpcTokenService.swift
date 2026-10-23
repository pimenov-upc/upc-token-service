import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Standard UPC Token Service base URLs.
public enum UpcTokenServiceResource {
    public static let Test = "https://ecg.test.upc.ua"
    public static let Production = "https://secure.upc.ua"
}

public enum UpcTokenServiceEnvironment: String {
    case test
    case production
}

public typealias UpcTokenServiceResponse = String

/// Client options. Timeout is expressed in milliseconds; nil uses 60 seconds.
public struct UpcTokenServiceOptions {
    public let merchantId: String
    public let terminalId: String
    public let timeout: Int?
    public let logging: Bool

    public init(merchantId: String, terminalId: String, timeout: Int? = nil, logging: Bool = false) {
        self.merchantId = merchantId
        self.terminalId = terminalId
        self.timeout = timeout
        self.logging = logging
    }
}

public struct TokenRequest {
    public let trackingId: String
    public let tokenId: String
    public init(trackingId: String, tokenId: String) {
        self.trackingId = trackingId
        self.tokenId = tokenId
    }
}

public struct CardDetails {
    public let cardNum: String
    public let expMonth: String
    public let expYear: String
    public let cvNum: String?
    public init(cardNum: String, expMonth: String, expYear: String, cvNum: String? = nil) {
        self.cardNum = cardNum
        self.expMonth = expMonth
        self.expYear = expYear
        self.cvNum = cvNum
    }
}

public struct CreateTokenRequest {
    public let trackingId: String
    public let card: CardDetails
    public init(trackingId: String, card: CardDetails) {
        self.trackingId = trackingId
        self.card = card
    }
}

public enum TokenReasonCode: String {
    case DEVICE_LOST
    case DEVICE_STOLEN
    case SUSPECTED_FRAUD
    case ACCOUNT_CLOSED
    case NOT_FRAUD
    case DEVICE_FOUND
    case OTHER
}

public struct UpdateTokenRequest {
    public let trackingId: String
    public let tokenId: String
    public let reasonCode: TokenReasonCode?
    public let reason: String?
    public init(trackingId: String, tokenId: String, reasonCode: TokenReasonCode? = nil, reason: String? = nil) {
        self.trackingId = trackingId
        self.tokenId = tokenId
        self.reasonCode = reasonCode
        self.reason = reason
    }
}

public struct CardContentRequest {
    public let trackingId: String
    public let contentId: String
    public let brand: String?
    public init(trackingId: String, contentId: String, brand: String? = nil) {
        self.trackingId = trackingId
        self.contentId = contentId
        self.brand = brand
    }
}

public struct CardMetadataRequest {
    public let trackingId: String
    public let tokenId: String
    public init(trackingId: String, tokenId: String) {
        self.trackingId = trackingId
        self.tokenId = tokenId
    }
}

public struct FetchError: Error, LocalizedError {
    public let status: Int
    public let url: String
    public let responseBody: String
    public var errorDescription: String? { "Request failed with status \(status)" }
    public init(status: Int, url: String, responseBody: String) {
        self.status = status
        self.url = url
        self.responseBody = responseBody
    }
}

private struct XmlNode {
    let name: String
    let value: String?
    let children: [XmlNode]?

    static func text(_ name: String, _ value: String) -> XmlNode { XmlNode(name: name, value: value, children: nil) }
    static func group(_ name: String, _ children: [XmlNode]) -> XmlNode { XmlNode(name: name, value: nil, children: children) }
}

/// Asynchronous client for the UPC Token Service XML API.
/// Example: `let client = try UpcTokenService(resource: "test", options: options)`.
public final class UpcTokenService {
    private static let xmlHeader = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
    private static let schema = "https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"
    private static let xmlRootOpen = "<ECommerceConnect xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\" " +
        "xmlns:noNamespaceSchemaLocation=\"https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd\" " +
        "xmlns:xenc=\"http://www.w3.org/2001/04/xmlenc#\" " +
        "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" " +
        "xsi:noNamespaceSchemaLocation=\"https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd\">"
    private static let messageIdLock = NSLock()
    private static var messageId = 0
    private static let apiPaths = [
        "createToken": "/go/token/create", "refreshToken": "/go/token/refresh",
        "deleteToken": "/go/token/delete", "getTokenStatus": "/go/token/status",
        "suspendToken": "/go/token/suspend", "resumeToken": "/go/token/resume",
        "getCardContent": "/go/card/content", "getCardMetadata": "/go/card/metadata"
    ]

    private let baseURL: String
    private let options: UpcTokenServiceOptions
    private let timeoutSeconds: TimeInterval
    private let session: URLSession

    public init(resource: String, options: UpcTokenServiceOptions) throws {
        self.baseURL = try Self.resolveBaseURL(resource)
        self.options = options
        try Self.validateNonEmpty(options.merchantId, name: "merchantId")
        try Self.validateNonEmpty(options.terminalId, name: "terminalId")
        try Self.validateMaxLength(options.merchantId, maxLength: 35, name: "merchantId")
        try Self.validateMaxLength(options.terminalId, maxLength: 35, name: "terminalId")
        if let timeout = options.timeout, timeout <= 0 {
            throw UpcTokenServiceValidationError("timeout must be greater than 0 milliseconds.")
        }
        let timeoutMs = options.timeout ?? 60_000
        let requestTimeoutSeconds = TimeInterval(timeoutMs) / 1000
        self.timeoutSeconds = requestTimeoutSeconds
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = requestTimeoutSeconds
        configuration.timeoutIntervalForResource = requestTimeoutSeconds
        self.session = URLSession(configuration: configuration)
    }

    /// Creates a UPC token for a card.
    public func createToken(_ request: CreateTokenRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTrackingId(request.trackingId)
        try Self.validateNonEmpty(request.card.cardNum, name: "card.cardNum")
        try Self.validateNonEmpty(request.card.expMonth, name: "card.expMonth")
        try Self.validateNonEmpty(request.card.expYear, name: "card.expYear")
        var card = [XmlNode.text("CardNum", request.card.cardNum), XmlNode.text("ExpYear", request.card.expYear), XmlNode.text("ExpMonth", request.card.expMonth)]
        if let cvNum = request.card.cvNum { card.append(.text("CVNum", cvNum)) }
        return try await send("createToken", operation: "XMLCreateTokenRequest", payload: [
            merchantNode, terminalNode, .text("trackingId", request.trackingId), .group("Card", card)
        ])
    }

    /// Refreshes an existing token and obtains fresh payment token data.
    public func refreshToken(_ request: TokenRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTokenRequest(request.trackingId, tokenId: request.tokenId)
        return try await send("refreshToken", operation: "XMLRefreshTokenRequest", payload: tokenPayload(request.trackingId, request.tokenId))
    }

    /// Permanently deletes a token. Deleted tokens cannot be resumed.
    public func deleteToken(_ request: UpdateTokenRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTokenRequest(request.trackingId, tokenId: request.tokenId)
        return try await send("deleteToken", operation: "XMLDeleteTokenRequest", payload: updatePayload(request))
    }

    /// Retrieves the current state of a token.
    public func getTokenStatus(_ request: TokenRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTokenRequest(request.trackingId, tokenId: request.tokenId)
        return try await send("getTokenStatus", operation: "XMLTokenStatusRequest", payload: tokenPayload(request.trackingId, request.tokenId))
    }

    /// Suspends a token, allowing it to be resumed later.
    public func suspendToken(_ request: UpdateTokenRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTokenRequest(request.trackingId, tokenId: request.tokenId)
        return try await send("suspendToken", operation: "XMLSuspendTokenRequest", payload: updatePayload(request))
    }

    /// Resumes a previously suspended token.
    public func resumeToken(_ request: UpdateTokenRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTokenRequest(request.trackingId, tokenId: request.tokenId)
        return try await send("resumeToken", operation: "XMLResumeTokenRequest", payload: updatePayload(request))
    }

    /// Retrieves card content by content ID.
    public func getCardContent(_ request: CardContentRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTrackingId(request.trackingId)
        try Self.validateNonEmpty(request.contentId, name: "contentId")
        var payload = basePayload(request.trackingId) + [.text("contentId", request.contentId)]
        if let brand = request.brand { payload.append(.text("Brand", brand)) }
        return try await send("getCardContent", operation: "XMLGetCardContentRequest", payload: payload)
    }

    /// Retrieves card metadata for a token.
    public func getCardMetadata(_ request: CardMetadataRequest) async throws -> UpcTokenServiceResponse {
        try Self.validateTokenRequest(request.trackingId, tokenId: request.tokenId)
        return try await send("getCardMetadata", operation: "XMLGetCardMetadataRequest", payload: tokenPayload(request.trackingId, request.tokenId))
    }

    private var merchantNode: XmlNode { .text("MerchantID", options.merchantId) }
    private var terminalNode: XmlNode { .text("TerminalID", options.terminalId) }
    private func basePayload(_ trackingId: String) -> [XmlNode] { [merchantNode, terminalNode, .text("trackingId", trackingId)] }
    private func tokenPayload(_ trackingId: String, _ tokenId: String) -> [XmlNode] {
        basePayload(trackingId) + [.group("UPCToken", [.text("tokenId", tokenId)])]
    }
    private func updatePayload(_ request: UpdateTokenRequest) -> [XmlNode] {
        var update = [XmlNode.group("UPCToken", [.text("tokenId", request.tokenId)])]
        if let reasonCode = request.reasonCode { update.append(.text("reasonCode", reasonCode.rawValue)) }
        if let reason = request.reason { update.append(.text("reason", reason)) }
        return basePayload(request.trackingId) + [.group("UpdateTokenRequest", update)]
    }

    private func send(_ pathKey: String, operation: String, payload: [XmlNode]) async throws -> String {
        guard let path = Self.apiPaths[pathKey] else { throw UpcTokenServiceValidationError("Unknown API operation.") }
        let urlString = baseURL + path
        let xml = Self.createXMLRequest(operation, payload: payload)
        if options.logging {
            print("[UPC Token Service] POST \(urlString) (\(operation))")
            print("[UPC Token Service] Request Content-Type: application/xml")
            print("[UPC Token Service] Request XML for \(operation): \(Self.redactXML(xml))")
        }
        guard let url = URL(string: urlString) else { throw UpcTokenServiceValidationError("Invalid request URL.") }
        var request = URLRequest(url: url, timeoutInterval: timeoutSeconds)
        request.httpMethod = "POST"
        request.setValue("application/xml", forHTTPHeaderField: "Content-Type")
        request.httpBody = xml.data(using: .utf8)
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else { throw UpcTokenServiceValidationError("UPC returned a non-HTTP response.") }
            let responseXML = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            guard (200..<300).contains(httpResponse.statusCode) else {
                throw FetchError(status: httpResponse.statusCode, url: urlString, responseBody: responseXML)
            }
            if options.logging {
                let requestId = httpResponse.value(forHTTPHeaderField: "x-request-id")
                    ?? httpResponse.value(forHTTPHeaderField: "x-correlation-id")
                    ?? httpResponse.value(forHTTPHeaderField: "correlation-id") ?? "not provided"
                let body = responseXML.isEmpty ? "[empty response body]" : Self.redactXML(responseXML)
                print("[UPC Token Service] HTTP \(httpResponse.statusCode) response for \(operation) " +
                      "(Content-Type: \(httpResponse.value(forHTTPHeaderField: "content-type") ?? "not provided"); " +
                      "Content-Length: \(httpResponse.value(forHTTPHeaderField: "content-length") ?? "not provided"); " +
                      "Request-ID: \(requestId); Empty: \(responseXML.isEmpty)): \(body)")
            }
            return responseXML
        } catch {
            if options.logging { fputs("[UPC Token Service] \(operation) failed: \(error.localizedDescription)\n", stderr) }
            throw error
        }
    }

    private static func createXMLRequest(_ operation: String, payload: [XmlNode]) -> String {
        messageIdLock.lock()
        messageId += 1
        let id = messageId
        messageIdLock.unlock()
        let body = payload.map(serialize).joined()
        return "\(xmlHeader)\(xmlRootOpen)<Message id=\"\(id)\" version=\"1.0\"><\(operation)>\(body)</\(operation)></Message></ECommerceConnect>"
    }

    private static func serialize(_ node: XmlNode) -> String {
        let content = node.children?.map(serialize).joined() ?? escapeXML(node.value ?? "")
        return "<\(node.name)>\(content)</\(node.name)>"
    }

    private static func escapeXML(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    private static func redactXML(_ xml: String) -> String {
        var result = xml
        for tag in ["CardNum", "CVNum", "TokenNumber", "TAVV", "tokenId"] {
            let pattern = "(<\(tag)\\b[^>]*>)[\\s\\S]*?(</\(tag)\\s*>)"
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                result = regex.stringByReplacingMatches(in: result, range: NSRange(result.startIndex..., in: result), withTemplate: "$1[REDACTED]$2")
            }
        }
        if let regex = try? NSRegularExpression(pattern: "<encodedData\\b[^>]*>[\\s\\S]*?</encodedData\\s*>", options: [.caseInsensitive]) {
            result = regex.stringByReplacingMatches(in: result, range: NSRange(result.startIndex..., in: result), withTemplate: "<encodedData>[OMITTED]</encodedData>")
        }
        return result.count > 2000 ? String(result.prefix(2000)) + "…[truncated]" : result
    }

    private static func resolveBaseURL(_ resource: String) throws -> String {
        let candidate = resource == "test" ? UpcTokenServiceResource.Test
            : resource == "production" ? UpcTokenServiceResource.Production : resource
        guard let components = URLComponents(string: candidate),
              components.scheme?.lowercased() == "https", let host = components.host, !host.isEmpty else {
            throw UpcTokenServiceValidationError("UPC Token Service resource must use HTTPS.")
        }
        guard (components.path.isEmpty || components.path == "/"), components.query == nil, components.fragment == nil else {
            throw UpcTokenServiceValidationError("Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically.")
        }
        var result = "https://\(host)"
        if let port = components.port { result += ":\(port)" }
        return result
    }

    private static func validateTokenRequest(_ trackingId: String, tokenId: String) throws {
        try validateTrackingId(trackingId)
        try validateNonEmpty(tokenId, name: "tokenId")
    }
    private static func validateTrackingId(_ value: String) throws {
        try validateNonEmpty(value, name: "trackingId")
        try validateMaxLength(value, maxLength: 10, name: "trackingId")
    }
    private static func validateNonEmpty(_ value: String, name: String) throws {
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw UpcTokenServiceValidationError("\(name) must not be empty.")
        }
    }
    private static func validateMaxLength(_ value: String, maxLength: Int, name: String) throws {
        if value.utf16.count > maxLength { throw UpcTokenServiceValidationError("\(name) must not exceed \(maxLength) characters.") }
    }
}

public struct UpcTokenServiceValidationError: Error, LocalizedError {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}
