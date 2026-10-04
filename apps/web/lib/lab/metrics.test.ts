import { describe, it, expect } from 'vitest';

import { durationErrorPct, longestHiddenMs, mapRecordingMetrics, nonFinalSegBoundsS } from './metrics';
import type { RecordingStats } from '../recorder/stats';

function stats(over: Partial<RecordingStats> = {}): RecordingStats {
  return {
    browser: { name: 'Chrome' },
    chosenVideoCodec: 'avc1.640028',
    chosenAudioCodec: 'mp4a.40.2',
    hardwareAcceleration: null,
    bitrateBps: 1_500_000,
    wallClockMs: 300_000,
    recordedDurationUs: 300_000_000,
    segmentCount: 75,
    segmentDurationMinS: 0.5,
    segmentDurationMaxS: 4,
    segmentDurationAvgS: 4,
    maxUploadLagS: 2,
    avgUploadLagS: 1,
    stopToFinalAckMs: 3000,
    visibilityTimeline: [],
    memorySamplesBytes: [],
    encoderQueueMax: null,
    longestFrameGapMs: null,
    ...over,
  };
}

describe('durationErrorPct', () => {
  it('is ~0 when recorded matches the expected target', () => {
    expect(durationErrorPct(stats({ recordedDurationUs: 300_000_000 }), 300)).toBeCloseTo(0);
  });
  it('falls back to wall-clock when no target is given', () => {
    expect(durationErrorPct(stats({ recordedDurationUs: 297_000_000, wallClockMs: 300_000 }))).toBeCloseTo(-1);
  });
  it('reports a positive error when recorded exceeds target', () => {
    expect(durationErrorPct(stats({ recordedDurationUs: 306_000_000 }), 300)).toBeCloseTo(2);
  });
});

describe('nonFinalSegBoundsS', () => {
  it('excludes the final (short) segment', () => {
    const b = nonFinalSegBoundsS([4_000_000, 4_000_000, 3_900_000, 500_000]);
    expect(b.minS).toBeCloseTo(3.9);
    expect(b.maxS).toBeCloseTo(4);
  });
  it('is zero for an empty or single-segment list', () => {
    expect(nonFinalSegBoundsS([])).toEqual({ minS: 0, maxS: 0 });
    expect(nonFinalSegBoundsS([500_000])).toEqual({ minS: 0, maxS: 0 });
  });
});

describe('longestHiddenMs', () => {
  it('measures the longest hidden→visible span', () => {
    const s = stats({
      visibilityTimeline: [
        { state: 'hidden', atMs: 1000 },
        { state: 'visible', atMs: 1500 },
        { state: 'hidden', atMs: 3000 },
        { state: 'visible', atMs: 6000 },
      ],
    });
    expect(longestHiddenMs(s)).toBe(3000);
  });
  it('is 0 when never hidden', () => {
    expect(longestHiddenMs(stats())).toBe(0);
  });
});

describe('mapRecordingMetrics', () => {
  it('T-REC-03 carries playback result and non-final seg bounds', () => {
    const m = mapRecordingMetrics('T-REC-03', stats(), {
      segmentDurationsUs: [4_000_000, 4_000_000, 500_000],
      playsToEnd: true,
    });
    expect(m).toMatchObject({ playsToEnd: true, minNonFinalSegS: 4, maxNonFinalSegS: 4 });
  });

  it('T-REC-04 marks completed and omits encoder queue when unavailable', () => {
    const m = mapRecordingMetrics('T-REC-04', stats(), { segmentDurationsUs: [], expectedDurationS: 3600 });
    expect(m.completed).toBe(true);
    expect('maxEncoderQueue' in m).toBe(false);
  });

  it('T-REC-04 includes encoder queue when a real sample exists', () => {
    const m = mapRecordingMetrics('T-REC-04', stats({ encoderQueueMax: 12 }), { segmentDurationsUs: [] });
    expect(m.maxEncoderQueue).toBe(12);
  });

  it('T-REC-05 uses the hidden-span proxy when no frame gap is available', () => {
    const s = stats({
      visibilityTimeline: [
        { state: 'hidden', atMs: 0 },
        { state: 'visible', atMs: 1200 },
      ],
    });
    const m = mapRecordingMetrics('T-REC-05', s, { segmentDurationsUs: [] });
    expect(m.maxFrozenMs).toBe(1200);
  });

  it('T-REC-07 reports upload completeness and playability', () => {
    const m = mapRecordingMetrics('T-REC-07', stats(), {
      segmentDurationsUs: [],
      allSegmentsUploaded: true,
      playable: true,
    });
    expect(m).toMatchObject({ allSegmentsUploaded: true, playable: true });
  });
});
