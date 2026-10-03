import { z } from 'zod';

import { LabRunner, LabStatus } from './enums.js';

/** POST /api/lab/results — browser/CLI submissions (TDD §13.1). */
export const LabResultSubmission = z.object({
  testId: z.string(),
  metrics: z.record(z.string(), z.unknown()),
  environment: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
});
export type LabResultSubmission = z.infer<typeof LabResultSubmission>;

/** One row in GET /api/lab/tests. */
export const LabTestInfo = z.object({
  id: z.string(),
  name: z.string(),
  runner: LabRunner,
  thresholdText: z.string(),
  latestStatus: LabStatus,
  runCount: z.number().int(),
  lastRunAt: z.string().nullable(),
});
export type LabTestInfo = z.infer<typeof LabTestInfo>;

/** PUT /api/lab/manual/:questionId */
export const ManualAnswerRequest = z.object({
  value: z.string(),
});
export type ManualAnswerRequest = z.infer<typeof ManualAnswerRequest>;
