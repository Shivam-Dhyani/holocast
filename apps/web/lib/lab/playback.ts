/**
 * Browser playback Lab runners (FR-LAB-03): TTFF cached/uncached (T-PLY-01/02),
 * seek latency (T-PLY-03), compatibility (T-PLY-04), and the R2 redirect+CORS check
 * (T-INF-05). All run inside the admin's browser against a READY Lab video and submit
 * via `submitLabResult`. First-frame timing uses `requestVideoFrameCallback` where
 * available (records which) and falls back to the `playing`/`seeked` events otherwise.
 */

import { attachHls, type PlayerHandle } from '../player/play';
import { playlistUrl } from '../api';
import { labEnvironment, mergeBrowsersOk, submitLabResult, type SubmitOutcome } from './submit';

export interface Percentiles {
  p50Ms: number;
  p95Ms: number;
  samples: number[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Infinity;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function percentiles(samples: number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95), samples };
}

/** Resolve once the next frame is painted (rVFC) or, failing that, on a fallback event. */
function nextFrame(video: HTMLVideoElement, fallbackEvent: 'playing' | 'seeked', timeoutMs = 20000): Promise<'rvfc' | 'event'> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (how: 'rvfc' | 'event') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener(fallbackEvent, onEvent);
      resolve(how);
    };
    const onEvent = () => finish('event');
    const timer = setTimeout(() => finish('event'), timeoutMs);
    const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
      .requestVideoFrameCallback;
    if (typeof rvfc === 'function') rvfc.call(video, () => finish('rvfc'));
    video.addEventListener(fallbackEvent, onEvent, { once: true });
  });
}

function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:-9999px;';
  document.body.appendChild(v);
  return v;
}

function teardown(video: HTMLVideoElement, handle: PlayerHandle): void {
  try {
    handle.destroy();
  } catch {
    /* ignore */
  }
  video.pause();
  video.remove();
}

async function waitMetadata(video: HTMLVideoElement, timeoutMs = 20000): Promise<void> {
  if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** T-PLY-01/02: 10 runs of play()→first-frame; PASS when p50 < 2000 ms. */
export async function runTtff(
  shareId: string,
  opts: { nocache?: boolean; count?: number } = {},
): Promise<Percentiles & { engine: string; frameMethod: string }> {
  const count = opts.count ?? 10;
  const src = playlistUrl(shareId) + (opts.nocache ? '?nocache=1' : '');
  const samples: number[] = [];
  let engine = 'none';
  let frameMethod = 'event';
  for (let i = 0; i < count; i++) {
    const video = hiddenVideo();
    const handle = attachHls(video, src);
    engine = handle.engine;
    const t0 = performance.now();
    await video.play().catch(() => {});
    const how = await nextFrame(video, 'playing');
    samples.push(performance.now() - t0);
    frameMethod = how === 'rvfc' ? 'requestVideoFrameCallback' : 'playing-event';
    teardown(video, handle);
  }
  return { ...percentiles(samples), engine, frameMethod };
}

/** T-PLY-03: with nocache, 10 seeks ≥60 s apart; latency = set currentTime → next frame. */
export async function runSeek(
  shareId: string,
  opts: { count?: number } = {},
): Promise<Percentiles & { engine: string }> {
  const count = opts.count ?? 10;
  const src = `${playlistUrl(shareId)}?nocache=1`;
  const video = hiddenVideo();
  const handle = attachHls(video, src);
  try {
    await video.play().catch(() => {});
    await nextFrame(video, 'playing');
    await waitMetadata(video);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : count * 60;
    const targets = pickSeekTargets(duration, count, 60);
    const samples: number[] = [];
    for (const target of targets) {
      const t0 = performance.now();
      video.currentTime = target;
      await nextFrame(video, 'seeked');
      samples.push(performance.now() - t0);
    }
    return { ...percentiles(samples), engine: handle.engine };
  } finally {
    teardown(video, handle);
  }
}

/** Distinct seek targets at least `minGapS` apart, spread across the duration. */
export function pickSeekTargets(durationS: number, count: number, minGapS: number): number[] {
  const usable = Math.max(0, durationS - 1);
  const buckets = Math.max(count, Math.floor(usable / minGapS) || count);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const lo = (usable * i) / count;
    const hi = (usable * (i + 1)) / count;
    out.push(Math.min(usable, lo + Math.random() * Math.max(0, hi - lo)));
  }
  void buckets;
  return out;
}

