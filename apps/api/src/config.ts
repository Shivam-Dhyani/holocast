/**
 * Environment configuration (TDD §4.8), validated with zod at startup.
 * Secrets are optional at the type level so the process can boot (e.g. for
 * /api/health) before everything is configured; `assertStorageConfigured`
 * guards the code paths that actually need them.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  HOLOCAST_DOMAIN: z.string().default('localhost'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  TELEGRAM_API_ID: z.coerce.number().int().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().default('HolocastStorageBot'),
  BOT_EVENT_SOURCE: z.enum(['botapi', 'mtproto']).default('botapi'),
  TG_SESSION_DIR: z.string().default('/var/lib/holocast/tg-sessions'),

  STORAGE_KEKS: z.string().optional(),
  APP_SECRET_KEY: z.string().optional(),
  MEDIA_URL_SECRET: z.string().optional(),
  UNLOCK_COOKIE_SECRET: z.string().optional(),

  ADMIN_TELEGRAM_IDS: z.string().default(''),
  SPOOL_DIR: z.string().default('/var/lib/holocast/spool'),

  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('holocast-cache'),
  R2_MAX_BYTES: z.coerce.number().default(9_000_000_000),
  R2_MAX_CLASS_A_PER_MONTH: z.coerce.number().default(900_000),
  R2_MAX_CLASS_B_PER_MONTH: z.coerce.number().default(9_000_000),

  RATE_ACTIVE_RECORDINGS: z.coerce.number().default(1),
  RATE_VIDEOS_PER_HOUR: z.coerce.number().default(30),
  RATE_SEGMENT_RPS: z.coerce.number().default(10),
  RATE_MEDIA_PER_MIN: z.coerce.number().default(300),
  RATE_UNLOCK: z.coerce.number().default(10),
  RATE_API_DEFAULT: z.coerce.number().default(120),

  WHISPER_BIN: z.string().optional(),
  WHISPER_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  adminTelegramIds: Set<string>;
  isProd: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const adminTelegramIds = new Set(
    parsed.ADMIN_TELEGRAM_IDS.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  return { ...parsed, adminTelegramIds, isProd: parsed.NODE_ENV === 'production' };
}

export const config = loadConfig();

export function isAdmin(telegramUserId: string): boolean {
  return config.adminTelegramIds.has(telegramUserId);
}

/** Throw if the Telegram/R2/encryption secrets needed for storage aren't set. */
export function assertStorageConfigured(c: Config = config): void {
  const missing: string[] = [];
  if (!c.TELEGRAM_API_ID) missing.push('TELEGRAM_API_ID');
  if (!c.TELEGRAM_API_HASH) missing.push('TELEGRAM_API_HASH');
  if (!c.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!c.STORAGE_KEKS) missing.push('STORAGE_KEKS');
  if (missing.length) {
    throw new Error(`storage not configured: missing ${missing.join(', ')}`);
  }
}
