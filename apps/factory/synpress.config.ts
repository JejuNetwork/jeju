/**
 * Factory Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests/playwright-only'

const FACTORY_PORT = parseInt(process.env.PORT || '4009', 10)

export default createSynpressConfig({
  appName: 'factory',
  port: FACTORY_PORT,
  testDir: './tests/synpress',
  overrides: {
    webServer: {
      command: 'bun run dev',
      url: `http://localhost:${FACTORY_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
