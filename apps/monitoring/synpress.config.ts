/**
 * Monitoring App Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests/playwright-only'

const MONITORING_PORT = parseInt(process.env.PORT || '9091', 10)

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
