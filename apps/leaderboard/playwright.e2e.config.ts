import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'comprehensive-with-error-detection.e2e.ts', // 10 tests with error detection
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [
    ['html', {
      outputFolder: 'playwright-report/leaderboard',
      open: 'never',
    }],
    ['list'],
    ['json', { outputFile: 'test-results/leaderboard/results.json' }],
  ],

  timeout: 60000,

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on',

    screenshot: {
      mode: 'on',
      fullPage: true,
    },

    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },

    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15000,
  },

  outputDir: 'test-results/leaderboard/artifacts',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No web server - we'll start it manually
});
