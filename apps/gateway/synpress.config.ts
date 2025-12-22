import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
  SEED_PHRASE,
} from '@jejunetwork/tests'

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4001', 10)

export default createSynpressConfig({
  appName: 'gateway',
  port: GATEWAY_PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 180000,
  },
})

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup()

// Re-export constants for tests
export { PASSWORD, SEED_PHRASE }
