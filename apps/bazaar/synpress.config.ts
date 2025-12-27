import { CORE_PORTS } from '@jejunetwork/config'
import {
  createSynpressConfig,
  createWalletSetup,
} from '@jejunetwork/tests/playwright-only'

const BAZAAR_PORT = CORE_PORTS.BAZAAR.get()

// Export Playwright config - assumes server already running
export default createSynpressConfig({
  appName: 'bazaar',
  port: BAZAAR_PORT,
  testDir: './tests/wallet',
  overrides: {
    timeout: 180000, // 3 minutes for trading and market operations
    webServer: undefined, // Server must be started manually
  },
})

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup()
