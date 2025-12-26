import { createSynpressConfig, createWalletSetup } from '@jejunetwork/tests/playwright-only'

const INDEXER_PORT = parseInt(process.env.INDEXER_PORT || '4001', 10)

export default createSynpressConfig({
  appName: 'indexer',
  port: INDEXER_PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 180000,
  },
})

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup()

