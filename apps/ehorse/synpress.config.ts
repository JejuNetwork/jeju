import { createJejuSynpressConfig, createJejuWalletSetup } from '../../tests/shared/synpress.config.base';

const EHORSE_PORT = parseInt(process.env.EHORSE_PORT || '4002');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'ehorse',
  port: EHORSE_PORT,
  testDir: './tests/e2e-wallet',
  webServer: false, // ehorse uses custom server setup
  overrides: {
    timeout: 240000, // 4 minutes for game operations
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();