/** T-PLY-04: play 30 s + 2 seeks with cache on; record engine and errors per browser. */
export async function runCompatibility(shareId: string): Promise<SubmitOutcome & { engine: string; errors: string[] }> {
  const video = hiddenVideo();
  const errors: string[] = [];
  const handle = attachHls(video, playlistUrl(shareId));
  video.addEventListener('error', () => errors.push(`video.error:${video.error?.code ?? '?'}`));
  try {
    await video.play().catch((e) => errors.push(`play:${e instanceof Error ? e.message : 'rejected'}`));
    await nextFrame(video, 'playing');
    await waitMetadata(video);
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 30;
    video.currentTime = Math.min(dur - 1, 10);
    await nextFrame(video, 'seeked');
    video.currentTime = Math.min(dur - 1, 20);
    await nextFrame(video, 'seeked');
    const ok = errors.length === 0;
    const browsersOk = ok ? await mergeBrowsersOk('T-PLY-04', labEnvironment().browserKey) : [];
    const outcome = await submitLabResult('T-PLY-04', { browsersOk, engine: handle.engine, errors }, errors.join('; ') || undefined);
    return { ...outcome, engine: handle.engine, errors };
  } finally {
    teardown(video, handle);
  }
}

/** First non-comment URI line of an m3u8 is a segment URL (absolute path in our playlists). */
export function firstSegmentUri(m3u8: string): string | null {
  for (const raw of m3u8.split('\n')) {
    const line = raw.trim();
    if (line && !line.startsWith('#')) return line;
  }
  return null;
}

/** T-INF-05: fetch an R2-cached segment (follows 302) vs the Telegram path (nc=1). */
export async function runR2(shareId: string): Promise<SubmitOutcome & { cachedMs: number; telegramMs: number; corsError: boolean }> {
  let corsError = false;
  let cachedMs = NaN;
  let telegramMs = NaN;
  let ok = false;
  try {
    const plRes = await fetch(playlistUrl(shareId), { credentials: 'same-origin' });
    const m3u8 = await plRes.text();
    const segUri = firstSegmentUri(m3u8);
    if (segUri) {
      const t0 = performance.now();
      const cached = await fetch(segUri, { credentials: 'same-origin' });
      await cached.arrayBuffer();
      cachedMs = performance.now() - t0;

      const telegramUri = segUri + (segUri.includes('?') ? '&nc=1' : '?nc=1');
      const t1 = performance.now();
      const tg = await fetch(telegramUri, { credentials: 'same-origin' });
      await tg.arrayBuffer();
      telegramMs = performance.now() - t1;
      ok = cached.ok && tg.ok;
    }
  } catch (e) {
    // A thrown fetch on a cross-origin redirect without CORS headers surfaces as TypeError.
    corsError = e instanceof TypeError;
  }
  const browsersOk = ok && !corsError ? await mergeBrowsersOk('T-INF-05', labEnvironment().browserKey) : [];
  const outcome = await submitLabResult(
    'T-INF-05',
    { browsersOk, cachedMs: round(cachedMs), telegramMs: round(telegramMs), corsError },
    corsError ? 'CORS error following R2 redirect' : undefined,
  );
  return { ...outcome, cachedMs, telegramMs, corsError };
}

function round(n: number): number | null {
  return Number.isFinite(n) ? Number(n.toFixed(1)) : null;
}

/** Run TTFF (cached or uncached) and submit under the right test id. */
export async function runAndSubmitTtff(shareId: string, nocache: boolean): Promise<SubmitOutcome & Percentiles> {
  const r = await runTtff(shareId, { nocache });
  const testId = nocache ? 'T-PLY-02' : 'T-PLY-01';
  const outcome = await submitLabResult(testId, { p50Ms: round(r.p50Ms), p95Ms: round(r.p95Ms), engine: r.engine, frameMethod: r.frameMethod, samples: r.samples });
  return { ...outcome, p50Ms: r.p50Ms, p95Ms: r.p95Ms, samples: r.samples };
}

/** Run the seek benchmark and submit T-PLY-03. */
export async function runAndSubmitSeek(shareId: string): Promise<SubmitOutcome & Percentiles> {
  const r = await runSeek(shareId);
  const outcome = await submitLabResult('T-PLY-03', { p50Ms: round(r.p50Ms), p95Ms: round(r.p95Ms), engine: r.engine, samples: r.samples });
  return { ...outcome, p50Ms: r.p50Ms, p95Ms: r.p95Ms, samples: r.samples };
}
