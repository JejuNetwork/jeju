import { defineConfig, devices } from '@playwright/test';

const PORT = parseInt(process.env.DOCUMENTATION_PORT || '4004');
const BASE_URL = `http://localhost:${PORT}/jeju/`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { outputFolder: 'playwright-report/documentation', open: 'never' }],
    ['json', { outputFile: 'test-results/documentation/results.json' }],
    ['list'],
  ],

  timeout: 30000,

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: { mode: 'on', fullPage: true },
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    actionTimeout: 10000,
    headless: true,
  },

  outputDir: 'test-results/documentation/artifacts',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
