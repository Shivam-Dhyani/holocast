/** Auth / CSRF middleware (FR-AUTH-06, TDD §8.2). */

import type { NextFunction, Request, Response } from 'express';

import { config, isAdmin } from '../config.js';
import { loadSessionUser } from './session.js';

/** Populate req.user from the session cookie (never rejects). */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.user = (await loadSessionUser(req)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Login required' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Login required' });
    return;
  }
  if (!isAdmin(req.user.telegramUserId)) {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Admins only' });
    return;
  }
  next();
}

/**
 * CSRF defense (TDD §8.2): state-changing requests must carry Origin ===
 * PUBLIC_BASE_URL. Skipped under NODE_ENV=test. Segment-PUT routes use their own
 * upload-token guard instead and opt out via `skip`.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!mutating || config.NODE_ENV === 'test') {
    next();
    return;
  }
  const origin = req.get('origin');
  if (origin !== config.PUBLIC_BASE_URL) {
    res.status(403).json({ code: 'BAD_ORIGIN', message: 'Bad origin' });
    return;
  }
  next();
}
