/** Share metadata, password unlock, and HLS playlist (FR-SHR, FR-PLY, TDD §11.4). */

import { UnlockRequest } from '@holocast/shared';
import { Router } from 'express';
import type { Request, Response } from 'express';

import { prisma } from '../db.js';
import { canWatch, needsPassword } from './access.js';
import { buildPlaylist } from './playlist.js';
import { shareIdHash } from './shareid.js';
import { hasValidUnlock, setUnlockCookie, verifyPassword } from './unlock.js';

export const shareRouter: Router = Router();

async function loadByShareId(shareId: string) {
  return prisma.video.findUnique({
    where: { shareIdHash: shareIdHash(shareId) },
    include: { owner: true, channel: true },
  });
}

function ctxFor(req: Request, ownerId: string, videoId: string) {
  return {
    isOwner: Boolean(req.user && req.user.id === ownerId),
    hasUnlock: hasValidUnlock(req, videoId),
  };
}

// GET /api/share/:shareId — viewer metadata.
shareRouter.get('/:shareId', async (req: Request, res: Response) => {
  const video = await loadByShareId(String(req.params.shareId));
  if (!video) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'This video does not exist.' });
    return;
  }
  const ctx = ctxFor(req, video.ownerId, video.id);
  const hidePrivate = video.visibility === 'PRIVATE' && !ctx.isOwner;
  res.json({
    title: hidePrivate ? '' : video.title,
    creatorName: hidePrivate ? '' : video.owner.firstName,
    creatorPublicId: hidePrivate ? '' : video.owner.publicId,
    visibility: video.visibility,
    status: video.status,
    durationUs: video.durationUs.toString(),
    needsPassword: needsPassword(video.visibility, ctx),
    isOwner: ctx.isOwner,
    storageConnected: video.channel.status === 'CONNECTED',
  });
});

// POST /api/share/:shareId/unlock — password gate (FR-SHR-05).
shareRouter.post('/:shareId/unlock', async (req: Request, res: Response) => {
  const video = await loadByShareId(String(req.params.shareId));
  if (!video || video.visibility !== 'PASSWORD') {
    res.status(400).json({ code: 'NO_PASSWORD', message: 'This video is not password-protected.' });
    return;
  }
  const parsed = UnlockRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Password required.' });
    return;
  }
  if (!(await verifyPassword(video.passwordHash, parsed.data.password))) {
    res.status(401).json({ code: 'BAD_PASSWORD', message: 'Incorrect password.' });
    return;
  }
  setUnlockCookie(res, video.id);
  res.json({ ok: true });
});

// GET /api/share/:shareId/playlist.m3u8 — HLS playlist (access-checked).
shareRouter.get('/:shareId/playlist.m3u8', async (req: Request, res: Response) => {
  const video = await loadByShareId(String(req.params.shareId));
  if (!video) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'This video does not exist.' });
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
  const decision = canWatch(video.visibility, ctxFor(req, video.ownerId, video.id));
  if (!decision.allowed) {
    res.status(decision.status).json({ code: decision.code, needsPassword: decision.needsPassword ?? false });
    return;
  }

  const segments = await prisma.segment.findMany({
    where: { videoId: video.id },
    select: { seq: true, durationUs: true },
    orderBy: { seq: 'asc' },
  });
  const playlist = buildPlaylist({
    videoId: video.id,
    ready: video.status === 'READY',
    segments,
    nocache: req.query.nocache === '1',
  });

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  res.send(playlist);
});
