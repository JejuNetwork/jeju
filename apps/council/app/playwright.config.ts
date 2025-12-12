import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop - primary
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Tablet
    {
      name: 'ipad',
      use: { ...devices['iPad Pro 11'] },
    },
    {
      name: 'ipad-landscape',
      use: { 
        ...devices['iPad Pro 11 landscape'],
      },
    },
    // Mobile
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-landscape',
      use: { 
        ...devices['iPhone 14 landscape'],
      },
    },
  ],
  // Start all required services
  webServer: [
    // 1. Council Backend API (port 8010)
    {
      command: 'cd .. && RPC_URL=http://localhost:8545 bun run src/index.ts',
      url: 'http://localhost:8010/health',
      reuseExistingServer: true, // Reuse if already running
      timeout: 30000,
    },
    // 2. Next.js Frontend (port 3010)
    {
      command: 'NEXT_PUBLIC_COUNCIL_API=http://localhost:8010 bun run dev',
      url: 'http://localhost:3010',
      reuseExistingServer: true, // Reuse if already running
      timeout: 120000,
    },
  ],
})
