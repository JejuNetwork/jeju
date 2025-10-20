import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envLocalPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      process.env[key.trim()] = value.trim();
    }
  });
}

const PREDIMARKET_PORT = process.env.PREDIMARKET_PORT || '4005';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Synpress works better with sequential execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Synpress requires single worker for wallet state
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results.json' }],
  ],
  timeout: 120000, // Increased for on-chain interactions
  use: {
    baseURL: `http://localhost:${PREDIMARKET_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `cd ${__dirname} && PREDIMARKET_PORT=${PREDIMARKET_PORT} bun run dev`,
    url: `http://localhost:${PREDIMARKET_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
