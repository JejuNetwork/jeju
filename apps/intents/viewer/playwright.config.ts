import { createJejuSynpressConfig, createJejuWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/synpress.config.base';

const VIEWER_PORT = parseInt(process.env.VIEWER_PORT || '4011');

// Export Playwright config
export default createJejuSynpressConfig({
  appName: 'intents-viewer',
  port: VIEWER_PORT,
  testDir: './tests',
});

// Export wallet setup for Synpress
export const basicSetup = createJejuWalletSetup();

export { PASSWORD, SEED_PHRASE };

