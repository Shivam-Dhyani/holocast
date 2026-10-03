/**
 * Phase 1 report generation (FR-LAB-07, TDD §13.5) — report.json and the Markdown
 * mirroring docs/PHASE1_RESULTS_TEMPLATE.md. Pure builders over LabRun rows +
 * manual answers so they are unit-testable.
 */

import { THRESHOLDS } from './thresholds.js';

export interface RunLike {
  testId: string;
  status: string;
  metrics: unknown;
  environment: unknown;
  notes: string | null;
  startedAt: Date | string;
}
export interface ManualAnswerLike {
  questionId: string;
  value: string;
}

const GROUPS: Array<{ title: string; match: (id: string) => boolean }> = [
  { title: '3.1 Telegram storage', match: (id) => id.startsWith('T-TG') },
  { title: '3.2 Onboarding & connection', match: (id) => id.startsWith('T-ONB') },
  { title: '3.3 Recording', match: (id) => id.startsWith('T-REC') },
  { title: '3.4 Playback', match: (id) => id.startsWith('T-PLY') },
  {
    title: '3.5 Infrastructure, security, other',
    match: (id) => id.startsWith('T-INF') || id.startsWith('T-SEC') || id.startsWith('T-FAIR') || id.startsWith('T-TRN'),
  },
];

/** TDD §14 failure → Phase 2 options (subset, keyed by test id). */
const FAILURE_OPTIONS: Record<string, string> = {
  'T-TG-01': 'Larger packs; global upload pacing; bot pool; lower default bitrate',
  'T-TG-05': 'Larger packs; global upload pacing; bot pool; lower default bitrate',
  'T-TG-02': 'Cache popular segments in R2; prefetch next 3; bot pool; shorter first segments',
  'T-TG-03': 'Cache popular segments in R2; prefetch next 3; bot pool; shorter first segments',
  'T-TG-04': 'Cache popular segments in R2; prefetch next 3; bot pool; shorter first segments',
  'T-PLY-02': 'Cache all public/unlisted segments in R2 while popular; prefetch; bot pool',
  'T-PLY-03': 'Cache all public/unlisted segments in R2 while popular; prefetch; bot pool',
  'T-PLY-05': 'Cache all public/unlisted segments in R2 while popular; prefetch; bot pool',
  'T-ONB-03': 'Use the working source only; else manual linking via a one-time code',
  'T-ONB-04': 'Take the access hash from MTProto updates; or require one message in the channel',
  'T-REC-03': 'MediaRecorder fallback with server-side remux (ffmpeg -c copy); or Chrome/Edge-only recording',
  'T-REC-04': 'Lower memory footprint; split encoder sessions; 720p for > 1h',
  'T-REC-05': 'Document Picture-in-Picture recorder window; Chrome extension',
  'T-REC-06': 'Adaptive bitrate from measured uplink; 720p default',
  'T-PLY-04': 'Demuxed audio rendition; force hls.js/ManagedMediaSource on Safari',
  'T-PLY-01': 'Inline init + first-segment preload; smaller first segment; R2 CDN domain',
  'T-INF-04': 'Self-hosted Postgres on the VM; or longer Redis caching',
  'T-INF-05': 'Proxy R2 through the API; fix CORS config',
};

/** Unknowns register (TDD §17): U-id → resolving test ids. */
const UNKNOWNS: Array<{ id: string; unknown: string; tests: string[] }> = [
  { id: 'U-01', unknown: 'Bot throughput / FLOOD_WAIT from VM', tests: ['T-TG-01', 'T-TG-02', 'T-TG-03', 'T-TG-04', 'T-TG-05', 'T-INF-03'] },
  { id: 'U-02', unknown: 'File-reference refresh cost and expiry', tests: ['T-TG-06', 'T-TG-07'] },
  { id: 'U-03', unknown: 'Bot event source with actor; coexistence', tests: ['T-ONB-03'] },
  { id: 'U-04', unknown: 'Channel access hash without user session', tests: ['T-ONB-04'] },
  { id: 'U-05', unknown: 'Frame acquisition API per browser', tests: ['T-REC-01'] },
  { id: 'U-06', unknown: 'Recording in background tab', tests: ['T-REC-05'] },
  { id: 'U-07', unknown: 'Mediabunny keyframe-aligned ~4s fragments', tests: ['T-REC-03'] },
  { id: 'U-08', unknown: 'AAC/Opus encode + playback everywhere', tests: ['T-REC-02', 'T-PLY-04'] },
  { id: 'U-09', unknown: 'Safari native HLS with muxed fMP4', tests: ['T-PLY-04'] },
  { id: 'U-10', unknown: '1–2 hour stability', tests: ['T-REC-04', 'T-PLY-06'] },
  { id: 'U-11', unknown: 'Oracle availability/limits/reclaim', tests: ['T-INF-01', 'T-INF-02'] },
  { id: 'U-12', unknown: 'Neon latency and cold start', tests: ['T-INF-04'] },
  { id: 'U-13', unknown: 'R2 redirect + CORS with players', tests: ['T-INF-05', 'T-PLY-04'] },
  { id: 'U-14', unknown: 'whisper.cpp speed on VM', tests: ['T-TRN-01'] },
  { id: 'U-15', unknown: 'Uplink sufficiency at 1.5 Mbps', tests: ['T-REC-06'] },
];

