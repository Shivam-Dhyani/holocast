/**
 * Fair-use rate limits (FR-FAIR-03..06, TDD §11.8). Active-recording (1) and
 * videos/hour (30) are enforced in the DB at create time; these are the
 * request-rate limiters. Disabled under NODE_ENV=test.
 */

import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { RedisStore } from 'rate-limit-redis';

import { config } from '../config.js';
import { getRedis } from '../redis.js';

const RATE_MESSAGE = "You're doing that too often. Please wait a minute and try again.";

function store(prefix: string) {
  if (!config.isProd) return undefined; // MemoryStore in dev (single process)
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: ((...args: string[]) => getRedis().call(args[0]!, ...args.slice(1))) as never,
  });
}

function make(opts: {
  prefix: string;
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
}): RequestHandler {
  if (config.NODE_ENV === 'test') return (_req, _res, next: NextFunction) => next();
  const limiter: RateLimitRequestHandler = rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
    ...(store(opts.prefix) ? { store: store(opts.prefix) } : {}),
    handler: (_req: Request, res: Response) => res.status(429).json({ code: 'RATE_LIMITED', message: RATE_MESSAGE }),
  });
  return limiter;
}

const userOrIp = (req: Request): string => (req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip ?? ''));

/** Segment & init PUT: burst 10/s per user (FR-FAIR-03). */
export const segmentLimiter: RequestHandler = make({ prefix: 'seg', windowMs: 1000, limit: config.RATE_SEGMENT_RPS, keyGenerator: userOrIp });

/** Viewer media + playlist: 300/min per IP (FR-FAIR-04). */
export const mediaLimiter: RequestHandler = make({ prefix: 'media', windowMs: 60_000, limit: config.RATE_MEDIA_PER_MIN });

/** Password unlock: 10 / 15 min per IP + video (FR-FAIR-05). */
export const unlockLimiter: RequestHandler = make({
  prefix: 'unlock',
  windowMs: 15 * 60_000,
  limit: config.RATE_UNLOCK,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.params.shareId)}`,
});

/** Everything else: 120/min per IP (FR-FAIR, default). */
export const defaultLimiter: RequestHandler = make({ prefix: 'def', windowMs: 60_000, limit: config.RATE_API_DEFAULT });
