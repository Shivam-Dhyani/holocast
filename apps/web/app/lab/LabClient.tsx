'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  cleanupLab,
  getLabTests,
  getManualAnswers,
  runLabTest,
  saveManualAnswer,
  type LabTest,
} from '../../lib/api';
import { runProbeAndSubmit } from '../../lib/lab/recording';
import { runAndSubmitSeek, runAndSubmitTtff, runCompatibility, runR2 } from '../../lib/lab/playback';
import { MANUAL_QUESTIONS } from './manualQuestions';

const STATUS_COLOR: Record<LabTest['latestStatus'], string> = {
  PASS: '#2ecc71',
  FAIL: '#ff6b6b',
  BLOCKED: '#e0a92e',
  INFO: '#8ab4ff',
  RUNNING: '#b084f7',
  NOT_RUN: '#5c6676',
};

type Tab = 'Overview' | 'Server' | 'Browser' | 'CLI' | 'Manual' | 'Report';
const TABS: Tab[] = ['Overview', 'Server', 'Browser', 'CLI', 'Manual', 'Report'];

const btn: React.CSSProperties = {
  background: '#2f6bff',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '6px 14px',
  cursor: 'pointer',
};
const input: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid #2a3140',
  background: '#11141b',
  color: '#e7e9ee',
};
const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1c2230', verticalAlign: 'top' };

