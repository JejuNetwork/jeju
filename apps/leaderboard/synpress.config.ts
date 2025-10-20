import { createJejuSynpressConfig, createJejuWalletSetup } from '../../tests/shared/synpress.config.base';

const LEADERBOARD_PORT = parseInt(process.env.LEADERBOARD_PORT || '3000');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'leaderboard',
  port: LEADERBOARD_PORT,
  testDir: './tests/e2e-wallet',
  overrides: {
    timeout: 180000, // 3 minutes for data sync operations
  },
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();
