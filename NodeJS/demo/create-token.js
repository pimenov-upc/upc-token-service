/**
 * Команда npm run demo:create-token збирає SDK і запускає приклад.
 * Перед запуском задайте змінні середовища 
 *  UPC_ENVIRONMENT (test або production), 
 *  UPC_MERCHANT_ID, 
 *  UPC_TERMINAL_ID, 
 *  UPC_PRIVATE_KEY_PATH, 
 *  UPC_CARD_NUMBER, 
 *  UPC_CARD_EXP_MONTH,
 *  UPC_CARD_EXP_YEAR,
 *  UPC_CARD_CVV (необов’язковий). 
 * 
 * Сценарій не виводить приватний ключ і приховує чутливі поля відповіді.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UpcTokenService } from '../dist/index.js';

/**
 * Reads a required environment variable and reports a safe, actionable error if absent.
 * @example requiredEnv('UPC_MERCHANT_ID')
 */
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Redacts sensitive card and payment-token fields before printing a response. */
function redactSensitiveFields(key, value) {
  const sensitiveFields = new Set(['cardnum', 'cvnum', 'tokennumber', 'tavv']);
  return sensitiveFields.has(key.toLowerCase()) ? '[REDACTED]' : value;
}

/** Creates a UPC token using credentials and card details from the environment. */
async function main() {
  const environment = (process.env.UPC_ENVIRONMENT ?? 'test').toLowerCase();
  if (environment !== 'test' && environment !== 'production') {
    throw new Error('UPC_ENVIRONMENT must be either "test" or "production".');
  }

  const privateKeyPath = resolve(requiredEnv('UPC_PRIVATE_KEY_PATH'));
  const privateKey = readFileSync(privateKeyPath, 'utf8');
  const cvNum = process.env.UPC_CARD_CVV?.trim();
  const client = new UpcTokenService(environment, {
    merchantId: requiredEnv('UPC_MERCHANT_ID'),
    terminalId: requiredEnv('UPC_TERMINAL_ID'),
    privateKey,
  });

  const response = await client.createToken({
    trackingId: randomUUID(),
    card: {
      cardNum: requiredEnv('UPC_CARD_NUMBER'),
      expMonth: requiredEnv('UPC_CARD_EXP_MONTH'),
      expYear: requiredEnv('UPC_CARD_EXP_YEAR'),
      ...(cvNum ? { cvNum } : {}),
    },
  });

  console.info(
    'Create-token response:',
    JSON.stringify(response, redactSensitiveFields, 2)
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Create-token demo failed: ${message}`);
  process.exitCode = 1;
});
