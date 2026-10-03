/** Select the active bot event source by BOT_EVENT_SOURCE (U-03). */

import { config } from '../config.js';
import { createBotApiSource } from './botapi-source.js';
import { createMtprotoSource, mtprotoSessionFile } from './mtproto-source.js';
import type { BotEventSource } from './types.js';

export function createBotEventSource(): BotEventSource {
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required for the bot event source');

  if (config.BOT_EVENT_SOURCE === 'mtproto') {
    if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) {
      throw new Error('mtproto event source requires TELEGRAM_API_ID and TELEGRAM_API_HASH');
    }
    return createMtprotoSource({
      apiId: config.TELEGRAM_API_ID,
      apiHash: config.TELEGRAM_API_HASH,
      botToken: config.TELEGRAM_BOT_TOKEN,
      sessionFile: mtprotoSessionFile(),
    });
  }
  return createBotApiSource(config.TELEGRAM_BOT_TOKEN);
}
