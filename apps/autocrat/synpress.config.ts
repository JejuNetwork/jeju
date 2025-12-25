/**
 * Autocrat Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests'

const AUTOCRAT_PORT = parseInt(process.env.PORT || '3010', 10)
const BASE_URL = `http://localhost:${AUTOCRAT_PORT}`

export default createSynpressConfig({
  appName: 'autocrat',
  port: AUTOCRAT_PORT,
  testDir: './tests/synpress',
  testMatch: '**/*.synpress.ts',
  timeout: 120000,
  overrides: {
    use: {
      baseURL: BASE_URL,
    },
    webServer: {
      command: 'bun run dev:web',
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 60000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
