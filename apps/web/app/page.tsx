export default function HomePage() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '64px 16px' }}>
      <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: 0 }}>Holocast</h1>
      <p style={{ fontSize: 20, color: '#9aa3b2', marginTop: 16 }}>
        Record your screen and share it instantly with a link — free, unlimited, and stored
        encrypted in your own Telegram.
      </p>
      <p style={{ marginTop: 32 }}>
        <a
          href="/login"
          style={{
            display: 'inline-block',
            padding: '12px 20px',
            borderRadius: 10,
            background: '#2f6bff',
            color: 'white',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Log in with Telegram
        </a>
      </p>
      <p style={{ color: '#5c6676', marginTop: 48, fontSize: 13 }}>Phase 1 · in development</p>
    </main>
  );
}
