import { describe, it, expect } from 'vitest';

import {
  canRedirectR2,
  canWriteR2,
  evictionTarget,
  isCacheEligible,
  monthKey,
  shouldPromote,
} from '../src/media/cache-policy.js';

describe('R2 cache policy (NFR-03, §11.6)', () => {
  it('never caches PASSWORD/PRIVATE videos', () => {
    expect(isCacheEligible('PUBLIC')).toBe(true);
    expect(isCacheEligible('UNLISTED')).toBe(true);
    expect(isCacheEligible('PASSWORD')).toBe(false);
    expect(isCacheEligible('PRIVATE')).toBe(false);
  });

  it('promotes after 3 hits in the window', () => {
    expect(shouldPromote(2)).toBe(false);
    expect(shouldPromote(3)).toBe(true);
  });

  it('guards Class A/B against the monthly cap', () => {
    expect(canWriteR2(899_999, 900_000)).toBe(true);
    expect(canWriteR2(900_000, 900_000)).toBe(false);
    expect(canRedirectR2(9_000_000, 9_000_000)).toBe(false);
  });

  it('evicts down to 90% of the byte cap once exceeded', () => {
    expect(evictionTarget(900, 1000)).toBe(0); // under cap
    expect(evictionTarget(1000, 1000)).toBe(0); // at cap
    expect(evictionTarget(1200, 1000)).toBe(300); // 1200 - 900
  });

  it('builds month-scoped counter keys', () => {
    expect(monthKey('classA', Date.UTC(2026, 9, 3))).toBe('r2:classA:2026-10');
    expect(monthKey('classB', Date.UTC(2026, 0, 15))).toBe('r2:classB:2026-01');
  });
});
