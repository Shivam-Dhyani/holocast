import { z } from 'zod';

/** Telegram ids are BigInt in the DB and strings in JSON (CLAUDE.md). */
export const TelegramId = z.union([z.string(), z.number()]).transform((v) => String(v));

/** Microsecond duration, carried as a decimal string in JSON (BigInt in the DB). */
export const DurationUs = z.union([z.string(), z.number()]).transform((v) => String(v));

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;

export const PublicUser = z.object({
  id: z.string(),
  telegramUserId: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  publicId: z.string(),
});
export type PublicUser = z.infer<typeof PublicUser>;
