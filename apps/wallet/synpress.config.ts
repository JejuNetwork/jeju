/**
 * Synpress Configuration for Wallet E2E Tests
 *
 * For MetaMask/wallet integration tests that require:
 * - Wallet connection flows
 * - Transaction signing
 * - Cross-chain transfers (EIL)
 * - Intent submission (OIF)
 * - Gas token selection
 * - Account abstraction features
 */

import {
  createSynpressConfig,
  PASSWORD,
  SEED_PHRASE,
} from '@jejunetwork/tests/playwright-only'

const WALLET_PORT = parseInt(process.env.WALLET_PORT || '4015', 10)

export default createSynpressConfig({
  appName: 'wallet',
  port: WALLET_PORT,
  testDir: './tests/e2e/metamask',
  overrides: {
    timeout: 120000,
    expect: {
      timeout: 30000,
    },
  },
})

export { PASSWORD, SEED_PHRASE }
