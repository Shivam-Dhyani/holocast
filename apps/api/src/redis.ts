/** Local Redis client (BullMQ, hot lookups, rate limits). Lazy-connects. */

import { Redis } from 'ioredis';

import { config } from './config.js';

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: true,
      // Bounded reconnection so dev/test don't spin forever when Redis is absent.
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });
    client.on('error', () => {
      // Errors are surfaced where used (e.g. the health check); avoid crashing on
      // transient Redis blips.
    });
  }
  return client;
}

export async function pingRedis(timeoutMs = 1000): Promise<boolean> {
  try {
    const r = getRedis();
    if (r.status === 'wait' || r.status === 'close' || r.status === 'end') await r.connect();
    const res = await Promise.race([
      r.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return res === 'PONG';
  } catch {
    return false;
  }
}
