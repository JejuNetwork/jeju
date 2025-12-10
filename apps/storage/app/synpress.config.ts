import { createJejuSynpressConfig, createJejuWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/synpress.config.base';

const STORAGE_PORT = parseInt(process.env.STORAGE_UI_PORT || '4100');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'storage',
  port: STORAGE_PORT,
  testDir: './tests/wallet',
  overrides: {
    webServer: undefined, // Server must be started manually
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();

export { PASSWORD, SEED_PHRASE };

