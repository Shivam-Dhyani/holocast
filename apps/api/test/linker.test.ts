import { describe, it, expect, vi } from 'vitest';

import { handleMembershipEvent, type ExistingChannel, type LinkerDeps } from '../src/storage-connect/linker.js';
import type { BotMembershipEvent } from '../src/storage-connect/types.js';

function event(overrides: Partial<BotMembershipEvent> = {}): BotMembershipEvent {
  return {
    channelId: '5001',
    channelTitle: 'Holocast Storage',
    actorTelegramUserId: '777',
    newStatus: 'administrator',
    canPostMessages: true,
    canDeleteMessages: true,
    source: 'botapi',
    receivedAt: new Date(),
    ...overrides,
  };
}

function deps(overrides: Partial<LinkerDeps> = {}): LinkerDeps {
  return {
    findUserByTelegramId: vi.fn(async () => ({ id: 'user-1' })),
    findChannelByTelegramId: vi.fn(async () => null),
    findOtherConnectedChannel: vi.fn(async () => null),
    createConnectedChannel: vi.fn(async () => {}),
    reconnectChannel: vi.fn(async () => {}),
    markDisconnected: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    resolveAccessHash: vi.fn(async () => 'hash-abc'),
    botLeave: vi.fn(async () => {}),
    postConfirmation: vi.fn(async () => {}),
    invalidateUserVideoCaches: vi.fn(async () => {}),
    logEvent: vi.fn(async () => {}),
    ...overrides,
  };
}

const chan = (over: Partial<ExistingChannel> = {}): ExistingChannel => ({
  id: 'c1',
  userId: 'user-1',
  status: 'CONNECTED',
  ...over,
});

describe('linking state machine (FR-STO-03..08)', () => {
  it('LINKED: new channel for a known user → create + confirmation', async () => {
    const d = deps();
    const out = await handleMembershipEvent(event(), d);
    expect(out).toBe('LINKED');
    expect(d.createConnectedChannel).toHaveBeenCalledOnce();
    expect(d.postConfirmation).toHaveBeenCalledWith('5001', 'hash-abc', '777');
    expect(d.logEvent).toHaveBeenCalledWith(expect.anything(), 'LINKED');
  });

  it('UNKNOWN_ACTOR: adder has no Holocast account → bot leaves', async () => {
    const d = deps({ findUserByTelegramId: vi.fn(async () => null) });
    const out = await handleMembershipEvent(event(), d);
    expect(out).toBe('UNKNOWN_ACTOR');
    expect(d.botLeave).toHaveBeenCalledOnce();
    expect(d.createConnectedChannel).not.toHaveBeenCalled();
  });

  it('RECONNECTED: same user re-adds the same channel', async () => {
    const d = deps({ findChannelByTelegramId: vi.fn(async () => chan({ status: 'DISCONNECTED' })) });
    const out = await handleMembershipEvent(event(), d);
    expect(out).toBe('RECONNECTED');
    expect(d.reconnectChannel).toHaveBeenCalledWith('5001', 'Holocast Storage', 'hash-abc');
    expect(d.botLeave).not.toHaveBeenCalled();
  });

  it('CHANNEL_OWNED_BY_OTHER: channel belongs to a different user → bot leaves', async () => {
    const d = deps({ findChannelByTelegramId: vi.fn(async () => chan({ userId: 'someone-else' })) });
    const out = await handleMembershipEvent(event(), d);
    expect(out).toBe('CHANNEL_OWNED_BY_OTHER');
    expect(d.botLeave).toHaveBeenCalledOnce();
  });

  it('ALREADY_CONNECTED: user already has another connected channel → bot leaves (FR-STO-09)', async () => {
    const d = deps({ findOtherConnectedChannel: vi.fn(async () => chan({ id: 'other' })) });
    const out = await handleMembershipEvent(event(), d);
    expect(out).toBe('ALREADY_CONNECTED');
    expect(d.botLeave).toHaveBeenCalledOnce();
    expect(d.createConnectedChannel).not.toHaveBeenCalled();
  });

  it('ERROR: access hash cannot be resolved → channel marked ERROR, no confirmation', async () => {
    const d = deps({ resolveAccessHash: vi.fn(async () => null) });
    const out = await handleMembershipEvent(event(), d);
    expect(out).toBe('ERROR');
    expect(d.createConnectedChannel).toHaveBeenCalledOnce();
    expect(d.markError).toHaveBeenCalledOnce();
    expect(d.postConfirmation).not.toHaveBeenCalled();
  });

  it('DISCONNECTED: bot demoted/removed from a tracked channel', async () => {
    const d = deps({ findChannelByTelegramId: vi.fn(async () => chan()) });
    const out = await handleMembershipEvent(event({ newStatus: 'kicked', canPostMessages: false }), d);
    expect(out).toBe('DISCONNECTED');
    expect(d.markDisconnected).toHaveBeenCalledWith('5001');
  });

  it('IGNORED: non-admin event for an untracked channel', async () => {
    const d = deps();
    const out = await handleMembershipEvent(event({ newStatus: 'member', canPostMessages: false }), d);
    expect(out).toBe('IGNORED');
    expect(d.markDisconnected).not.toHaveBeenCalled();
  });
});
