/**
 * Signed media URLs (FR-SHR-08, TDD §11.4). Every media URL carries an expiry and
 * an HMAC so it can't be forged or replayed after 6h. Applies to all link types.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../config.js';

const TTL_SECONDS = 6 * 60 * 60;

function key(): Buffer {
  if (!config.MEDIA_URL_SECRET) throw new Error('MEDIA_URL_SECRET not configured');
  return Buffer.from(config.MEDIA_URL_SECRET, 'base64');
}

/** 'init' for the init segment, or the segment seq number. */
export type MediaRef = 'init' | number;

function refToken(ref: MediaRef): string {
  return ref === 'init' ? 'init' : String(ref);
}

export function expiryUnix(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + TTL_SECONDS;
}

export function sign(videoId: string, ref: MediaRef, exp: number): string {
  return createHmac('sha256', key()).update(`${videoId}.${refToken(ref)}.${exp}`).digest('base64url');
}

export function verify(videoId: string, ref: MediaRef, exp: number, sig: string, nowMs = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(nowMs / 1000)) return false;
  const expected = Buffer.from(sign(videoId, ref, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Build a signed media URL path for the playlist (FR-PLY, §11.4). */
export function signedMediaUrl(videoId: string, ref: MediaRef, opts: { nocache?: boolean; nowMs?: number } = {}): string {
  const exp = expiryUnix(opts.nowMs);
  const sig = sign(videoId, ref, exp);
  const file = ref === 'init' ? 'init.mp4' : `${ref}.m4s`;
  const nc = opts.nocache ? '&nc=1' : '';
  return `/api/media/${videoId}/${file}?e=${exp}&s=${sig}${nc}`;
}
