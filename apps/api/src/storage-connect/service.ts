/** Storage status helpers shared by /api/me and /api/storage (FR-STO, TDD §8). */

import type { StorageState } from '@holocast/shared';

import { config } from '../config.js';
import { prisma } from '../db.js';

/** Deep link that adds the bot as admin with post/edit/delete rights (FR-STO-02). */
export function botDeepLink(): string {
  return `https://t.me/${config.TELEGRAM_BOT_USERNAME}?startchannel&admin=post_messages+edit_messages+delete_messages`;
}

export interface StorageStatus {
  status: StorageState;
  channelTitle: string | null;
}

export async function getStorageStatus(userId: string): Promise<StorageStatus> {
  const connected = await prisma.storageChannel.findFirst({ where: { userId, status: 'CONNECTED' } });
  if (connected) return { status: 'CONNECTED', channelTitle: connected.title };

  const latest = await prisma.storageChannel.findFirst({
    where: { userId },
    orderBy: { connectedAt: 'desc' },
  });
  if (latest) return { status: latest.status as StorageState, channelTitle: latest.title };

  return { status: 'NONE', channelTitle: null };
}
