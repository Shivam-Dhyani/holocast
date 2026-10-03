import { z } from 'zod';

import { Visibility, VideoStatus } from './enums.js';

export const MAX_TITLE_LEN = 120;
export const MIN_PASSWORD_LEN = 6;
export const LAB_BITRATES = [1_000_000, 1_500_000, 2_500_000] as const;

/** POST /api/videos (FR-SHR-02, FR-REC-08). */
export const CreateVideoRequest = z
  .object({
    title: z.string().max(MAX_TITLE_LEN).optional(),
    visibility: Visibility.default('UNLISTED'),
    password: z.string().min(MIN_PASSWORD_LEN).optional(),
    /** Lab-only bitrate override (1.0 / 1.5 / 2.5 Mbps). */
    bitrateBps: z
      .number()
      .int()
      .refine((n) => (LAB_BITRATES as readonly number[]).includes(n), 'unsupported bitrate')
      .optional(),
  })
  .refine((v) => v.visibility !== 'PASSWORD' || !!v.password, {
    message: 'password required for PASSWORD visibility',
    path: ['password'],
  });
export type CreateVideoRequest = z.infer<typeof CreateVideoRequest>;

export const CreateVideoResponse = z.object({
  videoId: z.string(),
  shareUrl: z.string(),
  uploadToken: z.string(),
  segmentTargetSeconds: z.number(),
  bitrateBps: z.number().int(),
});
export type CreateVideoResponse = z.infer<typeof CreateVideoResponse>;

/** POST /api/videos/:id/finalize (TDD §11.3). */
export const FinalizeRequest = z.object({
  expectedSegments: z.number().int().nonnegative(),
  durationUs: z.union([z.string(), z.number()]).transform((v) => String(v)),
  stats: z.record(z.string(), z.unknown()).optional(),
});
export type FinalizeRequest = z.infer<typeof FinalizeRequest>;

/** PATCH /api/videos/:id (FR-VID-02, FR-SHR-07). */
export const PatchVideoRequest = z
  .object({
    title: z.string().max(MAX_TITLE_LEN).optional(),
    visibility: Visibility.optional(),
    password: z.string().min(MIN_PASSWORD_LEN).nullable().optional(),
  })
  .refine((v) => v.visibility !== 'PASSWORD' || v.password !== null, {
    message: 'password required when switching to PASSWORD',
    path: ['password'],
  });
export type PatchVideoRequest = z.infer<typeof PatchVideoRequest>;

export const VideoListItem = z.object({
  id: z.string(),
  title: z.string(),
  durationUs: z.string(),
  createdAt: z.string(),
  visibility: Visibility,
  status: VideoStatus,
  shareUrl: z.string(),
});
export type VideoListItem = z.infer<typeof VideoListItem>;
