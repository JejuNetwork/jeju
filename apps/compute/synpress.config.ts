import { createSynpressConfig, createWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/synpress.config.base';

const COMPUTE_PORT = parseInt(process.env.COMPUTE_PORT || '4007');

// Export Playwright config
export default createSynpressConfig({
  appName: 'compute',
  port: COMPUTE_PORT,
  testDir: './tests/synpress',
  overrides: {
    webServer: {
      command: 'bun run serve-frontend',
      url: `http://localhost:${COMPUTE_PORT}`,
      reuseExistingServer: true,
      timeout: 120000,
    },
  },
});

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup();

export { PASSWORD, SEED_PHRASE };
