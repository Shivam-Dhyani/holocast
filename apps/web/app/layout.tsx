import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Holocast',
  description: 'Record your screen and share it instantly with a link — stored encrypted in your own Telegram.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#0b0d12',
          color: '#e7e9ee',
        }}
      >
        {children}
      </body>
    </html>
  );
}
