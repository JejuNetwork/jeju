import { defineConfig, devices } from '@playwright/test'
import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

const COMPUTE_PORT = parseInt(process.env.COMPUTE_PORT || '4007')
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337')
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545'

const PASSWORD = 'Tester@1234'
const SEED_PHRASE = 'test test test test test test test test test test test junk'

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/synpress-compute.json' }],
    ['list'],
  ],
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: `http://localhost:${COMPUTE_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run serve-frontend',
    url: `http://localhost:${COMPUTE_PORT}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
})

export const basicSetup = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  await metamask.importWallet(SEED_PHRASE)
  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: JEJU_RPC_URL,
    chainId: JEJU_CHAIN_ID,
    symbol: 'ETH',
  })
  await metamask.switchNetwork('Jeju Local')
})

export { PASSWORD, SEED_PHRASE }
