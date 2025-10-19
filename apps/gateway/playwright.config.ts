import { defineConfig, devices } from '@playwright/test';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env.local' });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Sequential for MetaMask tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for wallet tests
  reporter: 'html',
  timeout: 120000, // 2 minutes for blockchain ops
  
  use: {
    baseURL: 'http://localhost:4001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // MetaMask requires headful mode
        headless: false,
      },
    },
  ],

  webServer: [
    {
      command: 'bun run dev:ui',
      url: 'http://localhost:4001',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'bun run dev:a2a',
      url: 'http://localhost:4003',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});

