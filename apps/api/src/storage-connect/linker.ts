/**
 * Channel linking state machine (FR-STO-03..08, TDD §8.3). Pure logic over an
 * injected `LinkerDeps` so it is unit-testable without a database or Telegram.
 */

import type { BotMembershipEvent, LinkOutcome } from './types.js';

export interface ExistingChannel {
  id: string;
  userId: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
}

export interface LinkerDeps {
  findUserByTelegramId(actorTelegramUserId: string): Promise<{ id: string } | null>;
  /** channel row keyed by its telegram channel id, if any. */
  findChannelByTelegramId(channelId: string): Promise<ExistingChannel | null>;
  /** a different CONNECTED channel already owned by this user (FR-STO-09). */
  findOtherConnectedChannel(userId: string, exceptChannelId: string): Promise<ExistingChannel | null>;
  createConnectedChannel(input: {
    userId: string;
    channelId: string;
    title: string;
    accessHash: string | null;
  }): Promise<void>;
  reconnectChannel(channelId: string, title: string, accessHash: string | null): Promise<void>;
  markDisconnected(channelId: string): Promise<void>;
  markError(channelId: string): Promise<void>;
  /** resolve the MTProto access hash for file ops (U-04); null if it cannot. */
  resolveAccessHash(channelId: string, hintedAccessHash?: string): Promise<string | null>;
  botLeave(channelId: string, accessHash?: string): Promise<void>;
  postConfirmation(channelId: string, accessHash: string, telegramUserId: string): Promise<void>;
  invalidateUserVideoCaches(userId: string): Promise<void>;
  logEvent(event: BotMembershipEvent, outcome: LinkOutcome): Promise<void>;
}

const hasPostRights = (e: BotMembershipEvent): boolean =>
  e.newStatus === 'administrator' && e.canPostMessages;

export async function handleMembershipEvent(
  event: BotMembershipEvent,
  deps: LinkerDeps,
): Promise<LinkOutcome> {
  const outcome = await decide(event, deps);
  await deps.logEvent(event, outcome);
  return outcome;
}

async function decide(event: BotMembershipEvent, deps: LinkerDeps): Promise<LinkOutcome> {
  // Case 1: bot became an admin with post rights → (re)connect.
  if (hasPostRights(event)) {
    const user = await deps.findUserByTelegramId(event.actorTelegramUserId);
    if (!user) {
      await deps.botLeave(event.channelId, event.accessHash);
      return 'UNKNOWN_ACTOR';
    }

    const existing = await deps.findChannelByTelegramId(event.channelId);
    if (existing) {
      if (existing.userId !== user.id) {
        await deps.botLeave(event.channelId, event.accessHash);
        return 'CHANNEL_OWNED_BY_OTHER';
      }
      const accessHash = await deps.resolveAccessHash(event.channelId, event.accessHash);
      await deps.reconnectChannel(event.channelId, event.channelTitle, accessHash);
      await deps.invalidateUserVideoCaches(user.id);
      return 'RECONNECTED';
    }

    // New channel for this user — but one active channel per user (FR-STO-09).
    const other = await deps.findOtherConnectedChannel(user.id, event.channelId);
    if (other) {
      await deps.botLeave(event.channelId, event.accessHash);
      return 'ALREADY_CONNECTED';
    }

    const accessHash = await deps.resolveAccessHash(event.channelId, event.accessHash);
    await deps.createConnectedChannel({
      userId: user.id,
      channelId: event.channelId,
      title: event.channelTitle,
      accessHash,
    });
    if (accessHash === null) {
      await deps.markError(event.channelId);
      await deps.invalidateUserVideoCaches(user.id);
      return 'ERROR';
    }
    await deps.postConfirmation(event.channelId, accessHash, event.actorTelegramUserId);
    await deps.invalidateUserVideoCaches(user.id);
    return 'LINKED';
  }

  // Case 2: lost post rights / left / kicked → disconnect if we tracked it.
  const existing = await deps.findChannelByTelegramId(event.channelId);
  if (existing && existing.status !== 'DISCONNECTED') {
    await deps.markDisconnected(event.channelId);
    await deps.invalidateUserVideoCaches(existing.userId);
    return 'DISCONNECTED';
  }
  return 'IGNORED';
}
