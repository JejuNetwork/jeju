/**
 * Synpress Configuration for Node App
 * Configures MetaMask wallet testing with Playwright
 */
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests'

const NODE_PORT = parseInt(process.env.NODE_PORT ?? '1420', 10)

export default createSynpressConfig({
  appName: 'node',
  port: NODE_PORT,
  testDir: '.',
  overrides: {
    testMatch: '*.synpress.ts',
    webServer: {
      command: 'cd ../.. && bun run dev',
      url: `http://localhost:${NODE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
