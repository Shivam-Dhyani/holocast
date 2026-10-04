import { describe, it, expect } from 'vitest';

import { aggregateViewers, evaluateViewer, parsePlaylist } from '../src/lab/viewer-sim.js';

describe('evaluateViewer (T-PLY-05)', () => {
  it('no stalls when every segment arrives before its playback deadline', () => {
    // 4 s segments; downloads finish well ahead of the playback clock.
    const r = evaluateViewer({
      durationsS: [4, 4, 4, 4, 4],
      availableAtMs: [200, 400, 600, 800, 1000],
    });
    expect(r.stalls).toBe(0);
    expect(r.onTimePct).toBe(100);
  });

  it('counts a stall when a segment arrives after it must play', () => {
    // Buffer = seg0,1 ready by 400ms; playback starts at 400ms.
    // seg2 must play at 400 + (4+4)*1000 = 8400ms but arrives at 9000ms → stall.
    const r = evaluateViewer({
      durationsS: [4, 4, 4],
      availableAtMs: [200, 400, 9000],
    });
    expect(r.stalls).toBe(1);
    expect(r.lateCount).toBe(1);
    expect(r.onTimePct).toBeCloseTo((2 / 3) * 100, 1);
  });

  it('pre-buffered segments never stall', () => {
    const r = evaluateViewer({ durationsS: [4, 4], availableAtMs: [5000, 9000] });
    expect(r.stalls).toBe(0);
  });

  it('handles an empty playlist', () => {
    expect(evaluateViewer({ durationsS: [], availableAtMs: [] })).toMatchObject({ total: 0, stalls: 0, onTimePct: 100 });
  });
});

describe('aggregateViewers', () => {
  it('sums stalls and computes overall on-time %', () => {
    const agg = aggregateViewers([
      { total: 10, stalls: 0, lateCount: 0, onTimePct: 100, startClockMs: 0 },
      { total: 10, stalls: 1, lateCount: 1, onTimePct: 90, startClockMs: 0 },
    ]);
    expect(agg.stalls).toBe(1);
    expect(agg.segmentsTotal).toBe(20);
    expect(agg.segmentsLate).toBe(1);
    expect(agg.onTimePct).toBeCloseTo(95, 1);
  });
});

describe('parsePlaylist', () => {
  it('extracts the init URI and EXTINF/URI pairs', () => {
    const m3u8 = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MAP:URI="/api/media/vid/init.mp4?e=1&s=aa"',
      '#EXTINF:4.000,',
      '/api/media/vid/1.m4s?e=1&s=bb',
      '#EXTINF:3.200,',
      '/api/media/vid/2.m4s?e=1&s=cc',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const p = parsePlaylist(m3u8);
    expect(p.initUri).toBe('/api/media/vid/init.mp4?e=1&s=aa');
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0]).toEqual({ uri: '/api/media/vid/1.m4s?e=1&s=bb', durationS: 4 });
    expect(p.segments[1]!.durationS).toBeCloseTo(3.2);
  });
});
