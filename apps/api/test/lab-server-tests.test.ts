import { describe, it, expect } from 'vitest';
import type { ObjectRef, PutInput, RangeRequest, StorageAdapter } from '@shivam-dhyani/unified-storage';

import { runTgDownload, runTgRandomRanges, runTgUpload, type TgDeps } from '../src/lab/server-tests.js';

/** Minimal in-memory StorageAdapter for exercising the throughput logic. */
function memoryStore(): StorageAdapter & { count: () => number } {
  const store = new Map<string, Buffer>();
  let n = 0;
  return {
    kind: 'r2',
    async put(input: PutInput): Promise<ObjectRef> {
      const key = input.key ?? `obj-${++n}`;
      store.set(key, Buffer.from(input.data));
      return { adapter: 'r2', container: input.container, key, size: input.data.byteLength };
    },
    async get(ref: ObjectRef, range?: RangeRequest): Promise<Uint8Array> {
      const buf = store.get(ref.key)!;
      return range ? buf.subarray(range.offset, range.offset + range.length) : buf;
    },
    async delete(ref: ObjectRef): Promise<void> {
      store.delete(ref.key);
    },
    async stat(ref: ObjectRef) {
      const buf = store.get(ref.key);
      return buf ? { exists: true, size: buf.length } : { exists: false };
    },
    async close() {},
    count: () => store.size,
  };
}

function deps(store: StorageAdapter): TgDeps {
  return { store, channelId: 'c', floods: [], refreshMs: [] };
}

describe('lab server-test throughput runners', () => {
  it('T-TG-01 upload reports a median and cleans up', async () => {
    const store = memoryStore();
    const m = await runTgUpload(deps(store), { packs: 3, sizeMb: 0.5 });
    expect(typeof m.medianMBps).toBe('number');
    expect((m.perUploadMBps as number[]).length).toBe(3);
    expect(store.count()).toBe(0); // cleaned up
  });

  it('T-TG-02 download reports a median', async () => {
    const store = memoryStore();
    const m = await runTgDownload(deps(store), { packs: 3, sizeMb: 0.5 });
    expect(typeof m.medianMBps).toBe('number');
    expect(store.count()).toBe(0);
  });

  it('T-TG-03 random ranges reports p50/p95 and cleans up', async () => {
    const store = memoryStore();
    const m = await runTgRandomRanges(deps(store), { packs: 2, sizeMb: 2, reads: 5 });
    expect(typeof m.p50Ms).toBe('number');
    expect(typeof m.p95Ms).toBe('number');
    expect(store.count()).toBe(0);
  });
});
