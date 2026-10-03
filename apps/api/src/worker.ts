/**
 * Background worker entry (TDD §7). M2 is a stub; BullMQ queues (pack-upload,
 * finalize, r2-promote, delete-video, lab) and the active bot event source are
 * wired in M3/M4/M6.
 */

import { config } from './config.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  logger.info(
    { botEventSource: config.BOT_EVENT_SOURCE },
    'holocast worker starting (M2 stub — queues and bot event source wired in later milestones)',
  );
}

if (config.NODE_ENV !== 'test') {
  main().catch((err) => {
    logger.error({ err }, 'worker failed to start');
    process.exit(1);
  });
}
