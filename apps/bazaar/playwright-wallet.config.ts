import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const BAZAAR_PORT = process.env.BAZAAR_PORT || '4006';

export default createJejuPlaywrightConfig({
  appName: 'bazaar-wallet',
  port: parseInt(BAZAAR_PORT),
  testDir: './tests/e2e-wallet',
  webServer: {
    command: 'bun run dev',
    url: `http://localhost:${BAZAAR_PORT}`,
    reuseExistingServer: true, // Reuse already running server
    timeout: 120000,
  },
  overrides: {
    retries: 0, // Wallet tests should not retry
    timeout: 120000, // Wallet interactions can be slow
  },
});

