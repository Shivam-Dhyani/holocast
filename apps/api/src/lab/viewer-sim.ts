/**
 * Pure playback simulation for T-PLY-05 (TDD §9.4). A simulated viewer downloads
 * segments in order; playback starts once `bufferSegments` are buffered. We then walk a
 * realistic playback clock: whenever the next segment is not yet downloaded when it must
 * play, the clock pauses (a *stall*) until it arrives. `onTimePct` is the share of
 * segments that played without a pause. PASS (per thresholds.ts) = 0 stalls and ≥ 99 %.
 */

export interface ViewerTimeline {
  /** Per-segment playback durations (seconds), in order. */
  durationsS: number[];
  /** Wall-clock ms (relative to the viewer's start) at which each segment finished downloading. */
  availableAtMs: number[];
}

export interface ViewerResult {
  total: number;
  stalls: number;
  lateCount: number;
  onTimePct: number;
  startClockMs: number;
}

export function evaluateViewer(t: ViewerTimeline, bufferSegments = 2): ViewerResult {
  const n = t.durationsS.length;
  if (n === 0) return { total: 0, stalls: 0, lateCount: 0, onTimePct: 100, startClockMs: 0 };

  // Playback begins when the buffer target is met (or the last segment, if fewer).
  const startIdx = Math.min(bufferSegments, n) - 1;
  const startClock = t.availableAtMs[startIdx] ?? 0;

  let wall = startClock;
  let stalls = 0;
  let late = 0;
  for (let i = 0; i < n; i++) {
    if (i >= bufferSegments && (t.availableAtMs[i] ?? 0) > wall) {
      stalls++;
      late++;
      wall = t.availableAtMs[i]!; // clock pauses until the segment arrives
    }
    wall += (t.durationsS[i] ?? 0) * 1000;
  }
  return {
    total: n,
    stalls,
    lateCount: late,
    onTimePct: Number((((n - late) / n) * 100).toFixed(3)),
    startClockMs: Math.round(startClock),
  };
}

export interface AggregateResult {
  viewers: number;
  stalls: number;
  onTimePct: number;
  segmentsTotal: number;
  segmentsLate: number;
}

/** Combine per-viewer results: total stalls and overall on-time percentage. */
export function aggregateViewers(results: ViewerResult[]): AggregateResult {
  const segmentsTotal = results.reduce((a, r) => a + r.total, 0);
  const segmentsLate = results.reduce((a, r) => a + r.lateCount, 0);
  const stalls = results.reduce((a, r) => a + r.stalls, 0);
  return {
    viewers: results.length,
    stalls,
    onTimePct: segmentsTotal === 0 ? 100 : Number((((segmentsTotal - segmentsLate) / segmentsTotal) * 100).toFixed(3)),
    segmentsTotal,
    segmentsLate,
  };
}

export interface ParsedPlaylist {
  initUri: string | null;
  segments: Array<{ uri: string; durationS: number }>;
}

/** Parse an HLS media playlist into its init (EXT-X-MAP) and EXTINF/URI segment pairs. */
export function parsePlaylist(m3u8: string): ParsedPlaylist {
  const lines = m3u8.split('\n').map((l) => l.trim());
  let initUri: string | null = null;
  const segments: ParsedPlaylist['segments'] = [];
  let pendingDuration: number | null = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      initUri = /URI="([^"]+)"/.exec(line)?.[1] ?? null;
    } else if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(line.slice('#EXTINF:'.length));
    } else if (line && !line.startsWith('#')) {
      segments.push({ uri: line, durationS: pendingDuration ?? 0 });
      pendingDuration = null;
    }
  }
  return { initUri, segments };
}
