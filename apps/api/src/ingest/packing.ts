/** Pure pack-grouping math (TDD §11.2). A pack = 15 consecutive segments. */

export const PACK_SIZE = 15;

/** Pack number (1-based) that a 1-based segment seq belongs to: ceil(seq / 15). */
export function packNoForSeq(seq: number): number {
  return Math.ceil(seq / PACK_SIZE);
}

/** Inclusive [firstSeq, lastSeq] a full pack covers: pack n → 15n−14 … 15n. */
export function packRange(packNo: number): { firstSeq: number; lastSeq: number } {
  return { firstSeq: PACK_SIZE * packNo - (PACK_SIZE - 1), lastSeq: PACK_SIZE * packNo };
}

/** Whether every segment of a full pack is present (used to trigger pack-upload). */
export function isFullPackComplete(packNo: number, presentSeqs: Iterable<number>): boolean {
  const set = presentSeqs instanceof Set ? presentSeqs : new Set(presentSeqs);
  const { firstSeq, lastSeq } = packRange(packNo);
  for (let s = firstSeq; s <= lastSeq; s++) if (!set.has(s)) return false;
  return true;
}

/**
 * Concatenate segment byte buffers in order, recording each segment's plaintext
 * byte offset within the pack (TDD §11.2: Segment.offsetInPack).
 */
export function concatSegments(
  segments: Array<{ seq: number; bytes: Uint8Array }>,
): { data: Uint8Array; offsets: Array<{ seq: number; offsetInPack: number; sizeBytes: number }> } {
  let total = 0;
  for (const s of segments) total += s.bytes.length;
  const data = new Uint8Array(total);
  const offsets: Array<{ seq: number; offsetInPack: number; sizeBytes: number }> = [];
  let o = 0;
  for (const s of segments) {
    data.set(s.bytes, o);
    offsets.push({ seq: s.seq, offsetInPack: o, sizeBytes: s.bytes.length });
    o += s.bytes.length;
  }
  return { data, offsets };
}

/** Self-describing Telegram caption for a pack (TDD §11.2), ≤ 1024 chars. */
export function packCaption(videoId: string, packNo: number, firstSeq: number, lastSeq: number, offsets: number[]): string {
  return JSON.stringify({ hc: 1, v: videoId, p: packNo, s: [firstSeq, lastSeq], o: offsets });
}
