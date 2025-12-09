import { createJejuSynpressConfig, createJejuWalletSetup } from '@jejunetwork/tests/synpress.config.base';

const DOCS_PORT = parseInt(process.env.DOCS_PORT || '3002');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'documentation',
  port: DOCS_PORT,
  testDir: './tests/e2e-wallet',
  overrides: {
    timeout: 90000, // Documentation typically doesn't need long timeouts
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();
