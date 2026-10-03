import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import { getRedis } from '../src/redis.js';

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect().catch(() => {});
  getRedis().disconnect();
});

describe('GET /api/health', () => {
  it('returns a health payload with the expected shape', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok');
    expect(typeof res.body.db).toBe('boolean');
    expect(typeof res.body.redis).toBe('boolean');
    expect(typeof res.body.telegram).toBe('boolean');
    expect(typeof res.body.r2).toBe('boolean');
  });
});
