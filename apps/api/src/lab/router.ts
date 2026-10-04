/** Phase 1 Lab API (admin-only, TDD §13.1, FR-LAB-01..09). */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { LabResultSubmission, ManualAnswerRequest } from '@holocast/shared';

import { requireAdmin } from '../auth/middleware.js';
import { config, isAdmin } from '../config.js';
import { prisma } from '../db.js';
import { newId } from '../ids.js';
import { logger } from '../logger.js';
import { getQueue, QUEUE, type DeleteVideoJob } from '../queues.js';
import { latestRunByTest, toJson } from './runs.js';
import { buildReportJson, buildReportMarkdown } from './report.js';
import { startServerTest, SERVER_RUNNABLE } from './runner.js';
import { evaluate, THRESHOLDS } from './thresholds.js';

async function gatherReport() {
  const [runs, manual] = await Promise.all([
    prisma.labRun.findMany({ orderBy: { startedAt: 'desc' } }),
    prisma.labManualAnswer.findMany(),
  ]);
  const header = {
    'App version (git commit)': process.env.GIT_COMMIT ?? 'dev',
    'unified-storage version': '0.1.0-alpha.0',
    Domain: config.HOLOCAST_DOMAIN,
  };
  return buildReportJson(runs, manual, header);
}

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

// GET /api/lab/manual — saved manual answers for prefilling the form (FR-LAB-06).
labRouter.get('/manual', requireAdmin, async (_req: Request, res: Response) => {
  const rows = await prisma.labManualAnswer.findMany();
  const answers: Record<string, string> = {};
  for (const r of rows) answers[r.questionId] = r.value;
  res.json({ answers });
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

// GET /api/lab/report.json and report.md — Phase 1 export (FR-LAB-07).
labRouter.get('/report.json', requireAdmin, async (_req: Request, res: Response) => {
  res.json(await gatherReport());
});
labRouter.get('/report.md', requireAdmin, async (_req: Request, res: Response) => {
  const md = buildReportMarkdown(await gatherReport());
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="PHASE1_RESULTS.md"');
  res.send(md);
});

// POST /api/lab/cleanup — remove synthetic Lab data (FR-LAB-08).
// Marks every isLab video DELETED and enqueues the delete-video job (removes packs from
// Telegram + R2 + spool, no cascade deletes), then clears the Lab run history. Server
// tests already delete their own synthetic packs inline.
labRouter.post('/cleanup', requireAdmin, async (_req: Request, res: Response) => {
  const videos = await prisma.video.findMany({ where: { isLab: true, status: { not: 'DELETED' } }, select: { id: true } });
  for (const v of videos) {
    await prisma.video.update({ where: { id: v.id }, data: { status: 'DELETED', deletedAt: new Date() } });
    try {
      await getQueue(QUEUE.deleteVideo).add('delete-video', { videoId: v.id } satisfies DeleteVideoJob);
    } catch (err) {
      logger.warn({ err, videoId: v.id }, 'lab cleanup: could not enqueue delete-video (Redis down?)');
    }
  }
  const runs = await prisma.labRun.deleteMany({});
  res.json({ note: 'Lab videos marked DELETED and queued for storage removal; run history cleared.', labVideos: videos.length, runsCleared: runs.count });
});
