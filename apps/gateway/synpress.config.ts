/**
 * Gateway Synpress Configuration
 *
 * Run with: bun test:e2e
 * Or via jeju CLI: jeju test e2e --app gateway
 */

import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
  SEED_PHRASE,
} from '@jejunetwork/tests/shared/synpress.config.base'

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4001', 10)

export default createSynpressConfig({
  appName: 'gateway',
  port: GATEWAY_PORT,
  testDir: './tests/synpress',
  timeout: 120000,
})

export const basicSetup = createWalletSetup()

export { PASSWORD, SEED_PHRASE }
