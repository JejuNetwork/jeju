import { defineConfig, devices } from '@playwright/test'
import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

const VIEWER_PORT = parseInt(process.env.VIEWER_PORT || '4011')
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337')
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545'

const PASSWORD = 'Tester@1234'
const SEED_PHRASE = 'test test test test test test test test test test test junk'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['json', { outputFile: 'test-results/synpress-intents-viewer.json' }],
  ],
  use: {
    baseURL: `http://localhost:${VIEWER_PORT}`,
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
    command: 'bun run dev',
    url: `http://localhost:${VIEWER_PORT}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
  timeout: 120000,
  expect: {
    timeout: 15000,
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

