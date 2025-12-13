import { createJejuSynpressConfig, createJejuWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests/synpress.config.base';

const DOCS_PORT = parseInt(process.env.DOCS_PORT || '3002');

export default createJejuSynpressConfig({
  appName: 'documentation',
  port: DOCS_PORT,
  testDir: './tests/e2e-wallet',
  overrides: { timeout: 30000 },
});

export const basicSetup = createJejuWalletSetup();
export { PASSWORD, SEED_PHRASE };
