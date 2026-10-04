/**
 * T-FAIR-01: each fair-use limiter returns 429 at threshold+1 (TDD §11.8).
 * Loads the app with limiters enabled and tiny limits via vi.resetModules so the
 * 429 path is exercised cheaply. No DB needed — limiters run before route handlers.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { postAutotest, type CaseResult } from './helpers.js';

let app: Express;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_ENABLED = '1';
  process.env.RATE_API_DEFAULT = '3';
  process.env.RATE_MEDIA_PER_MIN = '3';
  vi.resetModules(); // re-evaluate config + limits with the new env
  const mod = await import('../../src/server.js');
  app = mod.createApp();
});

async function hitUntil429(path: string, max = 8): Promise<number> {
  let last = 0;
  for (let i = 0; i < max; i++) {
    const r = await request(app).get(path);
    last = r.status;
    if (r.status === 429) return i + 1; // 1-based attempt that got limited
  }
  return -1;
}

describe('T-FAIR-01 fair-use 429s', () => {
  it('default limiter (120→3/min) returns 429 after the threshold', async () => {
    const cases: CaseResult[] = [];
    const at = await hitUntil429('/api/me'); // defaultLimiter, unauth 401s count
    cases.push({ name: 'default 429 at attempt 4', ok: at === 4 });
    expect(at).toBe(4);

    const atMedia = await hitUntil429('/api/media/x/init.mp4?e=1&s=bad'); // mediaLimiter, 403s count
    cases.push({ name: 'media 429 at attempt 4', ok: atMedia === 4 });
    expect(atMedia).toBe(4);

    await postAutotest('T-FAIR-01', cases);
    expect(cases.every((c) => c.ok)).toBe(true);
  });
});
