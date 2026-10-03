import { z } from 'zod';

export const Visibility = z.enum(['PUBLIC', 'UNLISTED', 'PASSWORD', 'PRIVATE']);
export type Visibility = z.infer<typeof Visibility>;

export const VideoStatus = z.enum(['RECORDING', 'FINALIZING', 'READY', 'FAILED', 'DELETED']);
export type VideoStatus = z.infer<typeof VideoStatus>;

export const ChannelStatus = z.enum(['CONNECTED', 'DISCONNECTED', 'ERROR']);
export type ChannelStatus = z.infer<typeof ChannelStatus>;

/** Storage status as seen by the client: a channel state, or NONE when unconnected. */
export const StorageState = z.enum(['NONE', 'CONNECTED', 'DISCONNECTED', 'ERROR']);
export type StorageState = z.infer<typeof StorageState>;

export const LabStatus = z.enum(['PASS', 'FAIL', 'BLOCKED', 'INFO', 'NOT_RUN', 'RUNNING']);
export type LabStatus = z.infer<typeof LabStatus>;

export const LabRunner = z.enum(['SERVER', 'BROWSER', 'CLI', 'MANUAL', 'AUTOTEST']);
export type LabRunner = z.infer<typeof LabRunner>;
