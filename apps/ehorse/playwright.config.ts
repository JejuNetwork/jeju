import { defineConfig, devices } from '@playwright/test';

const EHORSE_PORT = process.env.EHORSE_PORT || '5700';
const BASE_URL = process.env.EHORSE_URL || `http://localhost:${EHORSE_PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially for blockchain state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for blockchain tests
  reporter: [['html'], ['list']],
  
  timeout: 180000, // 3 minutes for complete cycles
  
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Don't auto-start server (tests assume it's already running)
  webServer: undefined,
});



