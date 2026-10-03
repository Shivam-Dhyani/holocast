/**
 * OPFS persistence for the upload queue (FR-REC-06/07, TDD §10.6). Each segment is
 * written to OPFS before upload and removed only after the server acknowledges it,
 * so a tab reload/crash can resume. A per-video manifest tracks progress.
 */

export interface RecorderManifest {
  videoId: string;
  uploadToken: string;
  shareUrl: string;
  bitrateBps: number;
  /** next segment sequence number to assign (1-based). */
  nextSeq: number;
  /** acknowledged segment seqs. */
  acked: number[];
  /** whether finalize has been requested by the recorder. */
  finalRequested: boolean;
  /** total recorded duration in microseconds. */
  durationUs: number;
}

const ROOT_DIR = 'holocast';

async function root(): Promise<FileSystemDirectoryHandle> {
  const base = await navigator.storage.getDirectory();
  return base.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function videoDir(videoId: string, create = false): Promise<FileSystemDirectoryHandle> {
  return (await root()).getDirectoryHandle(videoId, { create });
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array | string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data as FileSystemWriteChunkType);
  await w.close();
}

export async function initVideoStorage(manifest: RecorderManifest): Promise<void> {
  const dir = await videoDir(manifest.videoId, true);
  await writeFile(dir, 'manifest.json', JSON.stringify(manifest));
}

export async function writeInit(videoId: string, bytes: Uint8Array): Promise<void> {
  await writeFile(await videoDir(videoId, true), 'init.mp4', bytes);
}

export async function writeSegment(videoId: string, seq: number, bytes: Uint8Array): Promise<void> {
  await writeFile(await videoDir(videoId, true), `${seq}.m4s`, bytes);
}

export async function readSegment(videoId: string, seq: number): Promise<Uint8Array | null> {
  try {
    const dir = await videoDir(videoId);
    const handle = await dir.getFileHandle(`${seq}.m4s`);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

export async function readInit(videoId: string): Promise<Uint8Array | null> {
  try {
    const dir = await videoDir(videoId);
    const file = await (await dir.getFileHandle('init.mp4')).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

export async function deleteSegment(videoId: string, seq: number): Promise<void> {
  try {
    (await videoDir(videoId)).removeEntry(`${seq}.m4s`);
  } catch {
    /* already gone */
  }
}

export async function writeManifest(manifest: RecorderManifest): Promise<void> {
  await writeFile(await videoDir(manifest.videoId, true), 'manifest.json', JSON.stringify(manifest));
}

export async function readManifest(videoId: string): Promise<RecorderManifest | null> {
  try {
    const dir = await videoDir(videoId);
    const file = await (await dir.getFileHandle('manifest.json')).getFile();
    return JSON.parse(await file.text()) as RecorderManifest;
  } catch {
    return null;
  }
}

export async function deleteVideoStorage(videoId: string): Promise<void> {
  try {
    (await root()).removeEntry(videoId, { recursive: true });
  } catch {
    /* already gone */
  }
}

/** List all manifests in OPFS (crash recovery, §10.7). */
export async function listManifests(): Promise<RecorderManifest[]> {
  const out: RecorderManifest[] = [];
  try {
    const base = await root();
    for await (const [name, handle] of (base as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }).entries()) {
      if (handle.kind !== 'directory') continue;
      const m = await readManifest(name);
      if (m) out.push(m);
    }
  } catch {
    /* OPFS unavailable */
  }
  return out;
}
