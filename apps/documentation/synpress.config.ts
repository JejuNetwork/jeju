import { createSynpressConfig, createWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/synpress.config.base';

const DOCS_PORT = parseInt(process.env.DOCS_PORT || '3002');

export default createSynpressConfig({
  appName: 'documentation',
  port: DOCS_PORT,
  testDir: './tests/e2e-wallet',
  overrides: { timeout: 30000 },
});

export const basicSetup = createWalletSetup();
export { PASSWORD, SEED_PHRASE };
