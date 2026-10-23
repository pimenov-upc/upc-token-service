package upctokenservice;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/** UPC Token Service client. Uses only the Java standard library (JDK 11+). */
public final class UpcTokenService {
  public static final class UpcTokenServiceResource {
    public static final String Test = "https://ecg.test.upc.ua";
    public static final String Production = "https://secure.upc.ua";
    private UpcTokenServiceResource() {}
  }

  public enum UpcTokenServiceEnvironment { TEST, PRODUCTION }

  public enum TokenReasonCode {
    DEVICE_LOST, DEVICE_STOLEN, SUSPECTED_FRAUD, ACCOUNT_CLOSED, NOT_FRAUD, DEVICE_FOUND, OTHER
  }

  public static final class UpcTokenServiceOptions {
    public final String merchantId;
    public final String terminalId;
    /** Request timeout in milliseconds; null selects 60 seconds. */
    public final Long timeout;
    public final boolean logging;
    public UpcTokenServiceOptions(String merchantId, String terminalId) { this(merchantId, terminalId, null, false); }
    public UpcTokenServiceOptions(String merchantId, String terminalId, Long timeout, boolean logging) {
      this.merchantId = merchantId; this.terminalId = terminalId; this.timeout = timeout; this.logging = logging;
    }
  }

  public static class TokenRequest {
    public final String trackingId;
    public final String tokenId;
    public TokenRequest(String trackingId, String tokenId) { this.trackingId = trackingId; this.tokenId = tokenId; }
  }

  public static final class CardDetails {
    public final String cardNum;
    public final String expMonth;
    public final String expYear;
    public final String cvNum;
    public CardDetails(String cardNum, String expMonth, String expYear) { this(cardNum, expMonth, expYear, null); }
    public CardDetails(String cardNum, String expMonth, String expYear, String cvNum) {
      this.cardNum = cardNum; this.expMonth = expMonth; this.expYear = expYear; this.cvNum = cvNum;
    }
  }

  public static final class CreateTokenRequest {
    public final String trackingId;
    public final CardDetails card;
    public CreateTokenRequest(String trackingId, CardDetails card) { this.trackingId = trackingId; this.card = card; }
  }

  public static final class UpdateTokenRequest extends TokenRequest {
    public final TokenReasonCode reasonCode;
    public final String reason;
    public UpdateTokenRequest(String trackingId, String tokenId) { this(trackingId, tokenId, null, null); }
    public UpdateTokenRequest(String trackingId, String tokenId, TokenReasonCode reasonCode, String reason) {
      super(trackingId, tokenId); this.reasonCode = reasonCode; this.reason = reason;
    }
  }

  public static final class CardContentRequest {
    public final String trackingId;
    public final String contentId;
    public final String brand;
    public CardContentRequest(String trackingId, String contentId) { this(trackingId, contentId, null); }
    public CardContentRequest(String trackingId, String contentId, String brand) {
      this.trackingId = trackingId; this.contentId = contentId; this.brand = brand;
    }
  }

  public static final class CardMetadataRequest extends TokenRequest {
    public CardMetadataRequest(String trackingId, String tokenId) { super(trackingId, tokenId); }
  }

  /** Error raised for non-2xx responses. */
  public static final class FetchError extends IOException {
    public final int status;
    public final String url;
    public final String responseBody;
    public FetchError(int status, String url, String responseBody) {
      super("Request failed with status " + status); this.status = status; this.url = url; this.responseBody = responseBody;
    }
  }

  private static final String XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
  private static final String XML_SCHEMA = "https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd";
  private static final String XML_ROOT_OPEN = "<ECommerceConnect xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\" "
      + "xmlns:noNamespaceSchemaLocation=\"" + XML_SCHEMA + "\" "
      + "xmlns:xenc=\"http://www.w3.org/2001/04/xmlenc#\" "
      + "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" "
      + "xsi:noNamespaceSchemaLocation=\"" + XML_SCHEMA + "\">";
  private static final AtomicLong MESSAGE_ID = new AtomicLong();
  private static final Pattern SENSITIVE = Pattern.compile(
      "(<(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\\b[^>]*>)[\\s\\S]*?(</(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\\s*>)", Pattern.CASE_INSENSITIVE);
  private static final Pattern ENCODED_DATA = Pattern.compile("<encodedData\\b[^>]*>[\\s\\S]*?</encodedData\\s*>", Pattern.CASE_INSENSITIVE);

  private final String baseUrl;
  private final UpcTokenServiceOptions options;
  private final Duration timeout;
  private final HttpClient httpClient;

