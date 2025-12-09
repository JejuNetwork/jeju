import { defineConfig, devices } from '@playwright/test'
import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

const STORAGE_PORT = parseInt(process.env.STORAGE_UI_PORT || '4100')
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337')
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545'

const PASSWORD = 'Tester@1234'
const SEED_PHRASE = 'test test test test test test test test test test test junk'

export default defineConfig({
  testDir: './tests/wallet',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/synpress-storage.json' }],
  ],
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: `http://localhost:${STORAGE_PORT}`,
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

