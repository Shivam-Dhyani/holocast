import { describe, it, expect } from 'vitest';

import { signTelegramAuthForTest, verifyTelegramAuth } from '../src/auth/verify.js';
import { hashToken } from '../src/auth/session.js';
import { botDeepLink } from '../src/storage-connect/service.js';

const BOT_TOKEN = '123456:TEST_BOT_TOKEN_abcdefghijklmnopqrstuv';
const NOW = 1_800_000_000_000; // fixed clock (ms)

function freshPayload(overrides: Record<string, string | number> = {}) {
  return signTelegramAuthForTest(
    {
      id: 777000111,
      first_name: 'Shivam',
      username: 'shivam',
      auth_date: Math.floor(NOW / 1000),
      ...overrides,
    },
    BOT_TOKEN,
  );
}

describe('Telegram widget verification (FR-AUTH-02)', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const res = verifyTelegramAuth(freshPayload(), BOT_TOKEN, { nowMs: NOW });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.id).toBe('777000111');
      expect(res.user.firstName).toBe('Shivam');
      expect(res.user.username).toBe('shivam');
    }
  });

  it('rejects a tampered field (bad signature)', () => {
    const payload = freshPayload();
    payload['first_name'] = 'Attacker';
    const res = verifyTelegramAuth(payload, BOT_TOKEN, { nowMs: NOW });
    expect(res).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a payload signed with the wrong bot token', () => {
    const res = verifyTelegramAuth(freshPayload(), 'different:token', { nowMs: NOW });
    expect(res).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a payload with no hash', () => {
    const { hash: _hash, ...noHash } = freshPayload();
    void _hash;
    const res = verifyTelegramAuth(noHash, BOT_TOKEN, { nowMs: NOW });
    expect(res).toMatchObject({ ok: false, reason: 'missing_hash' });
  });

  it('rejects a payload older than 24h', () => {
    const payload = freshPayload({ auth_date: Math.floor(NOW / 1000) - 86401 });
    const res = verifyTelegramAuth(payload, BOT_TOKEN, { nowMs: NOW });
    expect(res).toMatchObject({ ok: false, reason: 'expired' });
  });
});

describe('session token hashing', () => {
  it('is deterministic and 32 bytes', () => {
    const h1 = hashToken('abc');
    const h2 = hashToken('abc');
    expect(h1.equals(h2)).toBe(true);
    expect(h1.length).toBe(32);
    expect(hashToken('abc').equals(hashToken('abd'))).toBe(false);
  });
});

describe('bot deep link (FR-STO-02)', () => {
  it('requests post/edit/delete admin rights', () => {
    const link = botDeepLink();
    expect(link).toContain('?startchannel');
    expect(link).toContain('admin=post_messages+edit_messages+delete_messages');
  });
});