function StatusChip({ status }: { status: LabTest['latestStatus'] }) {
  return (
    <span style={{ background: STATUS_COLOR[status], color: '#0b0d12', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
      {status}
    </span>
  );
}

export function LabClient() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [tests, setTests] = useState<LabTest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { tests } = await getLabTests();
      setTests(tests);
      setError(null);
      return tests;
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 401 || status === 403 ? 'Admins only — log in as an admin to use the Lab.' : (e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While any test is RUNNING, refresh every 4s.
  useEffect(() => {
    if (!tests?.some((t) => t.latestStatus === 'RUNNING')) return;
    const id = setTimeout(() => void load(), 4000);
    return () => clearTimeout(id);
  }, [tests, load]);

  const onRunServer = async (id: string) => {
    setBusy(id);
    try {
      await runLabTest(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p style={{ color: '#ff6b6b' }}>{error}</p>;
  if (!tests) return <p style={{ color: '#9aa3b2' }}>Loading…</p>;

  return (
    <div>
      <nav style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn,
              background: tab === t ? '#2f6bff' : '#1c2230',
              color: tab === t ? 'white' : '#9aa3b2',
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Overview' && <TestTable tests={tests} />}
      {tab === 'Server' && (
        <TestTable tests={tests.filter((t) => t.serverRunnable)} onRun={onRunServer} busy={busy} />
      )}
      {tab === 'Browser' && <BrowserTests onDone={() => void load()} />}
      {tab === 'CLI' && <CliTests />}
      {tab === 'Manual' && <ManualForm />}
      {tab === 'Report' && <ReportTab onCleanup={() => void load()} />}
    </div>
  );
}

function TestTable({
  tests,
  onRun,
  busy,
}: {
  tests: LabTest[];
  onRun?: (id: string) => void | Promise<void>;
  busy?: string | null;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#9aa3b2' }}>
          <th style={cell}>ID</th>
          <th style={cell}>Test</th>
          <th style={cell}>Runner</th>
          <th style={cell}>Threshold</th>
          <th style={cell}>Status</th>
          <th style={cell}>Runs</th>
          {onRun && <th style={cell}></th>}
        </tr>
      </thead>
      <tbody>
        {tests.map((t) => (
          <tr key={t.id}>
            <td style={{ ...cell, fontFamily: 'monospace' }}>{t.id}</td>
            <td style={cell}>{t.name}</td>
            <td style={{ ...cell, color: '#9aa3b2' }}>{t.runner}</td>
            <td style={{ ...cell, color: '#9aa3b2' }}>{t.thresholdText}</td>
            <td style={cell}>
              <StatusChip status={t.latestStatus} />
              {t.notes && <div style={{ color: '#e0a92e', fontSize: 12, marginTop: 4 }}>{t.notes}</div>}
            </td>
            <td style={{ ...cell, color: '#9aa3b2' }}>{t.runCount}</td>
            {onRun && (
              <td style={cell}>
                <button
                  onClick={() => void onRun(t.id)}
                  disabled={busy === t.id || t.latestStatus === 'RUNNING'}
                  style={{ ...btn, opacity: busy === t.id || t.latestStatus === 'RUNNING' ? 0.5 : 1 }}
                >
                  {t.latestStatus === 'RUNNING' ? 'Running…' : 'Run'}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BrowserTests({ onDone }: { onDone: () => void | Promise<void> }) {
  const [shareId, setShareId] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const append = (line: string) => setLog((l) => [line, ...l].slice(0, 20));

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setRunning(name);
    try {
      const r = await fn();
      append(`${name}: ${JSON.stringify(r)}`);
      await onDone();
    } catch (e) {
      append(`${name}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(null);
    }
  };

  const needsShare = (fn: (s: string) => Promise<unknown>) => () => {
    if (!shareId.trim()) throw new Error('enter a READY Lab video shareId first');
    return fn(shareId.trim());
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ color: '#9aa3b2', margin: 0 }}>
        Runs inside this browser and posts results with environment info. Repeat in Chrome, Edge, Firefox and Safari.
        Guided recordings (T-REC-03…07) start from{' '}
        <code style={{ background: '#11141b', padding: '2px 6px', borderRadius: 4 }}>/record?lab=T-REC-03</code>.
      </p>

      <div>
        <button style={btn} disabled={running !== null} onClick={() => void run('probe', runProbeAndSubmit)}>
          Run capability probe (T-REC-01/02)
        </button>
      </div>

      <label style={{ display: 'grid', gap: 4, maxWidth: 420 }}>
        <span style={{ color: '#9aa3b2' }}>READY Lab video shareId (for playback tests)</span>
        <input style={input} value={shareId} onChange={(e) => setShareId(e.target.value)} placeholder="e.g. a1B2c3…" />
      </label>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn} disabled={running !== null} onClick={() => void run('T-PLY-01 TTFF cached', needsShare((s) => runAndSubmitTtff(s, false)))}>
          TTFF cached (T-PLY-01)
        </button>
        <button style={btn} disabled={running !== null} onClick={() => void run('T-PLY-02 TTFF uncached', needsShare((s) => runAndSubmitTtff(s, true)))}>
          TTFF uncached (T-PLY-02)
        </button>
        <button style={btn} disabled={running !== null} onClick={() => void run('T-PLY-03 Seek', needsShare((s) => runAndSubmitSeek(s)))}>
          Seek (T-PLY-03)
        </button>
        <button style={btn} disabled={running !== null} onClick={() => void run('T-PLY-04 Compatibility', needsShare((s) => runCompatibility(s)))}>
          Compatibility (T-PLY-04)
        </button>
        <button style={btn} disabled={running !== null} onClick={() => void run('T-INF-05 R2+CORS', needsShare((s) => runR2(s)))}>
          R2 redirect + CORS (T-INF-05)
        </button>
      </div>

      {running && <p style={{ color: '#b084f7' }}>Running {running}…</p>}
      {log.length > 0 && (
        <pre style={{ background: '#11141b', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12, color: '#9aa3b2' }}>
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}

function CliTests() {
  const cmds = [
    { id: 'T-PLY-05 (cached)', cmd: 'pnpm --filter api lab:viewers --share <shareId> --count 10' },
    { id: 'T-PLY-05 (uncached)', cmd: 'pnpm --filter api lab:viewers --share <shareId> --count 10 --nocache' },
    { id: 'T-INF-03 (laptop vs VM)', cmd: 'LAB_TOKEN=… pnpm bench --suite tg --report https://<domain>/api/lab/results --test T-INF-03' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ color: '#9aa3b2', margin: 0 }}>
        Run from a terminal. Set <code>LAB_TOKEN</code> (the Lab CLI token) and <code>LAB_BASE_URL</code> to post results back here.
      </p>
      {cmds.map((c) => (
        <div key={c.id}>
          <div style={{ color: '#9aa3b2', fontSize: 13, marginBottom: 4 }}>{c.id}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <code style={{ ...input, flex: 1, fontFamily: 'monospace' }}>{c.cmd}</code>
            <button style={btn} onClick={() => void navigator.clipboard?.writeText(c.cmd)}>
              Copy
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ManualForm() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getManualAnswers()
      .then(({ answers }) => setAnswers(answers))
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const save = async (id: string) => {
    try {
      await saveManualAnswer(id, answers[id] ?? '');
      setSaved(id);
      setTimeout(() => setSaved((s) => (s === id ? null : s)), 1500);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {loadError && <p style={{ color: '#ff6b6b' }}>{loadError}</p>}
      {MANUAL_QUESTIONS.map((q) => (
        <div key={q.id} style={{ display: 'grid', gap: 6 }}>
          <label style={{ color: '#e7e9ee' }}>
            <span style={{ fontFamily: 'monospace', color: '#8ab4ff', marginRight: 8 }}>{q.id}</span>
            {q.text}
          </label>
          <textarea
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            rows={2}
            style={{ ...input, resize: 'vertical' }}
          />
          <div>
            <button style={btn} onClick={() => void save(q.id)}>
              {saved === q.id ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportTab({ onCleanup }: { onCleanup: () => void | Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanup = async () => {
    if (!window.confirm('Remove synthetic Lab data (isLab videos + run history)? This cannot be undone.')) return;
    setBusy(true);
    try {
      const r = await cleanupLab();
      setMsg(`${r.note} (isLab videos: ${r.labVideos})`);
      await onCleanup();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
      <p style={{ color: '#9aa3b2', margin: 0 }}>
        Export the Phase 1 results, then send <code>PHASE1_RESULTS.md</code> (and the JSON) to generate the Phase 2 documents.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <a href="/api/lab/report.md" style={{ ...btn, textDecoration: 'none' }}>
          Download PHASE1_RESULTS.md
        </a>
        <a href="/api/lab/report.json" style={{ ...btn, textDecoration: 'none', background: '#1c2230', color: '#e7e9ee' }}>
          Download phase1-results.json
        </a>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid #1c2230', width: '100%' }} />
      <div>
        <button style={{ ...btn, background: '#ff6b6b' }} disabled={busy} onClick={() => void cleanup()}>
          {busy ? 'Cleaning…' : 'Clean up Lab data'}
        </button>
      </div>
      {msg && <p style={{ color: '#9aa3b2' }}>{msg}</p>}
    </div>
  );
}
