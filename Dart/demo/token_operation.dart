import 'dart:io';

import 'package:upc_token_service/upc_token_service.dart';

const _operations = {
  'create-token',
  'refresh',
  'delete',
  'status',
  'suspend',
  'resume',
  'card-content',
  'card-metadata',
};

const _reasonCodes = {
  'DEVICE_LOST': TokenReasonCode.DEVICE_LOST,
  'DEVICE_STOLEN': TokenReasonCode.DEVICE_STOLEN,
  'SUSPECTED_FRAUD': TokenReasonCode.SUSPECTED_FRAUD,
  'ACCOUNT_CLOSED': TokenReasonCode.ACCOUNT_CLOSED,
  'NOT_FRAUD': TokenReasonCode.NOT_FRAUD,
  'DEVICE_FOUND': TokenReasonCode.DEVICE_FOUND,
  'OTHER': TokenReasonCode.OTHER,
};

String _requiredEnv(Map<String, String> environment, String name) {
  final value = environment[name]?.trim();
  if (value == null || value.isEmpty) {
    throw StateError('Missing required environment variable: $name');
  }
  return value;
}

String? _optionalEnv(Map<String, String> environment, String name) {
  final value = environment[name]?.trim();
  return value == null || value.isEmpty ? null : value;
}

bool _loggingEnabled(Map<String, String> environment) {
  final value = (environment['UPC_LOGGING'] ?? 'false').trim().toLowerCase();
  if (value != 'true' && value != 'false') {
    throw const FormatException(
        'UPC_LOGGING must be either "true" or "false".');
  }
  return value == 'true';
}

TokenReasonCode? _reasonCode(Map<String, String> environment) {
  final value = _optionalEnv(environment, 'UPC_REASON_CODE');
  if (value == null) return null;
  final code = _reasonCodes[value];
  if (code == null) {
    throw FormatException(
      'UPC_REASON_CODE must be one of: ${_reasonCodes.keys.join(', ')}.',
    );
  }
  return code;
}

String _redactSensitiveXml(String xml) {
  var redacted = xml;
  for (final tag in ['tokenId', 'CardNum', 'CVNum', 'TokenNumber', 'TAVV']) {
    redacted = redacted.replaceAllMapped(
      RegExp('(<$tag\\b[^>]*>)[\\s\\S]*?(</$tag>)', caseSensitive: false),
      (match) => '${match[1]}[REDACTED]${match[2]}',
    );
  }
  return redacted.replaceAll(
    RegExp(r'<encodedData\b[^>]*>[\s\S]*?</encodedData>', caseSensitive: false),
    '<encodedData>[OMITTED]</encodedData>',
  );
}

void _printUsage() {
  stdout.writeln(
    'Usage: dart run demo/token_operation.dart <operation> [--confirm-delete]\n'
    'Operations: ${_operations.join(', ')}\n'
    'Set UPC_MERCHANT_ID, UPC_TERMINAL_ID, and UPC_TRACKING_ID in the environment.\n'
    'See demo/README.md for operation-specific variables.',
  );
}

Future<void> main(List<String> arguments) async {
  if (arguments.isEmpty || arguments.first == '--help') {
    _printUsage();
    return;
  }

  final operation = arguments.first.toLowerCase();
  if (!_operations.contains(operation)) {
    _printUsage();
    stderr.writeln('Unsupported operation: $operation');
    exitCode = 64;
    return;
  }
  if (operation == 'delete' && !arguments.contains('--confirm-delete')) {
    stderr.writeln(
      'Delete is permanent. Re-run with --confirm-delete to confirm.',
    );
    exitCode = 64;
    return;
  }

  UpcTokenService? client;
  try {
    final environment = Platform.environment;
    final merchantId = _requiredEnv(environment, 'UPC_MERCHANT_ID');
    final terminalId = _requiredEnv(environment, 'UPC_TERMINAL_ID');
    final trackingId = _requiredEnv(environment, 'UPC_TRACKING_ID');
    final baseUrl = _optionalEnv(environment, 'UPC_BASE_URL');
    final serviceEnvironment =
        (environment['UPC_ENVIRONMENT'] ?? 'test').trim().toLowerCase();

    if (baseUrl == null &&
        serviceEnvironment != 'test' &&
        serviceEnvironment != 'production') {
      throw const FormatException(
        'UPC_ENVIRONMENT must be either "test" or "production".',
      );
    }

    final reasonCode = _reasonCode(environment);
    final reason = _optionalEnv(environment, 'UPC_REASON');
    client = UpcTokenService(
      baseUrl ?? serviceEnvironment,
      UpcTokenServiceOptions(
        merchantId: merchantId,
        terminalId: terminalId,
        logging: _loggingEnabled(environment),
      ),
    );

    late final String response;
    switch (operation) {
      case 'create-token':
        response = await client.createToken(
          CreateTokenRequest(
            trackingId: trackingId,
            card: CardDetails(
              cardNum: _requiredEnv(environment, 'UPC_CARD_NUMBER'),
              expMonth: _requiredEnv(environment, 'UPC_CARD_EXP_MONTH'),
              expYear: _requiredEnv(environment, 'UPC_CARD_EXP_YEAR'),
              cvNum: _optionalEnv(environment, 'UPC_CARD_CVV'),
            ),
          ),
        );
      case 'refresh':
        response = await client.refreshToken(
          TokenRequest(
            trackingId: trackingId,
            tokenId: _requiredEnv(environment, 'UPC_TOKEN_ID'),
          ),
        );
      case 'delete':
        response = await client.deleteToken(
          UpdateTokenRequest(
            trackingId: trackingId,
            tokenId: _requiredEnv(environment, 'UPC_TOKEN_ID'),
            reasonCode: reasonCode,
            reason: reason,
          ),
        );
      case 'status':
        response = await client.getTokenStatus(
          TokenRequest(
            trackingId: trackingId,
            tokenId: _requiredEnv(environment, 'UPC_TOKEN_ID'),
          ),
        );
      case 'suspend':
        response = await client.suspendToken(
          UpdateTokenRequest(
            trackingId: trackingId,
            tokenId: _requiredEnv(environment, 'UPC_TOKEN_ID'),
            reasonCode: reasonCode,
            reason: reason,
          ),
        );
      case 'resume':
        response = await client.resumeToken(
          UpdateTokenRequest(
            trackingId: trackingId,
            tokenId: _requiredEnv(environment, 'UPC_TOKEN_ID'),
            reasonCode: reasonCode,
            reason: reason,
          ),
        );
      case 'card-content':
        response = await client.getCardContent(
          CardContentRequest(
            trackingId: trackingId,
            contentId: _requiredEnv(environment, 'UPC_CONTENT_ID'),
            brand: _optionalEnv(environment, 'UPC_CARD_BRAND'),
          ),
        );
      case 'card-metadata':
        response = await client.getCardMetadata(
          CardMetadataRequest(
            trackingId: trackingId,
            tokenId: _requiredEnv(environment, 'UPC_TOKEN_ID'),
          ),
        );
    }

    stdout.writeln(
      '$operation XML response: ${response.isEmpty ? '[empty response body]' : _redactSensitiveXml(response)}',
    );
  } catch (error) {
    stderr.writeln('Token operation demo failed: $error');
    exitCode = 1;
  } finally {
    client?.close();
  }
}
