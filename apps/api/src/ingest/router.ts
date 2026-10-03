/** Video creation + segment ingest (FR-REC-06/08, FR-FAIR-01/02, TDD §11.1). */

import { createHash, timingSafeEqual } from 'node:crypto';

import { hash as argon2Hash } from '@node-rs/argon2';
import { CreateVideoRequest, FinalizeRequest } from '@holocast/shared';
import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';

import { requireAuth } from '../auth/middleware.js';
import { toBytes } from '../bytes.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { newId, newShareId, newSecretToken } from '../ids.js';
import { getQueue, QUEUE, type FinalizeJob, type PackUploadJob } from '../queues.js';
import { encryptShareId, shareIdHash } from '../share/shareid.js';
import { isFullPackComplete, packNoForSeq, packRange } from './packing.js';
import { writeSpoolSegment } from './spool.js';

const SEGMENT_TARGET_SECONDS = 4;
const DEFAULT_BITRATE_BPS = 1_500_000;
const MAX_SEQ = 1900;
const rawBody = raw({ type: 'application/octet-stream', limit: '8mb' });

function sha256(buf: Uint8Array): Buffer {
  return createHash('sha256').update(buf).digest();
}
function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function tokenMatches(presented: string | undefined, storedHash: Uint8Array): boolean {
  if (!presented) return false;
  const a = sha256(Buffer.from(presented));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadOwnedVideo(req: Request, res: Response, requireToken: boolean) {
  const video = await prisma.video.findUnique({ where: { id: String(req.params.id) } });
  if (!video || video.ownerId !== req.user!.id) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Video not found' });
    return null;
  }
  if (requireToken && !tokenMatches(req.get('x-upload-token'), video.uploadTokenHash)) {
    res.status(401).json({ code: 'BAD_UPLOAD_TOKEN', message: 'Invalid upload token' });
    return null;
  }
  return video;
}

export const ingestRouter: Router = Router();