  /** Creates a client for test, production, or a custom HTTPS base URL. */
  public UpcTokenService(String resource, UpcTokenServiceOptions options) {
    if (options == null) throw new IllegalArgumentException("options must not be null.");
    this.baseUrl = resolveBaseUrl(resource);
    validateNonEmpty(options.merchantId, "merchantId"); validateNonEmpty(options.terminalId, "terminalId");
    validateMaxLength(options.merchantId, 35, "merchantId"); validateMaxLength(options.terminalId, 35, "terminalId");
    if (options.timeout != null && options.timeout <= 0) throw new IllegalArgumentException("timeout must be greater than 0 milliseconds.");
    this.options = options;
    this.timeout = Duration.ofMillis(options.timeout == null ? 60_000 : options.timeout);
    this.httpClient = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NORMAL).build();
  }

  /** Creates a token for a card. Example: client.createToken(new CreateTokenRequest("c1", card)). */
  public String createToken(CreateTokenRequest request) throws IOException, InterruptedException {
    if (request == null || request.card == null) throw new IllegalArgumentException("card must not be null.");
    validateTrackingId(request.trackingId); validateNonEmpty(request.card.cardNum, "card.cardNum");
    validateNonEmpty(request.card.expMonth, "card.expMonth"); validateNonEmpty(request.card.expYear, "card.expYear");
    List<XmlNode> card = nodes(text("CardNum", request.card.cardNum), text("ExpYear", request.card.expYear), text("ExpMonth", request.card.expMonth));
    if (request.card.cvNum != null) card.add(text("CVNum", request.card.cvNum));
    return send("/go/token/create", "XMLCreateTokenRequest", nodes(merchant(), terminal(), text("trackingId", request.trackingId), children("Card", card)));
  }

  /** Refreshes an existing token and obtains fresh payment token data. */
  public String refreshToken(TokenRequest request) throws IOException, InterruptedException {
    validateTokenRequest(request);
    return send("/go/token/refresh", "XMLRefreshTokenRequest", tokenPayload(request));
  }

  /** Permanently deletes a token. Deleted tokens cannot be resumed. */
  public String deleteToken(UpdateTokenRequest request) throws IOException, InterruptedException {
    validateTokenRequest(request);
    return send("/go/token/delete", "XMLDeleteTokenRequest", updatePayload(request));
  }

  /** Retrieves the current state of a token. */
  public String getTokenStatus(TokenRequest request) throws IOException, InterruptedException {
    validateTokenRequest(request);
    return send("/go/token/status", "XMLTokenStatusRequest", tokenPayload(request));
  }

  /** Suspends a token, allowing it to be resumed later. */
  public String suspendToken(UpdateTokenRequest request) throws IOException, InterruptedException {
    validateTokenRequest(request);
    return send("/go/token/suspend", "XMLSuspendTokenRequest", updatePayload(request));
  }

  /** Resumes a previously suspended token. */
  public String resumeToken(UpdateTokenRequest request) throws IOException, InterruptedException {
    validateTokenRequest(request);
    return send("/go/token/resume", "XMLResumeTokenRequest", updatePayload(request));
  }

  /** Retrieves card content by content ID. */
  public String getCardContent(CardContentRequest request) throws IOException, InterruptedException {
    if (request == null) throw new IllegalArgumentException("request must not be null.");
    validateTrackingId(request.trackingId); validateNonEmpty(request.contentId, "contentId");
    List<XmlNode> payload = nodes(merchant(), terminal(), text("trackingId", request.trackingId), text("contentId", request.contentId));
    if (request.brand != null) payload.add(text("Brand", request.brand));
    return send("/go/card/content", "XMLGetCardContentRequest", payload);
  }

  /** Retrieves card metadata for a token. */
  public String getCardMetadata(CardMetadataRequest request) throws IOException, InterruptedException {
    validateTokenRequest(request);
    return send("/go/card/metadata", "XMLGetCardMetadataRequest", tokenPayload(request));
  }

  private List<XmlNode> tokenPayload(TokenRequest request) {
    return nodes(merchant(), terminal(), text("trackingId", request.trackingId), children("UPCToken", nodes(text("tokenId", request.tokenId))));
  }
  private List<XmlNode> updatePayload(UpdateTokenRequest request) {
    List<XmlNode> update = nodes(children("UPCToken", nodes(text("tokenId", request.tokenId))));
    if (request.reasonCode != null) update.add(text("reasonCode", request.reasonCode.name()));
    if (request.reason != null) update.add(text("reason", request.reason));
    return nodes(merchant(), terminal(), text("trackingId", request.trackingId), children("UpdateTokenRequest", update));
  }
  private XmlNode merchant() { return text("MerchantID", options.merchantId); }
  private XmlNode terminal() { return text("TerminalID", options.terminalId); }
  private static XmlNode text(String name, String value) { return new XmlNode(name, value, null); }
  private static XmlNode children(String name, List<XmlNode> value) { return new XmlNode(name, null, value); }
  private static List<XmlNode> nodes(XmlNode... values) { return new ArrayList<>(List.of(values)); }

  private String send(String endpoint, String operation, List<XmlNode> payload) throws IOException, InterruptedException {
    String url = baseUrl + endpoint; String xml = createXmlRequest(operation, payload);
    if (options.logging) {
      System.out.println("[UPC Token Service] POST " + url + " (" + operation + ")");
      System.out.println("[UPC Token Service] Request Content-Type: application/xml");
      System.out.println("[UPC Token Service] Request XML for " + operation + ": " + redactXmlForLog(xml));
    }
    try {
      HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(timeout).header("Content-Type", "application/xml")
          .POST(HttpRequest.BodyPublishers.ofString(xml, StandardCharsets.UTF_8)).build();
      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (response.statusCode() < 200 || response.statusCode() >= 300) throw new FetchError(response.statusCode(), url, response.body());
      if (options.logging) {
        String body = response.body().isEmpty() ? "[empty response body]" : redactXmlForLog(response.body());
        String requestId = response.headers().firstValue("x-request-id").orElseGet(() -> response.headers().firstValue("x-correlation-id").orElseGet(() -> response.headers().firstValue("correlation-id").orElse("not provided")));
        System.out.println("[UPC Token Service] HTTP " + response.statusCode() + " response for " + operation
            + " (Content-Type: " + response.headers().firstValue("content-type").orElse("not provided")
            + "; Content-Length: " + response.headers().firstValue("content-length").orElse("not provided")
            + "; Request-ID: " + requestId + "; Empty: " + response.body().isEmpty() + "): " + body);
      }
      return response.body();
    } catch (IOException | InterruptedException error) {
      if (options.logging) System.err.println("[UPC Token Service] " + operation + " failed: " + error.getMessage());
      throw error;
    }
  }

  private static String createXmlRequest(String operation, List<XmlNode> payload) {
    StringBuilder body = new StringBuilder(); for (XmlNode node : payload) body.append(serialize(node));
    return XML_HEADER + XML_ROOT_OPEN + "<Message id=\"" + MESSAGE_ID.incrementAndGet() + "\" version=\"1.0\"><" + operation + ">" + body + "</" + operation + "></Message></ECommerceConnect>";
  }
  private static String serialize(XmlNode node) {
    StringBuilder result = new StringBuilder("<").append(node.name).append('>');
    if (node.children != null) for (XmlNode child : node.children) result.append(serialize(child));
    else result.append(escapeXml(node.value));
    return result.append("</").append(node.name).append('>').toString();
  }
  private static String escapeXml(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;"); }
  private static String redactXmlForLog(String xml) {
    String result = SENSITIVE.matcher(xml).replaceAll("$1[REDACTED]$2");
    result = ENCODED_DATA.matcher(result).replaceAll("<encodedData>[OMITTED]</encodedData>");
    return result.length() > 2000 ? result.substring(0, 2000) + "…[truncated]" : result;
  }
  private static String resolveBaseUrl(String resource) {
    if (resource == null) throw new IllegalArgumentException("resource must be a valid UPC HTTPS URL or environment name.");
    String candidate = resource.equals("test") ? UpcTokenServiceResource.Test : resource.equals("production") ? UpcTokenServiceResource.Production : resource;
    final URI uri;
    try { uri = URI.create(candidate); } catch (IllegalArgumentException error) { throw new IllegalArgumentException("resource must be a valid UPC HTTPS URL or environment name.", error); }
    if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isBlank()) throw new IllegalArgumentException("UPC Token Service resource must use HTTPS.");
    if ((uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/")) || uri.getRawQuery() != null || uri.getRawFragment() != null)
      throw new IllegalArgumentException("Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically.");
    return "https://" + uri.getHost() + (uri.getPort() < 0 ? "" : ":" + uri.getPort());
  }
  private static void validateTokenRequest(TokenRequest request) {
    if (request == null) throw new IllegalArgumentException("request must not be null.");
    validateTrackingId(request.trackingId); validateNonEmpty(request.tokenId, "tokenId");
  }
  private static void validateTrackingId(String value) { validateNonEmpty(value, "trackingId"); validateMaxLength(value, 10, "trackingId"); }
  private static void validateNonEmpty(String value, String name) { if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException(name + " must not be empty."); }
  private static void validateMaxLength(String value, int max, String name) { if (value.codePointCount(0, value.length()) > max) throw new IllegalArgumentException(name + " must not exceed " + max + " characters."); }
  private static final class XmlNode {
    final String name; final String value; final List<XmlNode> children;
    XmlNode(String name, String value, List<XmlNode> children) { this.name = name; this.value = value; this.children = children; }
  }
}
