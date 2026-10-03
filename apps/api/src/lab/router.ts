/** Phase 1 Lab API (admin-only, TDD §13.1, FR-LAB-01..09). */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { LabResultSubmission, ManualAnswerRequest } from '@holocast/shared';

import { requireAdmin } from '../auth/middleware.js';
import { config, isAdmin } from '../config.js';
import { prisma } from '../db.js';
import { newId } from '../ids.js';
import { latestRunByTest, toJson } from './runs.js';
import { startServerTest, SERVER_RUNNABLE } from './runner.js';
import { evaluate, THRESHOLDS } from './thresholds.js';

export const labRouter: Router = Router();

// GET /api/lab/tests — catalog + latest status per test (FR-LAB-01).
labRouter.get('/tests', requireAdmin, async (_req: Request, res: Response) => {
  const latest = await latestRunByTest();
  const counts = await prisma.labRun.groupBy({ by: ['testId'], _count: { _all: true } });
  const countByTest = new Map(counts.map((c) => [c.testId, c._count._all]));

  const tests = THRESHOLDS.map((t) => {
    const run = latest.get(t.id);
    return {
      id: t.id,
      name: t.name,
      runner: t.runner,
      thresholdText: t.thresholdText,
      serverRunnable: SERVER_RUNNABLE.has(t.id),
      latestStatus: run?.status ?? 'NOT_RUN',
      latestMetrics: run?.metrics ?? null,
      notes: run?.notes ?? null,
      runCount: countByTest.get(t.id) ?? 0,
      lastRunAt: run?.startedAt?.toISOString() ?? null,
    };
  });
  res.json({ tests });
});

// POST /api/lab/run/:testId — start a SERVER test (FR-LAB-02).
labRouter.post('/run/:testId', requireAdmin, async (req: Request, res: Response) => {
  const testId = String(req.params.testId);
  if (!SERVER_RUNNABLE.has(testId)) {
    res.status(400).json({ code: 'NOT_SERVER_TEST', message: `${testId} is not a server-runnable test` });
    return;
  }
  const started = await startServerTest(testId, req.user!.id);
  res.status(202).json(started);
});

// Allow admin session OR a Lab CLI bearer token for result submissions.
function labResultsAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user && isAdmin(req.user.telegramUserId)) return next();
  const auth = req.get('authorization');
  if (config.LAB_CLI_TOKEN && auth === `Bearer ${config.LAB_CLI_TOKEN}`) return next();
  res.status(401).json({ code: 'UNAUTHORIZED', message: 'Lab access required' });
}

// POST /api/lab/results — browser/CLI submissions (FR-LAB-03/04, TDD §13.1).
labRouter.post('/results', labResultsAuth, async (req: Request, res: Response) => {
  const parsed = LabResultSubmission.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'invalid result submission' });
    return;
  }
  const { testId, metrics, environment, notes } = parsed.data;
  let status: 'PASS' | 'FAIL' | 'INFO';
  try {
    status = evaluate(testId, metrics);
  } catch {
    res.status(400).json({ code: 'UNKNOWN_TEST', message: `unknown test id ${testId}` });
    return;
  }
  const run = await prisma.labRun.create({
    data: {
      id: newId(),
      testId,
      status,
      metrics: toJson(metrics),
      environment: toJson(environment ?? {}),
      notes: notes ?? null,
      runBy: req.user?.id ?? null,
      finishedAt: new Date(),
    },
  });
  res.status(201).json({ runId: run.id, status });
});

// GET /api/lab/runs?testId= — run history (FR-LAB-01 "View raw").
labRouter.get('/runs', requireAdmin, async (req: Request, res: Response) => {
  const testId = typeof req.query.testId === 'string' ? req.query.testId : undefined;
  const runs = await prisma.labRun.findMany({
    where: testId ? { testId } : {},
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json({ runs });
});

// PUT /api/lab/manual/:questionId — manual questionnaire answers (FR-LAB-06).
labRouter.put('/manual/:questionId', requireAdmin, async (req: Request, res: Response) => {
  const parsed = ManualAnswerRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'value required' });
    return;
  }
  const questionId = String(req.params.questionId);
  await prisma.labManualAnswer.upsert({
    where: { questionId },
    create: { questionId, value: parsed.data.value },
    update: { value: parsed.data.value },
  });
  res.status(204).end();
});

// POST /api/lab/cleanup — remove synthetic Lab data (FR-LAB-08).
// Server tests delete their packs inline; this clears isLab videos (M7+) and run history.
labRouter.post('/cleanup', requireAdmin, async (_req: Request, res: Response) => {
  const labVideos = await prisma.video.count({ where: { isLab: true } });
  res.json({ note: 'server-test packs are deleted inline; isLab video cleanup lands with M7 video APIs', labVideos });
});
