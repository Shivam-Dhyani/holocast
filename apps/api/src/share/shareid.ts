/**
 * Share-id handling (FR-SHR-09, TDD §9). The DB never stores the raw shareId: it
 * stores sha256(shareId) for lookup and an AES-256-GCM encrypted copy (nonce-
 * prefixed) under APP_SECRET_KEY for the owner's "Copy link".
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { toBytes } from '../bytes.js';
import { config } from '../config.js';

function appKey(): Buffer {
  if (!config.APP_SECRET_KEY) throw new Error('APP_SECRET_KEY not configured');
  const key = Buffer.from(config.APP_SECRET_KEY, 'base64');
  if (key.length !== 32) throw new Error('APP_SECRET_KEY must be base64 of 32 bytes');
  return key;
}

export function shareIdHash(shareId: string): Uint8Array<ArrayBuffer> {
  return toBytes(createHash('sha256').update(shareId).digest());
}

/** Encrypt a shareId → nonce(12) ‖ ciphertext ‖ tag(16). */
export function encryptShareId(shareId: string): Uint8Array<ArrayBuffer> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', appKey(), nonce);
  const ct = Buffer.concat([cipher.update(shareId, 'utf8'), cipher.final()]);
  return toBytes(Buffer.concat([nonce, ct, cipher.getAuthTag()]));
}

export function decryptShareId(enc: Uint8Array): string {
  const buf = Buffer.from(enc);
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', appKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
