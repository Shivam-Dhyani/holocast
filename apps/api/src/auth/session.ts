/**
 * Opaque-token sessions (FR-AUTH-04, TDD §8.2). The cookie holds a random token;
 * only its SHA-256 hash is stored. 30-day lifetime, slid forward at most daily.
 */

import { createHash } from 'node:crypto';

import type { Request, Response } from 'express';

import { toBytes } from '../bytes.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { newId, newSecretToken } from '../ids.js';

export const SESSION_COOKIE = 'hc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDING_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  telegramUserId: string;
  firstName: string;
  publicId: string;
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createSession(userId: string, res: Response): Promise<void> {
  const token = newSecretToken();
  await prisma.authSession.create({
    data: { id: newId(), userId, tokenHash: toBytes(hashToken(token)), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export async function loadSessionUser(req: Request): Promise<AuthUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: toBytes(hashToken(token)) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  if (Date.now() - session.lastSeenAt.getTime() > SLIDING_REFRESH_MS) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }

  return {
    id: session.user.id,
    telegramUserId: session.user.telegramUserId.toString(),
    firstName: session.user.firstName,
    publicId: session.user.publicId,
  };
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 0) {
    await prisma.authSession.deleteMany({ where: { tokenHash: toBytes(hashToken(token)) } });
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}
