import { describe, it, expect } from 'vitest';

import { concatSegments, isFullPackComplete, packCaption, packNoForSeq, packRange } from '../src/ingest/packing.js';

describe('pack grouping math (TDD §11.2)', () => {
  it('maps seq → packNo (15 per pack)', () => {
    expect(packNoForSeq(1)).toBe(1);
    expect(packNoForSeq(15)).toBe(1);
    expect(packNoForSeq(16)).toBe(2);
    expect(packNoForSeq(30)).toBe(2);
    expect(packNoForSeq(31)).toBe(3);
  });

  it('pack n covers 15n−14 … 15n', () => {
    expect(packRange(1)).toEqual({ firstSeq: 1, lastSeq: 15 });
    expect(packRange(2)).toEqual({ firstSeq: 16, lastSeq: 30 });
  });

  it('detects a complete full pack', () => {
    const present = new Set(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(isFullPackComplete(1, present)).toBe(true);
    present.delete(7);
    expect(isFullPackComplete(1, present)).toBe(false);
  });

  it('concatenates segments and records byte offsets', () => {
    const segs = [
      { seq: 1, bytes: new Uint8Array([1, 1, 1]) },
      { seq: 2, bytes: new Uint8Array([2, 2]) },
      { seq: 3, bytes: new Uint8Array([3, 3, 3, 3]) },
    ];
    const { data, offsets } = concatSegments(segs);
    expect(data.length).toBe(9);
    expect(offsets).toEqual([
      { seq: 1, offsetInPack: 0, sizeBytes: 3 },
      { seq: 2, offsetInPack: 3, sizeBytes: 2 },
      { seq: 3, offsetInPack: 5, sizeBytes: 4 },
    ]);
    expect([...data]).toEqual([1, 1, 1, 2, 2, 3, 3, 3, 3]);
  });

  it('builds a compact self-describing caption', () => {
    const c = packCaption('vid1', 2, 16, 30, [0, 100, 250]);
    expect(JSON.parse(c)).toEqual({ hc: 1, v: 'vid1', p: 2, s: [16, 30], o: [0, 100, 250] });
    expect(c.length).toBeLessThanOrEqual(1024);
  });
});
