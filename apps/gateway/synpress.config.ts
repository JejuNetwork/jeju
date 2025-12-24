import { createSynpressConfig, createWalletSetup } from '@jejunetwork/tests'

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4001', 10)

export default createSynpressConfig({
  appName: 'gateway',
  port: GATEWAY_PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 180000,
  },
})

export const basicSetup = createWalletSetup()
