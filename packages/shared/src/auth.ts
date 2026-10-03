import { z } from 'zod';

/**
 * Telegram Login Widget payload (TDD §8.1). The server verifies `hash` over all
 * other fields before trusting it; this schema only shapes the input.
 */
export const TelegramAuthPayload = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().url().optional(),
    auth_date: z.union([z.string(), z.number()]).transform((v) => Number(v)),
    hash: z.string(),
  })
  .passthrough();
export type TelegramAuthPayload = z.infer<typeof TelegramAuthPayload>;
