import { defineConfig } from 'vitest/config';

// AUTOTEST suites (T-SEC-01/02, T-FAIR-01). Require a test Postgres via DATABASE_URL
// and the app secrets; suites skip gracefully when DATABASE_URL is unset.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/integration/setup-env.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
