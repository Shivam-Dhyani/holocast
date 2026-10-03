/**
 * Crash recovery (FR-REC-07, TDD §10.7). On app load, scan OPFS for manifests with
 * unacked segments or an unfinished finalize, resume uploads (no re-encoding), then
 * finalize with whatever segments exist.
 */

import { listManifests, readInit, readSegment, deleteVideoStorage, type RecorderManifest } from './opfs-queue';
import { createUploader } from './uploader';

export interface RecoveryResult {
  videoId: string;
  resumedSegments: number;
  finalized: boolean;
}

async function resumeOne(manifest: RecorderManifest, apiBase: string): Promise<RecoveryResult> {
  const uploader = createUploader(manifest, { apiBase });
  const ackedSet = new Set(manifest.acked);

  const init = await readInit(manifest.videoId);
  if (init) {
    uploader.enqueueInit(init, { video: '', audio: '', width: 0, height: 0 });
  }

  let resumed = 0;
  for (let seq = 1; seq < manifest.nextSeq; seq++) {
    if (ackedSet.has(seq)) continue;
    const bytes = await readSegment(manifest.videoId, seq);
    if (!bytes) continue;
    uploader.enqueueSegment({ seq, bytes, durationUs: 0, sha256: '' });
    resumed++;
  }

  await uploader.drain();

  let finalized = false;
  if (manifest.finalRequested) {
    await fetch(`${apiBase}/api/videos/${manifest.videoId}/finalize`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-upload-token': manifest.uploadToken },
      body: JSON.stringify({ expectedSegments: manifest.nextSeq - 1, durationUs: String(manifest.durationUs), recovered: true }),
    }).catch(() => {});
    finalized = true;
    await deleteVideoStorage(manifest.videoId).catch(() => {});
  }

  return { videoId: manifest.videoId, resumedSegments: resumed, finalized };
}

/** Resume all incomplete recordings found in OPFS. Safe to call on every app load. */
export async function recoverPendingUploads(apiBase = ''): Promise<RecoveryResult[]> {
  const manifests = await listManifests();
  const results: RecoveryResult[] = [];
  for (const m of manifests) {
    const incomplete = m.finalRequested || m.acked.length < m.nextSeq - 1;
    if (!incomplete) continue;
    try {
      results.push(await resumeOne(m, apiBase));
    } catch {
      /* leave on disk for the next attempt */
    }
  }
  return results;
}
