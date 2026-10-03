/** Production LinkerDeps: Prisma + Bot API (confirm/leave) + storage adapter (U-04). */

import { config } from '../config.js';
import { prisma } from '../db.js';
import { newId } from '../ids.js';
import { logger } from '../logger.js';
import { getTelegramAdapter } from '../storage.js';
import { leaveChat, mtprotoToBotApiChatId, sendMessage } from './botapi-client.js';
import type { LinkerDeps } from './linker.js';
import type { BotMembershipEvent, LinkOutcome } from './types.js';

function confirmationText(telegramUserId: string): string {
  return (
    '✅ Holocast storage connected.\n' +
    "Videos you record will be saved here, encrypted. Don't delete this channel.\n" +
    `#holocast:v1 user=${telegramUserId}`
  );
}

export function createPrismaLinkerDeps(): LinkerDeps {
  return {
    async findUserByTelegramId(actorTelegramUserId) {
      const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(actorTelegramUserId) } });
      return user ? { id: user.id } : null;
    },

    async findChannelByTelegramId(channelId) {
      const ch = await prisma.storageChannel.findUnique({ where: { telegramChannelId: BigInt(channelId) } });
      return ch ? { id: ch.id, userId: ch.userId, status: ch.status } : null;
    },

    async findOtherConnectedChannel(userId, exceptChannelId) {
      const ch = await prisma.storageChannel.findFirst({
        where: { userId, status: 'CONNECTED', telegramChannelId: { not: BigInt(exceptChannelId) } },
      });
      return ch ? { id: ch.id, userId: ch.userId, status: ch.status } : null;
    },

    async createConnectedChannel({ userId, channelId, title, accessHash }) {
      await prisma.storageChannel.create({
        data: {
          id: newId(),
          userId,
          telegramChannelId: BigInt(channelId),
          accessHash: accessHash !== null ? BigInt(accessHash) : null,
          title,
          status: 'CONNECTED',
          botUsername: config.TELEGRAM_BOT_USERNAME,
          connectedAt: new Date(),
        },
      });
    },

    async reconnectChannel(channelId, title, accessHash) {
      await prisma.storageChannel.update({
        where: { telegramChannelId: BigInt(channelId) },
        data: {
          status: 'CONNECTED',
          title,
          accessHash: accessHash !== null ? BigInt(accessHash) : undefined,
          disconnectedAt: null,
        },
      });
    },

    async markDisconnected(channelId) {
      await prisma.storageChannel.update({
        where: { telegramChannelId: BigInt(channelId) },
        data: { status: 'DISCONNECTED', disconnectedAt: new Date() },
      });
    },

    async markError(channelId) {
      await prisma.storageChannel.update({
        where: { telegramChannelId: BigInt(channelId) },
        data: { status: 'ERROR' },
      });
    },

    async resolveAccessHash(channelId) {
      try {
        const handle = await getTelegramAdapter('worker').attachChannel(channelId);
        return handle.accessHash;
      } catch (err) {
        logger.warn({ err, channelId }, 'could not resolve channel access hash (U-04)');
        return null;
      }
    },

    async botLeave(channelId) {
      if (!config.TELEGRAM_BOT_TOKEN) return;
      try {
        await leaveChat(config.TELEGRAM_BOT_TOKEN, mtprotoToBotApiChatId(channelId));
      } catch (err) {
        logger.warn({ err, channelId }, 'botLeave failed');
      }
    },

    async postConfirmation(channelId, _accessHash, telegramUserId) {
      if (!config.TELEGRAM_BOT_TOKEN) return;
      await sendMessage(config.TELEGRAM_BOT_TOKEN, mtprotoToBotApiChatId(channelId), confirmationText(telegramUserId));
    },

    async invalidateUserVideoCaches(_userId) {
      // Playback caches are introduced in M7; nothing to invalidate yet.
    },

    async logEvent(event: BotMembershipEvent, outcome: LinkOutcome) {
      await prisma.botEventLog.create({
        data: {
          id: newId(),
          source: event.source,
          payload: JSON.parse(JSON.stringify(event)),
          outcome,
        },
      });
    },
  };
}
