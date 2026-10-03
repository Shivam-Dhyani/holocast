/**
 * fMP4 segmenter (TDD §10.5). Parses the ordered byte stream from Mediabunny's
 * AppendOnlyStreamTarget by MP4 box headers:
 *   - `ftyp` + `moov` (+ anything before the first `styp`/`moof`) = init segment.
 *   - each `styp?` + `sidx?` + `moof` + `mdat` = one media segment.
 * Per segment it records seq, durationUs (from the video traf's trun/tfhd/trex),
 * sizeBytes, and sha256.
 */

export interface MediaSegmentOut {
  seq: number;
  bytes: Uint8Array;
  durationUs: number;
  sizeBytes: number;
  sha256: string;
}

export interface SegmenterCallbacks {
  onInit: (bytes: Uint8Array) => void | Promise<void>;
  onSegment: (seg: MediaSegmentOut) => void | Promise<void>;
  /** optional warning when a non-final segment is outside 3.5–4.5 s (T-REC-03). */
  onDurationWarning?: (seq: number, seconds: number) => void;
}

interface BoxHeader {
  type: string;
  /** absolute start of the box within `buf`. */
  start: number;
  /** total box size in bytes. */
  size: number;
  headerSize: number;
}

function readBoxHeader(buf: Uint8Array, dv: DataView, at: number): BoxHeader | null {
  if (at + 8 > buf.length) return null;
  let size = dv.getUint32(at);
  const type = String.fromCharCode(buf[at + 4]!, buf[at + 5]!, buf[at + 6]!, buf[at + 7]!);
  let headerSize = 8;
  if (size === 1) {
    if (at + 16 > buf.length) return null;
    const hi = dv.getUint32(at + 8);
    const lo = dv.getUint32(at + 12);
    size = hi * 2 ** 32 + lo;
    headerSize = 16;
  } else if (size === 0) {
    size = buf.length - at; // extends to end
  }
  return { type, start: at, size, headerSize };
}

/** Video-track context parsed from moov, needed for durations. */
interface MoovCtx {
  videoTrackId: number;
  timescale: number;
  defaultSampleDuration: number;
}

function findChildren(buf: Uint8Array, dv: DataView, start: number, end: number): BoxHeader[] {
  const out: BoxHeader[] = [];
  let at = start;
  while (at + 8 <= end) {
    const h = readBoxHeader(buf, dv, at);
    if (!h || h.size < 8 || at + h.size > end) break;
    out.push(h);
    at += h.size;
  }
  return out;
}

function parseMoov(buf: Uint8Array, dv: DataView, moov: BoxHeader): MoovCtx | null {
  const moovStart = moov.start + moov.headerSize;
  const moovEnd = moov.start + moov.size;
  let ctx: MoovCtx | null = null;

  for (const trak of findChildren(buf, dv, moovStart, moovEnd)) {
    if (trak.type !== 'trak') continue;
    const trakEnd = trak.start + trak.size;
    let trackId = 0;
    let timescale = 0;
    let isVideo = false;

    for (const b of findChildren(buf, dv, trak.start + trak.headerSize, trakEnd)) {
      if (b.type === 'tkhd') {
        const v = buf[b.start + b.headerSize]!;
        trackId = dv.getUint32(b.start + b.headerSize + (v === 1 ? 4 + 16 : 4 + 8));
      } else if (b.type === 'mdia') {
        for (const m of findChildren(buf, dv, b.start + b.headerSize, b.start + b.size)) {
          if (m.type === 'mdhd') {
            const v = buf[m.start + m.headerSize]!;
            timescale = dv.getUint32(m.start + m.headerSize + (v === 1 ? 4 + 16 : 4 + 8));
          } else if (m.type === 'hdlr') {
            const handler = String.fromCharCode(
              buf[m.start + m.headerSize + 8]!,
              buf[m.start + m.headerSize + 9]!,
              buf[m.start + m.headerSize + 10]!,
              buf[m.start + m.headerSize + 11]!,
            );
            if (handler === 'vide') isVideo = true;
          }
        }
      }
    }
    if (isVideo && trackId && timescale) {
      ctx = { videoTrackId: trackId, timescale, defaultSampleDuration: 0 };
    }
  }

  if (ctx) {
    // trex default_sample_duration for the video track (moov/mvex/trex).
    for (const b of findChildren(buf, dv, moovStart, moovEnd)) {
      if (b.type !== 'mvex') continue;
      for (const trex of findChildren(buf, dv, b.start + b.headerSize, b.start + b.size)) {
        if (trex.type !== 'trex') continue;
        const base = trex.start + trex.headerSize;
        if (dv.getUint32(base + 4) === ctx.videoTrackId) {
          ctx.defaultSampleDuration = dv.getUint32(base + 12);
        }
      }
    }
  }
  return ctx;
}

