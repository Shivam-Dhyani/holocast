/**
 * Screen + mic capture and audio mixing (FR-REC-04, TDD §10.3). Mic is captured on
 * all browsers; tab audio is added on Chrome/Edge when the display stream carries
 * an audio track. Mic + tab audio are mixed into a single track via an
 * AudioContext.
 */

import { FPS, TARGET_HEIGHT, TARGET_WIDTH } from './constants';

export interface CaptureResult {
  displayStream: MediaStream;
  micStream: MediaStream;
  videoTrack: MediaStreamTrack;
  /** mixed mic (+ tab audio) track. */
  audioTrack: MediaStreamTrack;
  hasTabAudio: boolean;
  /** fires when the user ends the share from the browser UI. */
  onEnded: (cb: () => void) => void;
  stop: () => void;
}

export async function startCapture(opts: { tabAudio: boolean }): Promise<CaptureResult> {
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: FPS, width: { ideal: TARGET_WIDTH }, height: { ideal: TARGET_HEIGHT } },
    audio: opts.tabAudio,
  });
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaStreamSource(micStream).connect(dest);

  const tabAudioTracks = displayStream.getAudioTracks();
  const hasTabAudio = tabAudioTracks.length > 0;
  if (hasTabAudio) {
    audioCtx.createMediaStreamSource(new MediaStream(tabAudioTracks)).connect(dest);
  }

  const videoTrack = displayStream.getVideoTracks()[0]!;
  const audioTrack = dest.stream.getAudioTracks()[0]!;

  return {
    displayStream,
    micStream,
    videoTrack,
    audioTrack,
    hasTabAudio,
    onEnded(cb) {
      videoTrack.addEventListener('ended', cb, { once: true });
    },
    stop() {
      for (const t of displayStream.getTracks()) t.stop();
      for (const t of micStream.getTracks()) t.stop();
      void audioCtx.close();
    },
  };
}
