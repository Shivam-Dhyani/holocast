/** Spool-disk helpers (TDD §11.1): segment files written temp-then-rename. */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';

function videoDir(videoId: string): string {
  return path.join(config.SPOOL_DIR, videoId);
}
function segPath(videoId: string, seq: number): string {
  return path.join(videoDir(videoId), `${seq}.m4s`);
}

export async function writeSpoolSegment(videoId: string, seq: number, bytes: Uint8Array): Promise<void> {
  await mkdir(videoDir(videoId), { recursive: true });
  const finalPath = segPath(videoId, seq);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, finalPath); // atomic replace
}

export async function readSpoolSegment(videoId: string, seq: number): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(segPath(videoId, seq)));
  } catch {
    return null;
  }
}

export async function deleteSpoolSegment(videoId: string, seq: number): Promise<void> {
  await rm(segPath(videoId, seq), { force: true });
}

export async function deleteVideoSpool(videoId: string): Promise<void> {
  await rm(videoDir(videoId), { recursive: true, force: true });
}

/** List spool subdirectories (T-INF-08). */
export async function listSpoolVideoDirs(): Promise<string[]> {
  try {
    const entries = await readdir(config.SPOOL_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function spoolSegmentCount(videoId: string): Promise<number> {
  try {
    const entries = await readdir(videoDir(videoId));
    return entries.filter((f) => f.endsWith('.m4s')).length;
  } catch {
    return 0;
  }
}
