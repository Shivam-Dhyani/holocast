'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  deleteVideo,
  listMyVideos,
  patchVideo,
  type LinkType,
  type VideoListItem,
} from '../../lib/api';

function fmtDuration(durationUs: string): string {
  const s = Math.round(Number(durationUs) / 1_000_000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function VideosClient() {
  const [videos, setVideos] = useState<VideoListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVideos((await listMyVideos()).videos);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 401 ? 'Please log in to see your videos.' : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRename(v: VideoListItem) {
    const title = window.prompt('New title', v.title);
    if (title == null) return;
    await patchVideo(v.id, { title: title.slice(0, 120) });
    await load();
  }
  async function onChangeType(v: VideoListItem, visibility: LinkType) {
    let password: string | undefined;
    if (visibility === 'PASSWORD') {
      const p = window.prompt('Set a password (min 6 chars)');
      if (!p || p.length < 6) return;
      password = p;
    }
    await patchVideo(v.id, { visibility, ...(password ? { password } : {}) });
    await load();
  }
  async function onDelete(v: VideoListItem) {
    if (!window.confirm(`Delete "${v.title}"? This removes it from your Telegram channel and breaks the link.`)) return;
    await deleteVideo(v.id);
    await load();
  }

  if (error) return <p style={{ color: '#ff6b6b' }}>{error}</p>;
  if (!videos) return <p style={{ color: '#9aa3b2' }}>Loading…</p>;
  if (videos.length === 0) return <p style={{ color: '#9aa3b2' }}>No videos yet. Record one!</p>;

  const cell: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #1c2230', verticalAlign: 'top' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#9aa3b2' }}>
          <th style={cell}>Title</th>
          <th style={cell}>Duration</th>
          <th style={cell}>Link type</th>
          <th style={cell}>Status</th>
          <th style={cell}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {videos.map((v) => (
          <tr key={v.id}>
            <td style={cell}>
              {v.title}
              <div style={{ color: '#5c6676', fontSize: 12 }}>{new Date(v.createdAt).toLocaleString()}</div>
            </td>
            <td style={cell}>{fmtDuration(v.durationUs)}</td>
            <td style={cell}>
              <select
                value={v.visibility}
                onChange={(e) => void onChangeType(v, e.target.value as LinkType)}
                style={{ background: '#11141b', color: '#e7e9ee', border: '1px solid #2a3140', borderRadius: 6, padding: 4 }}
              >
                <option value="PUBLIC">Public</option>
                <option value="UNLISTED">Unlisted</option>
                <option value="PASSWORD">Password</option>
                <option value="PRIVATE">Private</option>
              </select>
            </td>
            <td style={cell}>{v.status}</td>
            <td style={cell}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => void navigator.clipboard?.writeText(v.shareUrl)} disabled={!v.shareUrl}>
                  Copy link
                </button>
                <button onClick={() => void onRename(v)}>Rename</button>
                <button onClick={() => void onDelete(v)} style={{ color: '#ff6b6b' }}>
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
