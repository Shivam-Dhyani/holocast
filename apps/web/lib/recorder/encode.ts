/**
 * Encode + mux to fragmented MP4 via Mediabunny (FR-REC-02/03, TDD §10.4), piping
 * the output byte stream into the box-parsing segmenter (§10.5). Frame acquisition
 * uses Mediabunny's MediaStream track sources (the preferred path for background
 * tabs, U-05/06); it's isolated here so an alternative could be swapped in.
 */

import {
  AppendOnlyStreamTarget,
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

import {
  AUDIO_BITRATE_BPS,
  FPS,
  KEYFRAME_INTERVAL_SECONDS,
  SEGMENT_TARGET_SECONDS,
  TARGET_HEIGHT,
  TARGET_WIDTH,
} from './constants';
import { createSegmenter, type SegmenterCallbacks } from './segmenter';

export interface EncoderHandle {
  /** finalize the MP4 and flush the last segment. */
  stop: () => Promise<void>;
}

export interface StartEncoderParams {
  videoTrack: MediaStreamTrack;
  audioTrack: MediaStreamTrack;
  audioCodec: 'aac' | 'opus';
  bitrateBps: number;
  /** actual source dimensions (from the display track), for downscale-only resize. */
  sourceWidth?: number;
  sourceHeight?: number;
  callbacks: SegmenterCallbacks;
}

/** Scale down to fit within TARGET_WIDTH×TARGET_HEIGHT preserving aspect ratio; never upscale (FR-REC-02). */
export function downscaleDims(w: number, h: number): { width: number; height: number } | null {
  if (!w || !h) return null;
  const scale = Math.min(1, TARGET_WIDTH / w, TARGET_HEIGHT / h);
  if (scale >= 1) return null; // source already within bounds — no resize
  return { width: Math.round((w * scale) / 2) * 2, height: Math.round((h * scale) / 2) * 2 };
}

export async function startEncoder(params: StartEncoderParams): Promise<EncoderHandle> {
  const segmenter = createSegmenter(params.callbacks);

  const writable = new WritableStream<Uint8Array>({
    write: (chunk) => segmenter.push(chunk),
  });

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: SEGMENT_TARGET_SECONDS }),
    target: new AppendOnlyStreamTarget(writable),
  });

  const resize = downscaleDims(params.sourceWidth ?? 0, params.sourceHeight ?? 0);
  const videoSource = new MediaStreamVideoTrackSource(
    params.videoTrack as never,
    {
      codec: 'avc',
      bitrate: params.bitrateBps,
      keyFrameInterval: KEYFRAME_INTERVAL_SECONDS,
      ...(resize ? { transform: { width: resize.width, height: resize.height } } : {}),
    },
    { frameRate: FPS },
  );
  const audioSource = new MediaStreamAudioTrackSource(
    params.audioTrack as never,
    { codec: params.audioCodec, bitrate: AUDIO_BITRATE_BPS },
  );

  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);
  await output.start();

  return {
    async stop() {
      await output.finalize(); // flushes remaining bytes through the writable → segmenter
      await segmenter.flush();
    },
  };
}
