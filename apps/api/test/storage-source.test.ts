import { describe, it, expect } from 'vitest';

import { mapMyChatMember } from '../src/storage-connect/botapi-source.js';
import { botApiChatIdToMtproto, mtprotoToBotApiChatId } from '../src/storage-connect/botapi-client.js';

describe('Bot API ⇄ MTProto channel id conversion', () => {
  it('round-trips', () => {
    const mtproto = '1234567890';
    const botApi = mtprotoToBotApiChatId(mtproto);
    expect(botApi).toBe('-1001234567890');
    expect(botApiChatIdToMtproto(botApi)).toBe(mtproto);
  });
});

describe('mapMyChatMember', () => {
  it('maps an admin-with-post-rights channel event', () => {
    const event = mapMyChatMember({
      update_id: 10,
      my_chat_member: {
        chat: { id: -1001234567890, type: 'channel', title: 'Holocast Storage' },
        from: { id: 777000111 },
        new_chat_member: { status: 'administrator', can_post_messages: true, can_delete_messages: true },
      },
    });
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      channelId: '1234567890',
      channelTitle: 'Holocast Storage',
      actorTelegramUserId: '777000111',
      newStatus: 'administrator',
      canPostMessages: true,
      canDeleteMessages: true,
      source: 'botapi',
    });
  });

  it('maps a kicked event (no post rights)', () => {
    const event = mapMyChatMember({
      update_id: 11,
      my_chat_member: {
        chat: { id: -1001234567890, type: 'channel', title: 'X' },
        from: { id: 1 },
        new_chat_member: { status: 'kicked' },
      },
    });
    expect(event).toMatchObject({ newStatus: 'kicked', canPostMessages: false });
  });

  it('ignores non-channel chats', () => {
    expect(
      mapMyChatMember({
        update_id: 12,
        my_chat_member: {
          chat: { id: 123, type: 'group', title: 'g' },
          from: { id: 1 },
          new_chat_member: { status: 'member' },
        },
      }),
    ).toBeNull();
  });
});
