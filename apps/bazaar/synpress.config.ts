import { defineConfig, devices } from '@playwright/test';

const BAZAAR_PORT = parseInt(process.env.BAZAAR_PORT || '4006');

export default defineConfig({
  testDir: './tests/wallet',
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results-synpress.json' }],
  ],

  timeout: 180000, // 3 minutes for DeFi operations

  expect: {
    timeout: 15000,
  },

  use: {
    baseURL: `http://localhost:${BAZAAR_PORT}`,
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

  webServer: {
    command: 'bun run dev',
    url: `http://localhost:${BAZAAR_PORT}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
