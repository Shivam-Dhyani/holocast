/**
 * Recording Lab runners (FR-LAB-03/05): capability probe submit (T-REC-01/02),
 * playback-to-end verification used by the 5-min E2E (T-REC-03) and crash-recovery
 * (T-REC-07), and `submitRecordingStats`, which the recorder calls after finalize to
 * post §10.8 statistics to the Lab when the user is an admin (a no-op otherwise).
 */

import { probe } from '../recorder/probe';
import type { RecordingStats } from '../recorder/stats';
import { attachHls } from '../player/play';
import { playlistUrl } from '../api';
import { mapRecordingMetrics, type RecMappingContext } from './metrics';
import { submitLabResult, type SubmitOutcome } from './submit';

/** Run the capability probe and submit T-REC-01 (INFO, full JSON) + T-REC-02 (recordable). */
export async function runProbeAndSubmit(): Promise<{ recordable: boolean; probe: SubmitOutcome; codecs: SubmitOutcome }> {
  const p = await probe();
  const probeOutcome = await submitLabResult('T-REC-01', p as unknown as Record<string, unknown>);
  const codecOutcome = await submitLabResult(
    'T-REC-02',
    { recordable: p.recordable, h264Configs: p.h264Configs, aacEncode: p.aacEncode, opusEncode: p.opusEncode },
    p.reasons.join('; ') || undefined,
  );
  return { recordable: p.recordable, probe: probeOutcome, codecs: codecOutcome };
}

/**
 * Play a READY share at `playbackRate` in a hidden player and resolve true on `ended`.
 * Used by T-REC-03 (4× fast-forward) and T-REC-07 (confirm the recovered video plays).
 */
export async function verifyPlaysToEnd(
  shareId: string,
  opts: { playbackRate?: number; nocache?: boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;left:-9999px;';
  document.body.appendChild(video);
  const handle = attachHls(video, playlistUrl(shareId) + (opts.nocache ? '?nocache=1' : ''));
  video.playbackRate = opts.playbackRate ?? 4;
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), opts.timeoutMs ?? 180_000);
      video.addEventListener('ended', () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
      video.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(false);
      }, { once: true });
      void video.play().catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  } finally {
    try {
      handle.destroy();
    } catch {
      /* ignore */
    }
    video.pause();
    video.remove();
  }
}

/**
 * Submit recorder §10.8 statistics under a T-REC-* id. Called unconditionally by the
 * recorder; returns `{ ok:false, forbidden:true }` for non-admins (FR-LAB-05).
 */
export async function submitRecordingStats(
  testId: string,
  stats: RecordingStats,
  ctx: RecMappingContext,
): Promise<SubmitOutcome> {
  const metrics = mapRecordingMetrics(testId, stats, ctx);
  return submitLabResult(testId, metrics);
}

/**
 * Full 5-min E2E evaluation (T-REC-03): given a freshly-finalized Lab video's share id
 * and its recorder stats, verify it plays to the end at 4× and submit the combined result.
 */
export async function runE2EEvaluation(
  shareId: string,
  stats: RecordingStats,
  segmentDurationsUs: number[],
): Promise<SubmitOutcome & { playsToEnd: boolean }> {
  const playsToEnd = await verifyPlaysToEnd(shareId, { playbackRate: 4 });
  const outcome = await submitRecordingStats('T-REC-03', stats, { segmentDurationsUs, playsToEnd });
  return { ...outcome, playsToEnd };
}
