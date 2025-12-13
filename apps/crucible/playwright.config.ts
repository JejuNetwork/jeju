/**
 * Playwright Configuration for Crucible
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/basic',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/html' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4020',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4020/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
