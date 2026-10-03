/**
 * Password unlock (FR-SHR-05, TDD §11.4). A successful unlock sets a per-video,
 * HMAC-signed cookie valid 24h. Passwords are stored as argon2id hashes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { verify as argon2Verify } from '@node-rs/argon2';
import type { Request, Response } from 'express';

import { config } from '../config.js';

const TTL_MS = 24 * 60 * 60 * 1000;

function cookieName(videoId: string): string {
  return `hc_unlock_${videoId}`;
}

function sign(videoId: string, exp: number): string {
  if (!config.UNLOCK_COOKIE_SECRET) throw new Error('UNLOCK_COOKIE_SECRET not configured');
  return createHmac('sha256', Buffer.from(config.UNLOCK_COOKIE_SECRET, 'base64'))
    .update(`${videoId}|${exp}`)
    .digest('base64url');
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await argon2Verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function setUnlockCookie(res: Response, videoId: string): void {
  const exp = Date.now() + TTL_MS;
  const value = `${Buffer.from(String(exp)).toString('base64url')}.${sign(videoId, exp)}`;
  res.cookie(cookieName(videoId), value, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api',
    maxAge: TTL_MS,
  });
}

export function hasValidUnlock(req: Request, videoId: string): boolean {
  const raw = req.cookies?.[cookieName(videoId)];
  if (typeof raw !== 'string') return false;
  const [encExp, sig] = raw.split('.');
  if (!encExp || !sig) return false;
  const exp = Number(Buffer.from(encExp, 'base64url').toString('utf8'));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(videoId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
