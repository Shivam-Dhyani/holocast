/**
 * Lab result submission from the browser (FR-LAB-03). Posts to `POST /api/lab/results`
 * with environment info. The endpoint accepts the submission only for an admin session,
 * so `submitLabResult` swallows 401/403 (returns `{ ok: false, forbidden: true }`) —
 * the recorder calls it unconditionally and it is a no-op for non-admins (FR-LAB-05).
 */

export type BrowserKey = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export interface LabEnvironment {
  browser: string;
  browserKey: BrowserKey;
  version: string;
  os: string;
  userAgent: string;
}

/** Detect browser/OS for result tagging (same precedence as the recorder probe). */
export function labEnvironment(): LabEnvironment {
  if (typeof navigator === 'undefined') {
    return { browser: 'Unknown', browserKey: 'other', version: '', os: 'Unknown', userAgent: '' };
  }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let key: BrowserKey = 'other';
  let version = '';
  if (/Edg\//.test(ua)) {
    [browser, key, version] = ['Edge', 'edge', /Edg\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  } else if (/Firefox\//.test(ua)) {
    [browser, key, version] = ['Firefox', 'firefox', /Firefox\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  } else if (/Chrome\//.test(ua)) {
    [browser, key, version] = ['Chrome', 'chrome', /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  } else if (/Version\/.*Safari/.test(ua)) {
    [browser, key, version] = ['Safari', 'safari', /Version\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  }
  const os =
    nav.userAgentData?.platform ??
    (/Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown');
  return { browser, browserKey: key, version, os, userAgent: ua };
}

export interface SubmitOutcome {
  ok: boolean;
  forbidden?: boolean;
  status?: 'PASS' | 'FAIL' | 'INFO';
  error?: string;
}

/** POST a Lab result; never throws. Non-admin sessions get `{ ok:false, forbidden:true }`. */
export async function submitLabResult(
  testId: string,
  metrics: Record<string, unknown>,
  notes?: string,
): Promise<SubmitOutcome> {
  try {
    const res = await fetch('/api/lab/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ testId, metrics, environment: labEnvironment(), ...(notes ? { notes } : {}) }),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, forbidden: true };
    if (!res.ok) return { ok: false, error: `submit failed (${res.status})` };
    const body = (await res.json().catch(() => ({}))) as { status?: SubmitOutcome['status'] };
    return { ok: true, status: body.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

/**
 * For per-browser tests (T-PLY-04, T-INF-05) whose threshold needs all four browsers,
 * read the most recent `browsersOk` for the test and return the union with this browser,
 * so the Nth browser's submission carries the full set and evaluates PASS.
 */
export async function mergeBrowsersOk(testId: string, add: BrowserKey): Promise<string[]> {
  const set = new Set<string>([add]);
  try {
    const res = await fetch(`/api/lab/runs?testId=${encodeURIComponent(testId)}`, { credentials: 'same-origin' });
    if (res.ok) {
      const body = (await res.json()) as { runs?: Array<{ metrics?: { browsersOk?: unknown } }> };
      for (const run of body.runs ?? []) {
        const prev = run.metrics?.browsersOk;
        if (Array.isArray(prev)) {
          for (const b of prev) set.add(String(b));
          break; // runs are newest-first; the latest already carries the accumulated union
        }
      }
    }
  } catch {
    /* best-effort accumulation */
  }
  return [...set];
}
