/**
 * Monitoring App Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { CORE_PORTS } from '@jejunetwork/config'
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests/playwright-only'

const MONITORING_PORT = CORE_PORTS.MONITORING.get()

export default createSynpressConfig({
  appName: 'monitoring',
  port: MONITORING_PORT,
  testDir: './tests/synpress',
  timeout: 120000,
  overrides: {
    webServer: {
      command: 'bun run server/a2a.ts',
      url: `http://localhost:${MONITORING_PORT}/.well-known/agent-card.json`,
      reuseExistingServer: true,
      timeout: 60000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
