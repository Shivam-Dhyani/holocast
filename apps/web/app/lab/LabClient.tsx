'use client';

import { useCallback, useEffect, useState } from 'react';

import { getLabTests, runLabTest, type LabTest } from '../../lib/api';

const STATUS_COLOR: Record<LabTest['latestStatus'], string> = {
  PASS: '#2ecc71',
  FAIL: '#ff6b6b',
  BLOCKED: '#e0a92e',
  INFO: '#8ab4ff',
  RUNNING: '#b084f7',
  NOT_RUN: '#5c6676',
};

function StatusChip({ status }: { status: LabTest['latestStatus'] }) {
  return (
    <span
      style={{
        background: STATUS_COLOR[status],
        color: '#0b0d12',
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  );
}

export function LabClient() {
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

  const onRun = async (id: string) => {
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

  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1c2230', verticalAlign: 'top' };

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
          <th style={cell}></th>
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
            <td style={cell}>
              {t.serverRunnable ? (
                <button
                  onClick={() => onRun(t.id)}
                  disabled={busy === t.id || t.latestStatus === 'RUNNING'}
                  style={{
                    background: '#2f6bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    opacity: busy === t.id || t.latestStatus === 'RUNNING' ? 0.5 : 1,
                  }}
                >
                  {t.latestStatus === 'RUNNING' ? 'Running…' : 'Run'}
                </button>
              ) : (
                <span style={{ color: '#5c6676', fontSize: 12 }}>{t.runner.toLowerCase()}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
