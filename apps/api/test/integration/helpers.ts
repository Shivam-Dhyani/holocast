/** Shared helpers for the AUTOTEST integration suites (need a test Postgres). */

import { createHash } from 'node:crypto';

import { hash as argon2Hash } from '@node-rs/argon2';

import type { Visibility } from '@holocast/shared';
import { toBytes } from '../../src/bytes.js';
import { prisma } from '../../src/db.js';
import { newId, newSecretToken, newShareId } from '../../src/ids.js';
import { encryptShareId, shareIdHash } from '../../src/share/shareid.js';

export const NO_DB = !process.env.DATABASE_URL;

export async function resetDb(): Promise<void> {
  await prisma.segment.deleteMany({});
  await prisma.pack.deleteMany({});
  await prisma.r2CacheEntry.deleteMany({});
  await prisma.labRun.deleteMany({});
  await prisma.labManualAnswer.deleteMany({});
  await prisma.usageCounter.deleteMany({});
  await prisma.authSession.deleteMany({});
  await prisma.video.deleteMany({});
  await prisma.storageChannel.deleteMany({});
  await prisma.botEventLog.deleteMany({});
  await prisma.user.deleteMany({});
}

export interface SeededOwner {
  userId: string;
  channelId: string;
  token: string;
  cookie: string;
}

export async function seedOwner(): Promise<SeededOwner> {
  const userId = newId();
  await prisma.user.create({
    data: { id: userId, telegramUserId: BigInt(Date.now()), firstName: 'Owner', publicId: newShareId().slice(0, 10) },
  });
  const channelId = newId();
  await prisma.storageChannel.create({
    data: {
      id: channelId,
      userId,
      telegramChannelId: BigInt(5000 + Math.floor(Math.random() * 100000)),
      accessHash: BigInt(1),
      title: 'Storage',
      status: 'CONNECTED',
      botUsername: 'HolocastStorageBot',
      connectedAt: new Date(),
    },
  });
  const token = newSecretToken();
  await prisma.authSession.create({
    data: {
      id: newId(),
      userId,
      tokenHash: toBytes(createHash('sha256').update(token).digest()),
      expiresAt: new Date(Date.now() + 86400_000),
    },
  });
  return { userId, channelId, token, cookie: `hc_session=${token}` };
}

export async function seedVideo(owner: SeededOwner, visibility: Visibility, password?: string): Promise<string> {
  const shareId = newShareId();
  const id = newId();
  await prisma.video.create({
    data: {
      id,
      ownerId: owner.userId,
      channelId: owner.channelId,
      title: `${visibility} video`,
      status: 'READY',
      visibility,
      shareIdHash: shareIdHash(shareId),
      shareIdEnc: encryptShareId(shareId),
      passwordHash: password ? await argon2Hash(password) : null,
      uploadTokenHash: toBytes(createHash('sha256').update('t').digest()),
      durationUs: BigInt(4_000_000),
      bitrateBps: 1_500_000,
      initSegment: toBytes(Buffer.from('ftypinit')),
    },
  });
  await prisma.segment.create({
    data: {
      videoId: id,
      seq: 1,
      durationUs: 4_000_000,
      sizeBytes: 8,
      sha256: toBytes(createHash('sha256').update('seg1').digest()),
      location: 'SPOOL',
    },
  });
  return shareId;
}

export interface CaseResult {
  name: string;
  ok: boolean;
}

/** Post an AUTOTEST summary to the Lab (FR-LAB; §13.2) when configured. */
export async function postAutotest(testId: string, cases: CaseResult[]): Promise<void> {
  const url = process.env.LAB_URL;
  const token = process.env.LAB_TOKEN;
  if (!url || !token) return;
  const passed = cases.filter((c) => c.ok).length;
  await fetch(`${url.replace(/\/$/, '')}/api/lab/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ testId, metrics: { passed, total: cases.length, rejected: passed, cases } }),
  }).catch(() => {});
}
