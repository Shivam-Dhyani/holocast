/**
 * R2 cache policy + free-tier guards (NFR-01/03, TDD §11.6). Pure decisions; the
 * stateful parts (counters, entries, eviction) live in r2cache.ts.
 */

import type { Visibility } from '@holocast/shared';

/** Private/Password videos are NEVER cached in R2 (NFR-03). */
export function isCacheEligible(visibility: Visibility): boolean {
  return visibility === 'PUBLIC' || visibility === 'UNLISTED';
}

/** Segments cached on READY for fast start (TDD §11.6). */
export const INITIAL_CACHE_SEQS = [1, 2, 3] as const;

/** A segment fetched from Telegram this many times within the window → promote. */
export const HOT_PROMOTION_THRESHOLD = 3;
export function shouldPromote(hitsInWindow: number): boolean {
  return hitsInWindow >= HOT_PROMOTION_THRESHOLD;
}

/** Monthly Class A/B op guards. */
export function canWriteR2(classAUsed: number, maxClassA: number): boolean {
  return classAUsed < maxClassA;
}
export function canRedirectR2(classBUsed: number, maxClassB: number): boolean {
  return classBUsed < maxClassB;
}

/** Evict down to 90% of the byte cap once exceeded (TDD §11.6). */
export function evictionTarget(totalBytes: number, maxBytes: number): number {
  if (totalBytes <= maxBytes) return 0;
  return totalBytes - Math.floor(maxBytes * 0.9);
}

/** UsageCounter keys for the current month (UTC). */
export function monthKey(prefix: 'classA' | 'classB', nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `r2:${prefix}:${ym}`;
}
