import { VideosClient } from './VideosClient';

export default function VideosPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>← Holocast</a>
      <h1 style={{ fontSize: 28, marginTop: 24 }}>My videos</h1>
      <VideosClient />
    </main>
  );
}
