import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// UPC Token Service resource URLs and standard environment names.
final class UpcTokenServiceResource {
  UpcTokenServiceResource._();

  static const String Test = 'https://ecg.test.upc.ua';
  static const String Production = 'https://secure.upc.ua';
}

typedef UpcTokenServiceEnvironment = String;
typedef UpcTokenServiceResponse = String;

/// Configuration used to construct [UpcTokenService].
class UpcTokenServiceOptions {
  const UpcTokenServiceOptions({
    required this.merchantId,
    required this.terminalId,
    this.timeout,
    this.logging = false,
  });

  final String merchantId;
  final String terminalId;
  final int? timeout;
  final bool logging;
}

class TokenRequest {
  const TokenRequest({required this.trackingId, required this.tokenId});

  final String trackingId;
  final String tokenId;
}

class CardDetails {
  const CardDetails({
    required this.cardNum,
    required this.expMonth,
    required this.expYear,
    this.cvNum,
  });

  final String cardNum;
  final String expMonth;
  final String expYear;
  final String? cvNum;
}

class CreateTokenRequest {
  const CreateTokenRequest({required this.trackingId, required this.card});

  final String trackingId;
  final CardDetails card;
}

enum TokenReasonCode {
  DEVICE_LOST,
  DEVICE_STOLEN,
  SUSPECTED_FRAUD,
  ACCOUNT_CLOSED,
  NOT_FRAUD,
  DEVICE_FOUND,
  OTHER,
}

class UpdateTokenRequest extends TokenRequest {
  const UpdateTokenRequest({
    required super.trackingId,
    required super.tokenId,
    this.reasonCode,
    this.reason,
  });

  final TokenReasonCode? reasonCode;
  final String? reason;
}

class CardContentRequest {
  const CardContentRequest({
    required this.trackingId,
    required this.contentId,
    this.brand,
  });

  final String trackingId;
  final String contentId;
  final String? brand;
}

class CardMetadataRequest extends TokenRequest {
  const CardMetadataRequest({
    required super.trackingId,
    required super.tokenId,
  });
}

/// HTTP error raised when UPC responds with a non-success status.
class FetchError implements Exception {
  const FetchError({
    required this.status,
    required this.message,
    required this.url,
    this.responseBody,
  });

  final int status;
  final String message;
  final String url;
  final String? responseBody;

  @override
  String toString() => 'FetchError: $message';
}

const int _defaultTimeoutMs = 60000;
const String _xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const String _xmlRootOpen =
    '<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#" '
    'xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd" '
    'xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd">';

const Map<String, String> _apiPaths = {
  'createToken': '/go/token/create',
  'refreshToken': '/go/token/refresh',
  'deleteToken': '/go/token/delete',
  'getTokenStatus': '/go/token/status',
  'suspendToken': '/go/token/suspend',
  'resumeToken': '/go/token/resume',
  'getCardContent': '/go/card/content',
  'getCardMetadata': '/go/card/metadata',
};

/// UPC Token Service SDK client.
///
/// [resource] accepts `test`, `production`, or a custom base HTTPS URL.
/// API paths are appended automatically. Call [close] when the client is no
/// longer needed to release its underlying HTTP connection pool.
class UpcTokenService {
  UpcTokenService(String resource, this.options)
    : _baseUrl = _resolveBaseUrl(resource),
      _http = _HttpClient(timeoutMs: options.timeout ?? _defaultTimeoutMs) {
    _validateNonEmpty(options.merchantId, 'merchantId');
    _validateNonEmpty(options.terminalId, 'terminalId');
    _validateMaxLength(options.merchantId, 35, 'merchantId');
    _validateMaxLength(options.terminalId, 35, 'terminalId');
  }

  static int _messageId = 0;

  final UpcTokenServiceOptions options;
  final String _baseUrl;
  final _HttpClient _http;

  /// Closes the HTTP connection pool. The client cannot be used afterward.
  void close({bool force = false}) => _http.close(force: force);

