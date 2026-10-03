/**
 * Telegram Login Widget verification (FR-AUTH-02, TDD §8.1).
 *
 *  1. Take all received fields except `hash`; sort keys; build
 *     `data_check_string = "key=value"` lines joined with "\n".
 *  2. secret = SHA256(botToken) (raw bytes); expected = hex(HMAC_SHA256(secret, dcs)).
 *  3. Constant-time compare with `hash`; reject if now − auth_date > 24 h.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedTelegramUser {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  authDate: number;
}

export type VerifyResult =
  | { ok: true; user: VerifiedTelegramUser }
  | { ok: false; reason: 'missing_hash' | 'bad_signature' | 'expired' };

function fieldToString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

export function verifyTelegramAuth(
  payload: Record<string, unknown>,
  botToken: string,
  opts: { maxAgeSec?: number; nowMs?: number } = {},
): VerifyResult {
  const maxAgeSec = opts.maxAgeSec ?? 86400;
  const nowMs = opts.nowMs ?? Date.now();

  const hash = payload['hash'];
  if (typeof hash !== 'string' || hash.length === 0) return { ok: false, reason: 'missing_hash' };

  const dataCheckString = Object.keys(payload)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fieldToString(payload[k])}`)
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  const authDate = Number(payload['auth_date']);
  if (!Number.isFinite(authDate) || nowMs / 1000 - authDate > maxAgeSec) {
    return { ok: false, reason: 'expired' };
  }

  const user: VerifiedTelegramUser = {
    id: fieldToString(payload['id']),
    firstName: fieldToString(payload['first_name'] ?? ''),
    authDate,
  };
  if (payload['last_name'] !== undefined) user.lastName = fieldToString(payload['last_name']);
  if (payload['username'] !== undefined) user.username = fieldToString(payload['username']);
  if (payload['photo_url'] !== undefined) user.photoUrl = fieldToString(payload['photo_url']);
  return { ok: true, user };
}

/** Build the exact signed payload a client would POST — used by tests and tooling. */
export function signTelegramAuthForTest(
  fields: Record<string, string | number>,
  botToken: string,
): Record<string, string | number> {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fieldToString(fields[k])}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return { ...fields, hash };
}
