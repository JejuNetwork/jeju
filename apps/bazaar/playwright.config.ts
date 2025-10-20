import { defineConfig, devices } from '@playwright/test';

const BAZAAR_PORT = process.env.BAZAAR_PORT || '4006';
const BASE_URL = process.env.BASE_URL || `http://localhost:${BAZAAR_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/e2e-wallet/**', // Exclude wallet tests from main config
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['dot'],
  ],

  timeout: 90000,

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
