import { describe, it, expect } from 'vitest';

import { buildReportJson, buildReportMarkdown, summarize, type RunLike } from '../src/lab/report.js';
import { ALL_TEST_IDS } from '../src/lab/thresholds.js';

function run(testId: string, status: string, over: Partial<RunLike> = {}): RunLike {
  return { testId, status, metrics: {}, environment: {}, notes: null, startedAt: new Date(), ...over };
}

describe('lab report', () => {
  it('summarize counts all PRD §9 tests, NOT_RUN by default', () => {
    const s = summarize([run('T-TG-01', 'PASS'), run('T-TG-02', 'FAIL')]);
    expect(s.PASS).toBe(1);
    expect(s.FAIL).toBe(1);
    expect(s.PASS + s.FAIL + s.BLOCKED + s.INFO + s.NOT_RUN + s.RUNNING).toBe(ALL_TEST_IDS.length);
    expect(s.NOT_RUN).toBe(ALL_TEST_IDS.length - 2);
  });

  it('uses the latest run per test', () => {
    const older = run('T-TG-01', 'FAIL', { startedAt: new Date(1000) });
    const newer = run('T-TG-01', 'PASS', { startedAt: new Date(2000) });
    expect(summarize([older, newer]).PASS).toBe(1);
    expect(summarize([older, newer]).FAIL).toBe(0);
  });

  it('builds a JSON report with every test and surfaces failures with §14 options', () => {
    const json = buildReportJson([run('T-TG-01', 'FAIL')], [{ questionId: 'MQ-01', value: 'Mumbai' }], { Domain: 'x' });
    expect(json.tests).toHaveLength(ALL_TEST_IDS.length);
    expect(json.manual['MQ-01']).toBe('Mumbai');
    expect(json.failures.find((f) => f.testId === 'T-TG-01')).toBeTruthy();
    expect(json.unknowns.find((u) => u.id === 'U-01')?.outcome).toBe('UNRESOLVED');
  });

  it('renders markdown with the template sections', () => {
    const md = buildReportMarkdown(buildReportJson([run('T-REC-03', 'PASS')], [], {}));
    expect(md).toContain('## 2. Summary');
    expect(md).toContain('### 3.3 Recording');
    expect(md).toContain('## 5. Unknowns register');
    expect(md).toContain('T-REC-03');
  });
});
