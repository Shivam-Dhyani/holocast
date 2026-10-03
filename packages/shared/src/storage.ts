import { z } from 'zod';

import { StorageState } from './enums.js';

/** GET /api/storage */
export const StorageStatusResponse = z.object({
  status: StorageState,
  channelTitle: z.string().nullable().optional(),
  /** t.me deep link that adds the bot with post/edit/delete rights (FR-STO-02). */
  deepLink: z.string(),
  botUsername: z.string(),
});
export type StorageStatusResponse = z.infer<typeof StorageStatusResponse>;
