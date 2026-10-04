/**
 * T-SEC-01 (access-control matrix) + T-SEC-02 (signed-URL expiry/tamper).
 * Requires a test Postgres (DATABASE_URL); skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/server.js';
import { prisma } from '../../src/db.js';
import { expiryUnix, sign } from '../../src/media/signing.js';
import { NO_DB, postAutotest, resetDb, seedOwner, seedVideo, type CaseResult, type SeededOwner } from './helpers.js';

const app = createApp();

describe.skipIf(NO_DB)('T-SEC-01 access matrix / T-SEC-02 signed URLs', () => {
  let owner: SeededOwner;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await resetDb();
    owner = await seedOwner();
    ids.PUBLIC = await seedVideo(owner, 'PUBLIC');
    ids.UNLISTED = await seedVideo(owner, 'UNLISTED');
    ids.PASSWORD = await seedVideo(owner, 'PASSWORD', 'secret1');
    ids.PRIVATE = await seedVideo(owner, 'PRIVATE');
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => {});
  });

  it('T-SEC-01: playlist access is correct for every link type × role', async () => {
    const cases: CaseResult[] = [];
    const playlist = (shareId: string) => `/api/share/${shareId}/playlist.m3u8`;

    const expect200 = async (name: string, shareId: string, cookie?: string) => {
      const r = cookie ? await request(app).get(playlist(shareId)).set('Cookie', cookie) : await request(app).get(playlist(shareId));
      cases.push({ name, ok: r.status === 200 });
      expect(r.status, name).toBe(200);
    };
    const expectStatus = async (name: string, shareId: string, status: number) => {
      const r = await request(app).get(playlist(shareId));
      cases.push({ name, ok: r.status === status });
      expect(r.status, name).toBe(status);
    };

    await expect200('PUBLIC anon', ids.PUBLIC!);
    await expect200('UNLISTED anon', ids.UNLISTED!);
    await expectStatus('PASSWORD anon→401', ids.PASSWORD!, 401);
    await expectStatus('PRIVATE anon→403', ids.PRIVATE!, 403);
    await expect200('PRIVATE owner', ids.PRIVATE!, owner.cookie);

    // PASSWORD: unlock then play.
    const unlock = await request(app).post(`/api/share/${ids.PASSWORD}/unlock`).send({ password: 'secret1' });
    cases.push({ name: 'PASSWORD unlock ok', ok: unlock.status === 200 });
    const cookie = unlock.headers['set-cookie']?.[0] ?? '';
    await expect200('PASSWORD unlocked', ids.PASSWORD!, cookie);
    await expect200('PASSWORD owner', ids.PASSWORD!, owner.cookie);

    const wrong = await request(app).post(`/api/share/${ids.PASSWORD}/unlock`).send({ password: 'nope' });
    cases.push({ name: 'PASSWORD wrong pw→401', ok: wrong.status === 401 });
    expect(wrong.status).toBe(401);

    await postAutotest('T-SEC-01', cases);
    expect(cases.every((c) => c.ok)).toBe(true);
  });

  it('T-SEC-02: signed media URLs reject expired/tampered/mismatched signatures', async () => {
    const vid = (await prisma.video.findFirst({ where: { visibility: 'PUBLIC' } }))!;
    const cases: CaseResult[] = [];
    const exp = expiryUnix();
    const good = sign(vid.id, 'init', exp);

    const get = (q: string) => request(app).get(`/api/media/${vid.id}/init.mp4?${q}`);

    const valid = await get(`e=${exp}&s=${good}`);
    cases.push({ name: 'valid→200', ok: valid.status === 200 });

    const tampered = await get(`e=${exp}&s=${good}x`);
    cases.push({ name: 'tampered sig→403', ok: tampered.status === 403 });

    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = await get(`e=${past}&s=${sign(vid.id, 'init', past)}`);
    cases.push({ name: 'expired→403', ok: expired.status === 403 });

    const otherSeq = await get(`e=${exp}&s=${sign(vid.id, 5, exp)}`);
    cases.push({ name: 'sig-for-other-seq→403', ok: otherSeq.status === 403 });

    const otherVid = await get(`e=${exp}&s=${sign('different-video', 'init', exp)}`);
    cases.push({ name: 'sig-for-other-video→403', ok: otherVid.status === 403 });

    await postAutotest('T-SEC-02', cases);
    expect(cases.every((c) => c.ok)).toBe(true);
  });
});
