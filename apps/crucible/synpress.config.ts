import { createJejuSynpressConfig, createJejuWalletSetup } from '../../tests/shared/synpress.config.base';

const CRUCIBLE_PORT = parseInt(process.env.CRUCIBLE_PORT || '3001');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'crucible',
  port: CRUCIBLE_PORT,
  testDir: './tests/e2e-wallet',
  webServer: false, // API server with custom setup
  overrides: {
    timeout: 120000,
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();
