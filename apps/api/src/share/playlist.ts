/** HLS playlist generation (FR-PLY-01/02, TDD §11.4). */

import { signedMediaUrl, type MediaRef } from '../media/signing.js';

export interface PlaylistSegment {
  seq: number;
  durationUs: number;
}

export interface BuildPlaylistOptions {
  videoId: string;
  ready: boolean;
  segments: PlaylistSegment[];
  nocache?: boolean;
  nowMs?: number;
}

/** Only contiguous segments from seq 1 are listed (TDD §11.4). */
export function contiguousFromOne(segments: PlaylistSegment[]): PlaylistSegment[] {
  const bySeq = new Map(segments.map((s) => [s.seq, s]));
  const out: PlaylistSegment[] = [];
  for (let seq = 1; bySeq.has(seq); seq++) out.push(bySeq.get(seq)!);
  return out;
}

export function buildPlaylist(opts: BuildPlaylistOptions): string {
  const segs = contiguousFromOne(opts.segments);
  const sign = (ref: MediaRef) => signedMediaUrl(opts.videoId, ref, { nocache: opts.nocache, nowMs: opts.nowMs });
  const maxDurS = segs.reduce((m, s) => Math.max(m, s.durationUs / 1_000_000), 0);
  const targetDuration = Math.max(1, Math.ceil(maxDurS || 4));

  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:1',
    `#EXT-X-PLAYLIST-TYPE:${opts.ready ? 'VOD' : 'EVENT'}`,
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MAP:URI="${sign('init')}"`,
  ];
  for (const s of segs) {
    lines.push(`#EXTINF:${(s.durationUs / 1_000_000).toFixed(3)},`);
    lines.push(sign(s.seq));
  }
  if (opts.ready) lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}
