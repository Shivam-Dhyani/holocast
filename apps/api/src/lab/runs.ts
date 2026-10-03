/** LabRun persistence helpers. */

import { Prisma, type LabRun } from '@prisma/client';

import { prisma } from '../db.js';

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

/** Latest LabRun per testId (across all browsers). */
export async function latestRunByTest(): Promise<Map<string, LabRun>> {
  const runs = await prisma.labRun.findMany({ orderBy: { startedAt: 'desc' } });
  const map = new Map<string, LabRun>();
  for (const r of runs) if (!map.has(r.testId)) map.set(r.testId, r);
  return map;
}
