/**
 * T-TRN-01 (SERVER, INFO): whisper.cpp transcription benchmark (TDD §9.5, §3.1 exception).
 * Picks a READY Lab video ≥ 10 min, reconstructs a playable MP4 from its init + segments,
 * extracts 16 kHz mono WAV with ffmpeg (the only place the VM touches media with ffmpeg),
 * runs whisper.cpp `base`, and reports wall time, audio duration, RTF, peak RSS and a
 * transcript preview. Viable if RTF ≤ 1.0. All temp files are removed afterwards.
 *
 * Gated on `WHISPER_BIN`/`WHISPER_MODEL` (and ffmpeg on PATH); when unset the runner
 * throws, which the Lab records as BLOCKED rather than FAIL.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ObjectRef } from '@shivam-dhyani/unified-storage';

import { config } from '../config.js';
import { prisma } from '../db.js';
import { readSpoolSegment } from '../ingest/spool.js';
import { getEncryptedTelegram } from '../storage.js';
import type { Metrics } from './server-tests.js';

const MIN_DURATION_US = 600_000_000n; // 10 minutes
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  peakRssBytes: number;
}

function exec(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let peakRssBytes = 0;
    const poll = setInterval(() => {
      try {
        const mem = process.memoryUsage().rss; // best-effort; child RSS isn't portable
        peakRssBytes = Math.max(peakRssBytes, mem);
      } catch {
        /* ignore */
      }
    }, 500);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearInterval(poll);
      reject(err);
    });
    child.on('close', (code) => {
      clearInterval(poll);
      resolve({ code: code ?? -1, stdout, stderr, peakRssBytes });
    });
  });
}

/** Read one segment's plaintext bytes (spool first, else ranged decrypt from Telegram). */
async function readSegmentBytes(videoId: string, seq: number): Promise<Uint8Array> {
  const seg = await prisma.segment.findUnique({ where: { videoId_seq: { videoId, seq } } });
  if (!seg) throw new Error(`segment ${seq} missing`);
  if (seg.location === 'SPOOL') {
    const bytes = await readSpoolSegment(videoId, seq);
    if (!bytes) throw new Error(`spool segment ${seq} missing`);
    return bytes;
  }
  if (seg.packNo == null || seg.offsetInPack == null) throw new Error(`segment ${seq} not packed`);
  const pack = await prisma.pack.findUnique({ where: { videoId_packNo: { videoId, packNo: seg.packNo } } });
  if (!pack?.storageRef) throw new Error(`pack ${seg.packNo} has no storage ref`);
  const bytes = await getEncryptedTelegram('api').get(pack.storageRef as unknown as ObjectRef, {
    offset: seg.offsetInPack,
    length: seg.sizeBytes,
  });
  if (!createHash('sha256').update(bytes).digest().equals(Buffer.from(seg.sha256))) {
    throw new Error(`segment ${seq} integrity check failed`);
  }
  return bytes;
}

/** Concatenate init + all segment bytes into a single fMP4 file the decoder accepts. */
async function reconstructMp4(videoId: string, outPath: string): Promise<void> {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video?.initSegment) throw new Error('video has no init segment');
  const segments = await prisma.segment.findMany({ where: { videoId }, orderBy: { seq: 'asc' } });
  const parts: Uint8Array[] = [Buffer.from(video.initSegment)];
  for (const seg of segments) parts.push(await readSegmentBytes(videoId, seg.seq));
  await writeFile(outPath, Buffer.concat(parts.map((p) => Buffer.from(p))));
}

export async function runTrn01(): Promise<Metrics> {
  if (!config.WHISPER_BIN || !config.WHISPER_MODEL) {
    throw new Error('WHISPER_BIN/WHISPER_MODEL not configured — install whisper.cpp on the VM (TDD §4)');
  }
  const video = await prisma.video.findFirst({
    where: { isLab: true, status: 'READY', durationUs: { gte: MIN_DURATION_US } },
    orderBy: { createdAt: 'desc' },
  });
  if (!video) throw new Error('no READY Lab video ≥ 10 min — record one with T-REC-03/benchmark first');

  const dir = await mkdtemp(path.join(tmpdir(), 'holocast-trn-'));
  const mp4 = path.join(dir, 'in.mp4');
  const wav = path.join(dir, 'audio.wav');
  try {
    await reconstructMp4(video.id, mp4);

    const ff = await exec(FFMPEG, ['-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wav]);
    if (ff.code !== 0) throw new Error(`ffmpeg failed (${ff.code}): ${ff.stderr.slice(-300)}`);

    const started = Date.now();
    const w = await exec(config.WHISPER_BIN, ['-m', config.WHISPER_MODEL, '-f', wav, '-nt']);
    const wallS = (Date.now() - started) / 1000;
    if (w.code !== 0) throw new Error(`whisper failed (${w.code}): ${w.stderr.slice(-300)}`);

    const audioS = Number(video.durationUs) / 1_000_000;
    const transcript = w.stdout.trim() || (await readFile(wav).then(() => '').catch(() => ''));
    const sizeBytes = (await stat(mp4)).size;

    return {
      wallS: Number(wallS.toFixed(2)),
      audioS: Number(audioS.toFixed(2)),
      rtf: Number((wallS / audioS).toFixed(3)),
      peakRssMb: Number((Math.max(ff.peakRssBytes, w.peakRssBytes) / (1024 * 1024)).toFixed(1)),
      transcriptHead: transcript.slice(0, 300),
      mp4SizeBytes: sizeBytes,
      model: path.basename(config.WHISPER_MODEL),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