  /// Creates a UPC token for a card.
  Future<UpcTokenServiceResponse> createToken(CreateTokenRequest request) {
    _validateTrackingId(request.trackingId);
    _validateNonEmpty(request.card.cardNum, 'card.cardNum');
    _validateNonEmpty(request.card.expMonth, 'card.expMonth');
    _validateNonEmpty(request.card.expYear, 'card.expYear');

    final card = <String, Object?>{
      'CardNum': request.card.cardNum,
      'ExpYear': request.card.expYear,
      'ExpMonth': request.card.expMonth,
      if (request.card.cvNum != null) 'CVNum': request.card.cvNum,
    };

    return _send(_apiPaths['createToken']!, 'XMLCreateTokenRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'Card': card,
    });
  }

  /// Refreshes an existing token and obtains fresh payment token data.
  Future<UpcTokenServiceResponse> refreshToken(TokenRequest request) {
    _validateTokenRequest(request);
    return _send(_apiPaths['refreshToken']!, 'XMLRefreshTokenRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'UPCToken': {'tokenId': request.tokenId},
    });
  }

  /// Permanently deletes a token. Deleted tokens cannot be resumed.
  Future<UpcTokenServiceResponse> deleteToken(UpdateTokenRequest request) {
    _validateTokenRequest(request);
    return _send(_apiPaths['deleteToken']!, 'XMLDeleteTokenRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'UpdateTokenRequest': {
        'UPCToken': {'tokenId': request.tokenId},
        ..._reasonPayload(request),
      },
    });
  }

  /// Retrieves the current state of a token.
  Future<UpcTokenServiceResponse> getTokenStatus(TokenRequest request) {
    _validateTokenRequest(request);
    return _send(_apiPaths['getTokenStatus']!, 'XMLTokenStatusRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'UPCToken': {'tokenId': request.tokenId},
    });
  }

  /// Suspends a token, allowing it to be resumed later.
  Future<UpcTokenServiceResponse> suspendToken(UpdateTokenRequest request) {
    _validateTokenRequest(request);
    return _send(_apiPaths['suspendToken']!, 'XMLSuspendTokenRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'UpdateTokenRequest': {
        'UPCToken': {'tokenId': request.tokenId},
        ..._reasonPayload(request),
      },
    });
  }

  /// Resumes a previously suspended token.
  Future<UpcTokenServiceResponse> resumeToken(UpdateTokenRequest request) {
    _validateTokenRequest(request);
    return _send(_apiPaths['resumeToken']!, 'XMLResumeTokenRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'UpdateTokenRequest': {
        'UPCToken': {'tokenId': request.tokenId},
        ..._reasonPayload(request),
      },
    });
  }

  /// Retrieves card content by its content ID.
  Future<UpcTokenServiceResponse> getCardContent(CardContentRequest request) {
    _validateTrackingId(request.trackingId);
    _validateNonEmpty(request.contentId, 'contentId');
    return _send(_apiPaths['getCardContent']!, 'XMLGetCardContentRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'contentId': request.contentId,
      if (request.brand != null) 'Brand': request.brand,
    });
  }

  /// Retrieves card metadata for a token.
  Future<UpcTokenServiceResponse> getCardMetadata(CardMetadataRequest request) {
    _validateTokenRequest(request);
    return _send(_apiPaths['getCardMetadata']!, 'XMLGetCardMetadataRequest', {
      ..._merchantPayload(),
      'trackingId': request.trackingId,
      'UPCToken': {'tokenId': request.tokenId},
    });
  }

  Map<String, Object?> _merchantPayload() => {
    'MerchantID': options.merchantId,
    'TerminalID': options.terminalId,
  };

  Map<String, Object?> _reasonPayload(UpdateTokenRequest request) => {
    if (request.reasonCode != null) 'reasonCode': request.reasonCode!.name,
    if (request.reason != null) 'reason': request.reason,
  };

  Future<UpcTokenServiceResponse> _send(
    String endpoint,
    String operation,
    Map<String, Object?> payload,
  ) async {
    final xml = _createXmlRequest(operation, payload);
    final url = '$_baseUrl$endpoint';
    if (options.logging) {
      print('[UPC Token Service] POST $url ($operation)');
      print('[UPC Token Service] Request Content-Type: application/xml');
      print(
        '[UPC Token Service] Request XML for $operation: ${_redactXmlForLog(xml)}',
      );
    }

    try {
      final result = await _http.post(url, xml);
      final requestId =
          result.headers['x-request-id']?.firstOrNull ??
          result.headers['x-correlation-id']?.firstOrNull ??
          result.headers['correlation-id']?.firstOrNull ??
          'not provided';
      final contentType =
          result.headers.contentType?.toString() ?? 'not provided';
      final contentLength = result.contentLength < 0
          ? 'not provided'
          : result.contentLength.toString();

      if (options.logging) {
        print(
          '[UPC Token Service] HTTP ${result.statusCode} response for $operation '
          '(Content-Type: $contentType; Content-Length: $contentLength; '
          'Request-ID: $requestId; Empty: ${result.body.isEmpty}): '
          '${result.body.isEmpty ? '[empty response body]' : _redactXmlForLog(result.body)}',
        );
      }
      return result.body;
    } catch (error) {
      final status = error is FetchError ? error.status : 'unavailable';
      if (options.logging) {
        stderr.writeln(
          '[UPC Token Service] $operation failed (HTTP $status): $error',
        );
      }
      rethrow;
    }
  }

  String _createXmlRequest(String operation, Map<String, Object?> payload) {
    _messageId += 1;
    final requestBody = payload.entries
        .map((entry) => _serializeXmlElement(entry.key, entry.value))
        .join();
    return '$_xmlHeader$_xmlRootOpen<Message id="$_messageId" version="1.0">'
        '<$operation>$requestBody</$operation></Message></ECommerceConnect>';
  }

  static String _resolveBaseUrl(String resource) {
    final resourceUrl = switch (resource) {
      'test' => UpcTokenServiceResource.Test,
      'production' => UpcTokenServiceResource.Production,
      _ => resource,
    };

    final Uri parsedUrl;
    try {
      parsedUrl = Uri.parse(resourceUrl);
    } on FormatException {
      throw ArgumentError(
        'resource must be a valid UPC HTTPS URL or environment name.',
      );
    }

    if (!parsedUrl.hasScheme || parsedUrl.host.isEmpty) {
      throw ArgumentError(
        'resource must be a valid UPC HTTPS URL or environment name.',
      );
    }
    if (parsedUrl.scheme != 'https') {
      throw ArgumentError('UPC Token Service resource must use HTTPS.');
    }
    if ((parsedUrl.path.isNotEmpty && parsedUrl.path != '/') ||
        parsedUrl.hasQuery ||
        parsedUrl.hasFragment) {
      throw ArgumentError(
        'Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically.',
      );
    }
    return parsedUrl.origin;
  }

  static void _validateTokenRequest(TokenRequest request) {
    _validateTrackingId(request.trackingId);
    _validateNonEmpty(request.tokenId, 'tokenId');
  }

  static void _validateTrackingId(String trackingId) {
    _validateNonEmpty(trackingId, 'trackingId');
    _validateMaxLength(trackingId, 10, 'trackingId');
  }

  static void _validateNonEmpty(String value, String name) {
    if (value.trim().isEmpty) {
      throw ArgumentError('$name must not be empty.');
    }
  }

  static void _validateMaxLength(String value, int maxLength, String name) {
    if (value.length > maxLength) {
      throw RangeError('$name must not exceed $maxLength characters.');
    }
  }
}

