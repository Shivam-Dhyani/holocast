/**
 * Crash-safe upload queue (FR-REC-06/09, TDD §10.6). One in-flight request per
 * video, strictly in seq order, with exponential backoff and infinite retry while
 * the page is open. Segments are removed from OPFS only after the server acks.
 */

import { deleteSegment, writeManifest, type RecorderManifest } from './opfs-queue.js';

/** Backoff schedule 1→2→4→8→16→30s (capped). Pure; unit-tested. */
export function backoffMs(attempt: number): number {
  const schedule = [1000, 2000, 4000, 8000, 16000, 30000];
  return schedule[Math.min(attempt, schedule.length - 1)]!;
}

/** Upload lag in seconds: recorded duration not yet acknowledged (FR-REC-09). */
export function lagSeconds(recordedDurationUs: number, ackedDurationUs: number): number {
  return Math.max(0, (recordedDurationUs - ackedDurationUs) / 1_000_000);
}

interface Task {
  run: () => Promise<void>;
}

export interface Uploader {
  enqueueInit: (bytes: Uint8Array, codecs: { video: string; audio: string; width: number; height: number }) => void;
  enqueueSegment: (job: { seq: number; bytes: Uint8Array; durationUs: number; sha256: string }) => void;
  ackedDurationUs: () => number;
  /** resolves when the queue is empty. */
  drain: () => Promise<void>;
  stop: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createUploader(
  manifest: RecorderManifest,
  opts: { apiBase?: string; onProgress?: () => void; sleepImpl?: (ms: number) => Promise<void> } = {},
): Uploader {
  const apiBase = opts.apiBase ?? '';
  const sleepImpl = opts.sleepImpl ?? sleep;
  const queue: Task[] = [];
  let acked = 0;
  let running = false;
  let stopped = false;
  let idleResolvers: Array<() => void> = [];

  function headers(extra: Record<string, string>): HeadersInit {
    return { 'content-type': 'application/octet-stream', 'x-upload-token': manifest.uploadToken, ...extra };
  }

  async function withRetry(fn: () => Promise<Response>): Promise<void> {
    let attempt = 0;
    for (;;) {
      if (stopped) return;
      try {
        const res = await fn();
        if (res.ok) return;
        // 4xx that are permanent (409 conflict/410 gone) should not loop forever.
        if (res.status === 409 || res.status === 410) return;
      } catch {
        /* network error → retry */
      }
      await sleepImpl(backoffMs(attempt++));
    }
  }

  function pump(): void {
    if (running) return;
    running = true;
    void (async () => {
      while (queue.length > 0 && !stopped) {
        const task = queue.shift()!;
        await task.run();
      }
      running = false;
      if (queue.length === 0) {
        const r = idleResolvers;
        idleResolvers = [];
        for (const res of r) res();
      }
    })();
  }

  return {
    enqueueInit(bytes, codecs) {
      queue.push({
        run: () =>
          withRetry(() =>
            fetch(`${apiBase}/api/videos/${manifest.videoId}/init`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: headers({
                'x-video-codec': codecs.video,
                'x-audio-codec': codecs.audio,
                'x-width': String(codecs.width),
                'x-height': String(codecs.height),
              }),
              body: bytes as BodyInit,
            }),
          ),
      });
      pump();
    },

    enqueueSegment(job) {
      queue.push({
        run: async () => {
          await withRetry(() =>
            fetch(`${apiBase}/api/videos/${manifest.videoId}/segments/${job.seq}`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: headers({
                'x-segment-duration-us': String(job.durationUs),
                'x-segment-sha256': job.sha256,
              }),
              body: job.bytes as BodyInit,
            }),
          );
          if (stopped) return;
          acked += job.durationUs;
          manifest.acked.push(job.seq);
          await deleteSegment(manifest.videoId, job.seq).catch(() => {});
          await writeManifest(manifest).catch(() => {});
          opts.onProgress?.();
        },
      });
      pump();
    },

    ackedDurationUs: () => acked,

    drain() {
      if (queue.length === 0 && !running) return Promise.resolve();
      return new Promise<void>((resolve) => idleResolvers.push(resolve));
    },

    stop() {
      stopped = true;
    },
  };
}
