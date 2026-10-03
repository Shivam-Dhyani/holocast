/**
 * Telegram server-test runners (TDD §13.2). Core throughput tests take an injected
 * encrypted store + channel id so they can be unit-tested with an in-memory
 * adapter; FLOOD_WAIT and file-ref-refresh timings arrive via the caller's metrics
 * arrays. T-ONB-04 and T-INF-04 run against the real adapter / Neon.
 *
 * Every pack is marked `{hc:1,lab:true}` and deleted after the test (T-INF-08 /
 * "Clean up Lab data").
 */

import { randomBytes } from 'node:crypto';

import type { ObjectRef, StorageAdapter, TelegramAdapter } from '@shivam-dhyani/unified-storage';
import type { PrismaClient } from '@prisma/client';

import { median, percentile, round } from './stats.js';

const MB = 1_000_000;
const LAB_CAPTION = JSON.stringify({ hc: 1, lab: true });

export interface TgDeps {
  store: StorageAdapter;
  channelId: string;
  /** flood_wait waitSeconds collected via the adapter metrics hook. */
  floods: number[];
  /** refresh_ref ms collected via the adapter metrics hook. */
  refreshMs: number[];
}

export type Metrics = Record<string, unknown>;

function labName(i: number): string {
  return `lab_${Date.now()}_${i}_${randomBytes(3).toString('hex')}.bin`;
}

async function uploadPacks(deps: TgDeps, count: number, bytes: number): Promise<{ refs: ObjectRef[]; mbps: number[] }> {
  const refs: ObjectRef[] = [];
  const mbps: number[] = [];
  for (let i = 0; i < count; i++) {
    const data = randomBytes(bytes);
    const t0 = performance.now();
    const ref = await deps.store.put({ container: deps.channelId, data, name: labName(i), caption: LAB_CAPTION });
    mbps.push(bytes / MB / ((performance.now() - t0) / 1000));
    refs.push(ref);
  }
  return { refs, mbps };
}

async function cleanup(deps: TgDeps, refs: ObjectRef[]): Promise<void> {
  for (const ref of refs) {
    try {
      await deps.store.delete(ref);
    } catch {
      /* best effort */
    }
  }
}

/** T-TG-01: upload throughput (median ≥ 1.0 MB/s). */
export async function runTgUpload(deps: TgDeps, opt: { packs?: number; sizeMb?: number } = {}): Promise<Metrics> {
  deps.floods.length = 0;
  const bytes = Math.round((opt.sizeMb ?? 12) * MB);
  const { refs, mbps } = await uploadPacks(deps, opt.packs ?? 10, bytes);
  await cleanup(deps, refs);
  return { medianMBps: round(median(mbps)), perUploadMBps: mbps.map((x) => round(x)), floodWaits: [...deps.floods] };
}

/** T-TG-02: sequential full-pack download (median ≥ 2.0 MB/s). */
export async function runTgDownload(deps: TgDeps, opt: { packs?: number; sizeMb?: number } = {}): Promise<Metrics> {
  const bytes = Math.round((opt.sizeMb ?? 12) * MB);
  const { refs } = await uploadPacks(deps, opt.packs ?? 10, bytes);
  const mbps: number[] = [];
  for (const ref of refs) {
    const t0 = performance.now();
    const buf = await deps.store.get(ref);
    mbps.push(buf.length / MB / ((performance.now() - t0) / 1000));
  }
  await cleanup(deps, refs);
  return { medianMBps: round(median(mbps)), perDownloadMBps: mbps.map((x) => round(x)) };
}

/** T-TG-03: 50 random 1 MB range reads (p50 ≤ 800 ms, p95 ≤ 1500 ms). */
export async function runTgRandomRanges(
  deps: TgDeps,
  opt: { packs?: number; sizeMb?: number; reads?: number } = {},
): Promise<Metrics> {
  const bytes = Math.round((opt.sizeMb ?? 12) * MB);
  const reads = opt.reads ?? 50;
  const { refs } = await uploadPacks(deps, opt.packs ?? 10, bytes);
  const lat: number[] = [];
  for (let i = 0; i < reads; i++) {
    const ref = refs[Math.floor(Math.random() * refs.length)]!;
    const offset = Math.floor(Math.random() * (bytes - MB));
    const t0 = performance.now();
    await deps.store.get(ref, { offset, length: MB });
    lat.push(performance.now() - t0);
  }
  await cleanup(deps, refs);
  return { p50Ms: round(percentile(lat, 50), 1), p95Ms: round(percentile(lat, 95), 1) };
}

