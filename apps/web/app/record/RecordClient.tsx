'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createVideo, finalizeVideo, type LinkType } from '../../lib/api';
import { startCapture, type CaptureResult } from '../../lib/recorder/capture';
import { MAX_RECORDING_MS, WARN_AT_MS } from '../../lib/recorder/constants';
import { startEncoder, type EncoderHandle } from '../../lib/recorder/encode';
import {
  deleteVideoStorage,
  initVideoStorage,
  writeInit,
  writeManifest,
  writeSegment,
  type RecorderManifest,
} from '../../lib/recorder/opfs-queue';
import { probe, type ProbeResult } from '../../lib/recorder/probe';
import { recoverPendingUploads } from '../../lib/recorder/recovery';
import { createStatsCollector, type StatsCollector } from '../../lib/recorder/stats';
import { createUploader, lagSeconds, type Uploader } from '../../lib/recorder/uploader';
import { runE2EEvaluation, submitRecordingStats } from '../../lib/lab/recording';

/** Expected guided-recording length per Lab test (seconds) for duration-error %. */
const LAB_EXPECTED_S: Record<string, number> = {
  'T-REC-03': 300,
  'T-REC-04': 3600,
  'T-REC-05': 600,
  'T-REC-06': 1800,
  'T-REC-07': 240,
};

