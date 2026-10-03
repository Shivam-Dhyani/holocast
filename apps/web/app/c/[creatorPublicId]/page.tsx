import type { Metadata } from 'next';

import { CreatorClient } from './CreatorClient';

// Public creator page is indexable (FR-SHR-03).
export const metadata: Metadata = { robots: { index: true, follow: true } };

export default async function CreatorPage({ params }: { params: Promise<{ creatorPublicId: string }> }) {
  const { creatorPublicId } = await params;
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '40px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>← Holocast</a>
      <div style={{ marginTop: 20 }}><CreatorClient publicId={creatorPublicId} /></div>
    </main>
  );
}
