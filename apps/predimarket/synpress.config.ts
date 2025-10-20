import { createJejuSynpressConfig, createJejuWalletSetup } from '../../tests/shared/synpress.config.base';

const PREDIMARKET_PORT = parseInt(process.env.PREDIMARKET_PORT || '4005');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'predimarket',
  port: PREDIMARKET_PORT,
  testDir: './tests/e2e/wallet',
  overrides: {
    timeout: 180000, // 3 minutes for market operations
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();
