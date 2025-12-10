import { createJejuSynpressConfig, createJejuWalletSetup, PASSWORD } from '@jejunetwork/tests/synpress.config.base';

const BAZAAR_PORT = parseInt(process.env.BAZAAR_PORT || '4006');

// Export Playwright config - assumes server already running
export default createJejuSynpressConfig({
  appName: 'bazaar',
  port: BAZAAR_PORT,
  testDir: './tests/wallet',
  overrides: {
    timeout: 180000, // 3 minutes for trading and market operations
    webServer: undefined, // Server must be started manually
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();

// Re-export password for tests that need it
export { PASSWORD };
