'use client';

import { useEffect, useState } from 'react';

import { getCreatorVideos, type VideoListItem } from '../../../lib/api';

export function CreatorClient({ publicId }: { publicId: string }) {
  const [data, setData] = useState<{ name: string; videos: VideoListItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCreatorVideos(publicId)
      .then((r) => setData({ name: r.creator.name, videos: r.videos }))
      .catch(() => setError('Creator not found.'));
  }, [publicId]);

  if (error) return <p style={{ color: '#9aa3b2' }}>{error}</p>;
  if (!data) return <p style={{ color: '#9aa3b2' }}>Loading…</p>;
  return (
    <div>
      <h1 style={{ fontSize: 28 }}>{data.name}</h1>
      {data.videos.length === 0 ? (
        <p style={{ color: '#9aa3b2' }}>No public videos yet.</p>
      ) : (
        <ul style={{ lineHeight: 1.9 }}>
          {data.videos.map((v) => (
            <li key={v.id}>
              <a href={v.shareUrl} style={{ color: '#8ab4ff' }}>{v.title}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
