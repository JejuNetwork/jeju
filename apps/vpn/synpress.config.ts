import { defineConfig, devices } from '@playwright/test'

const VPN_PORT = parseInt(process.env.VPN_PORT ?? '1421', 10)
const BASE_URL = `http://localhost:${VPN_PORT}`

const SEED_PHRASE =
  'test test test test test test test test test test test junk'
const PASSWORD = 'Tester@1234'

export const basicSetup = {
  seedPhrase: SEED_PHRASE,
  walletPassword: PASSWORD,
}

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 120000,
  globalTimeout: 1800000,

  expect: {
    timeout: 30000,
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/synpress-report' }],
    ['json', { outputFile: 'test-results/synpress-results.json' }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
})
