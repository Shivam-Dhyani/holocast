'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { getStorage, type StorageStatus } from '../../lib/api';

const btn: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 20px',
  borderRadius: 10,
  background: '#2f6bff',
  color: 'white',
  textDecoration: 'none',
  fontWeight: 600,
};

export function SetupClient() {
  const router = useRouter();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    let active = true;
    const MAX_POLLS = 300; // ~10 min at 2s

    async function poll() {
      try {
        const s = await getStorage();
        if (!active) return;
        setStatus(s);
        if (s.status === 'CONNECTED') return; // stop polling
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          router.push('/login');
          return;
        }
        if (active) setError(e instanceof Error ? e.message : 'Could not load storage status');
      }
      if (active && polls.current++ < MAX_POLLS) setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      active = false;
    };
  }, [router]);

  if (status?.status === 'CONNECTED') {
    return (
      <div>
        <p style={{ fontSize: 18 }}>
          Storage connected ✅ Your recordings will be saved in <strong>{status.channelTitle}</strong>.
        </p>
        <p style={{ marginTop: 24 }}>
          <a href="/record" style={btn}>
            Start recording
          </a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#9aa3b2' }}>
        Connect your storage — your videos are saved, encrypted, in your own Telegram channel.
      </p>
      <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
        <li>
          In Telegram, create a <strong>new private channel</strong> named <em>Holocast Storage</em>.
        </li>
        <li>
          Click the button below. Telegram will ask which channel to add the bot to — pick the new
          channel and grant the requested admin rights.
          <div style={{ marginTop: 12 }}>
            {status ? (
              <a href={status.deepLink} target="_blank" rel="noreferrer" style={btn}>
                Add Holocast bot to my channel
              </a>
            ) : (
              <span style={{ color: '#5c6676' }}>loading…</span>
            )}
          </div>
        </li>
        <li>Keep this tab open — we detect the connection automatically.</li>
      </ol>
      <p style={{ color: '#5c6676' }}>
        {status?.status === 'DISCONNECTED'
          ? 'Storage is disconnected — re-add the bot to the same channel to restore your links.'
          : status?.status === 'ERROR'
            ? 'We could not access the channel. Make sure the bot is an admin with post rights.'
            : 'Waiting for the bot to be added…'}
      </p>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
    </div>
  );
}
