import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-synpress-simple',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,

  reporter: [['list'], ['html']],

  use: {
    baseURL: 'http://localhost:4001',
    trace: 'on-first-retry',
    headless: false,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

