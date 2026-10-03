import { RecordClient } from './RecordClient';

export default function RecordPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>
        ← Holocast
      </a>
      <h1 style={{ fontSize: 28, marginTop: 24 }}>Record</h1>
      <RecordClient />
    </main>
  );
}
