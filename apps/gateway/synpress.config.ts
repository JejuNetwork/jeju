import { createJejuSynpressConfig, createJejuWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/synpress.config.base';

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4001');

// Export Playwright config - assumes servers already running
export default createJejuSynpressConfig({
  appName: 'gateway',
  port: GATEWAY_PORT,
  testDir: './tests/e2e-synpress',
  overrides: {
    timeout: 180000, // 3 minutes for bridge and liquidity operations
    webServer: undefined, // Servers must be started manually
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();

export { PASSWORD, SEED_PHRASE };

