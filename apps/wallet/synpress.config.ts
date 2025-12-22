import { createSynpressConfig, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests'

const WALLET_PORT = parseInt(process.env.WALLET_PORT || '4015', 10)

/**
 * Synpress configuration for wallet E2E tests
 *
 * Tests for:
 * - Wallet connection flows
 * - Transaction signing
 * - Cross-chain transfers (EIL)
 * - Intent submission (OIF)
 * - Gas token selection
 * - Account abstraction features
 */
export default createSynpressConfig({
  appName: 'wallet',
  port: WALLET_PORT,
  testDir: './tests',
  overrides: {
    timeout: 120000,
    expect: {
      timeout: 30000,
    },
  },
})

// Export wallet setup - app-specific setup is in tests/wallet-setup/basic.setup.ts
export { PASSWORD, SEED_PHRASE }