function shareIdFromUrl(shareUrl: string): string {
  const parts = shareUrl.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

type Phase = 'checking' | 'unsupported' | 'idle' | 'starting' | 'recording' | 'finalizing' | 'ready' | 'error';

interface Session {
  manifest: RecorderManifest;
  uploader: Uploader;
  capture: CaptureResult;
  encoder: EncoderHandle;
  stats: StatsCollector;
  audioCodec: 'aac' | 'opus';
}

const btn: React.CSSProperties = {
  background: '#2f6bff',
  color: 'white',
  border: 'none',
  borderRadius: 10,
  padding: '12px 20px',
  fontWeight: 600,
  cursor: 'pointer',
};

export function RecordClient() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<LinkType>('UNLISTED');
  const [password, setPassword] = useState('');
  const [tabAudio, setTabAudio] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lag, setLag] = useState(0);

  const session = useRef<Session | null>(null);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; start?: number }>({});
  // Guided Lab recordings carry ?lab=<T-REC-id>; stats are auto-submitted (admin-only).
  const labTestId = useRef<string | null>(null);

  useEffect(() => {
    labTestId.current = new URLSearchParams(window.location.search).get('lab');
    void recoverPendingUploads().catch(() => {});
    probe()
      .then((p) => {
        setProbeResult(p);
        setPhase(p.recordable ? 'idle' : 'unsupported');
      })
      .catch(() => setPhase('unsupported'));
  }, []);

  const stop = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    setPhase('finalizing');
    if (timers.current.tick) clearInterval(timers.current.tick);
    const stopAt = performance.now();
    try {
      await s.encoder.stop();
      s.capture.stop();
      s.manifest.finalRequested = true;
      await writeManifest(s.manifest);
      await s.uploader.drain();
      const stats = s.stats.finish({
        chosenVideoCodec: 'avc1.640028',
        chosenAudioCodec: s.audioCodec === 'aac' ? 'mp4a.40.2' : 'opus',
        hardwareAcceleration: null,
        bitrateBps: s.manifest.bitrateBps,
        stopToFinalAckMs: Math.round(performance.now() - stopAt),
      });
      await finalizeVideo(s.manifest.videoId, s.manifest.uploadToken, {
        expectedSegments: s.manifest.nextSeq - 1,
        durationUs: String(s.manifest.durationUs),
        stats: stats as unknown as Record<string, unknown>,
      });
      await deleteVideoStorage(s.manifest.videoId).catch(() => {});
      setPhase('ready');

      // FR-LAB-05: guided Lab recordings auto-submit §10.8 stats to the Lab (admin-only).
      const testId = labTestId.current;
      if (testId) {
        const segDurs = s.stats.segmentDurationsUs();
        const shareId = shareIdFromUrl(s.manifest.shareUrl);
        void (testId === 'T-REC-03'
          ? runE2EEvaluation(shareId, stats, segDurs)
          : submitRecordingStats(testId, stats, {
              segmentDurationsUs: segDurs,
              expectedDurationS: LAB_EXPECTED_S[testId],
              allSegmentsUploaded: true,
              playable: true,
            })
        ).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Finalize failed');
      setPhase('error');
    }
  }, []);

  const start = useCallback(async () => {
    if (!probeResult) return;
    if (visibility === 'PASSWORD' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError(null);
    setPhase('starting');
    try {
      const created = await createVideo({
        visibility,
        ...(title ? { title } : {}),
        ...(visibility === 'PASSWORD' ? { password } : {}),
      });
      setShareUrl(created.shareUrl); // instant link (FR-REC-08)

      const manifest: RecorderManifest = {
        videoId: created.videoId,
        uploadToken: created.uploadToken,
        shareUrl: created.shareUrl,
        bitrateBps: created.bitrateBps,
        nextSeq: 1,
        acked: [],
        finalRequested: false,
        durationUs: 0,
      };
      await initVideoStorage(manifest);

      const uploader = createUploader(manifest, { onProgress: () => refreshLag(manifest, uploader) });
      const stats = createStatsCollector(probeResult.browser);
      const capture = await startCapture({ tabAudio: tabAudio && probeResult.tabAudioCapture === 'supported' });
      const settings = capture.videoTrack.getSettings();
      const audioCodec: 'aac' | 'opus' =
        probeResult.aacEncode || probeResult.mediabunnyCanEncode.aac ? 'aac' : 'opus';

      const encoder = await startEncoder({
        videoTrack: capture.videoTrack,
        audioTrack: capture.audioTrack,
        audioCodec,
        bitrateBps: created.bitrateBps,
        sourceWidth: settings.width ?? 0,
        sourceHeight: settings.height ?? 0,
        callbacks: {
          onInit: async (bytes) => {
            await writeInit(manifest.videoId, bytes);
            uploader.enqueueInit(bytes, {
              video: 'avc1.640028',
              audio: audioCodec === 'aac' ? 'mp4a.40.2' : 'opus',
              width: settings.width ?? 0,
              height: settings.height ?? 0,
            });
          },
          onSegment: async (seg) => {
            await writeSegment(manifest.videoId, seg.seq, seg.bytes);
            manifest.nextSeq = seg.seq + 1;
            manifest.durationUs += seg.durationUs;
            await writeManifest(manifest);
            stats.onSegment(seg.durationUs);
            uploader.enqueueSegment(seg);
          },
        },
      });

      capture.onEnded(() => void stop());
      session.current = { manifest, uploader, capture, encoder, stats, audioCodec };

      timers.current.start = performance.now();
      timers.current.tick = setInterval(() => {
        const ms = performance.now() - (timers.current.start ?? 0);
        setElapsedMs(ms);
        stats.sampleMemory();
        if (ms >= MAX_RECORDING_MS) void stop();
      }, 1000);
      document.addEventListener('visibilitychange', onVisibility);
      setPhase('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recording');
      setPhase('error');
    }
  }, [probeResult, visibility, password, title, tabAudio, stop]);

  function onVisibility() {
    session.current?.stats.onVisibility(document.hidden ? 'hidden' : 'visible');
  }

  function refreshLag(manifest: RecorderManifest, uploader: Uploader) {
    const l = lagSeconds(manifest.durationUs, uploader.ackedDurationUs());
    session.current?.stats.sampleLag(l);
    setLag(l);
  }

  useEffect(() => () => {
    if (timers.current.tick) clearInterval(timers.current.tick);
    document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (phase === 'checking') return <p style={{ color: '#9aa3b2' }}>Checking browser capabilities…</p>;
  if (phase === 'unsupported') {
    return (
      <p style={{ color: '#e0a92e' }}>
        Recording isn&apos;t supported in this browser yet. Please use the latest Chrome or Edge.
        {probeResult?.reasons.length ? ` (${probeResult.reasons.join('; ')})` : ''}
      </p>
    );
  }

  const elapsed = new Date(elapsedMs).toISOString().substring(11, 19);

  return (
    <div>
      {(phase === 'idle' || phase === 'starting') && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recording"
              style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 8, border: '1px solid #2a3140', background: '#11141b', color: '#e7e9ee' }} />
          </label>
          <label>
            Link type
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as LinkType)}
              style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 8, border: '1px solid #2a3140', background: '#11141b', color: '#e7e9ee' }}>
              <option value="PUBLIC">Public</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="PASSWORD">Password-protected</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
          {visibility === 'PASSWORD' && (
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 6)"
              style={{ padding: 8, borderRadius: 8, border: '1px solid #2a3140', background: '#11141b', color: '#e7e9ee' }} />
          )}
          <label style={{ color: probeResult?.tabAudioCapture === 'supported' ? '#e7e9ee' : '#5c6676' }}>
            <input type="checkbox" checked={tabAudio} disabled={probeResult?.tabAudioCapture !== 'supported'}
              onChange={(e) => setTabAudio(e.target.checked)} /> Share tab audio
            {probeResult?.tabAudioCapture !== 'supported' && ' — not supported in this browser; your microphone will be recorded.'}
          </label>
          <button style={btn} onClick={() => void start()} disabled={phase === 'starting'}>
            {phase === 'starting' ? 'Starting…' : 'Start recording'}
          </button>
        </div>
      )}

      {shareUrl && (
        <p style={{ marginTop: 20 }}>
          Share link:{' '}
          <code style={{ background: '#11141b', padding: '4px 8px', borderRadius: 6 }}>{shareUrl}</code>{' '}
          <button onClick={() => void navigator.clipboard?.writeText(shareUrl)} style={{ ...btn, padding: '4px 10px' }}>
            Copy
          </button>
        </p>
      )}

      {phase === 'recording' && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 24, fontFamily: 'monospace' }}>● {elapsed}</p>
          <p style={{ color: lag < 1 ? '#2ecc71' : '#e0a92e' }}>
            {lag < 1 ? 'All caught up' : `Uploading… ${Math.round(lag)}s behind`}
          </p>
          {elapsedMs >= WARN_AT_MS && <p style={{ color: '#e0a92e' }}>Approaching the 2-hour limit — recording will stop automatically.</p>}
          <button style={{ ...btn, background: '#ff6b6b' }} onClick={() => void stop()}>Stop</button>
        </div>
      )}

      {phase === 'finalizing' && <p style={{ color: '#9aa3b2', marginTop: 20 }}>Finalizing…</p>}
      {phase === 'ready' && <p style={{ color: '#2ecc71', marginTop: 20 }}>Ready — your link plays the full video.</p>}
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
    </div>
  );
}
