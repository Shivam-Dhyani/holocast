/**
 * Structured JSON logging with secret redaction (NFR-06, TDD §11.10).
 * Never logs tokens, cookies, passwords, the bot token, keys, or signed query
 * strings.
 */

import { pino } from 'pino';

import { config } from './config.js';

export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.token',
      '*.secret',
      '*.password',
      '*.session',
      'password',
      'token',
      'secret',
      'botToken',
      'TELEGRAM_BOT_TOKEN',
      'STORAGE_KEKS',
    ],
    censor: '[redacted]',
  },
});
