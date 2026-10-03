import { LabClient } from './LabClient';

export default function LabPage() {
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 16px' }}>
      <a href="/" style={{ color: '#8ab4ff', textDecoration: 'none' }}>
        ← Holocast
      </a>
      <h1 style={{ fontSize: 28, marginTop: 24 }}>Phase 1 Lab</h1>
      <p style={{ color: '#9aa3b2' }}>
        Every PRD §9 test. Server tests run here; browser, CLI, manual and report export land in
        M8. Run the Telegram server tests first (TDD §13.3).
      </p>
      <LabClient />
    </main>
  );
}