/** T-TG-04: 10 concurrent range readers for `seconds` (aggregate ≥ 2.5 MB/s, p95 ≤ 2000 ms). */
export async function runTgConcurrency(
  deps: TgDeps,
  opt: { packs?: number; sizeMb?: number; seconds?: number; readBytes?: number } = {},
): Promise<Metrics> {
  const bytes = Math.round((opt.sizeMb ?? 12) * MB);
  const seconds = opt.seconds ?? 60;
  const readBytes = opt.readBytes ?? 750_000;
  const { refs } = await uploadPacks(deps, opt.packs ?? 10, bytes);

  const deadline = performance.now() + seconds * 1000;
  const lat: number[] = [];
  let totalBytes = 0;
  const worker = async (): Promise<void> => {
    while (performance.now() < deadline) {
      const ref = refs[Math.floor(Math.random() * refs.length)]!;
      const offset = Math.floor(Math.random() * (bytes - readBytes));
      const t0 = performance.now();
      const buf = await deps.store.get(ref, { offset, length: readBytes });
      lat.push(performance.now() - t0);
      totalBytes += buf.length;
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  await cleanup(deps, refs);
  return { aggregateMBps: round(totalBytes / MB / seconds), p95Ms: round(percentile(lat, 95), 1) };
}

/** T-TG-05: burst 30 uploads; count FLOOD_WAIT (max ≤ 10 s, total ≤ 30 s). */
export async function runTgBurst(deps: TgDeps, opt: { packs?: number; sizeMb?: number } = {}): Promise<Metrics> {
  deps.floods.length = 0;
  const bytes = Math.round((opt.sizeMb ?? 12) * MB);
  const { refs } = await uploadPacks(deps, opt.packs ?? 30, bytes);
  await cleanup(deps, refs);
  const maxWaitS = deps.floods.length ? Math.max(...deps.floods) : 0;
  const totalWaitS = deps.floods.reduce((a, b) => a + b, 0);
  return { maxWaitS: round(maxWaitS, 1), totalWaitS: round(totalWaitS, 1), floodWaits: [...deps.floods] };
}

/** T-TG-06: file-reference refresh cost (p95 ≤ 300 ms). Approximation: first read of
 * each of N freshly-uploaded packs triggers one getMessages (refresh_ref metric). */
export async function runTgRefRefresh(deps: TgDeps, opt: { iterations?: number; sizeMb?: number } = {}): Promise<Metrics> {
  deps.refreshMs.length = 0;
  const iterations = opt.iterations ?? 30;
  const bytes = Math.round((opt.sizeMb ?? 1) * MB);
  const { refs } = await uploadPacks(deps, iterations, bytes);
  for (const ref of refs) {
    await deps.store.get(ref, { offset: 0, length: 4096 }); // first read → refresh_ref
  }
  await cleanup(deps, refs);
  return { p95Ms: round(percentile(deps.refreshMs, 95), 1), samples: deps.refreshMs.length };
}

/** T-TG-07: stale reference after ≥24 h (INFO; recovery must succeed). Single-run
 * approximation records that a normal refreshed read works; the 24h arm is run by
 * the owner across two days per TDD §13.3. */
export async function runTgStaleRef(deps: TgDeps, opt: { sizeMb?: number } = {}): Promise<Metrics> {
  const bytes = Math.round((opt.sizeMb ?? 1) * MB);
  const { refs } = await uploadPacks(deps, 1, bytes);
  let recovered = false;
  try {
    const buf = await deps.store.get(refs[0]!, { offset: 0, length: 4096 });
    recovered = buf.length > 0;
  } finally {
    await cleanup(deps, refs);
  }
  return { expired: false, recovered, note: 'single-run approximation; run the 24h arm across two days (TDD §13.3)' };
}

/** T-ONB-04: resolve channel access for MTProto without a user session (U-04). */
export async function runOnb04(telegram: TelegramAdapter, channelId: string): Promise<Metrics> {
  try {
    const handle = await telegram.attachChannel(channelId);
    return { resolved: Boolean(handle.accessHash), method: 'channels.getChannels(accessHash=0)', title: handle.title };
  } catch (err) {
    return { resolved: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** T-INF-04: Neon segment-lookup query latency (warm p95 ≤ 100 ms). */
export async function runInf04(prisma: PrismaClient, opt: { iterations?: number } = {}): Promise<Metrics> {
  const iterations = opt.iterations ?? 200;
  // Warm the connection, then time a representative indexed lookup.
  await prisma.$queryRaw`SELECT 1`;
  const lat: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await prisma.segment.findFirst({ orderBy: { createdAt: 'desc' } });
    lat.push(performance.now() - t0);
  }
  return { warmP50Ms: round(percentile(lat, 50), 1), warmP95Ms: round(percentile(lat, 95), 1), iterations };
}
