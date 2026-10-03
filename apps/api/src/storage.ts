/**
 * unified-storage instances for Holocast (TDD §7). One Telegram bot adapter per
 * process (API and worker each persist their own session file), one R2 adapter,
 * and the encrypted Telegram store used for packs. Built lazily so the process
 * can start before storage is configured.
 */

import path from 'node:path';

import {
  createEncryptedStore,
  createR2Adapter,
  createTelegramAdapter,
  parseKeyring,
  type R2Adapter,
  type StorageAdapter,
  type TelegramAdapter,
} from '@shivam-dhyani/unified-storage';

import { assertStorageConfigured, config } from './config.js';

let telegram: TelegramAdapter | undefined;
let encrypted: StorageAdapter | undefined;
let r2: R2Adapter | undefined;

export function storageConfigured(): boolean {
  return Boolean(
    config.TELEGRAM_API_ID && config.TELEGRAM_API_HASH && config.TELEGRAM_BOT_TOKEN && config.STORAGE_KEKS,
  );
}

export function r2Configured(): boolean {
  return Boolean(config.R2_ENDPOINT && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY);
}

export function getTelegramAdapter(sessionName = 'api'): TelegramAdapter {
  assertStorageConfigured();
  if (!telegram) {
    telegram = createTelegramAdapter({
      mode: 'bot',
      apiId: config.TELEGRAM_API_ID!,
      apiHash: config.TELEGRAM_API_HASH!,
      botToken: config.TELEGRAM_BOT_TOKEN!,
      sessionFile: path.join(config.TG_SESSION_DIR, `${sessionName}.session`),
    });
  }
  return telegram;
}

/** Encrypted Telegram store: all packs are encrypted at rest (D-09, NFR-02). */
export function getEncryptedTelegram(sessionName = 'api'): StorageAdapter {
  if (!encrypted) {
    encrypted = createEncryptedStore(getTelegramAdapter(sessionName), parseKeyring(config.STORAGE_KEKS!));
  }
  return encrypted;
}

export function getR2(): R2Adapter {
  if (!r2) {
    if (!r2Configured()) throw new Error('R2 is not configured');
    r2 = createR2Adapter({
      endpoint: config.R2_ENDPOINT!,
      accessKeyId: config.R2_ACCESS_KEY_ID!,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
      bucket: config.R2_BUCKET,
    });
  }
  return r2;
}
