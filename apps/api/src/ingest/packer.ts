/**
 * Pack upload + finalize workers (TDD §11.2/§11.3). A pack (15 consecutive
 * segments, or the final partial pack) is concatenated, encrypted, and uploaded to
 * the creator's channel as one document; segments then point into it by offset.
 */

import { StorageError, type ObjectRef } from '@shivam-dhyani/unified-storage';
import { Prisma } from '@prisma/client';
import { Worker } from 'bullmq';

import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { getEncryptedTelegram } from '../storage.js';
import { makeQueueConnection, QUEUE, type FinalizeJob, type PackUploadJob } from '../queues.js';
import { concatSegments, packCaption, packNoForSeq, packRange } from './packing.js';
import { deleteSpoolSegment, readSpoolSegment } from './spool.js';

const POLL_MS = 5000;
const MAX_FINALIZE_WAIT_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processPackUpload(job: { data: PackUploadJob }): Promise<void> {
  const { videoId, packNo } = job.data;

  const existing = await prisma.pack.findUnique({ where: { videoId_packNo: { videoId, packNo } } });
  if (existing?.status === 'STORED') return; // idempotent

  const video = await prisma.video.findUnique({ where: { id: videoId }, include: { channel: true } });
  if (!video) return;
  if (video.channel.status !== 'CONNECTED') {
    throw new StorageError('ACCESS_LOST', 'channel not connected');
  }

  const { firstSeq, lastSeq } = packRange(packNo);
  const segRows = await prisma.segment.findMany({
    where: { videoId, seq: { gte: firstSeq, lte: lastSeq } },
    orderBy: { seq: 'asc' },
  });
  if (segRows.length === 0) return;

  const parts: Array<{ seq: number; bytes: Uint8Array }> = [];
  for (const row of segRows) {
    const bytes = await readSpoolSegment(videoId, row.seq);
    if (!bytes) {
      logger.warn({ videoId, seq: row.seq }, 'spool segment missing during pack');
      return; // a later finalize retry will pick it up
    }
    parts.push({ seq: row.seq, bytes });
  }
  const { data, offsets } = concatSegments(parts);

  const channelId = video.channel.telegramChannelId.toString();
  const caption = packCaption(videoId, packNo, firstSeq, lastSeq, offsets.map((o) => o.offsetInPack));

  try {
    const ref = await getEncryptedTelegram('worker').put({
      container: channelId,
      data,
      name: `hc_${videoId}_${packNo}.bin`,
      caption,
    });

    await prisma.$transaction([
      prisma.pack.upsert({
        where: { videoId_packNo: { videoId, packNo } },
        create: {
          id: `${videoId}:${packNo}`,
          videoId,
          packNo,
          firstSeq,
          lastSeq: offsets[offsets.length - 1]!.seq,
          plainSize: data.length,
          storageRef: ref as unknown as Prisma.InputJsonValue,
          status: 'STORED',
          uploadedAt: new Date(),
        },
        update: { status: 'STORED', storageRef: ref as unknown as Prisma.InputJsonValue, uploadedAt: new Date() },
      }),
      ...offsets.map((o) =>
        prisma.segment.update({
          where: { videoId_seq: { videoId, seq: o.seq } },
          data: { location: 'PACK', packNo, offsetInPack: o.offsetInPack },
        }),
      ),
    ]);

    for (const o of offsets) await deleteSpoolSegment(videoId, o.seq);
  } catch (err) {
    if (StorageError.is(err, 'ACCESS_LOST')) {
      await prisma.pack
        .upsert({
          where: { videoId_packNo: { videoId, packNo } },
          create: { id: `${videoId}:${packNo}`, videoId, packNo, firstSeq, lastSeq, plainSize: data.length, status: 'FAILED' },
          update: { status: 'FAILED' },
        })
        .catch(() => {});
      await prisma.storageChannel.update({ where: { id: video.channelId }, data: { status: 'ERROR' } }).catch(() => {});
    }
    throw err; // let BullMQ retry (FLOOD_WAIT etc.)
  }
}

export async function processFinalize(job: { data: FinalizeJob }): Promise<void> {
  const { videoId, expectedSegments } = job.data;
  const deadline = Date.now() + MAX_FINALIZE_WAIT_MS;

  // 1. Wait until segments 1..expectedSegments all exist.
  for (;;) {
    const count = await prisma.segment.count({ where: { videoId, seq: { lte: expectedSegments } } });
    if (count >= expectedSegments || Date.now() > deadline) break;
    await sleep(POLL_MS);
  }

  // 2. Enqueue the final (possibly partial) pack.
  if (expectedSegments > 0) {
    const lastPack = packNoForSeq(expectedSegments);
    const stored = await prisma.pack.findUnique({ where: { videoId_packNo: { videoId, packNo: lastPack } } });
    if (stored?.status !== 'STORED') await processPackUpload({ data: { videoId, packNo: lastPack } });
  }

  // 3. Wait until all packs are STORED.
  for (;;) {
    const pending = await prisma.pack.count({ where: { videoId, status: { not: 'STORED' } } });
    if (pending === 0 || Date.now() > deadline) break;
    await sleep(POLL_MS);
  }

  await prisma.video.update({ where: { id: videoId }, data: { status: 'READY', finalizedAt: new Date() } });
  logger.info({ videoId }, 'video finalized READY');
}

export function startIngestWorkers(): Worker[] {
  const packWorker = new Worker(QUEUE.packUpload, (job) => processPackUpload(job), {
    connection: makeQueueConnection(),
    concurrency: 2,
  });
  const finalizeWorker = new Worker(QUEUE.finalize, (job) => processFinalize(job), {
    connection: makeQueueConnection(),
    concurrency: 2,
  });
  for (const w of [packWorker, finalizeWorker]) {
    w.on('failed', (job, err) => logger.warn({ queue: w.name, jobId: job?.id, err }, 'job failed'));
  }
  return [packWorker, finalizeWorker];
}
