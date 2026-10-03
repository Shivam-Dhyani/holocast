'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getShareMetadata, playlistUrl, unlockShare, type ShareMetadata } from '../../../lib/api';
import { attachHls } from '../../../lib/player/play';

const MESSAGES: Record<string, string> = {
  deleted: 'This video was deleted.',
  private: 'This video is private.',
  disconnected: "The creator's storage is disconnected. Ask them to reconnect it.",
  notfound: 'This video does not exist.',
};

export function ViewerClient({ shareId }: { shareId: string }) {
  const [meta, setMeta] = useState<ShareMetadata | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(async () => {
    try {
      setMeta(await getShareMetadata(shareId));
      setState('ok');
    } catch {
      setState('error');
    }
  }, [shareId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canPlay =
    meta &&
    meta.status !== 'DELETED' &&
    meta.storageConnected &&
    !meta.needsPassword &&
    !(meta.visibility === 'PRIVATE' && !meta.isOwner);

  useEffect(() => {
    if (!canPlay || !videoRef.current) return;
    const handle = attachHls(videoRef.current, playlistUrl(shareId));
    return () => handle.destroy();
  }, [canPlay, shareId]);

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockError(null);
    try {
      await unlockShare(shareId, password);
      await load();
    } catch {
      setUnlockError('Incorrect password.');
    }
  }

  if (state === 'loading') return <p style={{ color: '#9aa3b2' }}>Loading…</p>;
  if (state === 'error' || !meta) return <Message text={MESSAGES.notfound!} />;
  if (meta.status === 'DELETED') return <Message text={MESSAGES.deleted!} />;
  if (!meta.storageConnected) return <Message text={MESSAGES.disconnected!} />;
  if (meta.visibility === 'PRIVATE' && !meta.isOwner) return <Message text={MESSAGES.private!} />;

  if (meta.needsPassword) {
    return (
      <form onSubmit={onUnlock} style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
        <p>This video is password-protected.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{ padding: 8, borderRadius: 8, border: '1px solid #2a3140', background: '#11141b', color: '#e7e9ee' }}
        />
        <button type="submit" style={{ background: '#2f6bff', color: 'white', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 600 }}>
          Unlock
        </button>
        {unlockError && <p style={{ color: '#ff6b6b' }}>{unlockError}</p>}
      </form>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 22 }}>{meta.title || 'Untitled'}</h1>
      <p style={{ color: '#9aa3b2', marginTop: 0 }}>by {meta.creatorName || 'Unknown'}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} controls playsInline style={{ width: '100%', borderRadius: 10, background: '#000' }} />
      {meta.status !== 'READY' && <p style={{ color: '#9aa3b2' }}>Still recording — this link updates as it finishes.</p>}
    </div>
  );
}

function Message({ text }: { text: string }) {
  return <p style={{ color: '#9aa3b2', fontSize: 18 }}>{text}</p>;
}
