/**
 * Example App Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { CORE_PORTS } from '@jejunetwork/config'
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests/playwright-only'

const EXAMPLE_PORT = CORE_PORTS.EXAMPLE.get()

export default createSynpressConfig({
  appName: 'example',
  port: EXAMPLE_PORT,
  testDir: './tests/synpress',
  timeout: 180000,
  overrides: {
    webServer: {
      command: 'bun run src/server/index.ts',
      url: `http://localhost:${EXAMPLE_PORT}/health`,
      reuseExistingServer: true,
      timeout: 60000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
