import { defineConfig, devices } from '@playwright/test'

const PORT = Number.parseInt(process.env.OTTO_PORT ?? '4040', 10)
const BASE_URL = process.env.OTTO_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false, // Synpress tests need to be sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for wallet tests
  reporter: [['html', { outputFolder: 'synpress-report' }], ['list']],
  timeout: 60000, // Longer timeout for wallet interactions

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

  // Start the Otto server before tests
  webServer: {
    command: 'bun run dev',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