// POST /api/videos — create + instant link (FR-REC-08, FR-SHR-01/09).
ingestRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = CreateVideoRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'invalid video options' });
    return;
  }
  const body = parsed.data;
  const userId = req.user!.id;

  const channel = await prisma.storageChannel.findFirst({ where: { userId, status: 'CONNECTED' } });
  if (!channel) {
    res.status(409).json({ code: 'STORAGE_DISCONNECTED', message: 'Connect your storage first.' });
    return;
  }

  // Fair-use (FR-FAIR-01/02).
  const active = await prisma.video.count({ where: { ownerId: userId, status: 'RECORDING' } });
  if (active >= config.RATE_ACTIVE_RECORDINGS) {
    res.status(429).json({ code: 'RATE_LIMITED', message: "You're doing that too often. Please wait a minute and try again." });
    return;
  }
  const lastHour = await prisma.video.count({
    where: { ownerId: userId, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (lastHour >= config.RATE_VIDEOS_PER_HOUR) {
    res.status(429).json({ code: 'RATE_LIMITED', message: "You're doing that too often. Please wait a minute and try again." });
    return;
  }

  const shareId = newShareId();
  const uploadToken = newSecretToken();
  const bitrateBps = body.bitrateBps ?? DEFAULT_BITRATE_BPS;
  const title = body.title ?? `Recording – ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const passwordHash = body.visibility === 'PASSWORD' && body.password ? await argon2Hash(body.password) : null;

  const video = await prisma.video.create({
    data: {
      id: newId(),
      ownerId: userId,
      channelId: channel.id,
      title,
      status: 'RECORDING',
      visibility: body.visibility,
      shareIdHash: shareIdHash(shareId),
      shareIdEnc: encryptShareId(shareId),
      passwordHash,
      uploadTokenHash: toBytes(sha256(Buffer.from(uploadToken))),
      bitrateBps,
    },
  });

  res.json({
    videoId: video.id,
    shareUrl: `${config.PUBLIC_BASE_URL}/v/${shareId}`,
    uploadToken,
    segmentTargetSeconds: SEGMENT_TARGET_SECONDS,
    bitrateBps,
  });
});

// PUT /api/videos/:id/init — store the fMP4 init segment once (idempotent).
ingestRouter.put('/:id/init', requireAuth, rawBody, async (req: Request, res: Response) => {
  const video = await loadOwnedVideo(req, res, true);
  if (!video) return;
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 1_000_000) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'init must be 1..1MB bytes' });
    return;
  }
  if (video.initSegment) {
    const same = Buffer.from(video.initSegment).equals(body);
    res.status(same ? 200 : 409).end();
    return;
  }
  await prisma.video.update({
    where: { id: video.id },
    data: {
      initSegment: toBytes(body),
      videoCodec: req.get('x-video-codec') ?? null,
      audioCodec: req.get('x-audio-codec') ?? null,
      width: req.get('x-width') ? Number(req.get('x-width')) : null,
      height: req.get('x-height') ? Number(req.get('x-height')) : null,
    },
  });
  res.status(200).end();
});

// PUT /api/videos/:id/segments/:seq — spool a media segment (idempotent).
ingestRouter.put('/:id/segments/:seq', requireAuth, rawBody, async (req: Request, res: Response) => {
  const seq = Number(req.params.seq);
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SEQ) {
    res.status(400).json({ code: 'BAD_SEQ', message: `seq must be 1..${MAX_SEQ}` });
    return;
  }
  const video = await loadOwnedVideo(req, res, true);
  if (!video) return;
  if (video.status === 'DELETED') {
    res.status(410).json({ code: 'DELETED', message: 'Video was deleted' });
    return;
  }
  if (video.status === 'READY') {
    res.status(409).json({ code: 'ALREADY_READY', message: 'Video already finalized' });
    return;
  }
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'empty segment' });
    return;
  }
  const digest = sha256Hex(body);
  const claimed = req.get('x-segment-sha256');
  if (claimed && claimed.toLowerCase() !== digest) {
    res.status(400).json({ code: 'SHA_MISMATCH', message: 'segment sha256 does not match body' });
    return;
  }

  const existing = await prisma.segment.findUnique({ where: { videoId_seq: { videoId: video.id, seq } } });
  if (existing) {
    const same = Buffer.from(existing.sha256).toString('hex') === digest;
    res.status(same ? 200 : 409).end();
    return;
  }

  const durationUs = Number(req.get('x-segment-duration-us') ?? 0);
  await writeSpoolSegment(video.id, seq, body);
  await prisma.$transaction([
    prisma.segment.create({
      data: {
        videoId: video.id,
        seq,
        durationUs: Number.isFinite(durationUs) ? Math.round(durationUs) : 0,
        sizeBytes: body.length,
        sha256: toBytes(sha256(body)),
        location: 'SPOOL',
      },
    }),
    prisma.video.update({ where: { id: video.id }, data: { durationUs: { increment: BigInt(Math.round(durationUs)) } } }),
  ]);

  await maybeEnqueuePack(video.id, seq);
  res.status(200).end();
});

// POST /api/videos/:id/finalize — begin finalization (TDD §11.3).
ingestRouter.post('/:id/finalize', requireAuth, async (req: Request, res: Response) => {
  const video = await loadOwnedVideo(req, res, true);
  if (!video) return;
  const parsed = FinalizeRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'invalid finalize payload' });
    return;
  }
  const { expectedSegments, durationUs } = parsed.data;
  await prisma.video.update({
    where: { id: video.id },
    data: { status: 'FINALIZING', expectedSegments, durationUs: BigInt(durationUs) },
  });
  await getQueue(QUEUE.finalize).add('finalize', {
    videoId: video.id,
    expectedSegments,
    durationUs,
  } satisfies FinalizeJob);
  res.status(202).json({ status: 'FINALIZING' });
});

/** Enqueue pack-upload when a full 15-segment pack is complete in the spool. */
async function maybeEnqueuePack(videoId: string, seq: number): Promise<void> {
  const packNo = packNoForSeq(seq);
  const { firstSeq, lastSeq } = packRange(packNo);
  const rows = await prisma.segment.findMany({
    where: { videoId, seq: { gte: firstSeq, lte: lastSeq }, location: 'SPOOL' },
    select: { seq: true },
  });
  if (isFullPackComplete(packNo, rows.map((r) => r.seq))) {
    await getQueue(QUEUE.packUpload).add('pack-upload', { videoId, packNo } satisfies PackUploadJob);
  }
}
