'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { loginWithTelegram } from '../../lib/api';

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '';

export function LoginClient() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      setBusy(true);
      setError(null);
      try {
        const me = await loginWithTelegram(user);
        router.push(me.storageStatus.status === 'CONNECTED' ? '/record' : '/setup');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed');
        setBusy(false);
      }
    };

    if (!BOT_USERNAME || !containerRef.current || containerRef.current.childElementCount > 0) return;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    containerRef.current.appendChild(script);

    return () => {
      window.onTelegramAuth = undefined;
    };
  }, [router]);

  return (
    <div>
      {!BOT_USERNAME && (
        <p style={{ color: '#e0a92e' }}>
          Set <code>NEXT_PUBLIC_TELEGRAM_BOT_USERNAME</code> to render the Telegram login button.
        </p>
      )}
      <div ref={containerRef} aria-busy={busy} />
      {busy && <p style={{ color: '#9aa3b2' }}>Signing you in…</p>}
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
    </div>
  );
}
