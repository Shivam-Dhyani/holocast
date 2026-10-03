import type { Metadata } from 'next';

import { ViewerClient } from './ViewerClient';

// Non-public pages must not be indexed (FR-SHR-04); the viewer is noindex by default.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ViewerPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>
        ← Holocast
      </a>
      <div style={{ marginTop: 20 }}>
        <ViewerClient shareId={shareId} />
      </div>
    </main>
  );
}
