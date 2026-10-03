import { describe, it, expect } from 'vitest';

import { createSegmenter, type MediaSegmentOut } from './segmenter';

// ---- minimal MP4 box builders ----
function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function str4(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [...u32(size), ...str4(type), ...payload];
}
function pad(n: number): number[] {
  return new Array(n).fill(0);
}

// trak: tkhd(track_id=1) + mdia(mdhd timescale=30000 + hdlr 'vide')
function videoTrak(): number[] {
  const tkhd = box('tkhd', [...pad(4), ...pad(8), ...u32(1), ...pad(4)]); // v0: [vf][create+mod=8][track_id][...]
  const mdhd = box('mdhd', [...pad(4), ...pad(8), ...u32(30000), ...u32(0)]); // timescale at +12
  const hdlr = box('hdlr', [...pad(4), ...pad(4), ...str4('vide'), ...pad(12)]); // handler at +8
  const mdia = box('mdia', [...mdhd, ...hdlr]);
  return box('trak', [...tkhd, ...mdia]);
}
function mvex(): number[] {
  // trex: [vf][track_id=1][default_sample_desc][default_sample_duration=1000][size][flags]
  const trex = box('trex', [...pad(4), ...u32(1), ...u32(1), ...u32(1000), ...u32(0), ...u32(0)]);
  return box('mvex', trex);
}
function moov(): number[] {
  return box('moov', [...videoTrak(), ...mvex()]);
}
function ftyp(): number[] {
  return box('ftyp', [...str4('isom'), ...u32(0), ...str4('isom'), ...str4('iso6')]);
}
// moof with a video traf whose trun carries 2 sample durations summing to `ticks`.
function moof(ticksEach: number): number[] {
  const tfhd = box('tfhd', [...pad(4), ...u32(1)]); // flags 0, track_ID=1
  // trun: flags 0x000100 (duration present), sample_count=2, durations
  const trun = box('trun', [0x00, 0x00, 0x01, 0x00, ...u32(2), ...u32(ticksEach), ...u32(ticksEach)]);
  const traf = box('traf', [...tfhd, ...trun]);
  const mfhd = box('mfhd', [...pad(8)]);
  return box('moof', [...mfhd, ...traf]);
}
function mdat(nbytes: number): number[] {
  return box('mdat', pad(nbytes));
}

async function collect(stream: number[], chunkSize?: number) {
  const inits: Uint8Array[] = [];
  const segments: MediaSegmentOut[] = [];
  const seg = createSegmenter({
    onInit: (b) => void inits.push(b),
    onSegment: (s) => void segments.push(s),
  });
  const bytes = new Uint8Array(stream);
  if (chunkSize) {
    for (let i = 0; i < bytes.length; i += chunkSize) await seg.push(bytes.subarray(i, i + chunkSize));
  } else {
    await seg.push(bytes);
  }
  await seg.flush();
  return { init: inits[0], segments };
}

describe('fMP4 segmenter', () => {
  it('splits init from one media segment and computes duration (60000 ticks/sample @30000 → 4s)', async () => {
    const stream = [...ftyp(), ...moov(), ...moof(60000), ...mdat(100)];
    const { init, segments } = await collect(stream);
    expect(init).not.toBeNull();
    // init = ftyp + moov
    expect(init!.length).toBe(ftyp().length + moov().length);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.seq).toBe(1);
    expect(segments[0]!.durationUs).toBe(4_000_000); // (60000+60000)/30000 * 1e6
    expect(segments[0]!.sizeBytes).toBe(moof(60000).length + mdat(100).length);
    expect(segments[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emits multiple segments at moof boundaries', async () => {
    const stream = [...ftyp(), ...moov(), ...moof(60000), ...mdat(50), ...moof(30000), ...mdat(70)];
    const { segments } = await collect(stream);
    expect(segments.map((s) => s.seq)).toEqual([1, 2]);
    expect(segments[0]!.durationUs).toBe(4_000_000);
    expect(segments[1]!.durationUs).toBe(2_000_000); // (30000+30000)/30000
  });

  it('reassembles correctly when bytes are pushed in small chunks', async () => {
    const stream = [...ftyp(), ...moov(), ...moof(60000), ...mdat(100)];
    const whole = await collect(stream);
    const chunked = await collect(stream, 7); // awkward chunk size across box boundaries
    expect(chunked.segments).toHaveLength(1);
    expect(chunked.segments[0]!.durationUs).toBe(whole.segments[0]!.durationUs);
    expect(chunked.segments[0]!.sha256).toBe(whole.segments[0]!.sha256);
    expect(chunked.init!.length).toBe(whole.init!.length);
  });

  it('warns when a non-final segment duration is outside 3.5–4.5 s', async () => {
    const warnings: Array<[number, number]> = [];
    const seg = createSegmenter({
      onInit: () => {},
      onSegment: () => {},
      onDurationWarning: (seq, s) => warnings.push([seq, s]),
    });
    // 90000 ticks/sample * 2 = 180000 / 30000 = 6s → out of range
    await seg.push(new Uint8Array([...ftyp(), ...moov(), ...moof(90000), ...mdat(10)]));
    await seg.flush();
    expect(warnings).toEqual([[1, 6]]);
  });
});
