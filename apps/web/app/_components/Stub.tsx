import type { ReactNode } from 'react';

/** Minimal M2 page scaffold; real UIs land in M3 (auth/setup), M5 (record), M7 (viewer/videos/creator), M8 (lab). */
export function Stub({ title, milestone, children }: { title: string; milestone: string; children?: ReactNode }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>
        ← Holocast
      </a>
      <h1 style={{ fontSize: 28, marginTop: 24 }}>{title}</h1>
      <p style={{ color: '#9aa3b2' }}>Coming in {milestone}.</p>
      {children}
    </main>
  );
}
