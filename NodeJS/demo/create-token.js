/**
 * Команда npm run demo:create-token збирає SDK і запускає приклад.
 * Змінні для демо задаються у файлі demo/.env.
 * Використовуйте лише тестові карткові дані в тестовому середовищі.
 */

import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { UpcTokenService } from '../dist/index.js';

const demoDirectory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(demoDirectory, '.env'));

/** Reads a required environment variable and reports a safe error if absent. */
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Redacts sensitive values in raw XML before printing the response. */
function redactSensitiveXml(xml) {
  const sensitiveTags = ['tokenId', 'CardNum', 'CVNum', 'TokenNumber', 'TAVV'];
  return sensitiveTags.reduce((result, tag) => {
    return result.replace(
      new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(</${tag}>)`, 'gi'),
      '$1[REDACTED]$2'
    );
  }, xml);
}

/** Creates a UPC token using card details loaded from demo/.env. */
async function main() {
  const environment = (process.env.UPC_ENVIRONMENT ?? 'test').toLowerCase();
  if (environment !== 'test' && environment !== 'production') {
    throw new Error('UPC_ENVIRONMENT must be either "test" or "production".');
  }

  const cvNum = process.env.UPC_CARD_CVV?.trim();
  const client = new UpcTokenService(environment, {
    merchantId: requiredEnv('UPC_MERCHANT_ID'),
    terminalId: requiredEnv('UPC_TERMINAL_ID'),
  });
  const trackingId = randomUUID();
  console.info(`UPC create-token trackingId: ${trackingId}`);

  const response = await client.createToken({
    trackingId,
    card: {
      cardNum: requiredEnv('UPC_CARD_NUMBER'),
      expMonth: requiredEnv('UPC_CARD_EXP_MONTH'),
      expYear: requiredEnv('UPC_CARD_EXP_YEAR'),
      ...(cvNum ? { cvNum } : {}),
    },
  });

  console.info('Create-token XML response:', redactSensitiveXml(response));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Create-token demo failed: ${message}`);
  process.exitCode = 1;
});
