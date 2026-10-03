/**
 * MTProto bot event source (U-03, experimental — validated by T-ONB-03). Listens
 * to raw `UpdateChannelParticipant` updates for the bot's own membership changes.
 *
 * This runs a second bot MTProto connection (its own session file). Whether it
 * coexists with the storage client and reliably carries the actor is exactly what
 * Phase 1 measures; the interface keeps it swappable.
 */

import path from 'node:path';

import { Api, TelegramClient } from 'telegram';
import { Raw } from 'telegram/events/index.js';
import { StringSession } from 'telegram/sessions/index.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { config } from '../config.js';
import { logger } from '../logger.js';
import type { BotEventSource, BotMembershipEvent, BotMemberStatus } from './types.js';

function readSession(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

function statusOf(p: Api.TypeChannelParticipant | undefined): {
  status: BotMemberStatus;
  canPost: boolean;
  canDelete: boolean;
} {
  if (!p || p instanceof Api.ChannelParticipantLeft) return { status: 'left', canPost: false, canDelete: false };
  if (p instanceof Api.ChannelParticipantBanned) return { status: 'kicked', canPost: false, canDelete: false };
  if (p instanceof Api.ChannelParticipantAdmin || p instanceof Api.ChannelParticipantCreator) {
    const rights = p.adminRights;
    return {
      status: 'administrator',
      canPost: Boolean(rights?.postMessages),
      canDelete: Boolean(rights?.deleteMessages),
    };
  }
  return { status: 'member', canPost: false, canDelete: false };
}

export function createMtprotoSource(opts: {
  apiId: number;
  apiHash: string;
  botToken: string;
  sessionFile: string;
}): BotEventSource {
  const sessionFile = opts.sessionFile;
  const initial = readSession(sessionFile);
  const client = new TelegramClient(new StringSession(initial), opts.apiId, opts.apiHash, {
    connectionRetries: 5,
    floodSleepThreshold: 0,
  });
  let botId = '';

  return {
    kind: 'mtproto',
    async start(onEvent) {
      if (initial) await client.connect();
      else await client.start({ botAuthToken: opts.botToken });
      writeFileSync(sessionFile, String(client.session.save()), { mode: 0o600 });
      const me = await client.getMe();
      botId = String((me as Api.User).id);
      logger.info('mtproto event source started');

      client.addEventHandler(async (update: Api.TypeUpdate) => {
        if (!(update instanceof Api.UpdateChannelParticipant)) return;
        if (String(update.userId) !== botId) return; // only the bot's own membership
        const { status, canPost, canDelete } = statusOf(update.newParticipant);
        const event: BotMembershipEvent = {
          channelId: String(update.channelId),
          channelTitle: '',
          actorTelegramUserId: String(update.actorId ?? update.userId),
          newStatus: status,
          canPostMessages: canPost,
          canDeleteMessages: canDelete,
          source: 'mtproto',
          receivedAt: new Date(),
        };
        try {
          await onEvent(event);
        } catch (err) {
          logger.error({ err }, 'mtproto onEvent handler failed');
        }
      }, new Raw({}));
    },
    async stop() {
      await client.disconnect();
      await client.destroy();
    },
  };
}

export function mtprotoSessionFile(): string {
  return path.join(config.TG_SESSION_DIR, 'worker-events.session');
}
