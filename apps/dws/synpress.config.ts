import {
  createSynpressConfig,
  createWalletSetup,
} from '@jejunetwork/tests/playwright-only'

const DWS_PORT = parseInt(process.env.DWS_PORT || '4031', 10)

export default createSynpressConfig({
  appName: 'dws',
  port: DWS_PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 180000,
  },
})

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup()
