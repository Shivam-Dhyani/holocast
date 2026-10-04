/**
 * T-PLY-05 CLI viewer simulation (TDD §9.4, FR-LAB-04). Spawns N concurrent simulated
 * viewers against a READY share, each fetching the playlist then segments in order, and
 * reports stalls + on-time %. Run both cached and uncached:
 *
 *   pnpm --filter api lab:viewers --share <shareId> --count 10
 *   pnpm --filter api lab:viewers --share <shareId> --count 10 --nocache
 *
 * Base URL: --base <url> | $LAB_BASE_URL | $PUBLIC_BASE_URL | http://127.0.0.1:3000.
 * When $LAB_TOKEN is set, results are POSTed to /api/lab/results (Bearer) as T-PLY-05.
 */

import {
  aggregateViewers,
  evaluateViewer,
  parsePlaylist,
  type ViewerResult,
} from '../src/lab/viewer-sim.js';

interface Args {
  share: string;
  count: number;
  nocache: boolean;
  base: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const share = get('--share');
  if (!share) {
    throw new Error('usage: lab:viewers --share <shareId> [--count 10] [--nocache] [--base <url>]');
  }
  const base =
    get('--base') ??
    process.env.LAB_BASE_URL ??
    process.env.PUBLIC_BASE_URL ??
    'http://127.0.0.1:3000';
  return {
    share,
    count: Number(get('--count') ?? 10),
    nocache: argv.includes('--nocache'),
    base: base.replace(/\/$/, ''),
  };
}

async function fetchOk(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  // Drain the body so the full transfer time is counted toward availability.
  await res.arrayBuffer();
}

/** One simulated viewer: fetch playlist, init, then every segment in order. */
async function runViewer(base: string, share: string, nocache: boolean): Promise<ViewerResult> {
  const playlistUrl = `${base}/api/share/${share}/playlist.m3u8${nocache ? '?nocache=1' : ''}`;
  const res = await fetch(playlistUrl);
  if (!res.ok) throw new Error(`playlist ${res.status}`);
  const { initUri, segments } = parsePlaylist(await res.text());
  if (segments.length === 0) throw new Error('playlist has no segments');

  const start = performance.now();
  if (initUri) await fetchOk(abs(base, initUri));

  const availableAtMs: number[] = [];
  for (const seg of segments) {
    await fetchOk(abs(base, seg.uri));
    availableAtMs.push(performance.now() - start);
  }
  return evaluateViewer({ durationsS: segments.map((s) => s.durationS), availableAtMs });
}

/** Segment URIs in our playlists are absolute paths; join defensively anyway. */
function abs(base: string, uri: string): string {
  if (/^https?:\/\//.test(uri)) return uri;
  return base + (uri.startsWith('/') ? uri : `/${uri}`);
}

async function submit(base: string, metrics: Record<string, unknown>): Promise<void> {
  const token = process.env.LAB_TOKEN;
  if (!token) {
    console.log('(LAB_TOKEN not set — not submitting to the Lab)');
    return;
  }
  const res = await fetch(`${base}/api/lab/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ testId: 'T-PLY-05', metrics, environment: { runner: 'cli', node: process.version } }),
  });
  console.log(res.ok ? `submitted T-PLY-05 (${res.status})` : `submit failed (${res.status})`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`T-PLY-05: ${args.count} viewers, ${args.nocache ? 'uncached' : 'cached'}, ${args.base}/v/${args.share}`);

  const results = await Promise.all(
    Array.from({ length: args.count }, () => runViewer(args.base, args.share, args.nocache)),
  );
  const agg = aggregateViewers(results);
  const metrics = {
    stalls: agg.stalls,
    onTimePct: agg.onTimePct,
    viewers: agg.viewers,
    nocache: args.nocache,
    segmentsTotal: agg.segmentsTotal,
    segmentsLate: agg.segmentsLate,
    perViewer: results,
  };

  console.table(results.map((r, i) => ({ viewer: i + 1, segments: r.total, stalls: r.stalls, onTimePct: r.onTimePct })));
  console.log(`\nAGGREGATE  stalls=${agg.stalls}  onTime=${agg.onTimePct}%  → ${agg.stalls === 0 && agg.onTimePct >= 99 ? 'PASS' : 'FAIL'}`);
  await submit(args.base, metrics);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
