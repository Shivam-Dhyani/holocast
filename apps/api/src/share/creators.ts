/** Public creator page API (FR-SHR-03, TDD §12). */

import { Router } from 'express';
import type { Request, Response } from 'express';

import { prisma } from '../db.js';
import { toVideoListItem } from '../ingest/router.js';

export const creatorsRouter: Router = Router();

// GET /api/creators/:publicId/videos — a creator's public, READY videos.
creatorsRouter.get('/:publicId/videos', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { publicId: String(req.params.publicId) } });
  if (!user) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Creator not found' });
    return;
  }
  const videos = await prisma.video.findMany({
    where: { ownerId: user.id, visibility: 'PUBLIC', status: 'READY' },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    creator: { name: user.firstName, publicId: user.publicId },
    videos: videos.map(toVideoListItem),
  });
});
