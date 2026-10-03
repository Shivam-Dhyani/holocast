import { beforeAll, describe, it, expect } from 'vitest';

// Secrets must exist before config is imported (config reads env at module load).
process.env.MEDIA_URL_SECRET ??= Buffer.alloc(32, 7).toString('base64');
process.env.UNLOCK_COOKIE_SECRET ??= Buffer.alloc(32, 9).toString('base64');

let signing: typeof import('../src/media/signing.js');
let access: typeof import('../src/share/access.js');
let playlist: typeof import('../src/share/playlist.js');

beforeAll(async () => {
  signing = await import('../src/media/signing.js');
  access = await import('../src/share/access.js');
  playlist = await import('../src/share/playlist.js');
});

describe('signed media URLs (FR-SHR-08, T-SEC-02)', () => {
  it('round-trips a valid signature', () => {
    const exp = signing.expiryUnix();
    const sig = signing.sign('vid1', 5, exp);
    expect(signing.verify('vid1', 5, exp, sig)).toBe(true);
  });
  it('rejects a tampered seq, video, exp, or signature', () => {
    const exp = signing.expiryUnix();
    const sig = signing.sign('vid1', 5, exp);
    expect(signing.verify('vid1', 6, exp, sig)).toBe(false);
    expect(signing.verify('vid2', 5, exp, sig)).toBe(false);
    expect(signing.verify('vid1', 5, exp + 1, sig)).toBe(false);
    expect(signing.verify('vid1', 5, exp, sig + 'x')).toBe(false);
  });
  it('rejects an expired URL', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig = signing.sign('vid1', 'init', past);
    expect(signing.verify('vid1', 'init', past, sig)).toBe(false);
  });
});

describe('access-control matrix (T-SEC-01)', () => {
  const anon = { isOwner: false, hasUnlock: false };
  const unlocked = { isOwner: false, hasUnlock: true };
  const owner = { isOwner: true, hasUnlock: false };

  it('PUBLIC/UNLISTED allow everyone', () => {
    expect(access.canWatch('PUBLIC', anon).allowed).toBe(true);
    expect(access.canWatch('UNLISTED', anon).allowed).toBe(true);
  });
  it('PASSWORD requires unlock or owner', () => {
    expect(access.canWatch('PASSWORD', anon)).toMatchObject({ allowed: false, status: 401, needsPassword: true });
    expect(access.canWatch('PASSWORD', unlocked).allowed).toBe(true);
    expect(access.canWatch('PASSWORD', owner).allowed).toBe(true);
  });
  it('PRIVATE allows only the owner', () => {
    expect(access.canWatch('PRIVATE', anon)).toMatchObject({ allowed: false, status: 403 });
    expect(access.canWatch('PRIVATE', unlocked).allowed).toBe(false);
    expect(access.canWatch('PRIVATE', owner).allowed).toBe(true);
  });
});

describe('HLS playlist (FR-PLY-01/02)', () => {
  const segs = [
    { seq: 1, durationUs: 4_000_000 },
    { seq: 2, durationUs: 3_800_000 },
    { seq: 4, durationUs: 4_000_000 }, // gap at 3 — must be excluded
  ];

  it('lists only contiguous segments from seq 1 and signs URLs', () => {
    expect(playlist.contiguousFromOne(segs).map((s) => s.seq)).toEqual([1, 2]);
    const m3u8 = playlist.buildPlaylist({ videoId: 'vid1', ready: true, segments: segs });
    expect(m3u8).toContain('#EXTM3U');
    expect(m3u8).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(m3u8).toContain('#EXT-X-MAP:URI="/api/media/vid1/init.mp4?e=');
    expect(m3u8).toContain('/api/media/vid1/1.m4s?e=');
    expect(m3u8).toContain('/api/media/vid1/2.m4s?e=');
    expect(m3u8).not.toContain('/api/media/vid1/4.m4s');
    expect(m3u8).toContain('#EXT-X-ENDLIST');
    expect(m3u8).toContain('#EXTINF:4.000,');
  });

  it('uses EVENT type and no ENDLIST while still recording', () => {
    const m3u8 = playlist.buildPlaylist({ videoId: 'vid1', ready: false, segments: segs });
    expect(m3u8).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(m3u8).not.toContain('#EXT-X-ENDLIST');
  });
});