/** Sum the video fragment's sample durations (ticks) from its traf trun/tfhd/trex. */
function moofDurationTicks(buf: Uint8Array, dv: DataView, moof: BoxHeader, ctx: MoovCtx): number {
  for (const traf of findChildren(buf, dv, moof.start + moof.headerSize, moof.start + moof.size)) {
    if (traf.type !== 'traf') continue;
    let trackId = 0;
    let tfhdDefaultDuration = 0;
    let trun: BoxHeader | null = null;

    for (const b of findChildren(buf, dv, traf.start + traf.headerSize, traf.start + traf.size)) {
      if (b.type === 'tfhd') {
        const flags = dv.getUint32(b.start + b.headerSize) & 0x00ffffff;
        trackId = dv.getUint32(b.start + b.headerSize + 4);
        let p = b.start + b.headerSize + 8;
        if (flags & 0x1) p += 8; // base_data_offset
        if (flags & 0x2) p += 4; // sample_description_index
        if (flags & 0x8) tfhdDefaultDuration = dv.getUint32(p);
      } else if (b.type === 'trun') {
        trun = b;
      }
    }
    if (trackId !== ctx.videoTrackId || !trun) continue;

    const flags = dv.getUint32(trun.start + trun.headerSize) & 0x00ffffff;
    const sampleCount = dv.getUint32(trun.start + trun.headerSize + 4);
    let p = trun.start + trun.headerSize + 8;
    if (flags & 0x1) p += 4; // data_offset
    if (flags & 0x4) p += 4; // first_sample_flags
    const hasDuration = (flags & 0x100) !== 0;
    const perSampleFields =
      (hasDuration ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);

    if (hasDuration) {
      let total = 0;
      for (let i = 0; i < sampleCount; i++) total += dv.getUint32(p + i * perSampleFields);
      return total;
    }
    const perSample = tfhdDefaultDuration || ctx.defaultSampleDuration;
    return sampleCount * perSample;
  }
  return 0;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Segmenter {
  push(chunk: Uint8Array): Promise<void>;
  flush(): Promise<void>;
}

export function createSegmenter(cb: SegmenterCallbacks): Segmenter {
  let buffer: Uint8Array = new Uint8Array(0);
  let phase: 'init' | 'segment' = 'init';
  const initBoxes: Uint8Array[] = [];
  let curSeg: Uint8Array[] = [];
  let curSegHasMdat = false;
  let moovCtx: MoovCtx | null = null;
  let seq = 0;

  function append(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  async function emitSegment(): Promise<void> {
    if (curSeg.length === 0) return;
    let total = 0;
    for (const c of curSeg) total += c.length;
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of curSeg) {
      bytes.set(c, o);
      o += c.length;
    }
    seq += 1;
    let durationUs = 0;
    try {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const moof = findChildren(bytes, dv, 0, bytes.length).find((h) => h.type === 'moof');
      if (moof && moovCtx) {
        const ticks = moofDurationTicks(bytes, dv, moof, moovCtx);
        if (ticks > 0) durationUs = Math.round((ticks / moovCtx.timescale) * 1_000_000);
      }
    } catch {
      /* fall back to 0 → caller may treat as unknown */
    }
    const sha256 = await sha256Hex(bytes);
    const seconds = durationUs / 1_000_000;
    if (cb.onDurationWarning && durationUs > 0 && (seconds < 3.5 || seconds > 4.5)) {
      cb.onDurationWarning(seq, seconds);
    }
    await cb.onSegment({ seq, bytes, durationUs, sizeBytes: total, sha256 });
    curSeg = [];
    curSegHasMdat = false;
  }

  async function consume(): Promise<void> {
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let at = 0;
    for (;;) {
      const h = readBoxHeader(buffer, dv, at);
      if (!h || at + h.size > buffer.length) break; // incomplete box, wait for more
      const boxBytes = buffer.subarray(at, at + h.size);

      const startsSegment = h.type === 'styp' || h.type === 'moof';
      if (phase === 'init') {
        if (startsSegment) {
          // init complete
          let len = 0;
          for (const c of initBoxes) len += c.length;
          const init = new Uint8Array(len);
          let o = 0;
          for (const c of initBoxes) {
            init.set(c, o);
            o += c.length;
          }
          if (h.type === 'moof' || h.type === 'styp') {
            // parse moov from init (if present) for durations
            const idv = new DataView(init.buffer, init.byteOffset, init.byteLength);
            const moov = findChildren(init, idv, 0, init.length).find((b) => b.type === 'moov');
            if (moov) moovCtx = parseMoov(init, idv, moov);
          }
          await cb.onInit(init);
          phase = 'segment';
          curSeg.push(boxBytes.slice());
          if (h.type === 'mdat') curSegHasMdat = true;
        } else {
          initBoxes.push(boxBytes.slice());
        }
      } else {
        if (startsSegment && curSegHasMdat) {
          await emitSegment();
        }
        curSeg.push(boxBytes.slice());
        if (h.type === 'mdat') curSegHasMdat = true;
      }
      at += h.size;
    }
    buffer = buffer.subarray(at).slice();
  }

  return {
    async push(chunk: Uint8Array): Promise<void> {
      buffer = append(buffer, chunk);
      await consume();
    },
    async flush(): Promise<void> {
      await consume();
      await emitSegment();
    },
  };
}
