/** HLS attach helper (FR-PLY-01): native HLS where available (Safari), else hls.js. */

import Hls from 'hls.js';

export interface PlayerHandle {
  engine: 'native' | 'hls.js' | 'none';
  destroy: () => void;
}

export function attachHls(video: HTMLVideoElement, src: string): PlayerHandle {
  // Safari / iOS play fMP4 HLS natively and generally better than MSE.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    return {
      engine: 'native',
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }
  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hls.loadSource(src);
    hls.attachMedia(video);
    return { engine: 'hls.js', destroy: () => hls.destroy() };
  }
  return { engine: 'none', destroy: () => {} };
}
