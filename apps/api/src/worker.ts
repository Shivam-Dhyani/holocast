/**
 * Background worker entry (TDD §7). M3 wires the active bot event source into the
 * linking state machine. BullMQ queues (pack-upload, finalize, r2-promote,
 * delete-video, lab) land in M6.
 */

import { config } from './config.js';
import { logger } from './logger.js';
import { startIngestWorkers } from './ingest/packer.js';
import { storageConfigured } from './storage.js';
import { handleMembershipEvent } from './storage-connect/linker.js';
import { createPrismaLinkerDeps } from './storage-connect/linker-deps.js';
import { createBotEventSource } from './storage-connect/source.js';

async function main(): Promise<void> {
  if (!storageConfigured()) {
    logger.warn('storage not configured — bot event source not started (set Telegram env vars)');
    await new Promise(() => {}); // stay alive so systemd doesn't flap
    return;
  }

  startIngestWorkers();
  logger.info('ingest workers started (pack-upload, finalize)');

  const deps = createPrismaLinkerDeps();
  const source = createBotEventSource();
  logger.info({ source: config.BOT_EVENT_SOURCE }, 'starting bot event source');

  await source.start((event) => handleMembershipEvent(event, deps).then(() => undefined));
  // botapi source loops forever; mtproto returns after registering — keep alive.
  await new Promise(() => {});
}

if (config.NODE_ENV !== 'test') {
  main().catch((err) => {
    logger.error({ err }, 'worker failed to start');
    process.exit(1);
  });
}
