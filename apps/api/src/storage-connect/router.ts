/** Storage status + disconnect routes (FR-STO-01/08, TDD §8.4, §12). */

import { Router } from 'express';
import type { Request, Response } from 'express';

import { config } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { requireAuth } from '../auth/middleware.js';
import { leaveChat, mtprotoToBotApiChatId } from './botapi-client.js';
import { botDeepLink, getStorageStatus } from './service.js';

export const storageRouter: Router = Router();

// GET /api/storage — status + deep link (polled by the wizard, FR-STO-05).
storageRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const status = await getStorageStatus(req.user!.id);
  res.json({
    status: status.status,
    channelTitle: status.channelTitle,
    deepLink: botDeepLink(),
    botUsername: config.TELEGRAM_BOT_USERNAME,
  });
});

// POST /api/storage/disconnect — bot leaves the channel; data untouched (FR-STO-08).
storageRouter.post('/disconnect', requireAuth, async (req: Request, res: Response) => {
  const channel = await prisma.storageChannel.findFirst({
    where: { userId: req.user!.id, status: 'CONNECTED' },
  });
  if (!channel) {
    res.json({ status: 'NONE', channelTitle: null });
    return;
  }
  const channelId = channel.telegramChannelId.toString();
  if (config.TELEGRAM_BOT_TOKEN) {
    try {
      await leaveChat(config.TELEGRAM_BOT_TOKEN, mtprotoToBotApiChatId(channelId));
    } catch (err) {
      logger.warn({ err, channelId }, 'leaveChat during disconnect failed; marking disconnected anyway');
    }
  }
  await prisma.storageChannel.update({
    where: { id: channel.id },
    data: { status: 'DISCONNECTED', disconnectedAt: new Date() },
  });
  res.json({ status: 'DISCONNECTED', channelTitle: channel.title });
});