export type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO' | 'NOT_RUN' | 'RUNNING';

function browserOf(env: unknown): string | null {
  const b = (env as { browser?: { name?: string } } | undefined)?.browser;
  return b?.name ?? null;
}

/** Latest run per test id (runs may arrive unsorted). */
function latestPerTest(runs: RunLike[]): Map<string, RunLike> {
  const sorted = [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const map = new Map<string, RunLike>();
  for (const r of sorted) if (!map.has(r.testId)) map.set(r.testId, r);
  return map;
}

export function summarize(runs: RunLike[]): Record<Status, number> {
  const latest = latestPerTest(runs);
  const counts: Record<Status, number> = { PASS: 0, FAIL: 0, BLOCKED: 0, INFO: 0, NOT_RUN: 0, RUNNING: 0 };
  for (const t of THRESHOLDS) {
    const status = (latest.get(t.id)?.status as Status) ?? 'NOT_RUN';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export interface ReportJson {
  header: Record<string, string>;
  summary: Record<Status, number>;
  tests: Array<{ id: string; name: string; runner: string; threshold: string; status: Status; notes: string | null; browser: string | null; metrics: unknown }>;
  manual: Record<string, string>;
  unknowns: Array<{ id: string; unknown: string; outcome: string; tests: string[] }>;
  failures: Array<{ testId: string; options: string }>;
  generatedAt: string;
}

export function buildReportJson(runs: RunLike[], manual: ManualAnswerLike[], header: Record<string, string>): ReportJson {
  const latest = latestPerTest(runs);
  const tests = THRESHOLDS.map((t) => {
    const run = latest.get(t.id);
    return {
      id: t.id,
      name: t.name,
      runner: t.runner,
      threshold: t.thresholdText,
      status: (run?.status as Status) ?? ('NOT_RUN' as Status),
      notes: run?.notes ?? null,
      browser: run ? browserOf(run.environment) : null,
      metrics: run?.metrics ?? null,
    };
  });
  const manualMap: Record<string, string> = {};
  for (const m of manual) manualMap[m.questionId] = m.value;

  const unknowns = UNKNOWNS.map((u) => {
    const statuses = u.tests.map((id) => tests.find((t) => t.id === id)?.status ?? 'NOT_RUN');
    const anyFail = statuses.includes('FAIL');
    const allDone = statuses.every((s) => s !== 'NOT_RUN' && s !== 'RUNNING');
    const outcome = !allDone ? 'UNRESOLVED' : anyFail ? 'RESOLVED-NO' : 'RESOLVED-YES';
    return { ...u, outcome };
  });

  const failures = tests
    .filter((t) => t.status === 'FAIL' && FAILURE_OPTIONS[t.id])
    .map((t) => ({ testId: t.id, options: FAILURE_OPTIONS[t.id]! }));

  return {
    header,
    summary: summarize(runs),
    tests,
    manual: manualMap,
    unknowns,
    failures,
    generatedAt: new Date().toISOString(),
  };
}

export function buildReportMarkdown(json: ReportJson): string {
  const L: string[] = [];
  L.push('# Holocast — Phase 1 Results (PHASE1_RESULTS.md)', '');
  L.push('## 1. Header', '| Field | Value |', '|---|---|');
  for (const [k, v] of Object.entries(json.header)) L.push(`| ${k} | ${v} |`);
  L.push(`| Generated at (UTC) | ${json.generatedAt} |`, '');

  L.push('## 2. Summary', '| PASS | FAIL | BLOCKED | INFO | NOT_RUN |', '|---|---|---|---|---|');
  L.push(`| ${json.summary.PASS} | ${json.summary.FAIL} | ${json.summary.BLOCKED} | ${json.summary.INFO} | ${json.summary.NOT_RUN} |`, '');

  L.push('## 3. Results');
  for (const group of GROUPS) {
    const rows = json.tests.filter((t) => group.match(t.id));
    if (rows.length === 0) continue;
    L.push(`### ${group.title}`, '| ID | Test | Runner | Threshold | Status | Browser | Notes |', '|---|---|---|---|---|---|---|');
    for (const r of rows) {
      L.push(`| ${r.id} | ${r.name} | ${r.runner} | ${r.threshold} | ${r.status} | ${r.browser ?? ''} | ${r.notes ?? ''} |`);
    }
    L.push('');
  }

  L.push('## 4. Manual answers', '| ID | Answer |', '|---|---|');
  for (let i = 1; i <= 12; i++) {
    const id = `MQ-${String(i).padStart(2, '0')}`;
    L.push(`| ${id} | ${(json.manual[id] ?? '').replace(/\n/g, ' ')} |`);
  }
  L.push('');

  L.push('## 5. Unknowns register', '| ID | Unknown | Outcome | Evidence |', '|---|---|---|---|');
  for (const u of json.unknowns) L.push(`| ${u.id} | ${u.unknown} | ${u.outcome} | ${u.tests.join(', ')} |`);
  L.push('');

  L.push('## 6. Failures and triggered decision options', '| Test ID | Options from TDD §14 |', '|---|---|');
  for (const f of json.failures) L.push(`| ${f.testId} | ${f.options} |`);
  L.push('');

  L.push('## 7. Appendix — raw metrics', '```json', JSON.stringify(json.tests, null, 2), '```', '');
  return L.join('\n');
}
