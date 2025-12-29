/**
 * Factory Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { CORE_PORTS } from '@jejunetwork/config'
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests/playwright-only'

const FACTORY_PORT = CORE_PORTS.FACTORY.get()

export default createSynpressConfig({
  appName: 'factory',
  port: FACTORY_PORT,
  testDir: './tests/synpress',
  overrides: {
    webServer: {
      command: 'bun run start',
      url: `http://localhost:${FACTORY_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
