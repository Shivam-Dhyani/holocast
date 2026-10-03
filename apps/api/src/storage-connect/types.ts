/** Bot membership events + source interface (U-03, TDD §8.3). */

export type BotMemberStatus = 'administrator' | 'member' | 'left' | 'kicked';

export interface BotMembershipEvent {
  /** positive MTProto channel id, as a string. */
  channelId: string;
  channelTitle: string;
  /** who made the change. */
  actorTelegramUserId: string;
  newStatus: BotMemberStatus;
  canPostMessages: boolean;
  canDeleteMessages: boolean;
  /** only delivered by the MTProto source. */
  accessHash?: string;
  source: 'botapi' | 'mtproto';
  receivedAt: Date;
}

export interface BotEventSource {
  readonly kind: 'botapi' | 'mtproto';
  start(onEvent: (e: BotMembershipEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

/** Outcomes recorded in BotEventLog (TDD §9 BotEventLog.outcome). */
export type LinkOutcome =
  | 'LINKED'
  | 'RECONNECTED'
  | 'DISCONNECTED'
  | 'UNKNOWN_ACTOR'
  | 'ALREADY_CONNECTED'
  | 'CHANNEL_OWNED_BY_OTHER'
  | 'ERROR'
  | 'IGNORED';
