/**
 * Recording statistics for T-REC-03..07 (TDD §10.8). Sent with finalize and to the
 * Lab when the user is an admin.
 *
 * Note: per-frame gap and encoder-queue depth aren't exposed by Mediabunny's
 * internal encoder, so those are best-effort/null here (recorded in
 * IMPLEMENTATION_NOTES); segment cadence and the visibility timeline still let the
 * Lab reason about background-tab behaviour (T-REC-05).
 */

export interface DurationAggregate {
  count: number;
  recordedUs: number;
  minS: number;
  maxS: number;
  avgS: number;
}

/** Pure aggregation over per-segment durations (µs). */
export function aggregateDurations(durationsUs: number[]): DurationAggregate {
  if (durationsUs.length === 0) return { count: 0, recordedUs: 0, minS: 0, maxS: 0, avgS: 0 };
  const recordedUs = durationsUs.reduce((a, b) => a + b, 0);
  const secs = durationsUs.map((d) => d / 1_000_000);
  return {
    count: durationsUs.length,
    recordedUs,
    minS: Math.min(...secs),
    maxS: Math.max(...secs),
    avgS: recordedUs / 1_000_000 / durationsUs.length,
  };
}

export interface RecordingStats {
  browser: unknown;
  chosenVideoCodec: string;
  chosenAudioCodec: string;
  hardwareAcceleration: string | null;
  bitrateBps: number;
  wallClockMs: number;
  recordedDurationUs: number;
  segmentCount: number;
  segmentDurationMinS: number;
  segmentDurationMaxS: number;
  segmentDurationAvgS: number;
  maxUploadLagS: number;
  avgUploadLagS: number;
  stopToFinalAckMs: number;
  visibilityTimeline: Array<{ state: 'hidden' | 'visible'; atMs: number }>;
  memorySamplesBytes: number[];
  encoderQueueMax: number | null;
  longestFrameGapMs: number | null;
}

export interface StatsCollector {
  onSegment: (durationUs: number) => void;
  sampleLag: (lagS: number) => void;
  onVisibility: (state: 'hidden' | 'visible') => void;
  sampleMemory: () => void;
  finish: (final: {
    chosenVideoCodec: string;
    chosenAudioCodec: string;
    hardwareAcceleration: string | null;
    bitrateBps: number;
    stopToFinalAckMs: number;
  }) => RecordingStats;
}

export function createStatsCollector(browser: unknown): StatsCollector {
  const startedAt = performance.now();
  const durations: number[] = [];
  const lags: number[] = [];
  const visibilityTimeline: RecordingStats['visibilityTimeline'] = [];
  const memorySamplesBytes: number[] = [];

  return {
    onSegment: (durationUs) => void durations.push(durationUs),
    sampleLag: (lagS) => void lags.push(lagS),
    onVisibility: (state) => void visibilityTimeline.push({ state, atMs: Math.round(performance.now() - startedAt) }),
    sampleMemory: () => {
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) memorySamplesBytes.push(mem.usedJSHeapSize);
    },
    finish: (final) => {
      const agg = aggregateDurations(durations);
      return {
        browser,
        chosenVideoCodec: final.chosenVideoCodec,
        chosenAudioCodec: final.chosenAudioCodec,
        hardwareAcceleration: final.hardwareAcceleration,
        bitrateBps: final.bitrateBps,
        wallClockMs: Math.round(performance.now() - startedAt),
        recordedDurationUs: agg.recordedUs,
        segmentCount: agg.count,
        segmentDurationMinS: Number(agg.minS.toFixed(3)),
        segmentDurationMaxS: Number(agg.maxS.toFixed(3)),
        segmentDurationAvgS: Number(agg.avgS.toFixed(3)),
        maxUploadLagS: lags.length ? Math.max(...lags) : 0,
        avgUploadLagS: lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : 0,
        stopToFinalAckMs: final.stopToFinalAckMs,
        visibilityTimeline,
        memorySamplesBytes,
        encoderQueueMax: null,
        longestFrameGapMs: null,
      };
    },
  };
}
