/** Signed media resolution: spool | R2 redirect | ranged decrypt from Telegram (§11.5). */

import { createHash } from 'node:crypto';

import { StorageError, type ObjectRef } from '@shivam-dhyani/unified-storage';
import { Router } from 'express';
import type { Request, Response } from 'express';

import { prisma } from '../db.js';
import { readSpoolSegment } from '../ingest/spool.js';
import { logger } from '../logger.js';
import { getQueue, QUEUE, type R2PromoteJob } from '../queues.js';
import { getRedis } from '../redis.js';
import { getEncryptedTelegram } from '../storage.js';
import { HOT_PROMOTION_THRESHOLD, isCacheEligible, shouldPromote } from './cache-policy.js';
import { presignIfCached } from './r2cache.js';
import { verify, type MediaRef } from './signing.js';

export const mediaRouter: Router = Router();

function serveSegment(res: Response, bytes: Uint8Array): void {
  res.setHeader('Content-Type', 'video/iso.segment');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(bytes));
}

async function bumpHot(videoId: string, seq: number, visibility: string): Promise<void> {
  if (!isCacheEligible(visibility as never)) return;
  try {
    const redis = getRedis();
    const key = `hot:${videoId}:${seq}`;
    const hits = await redis.incr(key);
    if (hits === 1) await redis.expire(key, 3600);
    if (shouldPromote(hits) && hits === HOT_PROMOTION_THRESHOLD) {
      await getQueue(QUEUE.r2Promote).add('r2-promote', { videoId, seq } satisfies R2PromoteJob);
    }
  } catch {
    /* Redis optional for hot promotion */
  }
}

mediaRouter.get('/:videoId/:file', async (req: Request, res: Response) => {
  const videoId = String(req.params.videoId);
  const file = String(req.params.file);
  const exp = Number(req.query.e);
  const sig = String(req.query.s ?? '');
  const nc = req.query.nc === '1';

  let ref: MediaRef;
  let seq: number | null = null;
  if (file === 'init.mp4') {
    ref = 'init';
  } else {
    const m = /^(\d+)\.m4s$/.exec(file);
    if (!m) {
      res.status(404).end();
      return;
    }
    seq = Number(m[1]);
    ref = seq;
  }

  if (!verify(videoId, ref, exp, sig)) {
    res.status(403).json({ code: 'BAD_SIGNATURE', message: 'Invalid or expired URL' });
    return;
  }

  const video = await prisma.video.findUnique({ where: { id: videoId }, include: { channel: true } });
  if (!video) {
    res.status(404).end();
    return;
  }
  if (video.status === 'DELETED') {
    res.status(410).json({ code: 'DELETED', message: 'This video was deleted.' });
    return;
  }
  if (video.channel.status !== 'CONNECTED') {
    res.status(409).json({ code: 'STORAGE_DISCONNECTED', message: "The creator's storage is disconnected." });
    return;
  }

  // Init segment is always served from the DB.
  if (ref === 'init') {
    if (!video.initSegment) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(video.initSegment));
    return;
  }

  const seg = await prisma.segment.findUnique({ where: { videoId_seq: { videoId, seq: seq! } } });
  if (!seg) {
    res.status(404).end();
    return;
  }

  // 1) Still in the spool (not yet packed).
  if (seg.location === 'SPOOL') {
    const bytes = await readSpoolSegment(videoId, seq!);
    if (!bytes) {
      res.status(404).end();
      return;
    }
    serveSegment(res, bytes);
    return;
  }

  // 2) R2 cache (public/unlisted only; never for nocache lab requests).
  if (!nc) {
    const url = await presignIfCached(videoId, seq!);
    if (url) {
      res.redirect(302, url);
      return;
    }
  }

  // 3) Ranged decrypt from Telegram.
  if (seg.packNo == null || seg.offsetInPack == null) {
    res.status(404).end();
    return;
  }
  const pack = await prisma.pack.findUnique({ where: { videoId_packNo: { videoId, packNo: seg.packNo } } });
  if (!pack?.storageRef) {
    res.status(404).end();
    return;
  }
  try {
    const objectRef = pack.storageRef as unknown as ObjectRef;
    const bytes = await getEncryptedTelegram('api').get(objectRef, { offset: seg.offsetInPack, length: seg.sizeBytes });
    const digest = createHash('sha256').update(bytes).digest();
    if (!digest.equals(Buffer.from(seg.sha256))) {
      logger.error({ videoId, seq }, 'segment sha256 mismatch after decrypt');
      res.status(502).json({ code: 'INTEGRITY', message: 'Segment integrity check failed' });
      return;
    }
    serveSegment(res, bytes);
    void bumpHot(videoId, seq!, video.visibility);
  } catch (err) {
    if (StorageError.is(err, 'ACCESS_LOST')) {
      res.status(409).json({ code: 'STORAGE_DISCONNECTED', message: "The creator's storage is disconnected." });
      return;
    }
    logger.error({ err, videoId, seq }, 'telegram media read failed');
    res.status(502).json({ code: 'READ_FAILED', message: 'Could not read media' });
  }
});
