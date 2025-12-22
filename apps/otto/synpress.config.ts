import { createSynpressConfig, createWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests';

const OTTO_PORT = parseInt(process.env.OTTO_PORT || '4040');

export default createSynpressConfig({
  appName: 'otto',
  port: OTTO_PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 180000,
  },
});

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup();

// Re-export constants for tests
export { PASSWORD, SEED_PHRASE };
