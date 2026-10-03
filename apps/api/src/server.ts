/**
 * Express HTTP entry (TDD §7, §12). M2: helmet, JSON body limit, cookie parsing,
 * pino-http logging with redaction, and the /api/health probe. Feature routers
 * (auth, storage, videos, ingest, share, media, lab) are added in M3–M8.
 */

import type { ErrorRequestHandler, Express, Request, Response } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { attachUser, requireSameOrigin } from './auth/middleware.js';
import { authRouter } from './auth/router.js';
import { ingestRouter } from './ingest/router.js';
import { labRouter } from './lab/router.js';
import { mediaRouter } from './media/router.js';
import { shareRouter } from './share/router.js';
import { storageRouter } from './storage-connect/router.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { pingRedis } from './redis.js';
import { r2Configured, storageConfigured } from './storage.js';

async function pingDb(timeoutMs = 1500): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(cookieParser());
  app.use(express.json({ limit: '64kb' }));
  app.use(attachUser);
  app.use('/api', requireSameOrigin);

  // Health probe (TDD §12): db + redis liveness, storage/r2 configuration.
  app.get('/api/health', async (_req: Request, res: Response) => {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    res.json({
      ok: db && redis,
      db,
      redis,
      telegram: storageConfigured(),
      r2: r2Configured(),
    });
  });

  app.use('/api', authRouter);
  app.use('/api/storage', storageRouter);
  app.use('/api/videos', ingestRouter);
  app.use('/api/share', shareRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/lab', labRouter);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error({ err }, 'unhandled error');
    if (res.headersSent) return;
    res.status(500).json({ code: 'INTERNAL', message: 'Internal error' });
  };
  app.use(errorHandler);

  return app;
}

if (config.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => logger.info({ port }, 'holocast api listening'));
}
