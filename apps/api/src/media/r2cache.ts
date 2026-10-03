/** R2 cache state: Class A/B counters, promote, eviction, presign, removal (§11.6). */

import type { ObjectRef } from '@shivam-dhyani/unified-storage';

import { config } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { getEncryptedTelegram, getR2, r2Configured } from '../storage.js';
import { canRedirectR2, canWriteR2, evictionTarget, isCacheEligible, monthKey } from './cache-policy.js';

export function r2ObjectKey(videoId: string, seq: number): string {
  return `v/${videoId}/${seq}.m4s`;
}

async function bump(key: string, by = 1): Promise<number> {
  const row = await prisma.usageCounter.upsert({
    where: { key },
    create: { key, value: BigInt(by) },
    update: { value: { increment: BigInt(by) } },
  });
  return Number(row.value);
}
async function counter(key: string): Promise<number> {
  const r = await prisma.usageCounter.findUnique({ where: { key } });
  return r ? Number(r.value) : 0;
}

/** Decrypt a segment from Telegram and store a plaintext copy in R2 (worker, §11.6). */
export async function promoteSegment(videoId: string, seq: number): Promise<void> {
  if (!r2Configured()) return;
  if (!canWriteR2(await counter(monthKey('classA')), config.R2_MAX_CLASS_A_PER_MONTH)) return;

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video || !isCacheEligible(video.visibility)) return;
  const seg = await prisma.segment.findUnique({ where: { videoId_seq: { videoId, seq } } });
  if (!seg || seg.location !== 'PACK' || seg.packNo == null || seg.offsetInPack == null) return;
  const pack = await prisma.pack.findUnique({ where: { videoId_packNo: { videoId, packNo: seg.packNo } } });
  if (!pack?.storageRef) return;

  const ref = pack.storageRef as unknown as ObjectRef;
  const bytes = await getEncryptedTelegram('worker').get(ref, { offset: seg.offsetInPack, length: seg.sizeBytes });
  const key = r2ObjectKey(videoId, seq);
  await getR2().put({ container: config.R2_BUCKET, data: bytes, name: key, key, contentType: 'video/iso.segment' });
  await bump(monthKey('classA'));
  await prisma.r2CacheEntry.upsert({
    where: { objectKey: key },
    create: { objectKey: key, videoId, seq, sizeBytes: bytes.length },
    update: { sizeBytes: bytes.length },
  });
  await evictIfNeeded();
}

export async function evictIfNeeded(): Promise<void> {
  const agg = await prisma.r2CacheEntry.aggregate({ _sum: { sizeBytes: true } });
  let need = evictionTarget(Number(agg._sum.sizeBytes ?? 0), config.R2_MAX_BYTES);
  if (need <= 0) return;
  const victims = await prisma.r2CacheEntry.findMany({ orderBy: { lastAccessAt: 'asc' }, take: 1000 });
  for (const v of victims) {
    if (need <= 0) break;
    try {
      await getR2().delete({ adapter: 'r2', container: config.R2_BUCKET, key: v.objectKey, size: v.sizeBytes });
      await bump(monthKey('classA'));
    } catch (err) {
      logger.warn({ err, key: v.objectKey }, 'R2 evict delete failed');
    }
    await prisma.r2CacheEntry.delete({ where: { objectKey: v.objectKey } }).catch(() => {});
    need -= v.sizeBytes;
  }
}

/** If the segment is cached and the Class B guard allows, return a presigned URL (counts 1 Class B). */
export async function presignIfCached(videoId: string, seq: number): Promise<string | null> {
  if (!r2Configured()) return null;
  const key = r2ObjectKey(videoId, seq);
  const entry = await prisma.r2CacheEntry.findUnique({ where: { objectKey: key } });
  if (!entry) return null;
  if (!canRedirectR2(await counter(monthKey('classB')), config.R2_MAX_CLASS_B_PER_MONTH)) return null;
  const url = await getR2().presignGet({ adapter: 'r2', container: config.R2_BUCKET, key, size: entry.sizeBytes }, 600);
  await bump(monthKey('classB'));
  void prisma.r2CacheEntry
    .update({ where: { objectKey: key }, data: { hits: { increment: 1 }, lastAccessAt: new Date() } })
    .catch(() => {});
  return url;
}

export async function removeVideoFromR2(videoId: string): Promise<void> {
  if (!r2Configured()) return;
  const entries = await prisma.r2CacheEntry.findMany({ where: { videoId } });
  for (const e of entries) {
    try {
      await getR2().delete({ adapter: 'r2', container: config.R2_BUCKET, key: e.objectKey, size: e.sizeBytes });
      await bump(monthKey('classA'));
    } catch (err) {
      logger.warn({ err, key: e.objectKey }, 'R2 delete failed');
    }
  }
  await prisma.r2CacheEntry.deleteMany({ where: { videoId } });
}
