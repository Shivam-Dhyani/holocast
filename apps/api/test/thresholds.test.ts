import { describe, it, expect } from 'vitest';

import { ALL_TEST_IDS, evaluate, THRESHOLD_MAP } from '../src/lab/thresholds.js';

/**
 * Authoritative list of every test ID in PRD §9. CLAUDE.md rule 7 / FR-LAB-09:
 * thresholds.ts MUST contain exactly these.
 */
const PRD_9_TEST_IDS = [
  'T-TG-01', 'T-TG-02', 'T-TG-03', 'T-TG-04', 'T-TG-05', 'T-TG-06', 'T-TG-07',
  'T-ONB-01', 'T-ONB-02', 'T-ONB-03', 'T-ONB-04', 'T-ONB-05',
  'T-REC-01', 'T-REC-02', 'T-REC-03', 'T-REC-04', 'T-REC-05', 'T-REC-06', 'T-REC-07', 'T-REC-08',
  'T-PLY-01', 'T-PLY-02', 'T-PLY-03', 'T-PLY-04', 'T-PLY-05', 'T-PLY-06',
  'T-INF-01', 'T-INF-02', 'T-INF-03', 'T-INF-04', 'T-INF-05', 'T-INF-06', 'T-INF-07', 'T-INF-08',
  'T-SEC-01', 'T-SEC-02', 'T-FAIR-01', 'T-TRN-01',
];

describe('lab thresholds (PRD §9 single source of truth)', () => {
  it('contains exactly the PRD §9 test IDs', () => {
    expect([...ALL_TEST_IDS].sort()).toEqual([...PRD_9_TEST_IDS].sort());
  });

  it('every test has a name, runner and threshold text', () => {
    for (const id of PRD_9_TEST_IDS) {
      const def = THRESHOLD_MAP.get(id);
      expect(def, id).toBeDefined();
      expect(def!.name.length).toBeGreaterThan(0);
      expect(def!.thresholdText.length).toBeGreaterThan(0);
    }
  });

  it('evaluates threshold tests against sample metrics', () => {
    expect(evaluate('T-TG-01', { medianMBps: 1.4 })).toBe('PASS');
    expect(evaluate('T-TG-01', { medianMBps: 0.5 })).toBe('FAIL');
    expect(evaluate('T-TG-03', { p50Ms: 700, p95Ms: 1400 })).toBe('PASS');
    expect(evaluate('T-TG-03', { p50Ms: 900, p95Ms: 1400 })).toBe('FAIL');
    expect(evaluate('T-REC-03', { playsToEnd: true, minNonFinalSegS: 3.6, maxNonFinalSegS: 4.4 })).toBe('PASS');
    expect(evaluate('T-REC-03', { playsToEnd: true, minNonFinalSegS: 3.6, maxNonFinalSegS: 5.0 })).toBe('FAIL');
    expect(evaluate('T-PLY-01', { p50Ms: 1500 })).toBe('PASS');
    expect(evaluate('T-PLY-01', { p50Ms: 2500 })).toBe('FAIL');
    expect(evaluate('T-ONB-01', { browsersOk: ['Chrome', 'Edge', 'Firefox', 'Safari'] })).toBe('PASS');
    expect(evaluate('T-ONB-01', { browsersOk: ['Chrome', 'Edge', 'Firefox'] })).toBe('FAIL');
    expect(evaluate('T-SEC-01', { passed: 24, total: 24 })).toBe('PASS');
    expect(evaluate('T-SEC-01', { passed: 23, total: 24 })).toBe('FAIL');
  });

  it('INFO tests report INFO', () => {
    for (const id of ['T-TG-07', 'T-REC-01', 'T-REC-08', 'T-INF-01', 'T-INF-02', 'T-INF-03', 'T-INF-07', 'T-TRN-01']) {
      expect(evaluate(id, {}), id).toBe('INFO');
    }
  });
});
