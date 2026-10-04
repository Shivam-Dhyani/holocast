/**
 * Pure mappings from recorder statistics (§10.8) to the metric keys each recording
 * threshold evaluates (apps/api/src/lab/thresholds.ts). Kept pure and unit-tested; the
 * DOM runners and the recorder feed real data through here before submitting (FR-LAB-05).
 *
 * Honesty note: Mediabunny does not expose encoder-queue depth or per-frame gaps in the
 * installed version (see IMPLEMENTATION_NOTES), so `maxEncoderQueue` (T-REC-04) and
 * `maxFrozenMs` (T-REC-05) are only emitted when a real sample exists — a missing sample
 * makes the threshold FAIL rather than silently passing on a fabricated value.
 */

import type { RecordingStats } from '../recorder/stats';

export interface RecMappingContext {
  /** Per-segment durations (µs), in order; the last is the (short) final segment. */
  segmentDurationsUs: number[];
  /** Guided target duration in seconds (5-min = 300, 60-min = 3600, …) for error %. */
  expectedDurationS?: number;
  /** Playback verification outcome (set by the E2E/recovery runner). */
  playsToEnd?: boolean;
  playable?: boolean;
  /** Whether every pre-reload segment is present on the server (T-REC-07). */
  allSegmentsUploaded?: boolean;
}

/** Percent error of recorded vs expected duration (vs wall-clock when no target given). */
export function durationErrorPct(stats: RecordingStats, expectedDurationS?: number): number {
  const recordedS = stats.recordedDurationUs / 1_000_000;
  const baseS = expectedDurationS && expectedDurationS > 0 ? expectedDurationS : stats.wallClockMs / 1000;
  if (baseS <= 0) return Infinity;
  return ((recordedS - baseS) / baseS) * 100;
}

/** min/max over all but the final segment (the final one is intentionally short). */
export function nonFinalSegBoundsS(segmentDurationsUs: number[]): { minS: number; maxS: number } {
  const nonFinal = segmentDurationsUs.slice(0, Math.max(0, segmentDurationsUs.length - 1));
  if (nonFinal.length === 0) return { minS: 0, maxS: 0 };
  const secs = nonFinal.map((d) => d / 1_000_000);
  return { minS: Math.min(...secs), maxS: Math.max(...secs) };
}

/** longest hidden→visible gap in ms (proxy for a frozen tab when frame gaps aren't exposed). */
export function longestHiddenMs(stats: RecordingStats): number {
  let worst = 0;
  let hiddenAt: number | null = null;
  for (const e of stats.visibilityTimeline) {
    if (e.state === 'hidden') hiddenAt = e.atMs;
    else if (e.state === 'visible' && hiddenAt !== null) {
      worst = Math.max(worst, e.atMs - hiddenAt);
      hiddenAt = null;
    }
  }
  return worst;
}

export function mapRecordingMetrics(
  testId: string,
  stats: RecordingStats,
  ctx: RecMappingContext,
): Record<string, unknown> {
  const common = {
    browser: stats.browser,
    wallClockS: Number((stats.wallClockMs / 1000).toFixed(2)),
    recordedDurationS: Number((stats.recordedDurationUs / 1_000_000).toFixed(2)),
    segmentCount: stats.segmentCount,
    maxLagS: Number(stats.maxUploadLagS.toFixed(2)),
    avgLagS: Number(stats.avgUploadLagS.toFixed(2)),
    finalAckS: Number((stats.stopToFinalAckMs / 1000).toFixed(2)),
  };

  switch (testId) {
    case 'T-REC-03': {
      const b = nonFinalSegBoundsS(ctx.segmentDurationsUs);
      return {
        ...common,
        playsToEnd: ctx.playsToEnd ?? false,
        minNonFinalSegS: Number(b.minS.toFixed(3)),
        maxNonFinalSegS: Number(b.maxS.toFixed(3)),
      };
    }
    case 'T-REC-04':
      return {
        ...common,
        completed: true,
        durationErrorPct: Number(durationErrorPct(stats, ctx.expectedDurationS).toFixed(2)),
        ...(stats.encoderQueueMax !== null ? { maxEncoderQueue: stats.encoderQueueMax } : {}),
      };
    case 'T-REC-05':
      return {
        ...common,
        durationErrorPct: Number(durationErrorPct(stats, ctx.expectedDurationS).toFixed(2)),
        maxFrozenMs: stats.longestFrameGapMs ?? longestHiddenMs(stats),
      };
    case 'T-REC-06':
      return { ...common };
    case 'T-REC-07':
      return {
        ...common,
        allSegmentsUploaded: ctx.allSegmentsUploaded ?? false,
        playable: ctx.playable ?? false,
      };
    default:
      return common;
  }
}
