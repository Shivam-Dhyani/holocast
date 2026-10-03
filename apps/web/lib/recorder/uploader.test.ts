import { afterEach, describe, it, expect, vi } from 'vitest';

import { backoffMs, createUploader, lagSeconds } from './uploader.js';
import { aggregateDurations } from './stats.js';
import type { RecorderManifest } from './opfs-queue.js';

function manifest(): RecorderManifest {
  return {
    videoId: 'vid1',
    uploadToken: 'tok',
    shareUrl: 'https://x/v/abc',
    bitrateBps: 1_500_000,
    nextSeq: 1,
    acked: [],
    finalRequested: false,
    durationUs: 0,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('backoff + lag (pure)', () => {
  it('backoffMs climbs 1→2→4→8→16→30s and caps', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
  it('lagSeconds is recorded minus acked, floored at 0', () => {
    expect(lagSeconds(10_000_000, 4_000_000)).toBe(6);
    expect(lagSeconds(4_000_000, 10_000_000)).toBe(0);
  });
});

describe('aggregateDurations (pure)', () => {
  it('summarises per-segment durations', () => {
    const a = aggregateDurations([4_000_000, 4_000_000, 2_000_000]);
    expect(a.count).toBe(3);
    expect(a.recordedUs).toBe(10_000_000);
    expect(a.minS).toBe(2);
    expect(a.maxS).toBe(4);
    expect(a.avgS).toBeCloseTo(3.333, 2);
  });
  it('handles empty', () => {
    expect(aggregateDurations([])).toEqual({ count: 0, recordedUs: 0, minS: 0, maxS: 0, avgS: 0 });
  });
});

describe('uploader queue', () => {
  it('uploads init then segments in order and accumulates acked duration', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(null, { status: 200 });
      }),
    );
    const up = createUploader(manifest(), { sleepImpl: async () => {} });
    up.enqueueInit(new Uint8Array([1]), { video: 'avc1.640028', audio: 'mp4a.40.2', width: 1920, height: 1080 });
    up.enqueueSegment({ seq: 1, bytes: new Uint8Array([2]), durationUs: 4_000_000, sha256: 'a' });
    up.enqueueSegment({ seq: 2, bytes: new Uint8Array([3]), durationUs: 4_000_000, sha256: 'b' });
    await up.drain();

    expect(calls).toEqual([
      '/api/videos/vid1/init',
      '/api/videos/vid1/segments/1',
      '/api/videos/vid1/segments/2',
    ]);
    expect(up.ackedDurationUs()).toBe(8_000_000);
  });

  it('retries on a failed request using the backoff sleeper', async () => {
    let n = 0;
    const sleeps: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++;
        if (n === 1) throw new Error('network');
        return new Response(null, { status: 200 });
      }),
    );
    const up = createUploader(manifest(), { sleepImpl: async (ms) => void sleeps.push(ms) });
    up.enqueueSegment({ seq: 1, bytes: new Uint8Array([2]), durationUs: 4_000_000, sha256: 'a' });
    await up.drain();
    expect(n).toBe(2); // one failure + one success
    expect(sleeps).toEqual([1000]);
    expect(up.ackedDurationUs()).toBe(4_000_000);
  });
});
