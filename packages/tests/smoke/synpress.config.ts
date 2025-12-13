import { defineConfig, devices } from '@playwright/test';

/**
 * Synpress config for wallet smoke tests
 *
 * These tests require MetaMask and a running localnet.
 * Run: bunx playwright test --config packages/tests/smoke/synpress.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'wallet-smoke.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,

  reporter: [
    ['list'],
    ['json', { outputFile: 'wallet-smoke-results.json' }],
  ],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

