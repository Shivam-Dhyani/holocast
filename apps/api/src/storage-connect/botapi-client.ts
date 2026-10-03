/**
 * Thin Telegram Bot API HTTP client (getUpdates long-poll, sendMessage, leaveChat).
 * Used for the default membership event source and for posting the confirmation /
 * leaving a channel — none of which require the MTProto storage client.
 */

const BOT_API = 'https://api.telegram.org';

/** Bot API channel chat id (-100…) ⇄ MTProto channel id (positive), TDD §8.3. */
export function mtprotoToBotApiChatId(channelId: string): string {
  return (-1_000_000_000_000n - BigInt(channelId)).toString();
}
export function botApiChatIdToMtproto(chatId: string): string {
  return (-BigInt(chatId) - 1_000_000_000_000n).toString();
}

interface BotApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(token: string, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BOT_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const json = (await res.json()) as BotApiResult<T>;
  if (!json.ok) throw new Error(`Bot API ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

export interface RawUpdate {
  update_id: number;
  my_chat_member?: unknown;
  [k: string]: unknown;
}

export function getUpdates(
  token: string,
  offset: number,
  opts: { timeout?: number; allowedUpdates?: string[]; signal?: AbortSignal } = {},
): Promise<RawUpdate[]> {
  return call<RawUpdate[]>(
    token,
    'getUpdates',
    { offset, timeout: opts.timeout ?? 50, allowed_updates: opts.allowedUpdates ?? ['my_chat_member'] },
    opts.signal,
  );
}

export function sendMessage(token: string, chatId: string, text: string): Promise<unknown> {
  return call(token, 'sendMessage', { chat_id: chatId, text });
}

export function leaveChat(token: string, chatId: string): Promise<unknown> {
  return call(token, 'leaveChat', { chat_id: chatId });
}
