import { LoginClient } from './LoginClient';

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '64px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>
        ← Holocast
      </a>
      <h1 style={{ fontSize: 28, marginTop: 24 }}>Log in with Telegram</h1>
      <p style={{ color: '#9aa3b2' }}>
        We only use Telegram to identify you — no phone number, no OTP, and we never store a
        Telegram session.
      </p>
      <div style={{ marginTop: 24 }}>
        <LoginClient />
      </div>
    </main>
  );
}
