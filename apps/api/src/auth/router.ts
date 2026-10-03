/** Auth + identity routes (FR-AUTH, TDD §8, §12). */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';

import { config } from '../config.js';
import { prisma } from '../db.js';
import { newId, newPublicId } from '../ids.js';
import { logger } from '../logger.js';
import { getStorageStatus } from '../storage-connect/service.js';
import { requireAuth } from './middleware.js';
import { createSession, destroySession } from './session.js';
import { verifyTelegramAuth } from './verify.js';

function toPublicUser(u: User) {
  return {
    id: u.id,
    telegramUserId: u.telegramUserId.toString(),
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    photoUrl: u.photoUrl,
    publicId: u.publicId,
  };
}

export const authRouter: Router = Router();

// POST /api/auth/telegram — verify widget payload, upsert user, create session.
authRouter.post('/auth/telegram', async (req: Request, res: Response) => {
  if (!config.TELEGRAM_BOT_TOKEN) {
    res.status(500).json({ code: 'CONFIG', message: 'Telegram login is not configured' });
    return;
  }
  const result = verifyTelegramAuth(req.body as Record<string, unknown>, config.TELEGRAM_BOT_TOKEN);
  if (!result.ok) {
    res.status(401).json({ code: 'AUTH_FAILED', message: 'Telegram login could not be verified' });
    return;
  }
  const v = result.user;
  const telegramUserId = BigInt(v.id);
  const user = await prisma.user.upsert({
    where: { telegramUserId },
    create: {
      id: newId(),
      telegramUserId,
      firstName: v.firstName,
      lastName: v.lastName ?? null,
      username: v.username ?? null,
      photoUrl: v.photoUrl ?? null,
      publicId: newPublicId(),
    },
    update: {
      firstName: v.firstName,
      lastName: v.lastName ?? null,
      username: v.username ?? null,
      photoUrl: v.photoUrl ?? null,
    },
  });
  await createSession(user.id, res);
  logger.info({ userId: user.id }, 'user logged in');
  res.json({ user: toPublicUser(user), storageStatus: await getStorageStatus(user.id) });
});

// POST /api/auth/logout — delete session server-side (FR-AUTH-05).
authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  await destroySession(req, res);
  res.status(204).end();
});

// GET /api/me — current user + storage status.
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Login required' });
    return;
  }
  res.json({ user: toPublicUser(user), storageStatus: await getStorageStatus(user.id) });
});
