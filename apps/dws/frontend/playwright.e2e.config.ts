/**
 * Playwright E2E Config
 * 
 * Full end-to-end tests with infrastructure setup.
 * Runs localnet, DWS backend, and frontend.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // Run serially for stability
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1, // Single worker for e2e
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }], ['list']],
  
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  
  use: {
    baseURL: 'http://127.0.0.1:4031',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  projects: [
    {
      name: 'e2e-chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*\.spec\.ts/,
      testIgnore: /wallet-integration\.spec\.ts/, // Synpress tests run separately
    },
    {
      name: 'e2e-wallet',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /wallet-integration\.spec\.ts/,
    },
  ],
});

