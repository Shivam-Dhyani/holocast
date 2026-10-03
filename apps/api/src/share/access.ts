/** Access-control rule for the 4 link types (FR-SHR-03..06, T-SEC-01, TDD §11.4). */

import type { Visibility } from '@holocast/shared';

export interface WatchContext {
  isOwner: boolean;
  hasUnlock: boolean;
}

export type WatchDecision =
  | { allowed: true }
  | { allowed: false; status: number; code: string; needsPassword?: boolean };

export function canWatch(visibility: Visibility, ctx: WatchContext): WatchDecision {
  switch (visibility) {
    case 'PUBLIC':
    case 'UNLISTED':
      return { allowed: true };
    case 'PASSWORD':
      if (ctx.isOwner || ctx.hasUnlock) return { allowed: true };
      return { allowed: false, status: 401, code: 'PASSWORD_REQUIRED', needsPassword: true };
    case 'PRIVATE':
      if (ctx.isOwner) return { allowed: true };
      return { allowed: false, status: 403, code: 'PRIVATE' };
    default:
      return { allowed: false, status: 403, code: 'FORBIDDEN' };
  }
}

/** Whether the viewer must present a password before any media is served. */
export function needsPassword(visibility: Visibility, ctx: WatchContext): boolean {
  return visibility === 'PASSWORD' && !ctx.isOwner && !ctx.hasUnlock;
}
