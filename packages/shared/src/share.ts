import { z } from 'zod';

import { Visibility, VideoStatus } from './enums.js';
import { MIN_PASSWORD_LEN } from './videos.js';

/** GET /api/share/:shareId (TDD §11.4). */
export const ShareMetadata = z.object({
  title: z.string(),
  creatorName: z.string(),
  creatorPublicId: z.string(),
  visibility: Visibility,
  status: VideoStatus,
  durationUs: z.string(),
  needsPassword: z.boolean(),
  isOwner: z.boolean(),
  storageConnected: z.boolean(),
});
export type ShareMetadata = z.infer<typeof ShareMetadata>;

/** POST /api/share/:shareId/unlock (FR-SHR-05). */
export const UnlockRequest = z.object({
  password: z.string().min(MIN_PASSWORD_LEN),
});
export type UnlockRequest = z.infer<typeof UnlockRequest>;
