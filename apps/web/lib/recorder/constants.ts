/** Recording defaults (FR-REC-02/03/05, D-06). */

export const TARGET_WIDTH = 1920;
export const TARGET_HEIGHT = 1080;
export const FPS = 30;
export const DEFAULT_BITRATE_BPS = 1_500_000;
export const LAB_BITRATES = [1_000_000, 1_500_000, 2_500_000] as const;
export const SEGMENT_TARGET_SECONDS = 4;
export const KEYFRAME_INTERVAL_SECONDS = 4;
export const AUDIO_BITRATE_BPS = 128_000;
export const MAX_RECORDING_MS = 2 * 60 * 60 * 1000; // 2 hours (FR-REC-05)
export const WARN_AT_MS = (2 * 60 - 5) * 60 * 1000; // 1h55m

/** H.264 codec strings probed in order of preference (High, Main, Baseline). */
export const H264_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'] as const;