class _HttpClient {
  _HttpClient({required this.timeoutMs}) : _client = HttpClient();

  final int timeoutMs;
  final HttpClient _client;

  void close({bool force = false}) => _client.close(force: force);

  Future<
    ({int statusCode, HttpHeaders headers, int contentLength, String body})
  >
  post(String url, String body) async {
    final timeout = Duration(milliseconds: timeoutMs);
    final request = await _client.postUrl(Uri.parse(url)).timeout(timeout);
    request.headers.contentType = ContentType('application', 'xml');
    request.write(body);

    try {
      final response = await request.close().timeout(timeout);
      final responseBody = await utf8.decoder
          .bind(response)
          .join()
          .timeout(timeout);
      if (response.statusCode < HttpStatus.ok ||
          response.statusCode >= HttpStatus.multipleChoices) {
        throw FetchError(
          status: response.statusCode,
          message: response.reasonPhrase.isEmpty
              ? 'Request failed with status ${response.statusCode}'
              : response.reasonPhrase,
          url: url,
          responseBody: responseBody,
        );
      }
      return (
        statusCode: response.statusCode,
        headers: response.headers,
        contentLength: response.contentLength,
        body: responseBody,
      );
    } on TimeoutException {
      request.abort(
        TimeoutException('Request timed out after ${timeoutMs}ms.'),
      );
      rethrow;
    }
  }
}

String _serializeXmlElement(String name, Object? value) {
  if (value == null) return '';
  if (value is Map<String, Object?>) {
    final children = value.entries
        .map((entry) => _serializeXmlElement(entry.key, entry.value))
        .join();
    return '<$name>$children</$name>';
  }
  return '<$name>${_escapeXml(value.toString())}</$name>';
}

String _escapeXml(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

String _redactXmlForLog(String xml) {
  const sensitiveTags = ['CardNum', 'CVNum', 'TokenNumber', 'TAVV', 'tokenId'];
  var redactedXml = xml;
  for (final tag in sensitiveTags) {
    final pattern = RegExp(
      '(<$tag\\b[^>]*>)[\\s\\S]*?(</$tag>)',
      caseSensitive: false,
    );
    redactedXml = redactedXml.replaceAllMapped(
      pattern,
      (match) => '${match[1]}[REDACTED]${match[2]}',
    );
  }
  redactedXml = redactedXml.replaceAll(
    RegExp(r'<encodedData\b[^>]*>[\s\S]*?</encodedData>', caseSensitive: false),
    '<encodedData>[OMITTED]</encodedData>',
  );
  const maxLogLength = 2000;
  return redactedXml.length > maxLogLength
      ? '${redactedXml.substring(0, maxLogLength)}…[truncated]'
      : redactedXml;
}
