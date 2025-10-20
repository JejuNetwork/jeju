import { defineConfig, devices } from '@playwright/test';

const GATEWAY_PORT = process.env.GATEWAY_PORT || '4001';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  timeout: 120000,
  expect: { timeout: 15000 },

  use: {
    baseURL: `http://localhost:${GATEWAY_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: false, // MetaMask requires headful
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
      },
    },
  ],
});
