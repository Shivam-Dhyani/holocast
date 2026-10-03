/**
 * Capability probe (FR-REC-01, T-REC-01/02, TDD §10.2). Runs in the browser and
 * returns a JSON summary used to decide whether recording is possible and to feed
 * the Lab.
 */

import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

import { DEFAULT_BITRATE_BPS, FPS, H264_CODECS, TARGET_HEIGHT, TARGET_WIDTH } from './constants';

export interface H264ConfigResult {
  codec: string;
  supported: boolean;
  hardwareAcceleration: 'prefer-hardware' | 'no-preference';
}

export interface ProbeResult {
  browser: { name: string; version: string; os: string; uaData: unknown };
  getDisplayMedia: boolean;
  tabAudioCapture: 'supported' | 'unsupported' | 'unknown';
  mediaStreamTrackProcessor: { window: boolean; worker: boolean };
  videoEncoder: boolean;
  audioEncoder: boolean;
  h264Configs: H264ConfigResult[];
  aacEncode: boolean;
  opusEncode: boolean;
  opfs: boolean;
  opfsSyncAccessHandleInWorker: boolean;
  mse: boolean;
  managedMediaSource: boolean;
  nativeHls: boolean;
  mediabunnyCanEncode: { avc: boolean; aac: boolean; opus: boolean };
  recordable: boolean;
  reasons: string[];
}

function detectBrowser(): { name: string; version: string; os: string; uaData: unknown } {
  const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string } };
  const uaData = nav.userAgentData ?? null;
  const ua = navigator.userAgent;
  let name = 'Unknown';
  let version = '';
  if (/Edg\//.test(ua)) [name, version] = ['Edge', /Edg\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  else if (/Firefox\//.test(ua)) [name, version] = ['Firefox', /Firefox\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  else if (/Chrome\//.test(ua)) [name, version] = ['Chrome', /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  else if (/Version\/.*Safari/.test(ua)) [name, version] = ['Safari', /Version\/([\d.]+)/.exec(ua)?.[1] ?? ''];
  const os = nav.userAgentData?.platform ?? (/Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown');
  return { name, version, os, uaData };
}

async function probeH264(): Promise<H264ConfigResult[]> {
  const out: H264ConfigResult[] = [];
  if (typeof VideoEncoder === 'undefined') return out;
  for (const codec of H264_CODECS) {
    for (const hw of ['prefer-hardware', 'no-preference'] as const) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: TARGET_WIDTH,
          height: TARGET_HEIGHT,
          framerate: FPS,
          bitrate: DEFAULT_BITRATE_BPS,
          hardwareAcceleration: hw,
        });
        out.push({ codec, supported: Boolean(support.supported), hardwareAcceleration: hw });
      } catch {
        out.push({ codec, supported: false, hardwareAcceleration: hw });
      }
    }
  }
  return out;
}

async function probeAudio(codec: 'aac' | 'opus'): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  const codecString = codec === 'aac' ? 'mp4a.40.2' : 'opus';
  for (const channels of [2, 1]) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: codecString,
        sampleRate: 48000,
        numberOfChannels: channels,
        bitrate: 128_000,
      });
      if (support.supported) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function probe(): Promise<ProbeResult> {
  const getDisplayMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  const videoEncoder = typeof VideoEncoder !== 'undefined';
  const audioEncoder = typeof AudioEncoder !== 'undefined';
  const browser = detectBrowser();

  const [h264Configs, aacEncode, opusEncode, mbAvc, mbAac, mbOpus] = await Promise.all([
    probeH264(),
    probeAudio('aac'),
    probeAudio('opus'),
    canEncodeVideo('avc').catch(() => false),
    canEncodeAudio('aac').catch(() => false),
    canEncodeAudio('opus').catch(() => false),
  ]);

  const opfs = typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
  const opfsSyncAccessHandleInWorker = opfs; // presence of OPFS implies the worker sync API on supporting browsers
  const mse = typeof MediaSource !== 'undefined';
  const managedMediaSource = typeof window !== 'undefined' && 'ManagedMediaSource' in window;
  const video = typeof document !== 'undefined' ? document.createElement('video') : null;
  const nativeHls = !!video && video.canPlayType('application/vnd.apple.mpegurl') !== '';

  // Tab audio is only capturable on Chrome/Edge (FR-REC-04); confirmed after capture.
  const tabAudioCapture: ProbeResult['tabAudioCapture'] =
    browser.name === 'Chrome' || browser.name === 'Edge' ? 'supported' : browser.name === 'Unknown' ? 'unknown' : 'unsupported';

  const h264Supported = h264Configs.some((c) => c.supported) || mbAvc;
  const reasons: string[] = [];
  if (!getDisplayMedia) reasons.push('getDisplayMedia unavailable');
  if (!h264Supported) reasons.push('no supported H.264 encoder config');
  if (!(aacEncode || opusEncode || mbAac || mbOpus)) reasons.push('no AAC or Opus encoder');
  if (!opfs) reasons.push('OPFS unavailable');
  const recordable = getDisplayMedia && h264Supported && (aacEncode || opusEncode || mbAac || mbOpus) && opfs;

  return {
    browser,
    getDisplayMedia,
    tabAudioCapture,
    mediaStreamTrackProcessor: {
      window: typeof window !== 'undefined' && 'MediaStreamTrackProcessor' in window,
      worker: typeof (globalThis as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor !== 'undefined',
    },
    videoEncoder,
    audioEncoder,
    h264Configs,
    aacEncode,
    opusEncode,
    opfs,
    opfsSyncAccessHandleInWorker,
    mse,
    managedMediaSource,
    nativeHls,
    mediabunnyCanEncode: { avc: mbAvc, aac: mbAac, opus: mbOpus },
    recordable,
    reasons,
  };
}
