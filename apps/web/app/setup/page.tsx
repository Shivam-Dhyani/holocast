import { SetupClient } from './SetupClient';

export default function SetupPage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>
        ← Holocast
      </a>
      <h1 style={{ fontSize: 28, marginTop: 24 }}>Connect storage</h1>
      <SetupClient />
    </main>
  );
}
