/** BullMQ queues over local Redis (TDD §7, §11.2). Lazily constructed so the
 * process can boot without Redis (e.g. for /api/health). */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { config } from './config.js';

export const QUEUE = {
  packUpload: 'pack-upload',
  finalize: 'finalize',
  r2Promote: 'r2-promote',
  deleteVideo: 'delete-video',
  lab: 'lab',
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** A fresh Redis connection for BullMQ (it requires maxRetriesPerRequest: null). */
export function makeQueueConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: makeQueueConnection(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    });
    queues.set(name, q);
  }
  return q;
}

export interface PackUploadJob {
  videoId: string;
  packNo: number;
}
export interface FinalizeJob {
  videoId: string;
  expectedSegments: number;
  durationUs: string;
}
export interface R2PromoteJob {
  videoId: string;
  seq: number;
}
export interface DeleteVideoJob {
  videoId: string;
}
