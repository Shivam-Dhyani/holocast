/**
 * Phase 1 Lab thresholds — the SINGLE source of truth (PRD §9, CLAUDE.md rule 7,
 * FR-LAB-09). `thresholds.test.ts` asserts every PRD §9 test ID appears here.
 *
 * `evaluate(metrics)` returns PASS / FAIL / INFO. BLOCKED / NOT_RUN / RUNNING are
 * set by the Lab runtime, not here.
 */

import type { LabRunner } from '@holocast/shared';

export type ThresholdStatus = 'PASS' | 'FAIL' | 'INFO';
export type Metrics = Record<string, unknown>;

export interface ThresholdDef {
  id: string;
  name: string;
  runner: LabRunner;
  thresholdText: string;
  evaluate: (m: Metrics) => ThresholdStatus;
}

const BROWSERS = ['chrome', 'edge', 'firefox', 'safari'];

function num(m: Metrics, key: string): number | undefined {
  const v = m[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function bool(m: Metrics, key: string): boolean | undefined {
  const v = m[key];
  return typeof v === 'boolean' ? v : undefined;
}
function strArr(m: Metrics, key: string): string[] {
  const v = m[key];
  return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : [];
}
const INFO = (): ThresholdStatus => 'INFO';
/** PASS when every condition is a defined, true value; FAIL otherwise. */
function pass(...conds: Array<boolean | undefined>): ThresholdStatus {
  return conds.every((c) => c === true) ? 'PASS' : 'FAIL';
}
function allBrowsers(m: Metrics, key = 'browsersOk'): ThresholdStatus {
  const ok = new Set(strArr(m, key));
  return pass(BROWSERS.every((b) => ok.has(b)));
}

export const THRESHOLDS: ThresholdDef[] = [
  // 9.1 Telegram storage
  { id: 'T-TG-01', name: 'Upload throughput (10 × 12 MB)', runner: 'SERVER', thresholdText: 'median ≥ 1.0 MB/s',
    evaluate: (m) => pass((num(m, 'medianMBps') ?? -1) >= 1.0) },
  { id: 'T-TG-02', name: 'Sequential download throughput', runner: 'SERVER', thresholdText: 'median ≥ 2.0 MB/s',
    evaluate: (m) => pass((num(m, 'medianMBps') ?? -1) >= 2.0) },
  { id: 'T-TG-03', name: 'Random 1 MB range reads (50)', runner: 'SERVER', thresholdText: 'p50 ≤ 800 ms, p95 ≤ 1500 ms',
    evaluate: (m) => pass((num(m, 'p50Ms') ?? Infinity) <= 800, (num(m, 'p95Ms') ?? Infinity) <= 1500) },
  { id: 'T-TG-04', name: '10 concurrent readers, 60 s', runner: 'SERVER', thresholdText: 'aggregate ≥ 2.5 MB/s and p95 ≤ 2000 ms',
    evaluate: (m) => pass((num(m, 'aggregateMBps') ?? -1) >= 2.5, (num(m, 'p95Ms') ?? Infinity) <= 2000) },
  { id: 'T-TG-05', name: 'Burst 30 uploads', runner: 'SERVER', thresholdText: 'no single FLOOD_WAIT > 10 s; total ≤ 30 s',
    evaluate: (m) => pass((num(m, 'maxWaitS') ?? Infinity) <= 10, (num(m, 'totalWaitS') ?? Infinity) <= 30) },
  { id: 'T-TG-06', name: 'File-ref refresh cost', runner: 'SERVER', thresholdText: 'p95 ≤ 300 ms',
    evaluate: (m) => pass((num(m, 'p95Ms') ?? Infinity) <= 300) },
  { id: 'T-TG-07', name: 'Stale ref after 24 h', runner: 'SERVER', thresholdText: 'INFO; recovery must succeed', evaluate: INFO },

  // 9.2 Onboarding & connection
  { id: 'T-ONB-01', name: 'Login widget, 4 browsers', runner: 'MANUAL', thresholdText: 'login succeeds in all 4 browsers',
    evaluate: (m) => allBrowsers(m) },
  { id: 'T-ONB-02', name: 'Deep link adds bot with rights', runner: 'MANUAL', thresholdText: 'bot is admin with post/edit/delete',
    evaluate: (m) => pass(bool(m, 'canPost'), bool(m, 'canDelete'), bool(m, 'confirmationPosted')) },
  { id: 'T-ONB-03', name: 'Event source delivers actor ≤ 10 s', runner: 'SERVER', thresholdText: '≥ 1 source delivers actor within 10 s',
    evaluate: (m) => pass((num(m, 'bestActorLatencyS') ?? Infinity) <= 10) },
  { id: 'T-ONB-04', name: 'Channel access without user session', runner: 'SERVER', thresholdText: 'resolved',
    evaluate: (m) => pass(bool(m, 'resolved')) },
  { id: 'T-ONB-05', name: 'Remove → detect; re-add → plays', runner: 'MANUAL', thresholdText: 'detection ≤ 60 s; old link plays',
    evaluate: (m) => pass((num(m, 'detectionS') ?? Infinity) <= 60, bool(m, 'fetchOk')) },

  // 9.3 Recording
  { id: 'T-REC-01', name: 'Capability probe', runner: 'BROWSER', thresholdText: 'INFO per browser', evaluate: INFO },
  { id: 'T-REC-02', name: 'Supported H.264 + audio config', runner: 'BROWSER', thresholdText: 'recordable',
    evaluate: (m) => pass(bool(m, 'recordable')) },
  { id: 'T-REC-03', name: '5-min E2E', runner: 'BROWSER', thresholdText: 'plays to end; seg 3.5–4.5 s',
    evaluate: (m) => pass(bool(m, 'playsToEnd'), (num(m, 'minNonFinalSegS') ?? 0) >= 3.5, (num(m, 'maxNonFinalSegS') ?? Infinity) <= 4.5) },
  { id: 'T-REC-04', name: '60-min recording', runner: 'BROWSER', thresholdText: 'no crash; ±2 % duration; queue < 60',
    evaluate: (m) => pass(bool(m, 'completed'), Math.abs(num(m, 'durationErrorPct') ?? Infinity) <= 2, (num(m, 'maxEncoderQueue') ?? Infinity) < 60) },
  { id: 'T-REC-05', name: 'Background tab 5 min', runner: 'BROWSER', thresholdText: '±2 %; no frozen frame > 2 s',
    evaluate: (m) => pass(Math.abs(num(m, 'durationErrorPct') ?? Infinity) <= 2, (num(m, 'maxFrozenMs') ?? Infinity) <= 2000) },
  { id: 'T-REC-06', name: 'Upload keep-up 30 min @1.5 Mbps', runner: 'BROWSER', thresholdText: 'max lag ≤ 8 s; final ack ≤ 10 s',
    evaluate: (m) => pass((num(m, 'maxLagS') ?? Infinity) <= 8, (num(m, 'finalAckS') ?? Infinity) <= 10) },
  { id: 'T-REC-07', name: 'Crash recovery (reload)', runner: 'BROWSER', thresholdText: 'all pre-reload segments; playable',
    evaluate: (m) => pass(bool(m, 'allSegmentsUploaded'), bool(m, 'playable')) },
  { id: 'T-REC-08', name: 'Webcam composite experiment', runner: 'BROWSER', thresholdText: 'INFO (Chrome/Edge)', evaluate: INFO },

  // 9.4 Playback
  { id: 'T-PLY-01', name: 'TTFF cached (p50)', runner: 'BROWSER', thresholdText: 'p50 < 2000 ms',
    evaluate: (m) => pass((num(m, 'p50Ms') ?? Infinity) < 2000) },
  { id: 'T-PLY-02', name: 'TTFF uncached (p50)', runner: 'BROWSER', thresholdText: 'p50 < 2000 ms (FAIL informative)',
    evaluate: (m) => pass((num(m, 'p50Ms') ?? Infinity) < 2000) },
  { id: 'T-PLY-03', name: 'Seek uncached (p50)', runner: 'BROWSER', thresholdText: 'p50 < 1500 ms',
    evaluate: (m) => pass((num(m, 'p50Ms') ?? Infinity) < 1500) },
  { id: 'T-PLY-04', name: 'Plays + seeks (engine used)', runner: 'BROWSER', thresholdText: 'plays + seeks in all 4 browsers',
    evaluate: (m) => allBrowsers(m) },
  { id: 'T-PLY-05', name: '10 simulated viewers, 10-min video', runner: 'CLI', thresholdText: '0 stalls; ≥ 99 % on time',
    evaluate: (m) => pass((num(m, 'stalls') ?? Infinity) === 0, (num(m, 'onTimePct') ?? -1) >= 99) },
  { id: 'T-PLY-06', name: 'Seek near end of 2-h video (p50)', runner: 'BROWSER', thresholdText: 'p50 < 1500 ms',
    evaluate: (m) => pass((num(m, 'p50Ms') ?? Infinity) < 1500) },

  // 9.5 Infrastructure, security, other
  { id: 'T-INF-01', name: 'Oracle A1 obtained', runner: 'MANUAL', thresholdText: 'INFO', evaluate: INFO },
  { id: 'T-INF-02', name: 'Oracle idle-reclaim notices', runner: 'MANUAL', thresholdText: 'INFO', evaluate: INFO },
  { id: 'T-INF-03', name: 'Laptop vs VM Telegram throughput', runner: 'CLI', thresholdText: 'INFO', evaluate: INFO },
  { id: 'T-INF-04', name: 'Neon query latency', runner: 'SERVER', thresholdText: 'warm p95 ≤ 100 ms; cold INFO',
    evaluate: (m) => pass((num(m, 'warmP95Ms') ?? Infinity) <= 100) },
  { id: 'T-INF-05', name: 'R2 redirect + CORS (4 browsers)', runner: 'BROWSER', thresholdText: 'works in all 4 browsers',
    evaluate: (m) => allBrowsers(m) },
  { id: 'T-INF-06', name: 'R2 usage vs free tier', runner: 'SERVER', thresholdText: 'INFO (must be below limits)',
    evaluate: (m) => (bool(m, 'belowLimits') === false ? 'FAIL' : 'INFO') },
  { id: 'T-INF-07', name: 'Bytes per viewer-hour', runner: 'SERVER', thresholdText: 'INFO', evaluate: INFO },
  { id: 'T-INF-08', name: 'Spool cleanup', runner: 'SERVER', thresholdText: 'no spool left for READY videos',
    evaluate: (m) => pass((num(m, 'spoolLeftForReady') ?? Infinity) === 0) },
  { id: 'T-SEC-01', name: 'Access-control matrix', runner: 'AUTOTEST', thresholdText: '100 % of cases pass',
    evaluate: (m) => pass((num(m, 'total') ?? 0) > 0, num(m, 'passed') === num(m, 'total')) },
  { id: 'T-SEC-02', name: 'Signed URL expiry/tamper', runner: 'AUTOTEST', thresholdText: '100 % rejected',
    evaluate: (m) => pass((num(m, 'total') ?? 0) > 0, num(m, 'rejected') === num(m, 'total')) },
  { id: 'T-FAIR-01', name: 'Fair-use limits return 429', runner: 'AUTOTEST', thresholdText: '100 % of cases pass',
    evaluate: (m) => pass((num(m, 'total') ?? 0) > 0, num(m, 'passed') === num(m, 'total')) },
  { id: 'T-TRN-01', name: 'whisper.cpp base, 10-min audio', runner: 'SERVER', thresholdText: 'INFO; viable if RTF ≤ 1.0', evaluate: INFO },
];

export const THRESHOLD_MAP: ReadonlyMap<string, ThresholdDef> = new Map(THRESHOLDS.map((t) => [t.id, t]));

export const ALL_TEST_IDS: string[] = THRESHOLDS.map((t) => t.id);

export function evaluate(id: string, metrics: Metrics): ThresholdStatus {
  const def = THRESHOLD_MAP.get(id);
  if (!def) throw new Error(`unknown test id ${id}`);
  return def.evaluate(metrics);
}
