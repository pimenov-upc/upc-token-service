/**
 * Runs one UPC Token Service operation.
 * Example: npm run demo:operation -- create-token
 */

import { randomInt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UpcTokenService } from '../dist/index.js';

const demoDirectory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(demoDirectory, '.env'));

const OPERATIONS = [
  'create-token',
  'refresh',
  'delete',
  'status',
  'suspend',
  'resume',
  'card-content',
  'card-metadata',
];
const REASON_CODES = [
  'DEVICE_LOST',
  'DEVICE_STOLEN',
  'SUSPECTED_FRAUD',
  'ACCOUNT_CLOSED',
  'NOT_FRAUD',
  'DEVICE_FOUND',
  'OTHER',
];

/** Reads a required environment value without printing it. */
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Returns a trimmed optional environment value. */
function optionalEnv(name) {
  return process.env[name]?.trim() || undefined;
}

/** Validates the logging environment setting. */
function isLoggingEnabled() {
  const setting = (process.env.UPC_LOGGING ?? 'false').trim().toLowerCase();
  if (setting !== 'true' && setting !== 'false') {
    throw new Error('UPC_LOGGING must be either "true" or "false".');
  }
  return setting === 'true';
}

/** Redacts card data, token values, and encoded payment data from XML output. */
function redactSensitiveXml(xml) {
  const sensitiveTags = ['tokenId', 'CardNum', 'CVNum', 'TokenNumber', 'TAVV'];
  const redactedXml = sensitiveTags.reduce((result, tag) => {
    return result.replace(
      new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(</${tag}>)`, 'gi'),
      '$1[REDACTED]$2'
    );
  }, xml);
  return redactedXml.replace(
    /<encodedData\b[^>]*>[\s\S]*?<\/encodedData>/gi,
    '<encodedData>[OMITTED]</encodedData>'
  );
}

/** Prints safe usage text. */
function printUsage() {
  console.info(
    'Usage: npm run demo:operation -- <operation> [--confirm-delete]\n' +
      `Operations: ${OPERATIONS.join(', ')}\n` +
      'Create-token requires UPC_CARD_NUMBER, UPC_CARD_EXP_MONTH, and UPC_CARD_EXP_YEAR.\n' +
      'Other operations require UPC_TRACKING_ID plus UPC_TOKEN_ID or UPC_CONTENT_ID.'
  );
}

/** Creates the client using the demo environment configuration. */
function createClient() {
  const customBaseUrl = optionalEnv('UPC_BASE_URL');
  const environment = (process.env.UPC_ENVIRONMENT ?? 'test').trim().toLowerCase();
  if (!customBaseUrl && environment !== 'test' && environment !== 'production') {
    throw new Error('UPC_ENVIRONMENT must be either "test" or "production".');
  }

  return new UpcTokenService(customBaseUrl || environment, {
    merchantId: requiredEnv('UPC_MERCHANT_ID'),
    terminalId: requiredEnv('UPC_TERMINAL_ID'),
    logging: isLoggingEnabled(),
  });
}

/** Executes a requested operation; delete requires an explicit confirmation flag. */
async function main() {
  const operation = process.argv[2]?.toLowerCase();
  if (operation === '--help' || operation === undefined) {
    printUsage();
    return;
  }
  if (!OPERATIONS.includes(operation)) {
    printUsage();
    throw new Error(`Unsupported operation: ${operation}`);
  }
  if (operation === 'delete' && !process.argv.includes('--confirm-delete')) {
    throw new Error('Delete is permanent. Re-run with --confirm-delete to confirm.');
  }

  const client = createClient();
  const trackingId = operation === 'create-token'
    ? optionalEnv('UPC_TRACKING_ID') ?? String(randomInt(100000, 1000000))
    : requiredEnv('UPC_TRACKING_ID');
  const tokenId = optionalEnv('UPC_TOKEN_ID');
  const contentId = optionalEnv('UPC_CONTENT_ID');
  const brand = optionalEnv('UPC_CARD_BRAND');
  const cardCvv = optionalEnv('UPC_CARD_CVV');
  const reasonCode = optionalEnv('UPC_REASON_CODE');
  const reason = optionalEnv('UPC_REASON');

  if (reasonCode && !REASON_CODES.includes(reasonCode)) {
    throw new Error(`UPC_REASON_CODE must be one of: ${REASON_CODES.join(', ')}.`);
  }

  let response;
  switch (operation) {
    case 'create-token':
      response = await client.createToken({
        trackingId,
        card: {
          cardNum: requiredEnv('UPC_CARD_NUMBER'),
          expMonth: requiredEnv('UPC_CARD_EXP_MONTH'),
          expYear: requiredEnv('UPC_CARD_EXP_YEAR'),
          ...(cardCvv ? { cvNum: cardCvv } : {}),
        },
      });
      break;
    case 'refresh':
      response = await client.refreshToken({ trackingId, tokenId: requiredEnv('UPC_TOKEN_ID') });
      break;
    case 'delete':
      response = await client.deleteToken({
        trackingId,
        tokenId: requiredEnv('UPC_TOKEN_ID'),
        ...(reasonCode ? { reasonCode } : {}),
        ...(reason ? { reason } : {}),
      });
      break;
    case 'status':
      response = await client.getTokenStatus({ trackingId, tokenId: requiredEnv('UPC_TOKEN_ID') });
      break;
    case 'suspend':
      response = await client.suspendToken({
        trackingId,
        tokenId: requiredEnv('UPC_TOKEN_ID'),
        ...(reasonCode ? { reasonCode } : {}),
        ...(reason ? { reason } : {}),
      });
      break;
    case 'resume':
      response = await client.resumeToken({
        trackingId,
        tokenId: requiredEnv('UPC_TOKEN_ID'),
        ...(reasonCode ? { reasonCode } : {}),
        ...(reason ? { reason } : {}),
      });
      break;
    case 'card-content':
      response = await client.getCardContent({
        trackingId,
        contentId: requiredEnv('UPC_CONTENT_ID'),
        ...(brand ? { brand } : {}),
      });
      break;
    case 'card-metadata':
      response = await client.getCardMetadata({ trackingId, tokenId: requiredEnv('UPC_TOKEN_ID') });
      break;
  }

  console.info(`${operation} XML response:`,
    response ? redactSensitiveXml(response) : '[empty response body]');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Token operation demo failed: ${message}`);
  process.exitCode = 1;
});
