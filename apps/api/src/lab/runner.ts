/**
 * In-process executor for SERVER Lab tests (TDD §13.1/§13.2). Builds a
 * metrics-instrumented encrypted Telegram adapter against the admin's connected
 * channel, dispatches the test, evaluates PASS/FAIL/INFO via thresholds.ts, and
 * records a LabRun. (BullMQ-backed background jobs arrive in M6; the Lab runs
 * these inline for now.)
 */

import {
  createEncryptedStore,
  createTelegramAdapter,
  parseKeyring,
  type MetricEvent,
  type StorageAdapter,
  type TelegramAdapter,
} from '@shivam-dhyani/unified-storage';
import path from 'node:path';

import { assertStorageConfigured, config } from '../config.js';
import { prisma } from '../db.js';
import { newId } from '../ids.js';
import { logger } from '../logger.js';
import {
  runInf04,
  runOnb04,
  runTgBurst,
  runTgConcurrency,
  runTgDownload,
  runTgRandomRanges,
  runTgRefRefresh,
  runTgStaleRef,
  runTgUpload,
  type Metrics,
  type TgDeps,
} from './server-tests.js';
import { toJson } from './runs.js';
import { evaluate } from './thresholds.js';

export const SERVER_RUNNABLE = new Set([
  'T-TG-01',
  'T-TG-02',
  'T-TG-03',
  'T-TG-04',
  'T-TG-05',
  'T-TG-06',
  'T-TG-07',
  'T-ONB-04',
  'T-INF-04',
]);

interface LabAdapters {
  deps: TgDeps;
  telegram: TelegramAdapter;
  close: () => Promise<void>;
}

/** Build a metrics-instrumented encrypted Telegram store for the admin's CONNECTED channel. */
async function buildLabAdapters(userId: string): Promise<LabAdapters> {
  assertStorageConfigured();
  const channel = await prisma.storageChannel.findFirst({ where: { userId, status: 'CONNECTED' } });
  if (!channel) {
    throw new Error('no CONNECTED storage channel for this admin — connect storage first');
  }

  const floods: number[] = [];
  const refreshMs: number[] = [];
  const metrics = (e: MetricEvent): void => {
    if (e.op === 'flood_wait' && e.waitSeconds !== undefined) floods.push(e.waitSeconds);
    if (e.op === 'refresh_ref' && e.ms !== undefined) refreshMs.push(e.ms);
  };

  const telegram = createTelegramAdapter({
    mode: 'bot',
    apiId: config.TELEGRAM_API_ID!,
    apiHash: config.TELEGRAM_API_HASH!,
    botToken: config.TELEGRAM_BOT_TOKEN!,
    sessionFile: path.join(config.TG_SESSION_DIR, 'lab.session'),
    metrics,
  });
  const store: StorageAdapter = createEncryptedStore(telegram, parseKeyring(config.STORAGE_KEKS!));

  return {
    deps: { store, channelId: channel.telegramChannelId.toString(), floods, refreshMs },
    telegram,
    close: () => telegram.close(),
  };
}

async function dispatch(testId: string, userId: string): Promise<Metrics> {
  if (testId === 'T-INF-04') {
    return runInf04(prisma);
  }

  const adapters = await buildLabAdapters(userId);
  try {
    switch (testId) {
      case 'T-TG-01':
        return await runTgUpload(adapters.deps);
      case 'T-TG-02':
        return await runTgDownload(adapters.deps);
      case 'T-TG-03':
        return await runTgRandomRanges(adapters.deps);
      case 'T-TG-04':
        return await runTgConcurrency(adapters.deps);
      case 'T-TG-05':
        return await runTgBurst(adapters.deps);
      case 'T-TG-06':
        return await runTgRefRefresh(adapters.deps);
      case 'T-TG-07':
        return await runTgStaleRef(adapters.deps);
      case 'T-ONB-04':
        return await runOnb04(adapters.telegram, adapters.deps.channelId);
      default:
        throw new Error(`test ${testId} is not server-runnable`);
    }
  } finally {
    await adapters.close().catch(() => {});
  }
}

export interface LabRunResult {
  runId: string;
  testId: string;
  status: string;
  metrics: Metrics;
}

async function executeRun(runId: string, testId: string, userId: string): Promise<LabRunResult> {
  try {
    const metrics = await dispatch(testId, userId);
    const status = evaluate(testId, metrics);
    await prisma.labRun.update({
      where: { id: runId },
      data: { status, metrics: toJson(metrics), finishedAt: new Date() },
    });
    return { runId, testId, status, metrics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, testId }, 'server test could not run');
    await prisma.labRun.update({
      where: { id: runId },
      data: { status: 'BLOCKED', notes: message, finishedAt: new Date() },
    });
    return { runId, testId, status: 'BLOCKED', metrics: { error: message } };
  }
}

async function createRunningRecord(testId: string, userId: string): Promise<string> {
  const run = await prisma.labRun.create({
    data: {
      id: newId(),
      testId,
      status: 'RUNNING',
      metrics: {},
      environment: toJson({ node: process.version, region: config.HOLOCAST_DOMAIN }),
      runBy: userId,
    },
  });
  return run.id;
}

/** Run a SERVER test to completion (used programmatically / in tests). */
export async function runServerTest(testId: string, userId: string): Promise<LabRunResult> {
  if (!SERVER_RUNNABLE.has(testId)) throw new Error(`test ${testId} is not server-runnable`);
  const runId = await createRunningRecord(testId, userId);
  return executeRun(runId, testId, userId);
}

/** Start a SERVER test in the background; returns the RUNNING run id immediately. */
export async function startServerTest(testId: string, userId: string): Promise<{ runId: string; status: 'RUNNING' }> {
  if (!SERVER_RUNNABLE.has(testId)) throw new Error(`test ${testId} is not server-runnable`);
  const runId = await createRunningRecord(testId, userId);
  void executeRun(runId, testId, userId).catch((err) => logger.error({ err, testId }, 'lab run crashed'));
  return { runId, status: 'RUNNING' };
}
