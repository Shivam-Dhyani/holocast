/**
 * Default bot event source (U-03): long-poll `getUpdates` with
 * `allowed_updates=["my_chat_member"]` and map channel membership changes.
 */

import { logger } from '../logger.js';
import { botApiChatIdToMtproto, getUpdates, type RawUpdate } from './botapi-client.js';
import type { BotEventSource, BotMembershipEvent, BotMemberStatus } from './types.js';

interface TgChat {
  id: number;
  type: string;
  title?: string;
}
interface TgChatMember {
  status: string;
  can_post_messages?: boolean;
  can_delete_messages?: boolean;
}
interface MyChatMember {
  chat: TgChat;
  from: { id: number };
  new_chat_member: TgChatMember;
}

function normalizeStatus(status: string): BotMemberStatus {
  switch (status) {
    case 'administrator':
      return 'administrator';
    case 'left':
      return 'left';
    case 'kicked':
      return 'kicked';
    default:
      return 'member';
  }
}

/** Map a `my_chat_member` update to a BotMembershipEvent (channels only). Exported for tests. */
export function mapMyChatMember(update: RawUpdate): BotMembershipEvent | null {
  const m = update.my_chat_member as MyChatMember | undefined;
  if (!m || m.chat.type !== 'channel') return null;
  const nm = m.new_chat_member;
  return {
    channelId: botApiChatIdToMtproto(String(m.chat.id)),
    channelTitle: m.chat.title ?? '',
    actorTelegramUserId: String(m.from.id),
    newStatus: normalizeStatus(nm.status),
    canPostMessages: Boolean(nm.can_post_messages),
    canDeleteMessages: Boolean(nm.can_delete_messages),
    source: 'botapi',
    receivedAt: new Date(),
  };
}

export function createBotApiSource(botToken: string): BotEventSource {
  let running = false;
  let controller: AbortController | undefined;

  return {
    kind: 'botapi',
    async start(onEvent) {
      running = true;
      let offset = 0;
      logger.info('botapi event source started');
      while (running) {
        controller = new AbortController();
        try {
          const updates = await getUpdates(botToken, offset, {
            timeout: 50,
            allowedUpdates: ['my_chat_member'],
            signal: controller.signal,
          });
          for (const u of updates) {
            offset = Math.max(offset, u.update_id + 1);
            const event = mapMyChatMember(u);
            if (event) {
              try {
                await onEvent(event);
              } catch (err) {
                logger.error({ err }, 'onEvent handler failed');
              }
            }
          }
        } catch (err) {
          if (!running) break;
          logger.warn({ err }, 'getUpdates failed; retrying shortly');
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    },
    async stop() {
      running = false;
      controller?.abort();
    },
  };
}
