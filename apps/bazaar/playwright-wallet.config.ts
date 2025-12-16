import { createPlaywrightConfig } from '@jejunetwork/tests';

const BAZAAR_PORT = process.env.BAZAAR_PORT || '4006';

export default createPlaywrightConfig({
  name: 'bazaar-wallet',
  port: parseInt(BAZAAR_PORT),
  testDir: './tests/e2e-wallet',
  retries: 0, // Wallet tests should not retry
  timeout: 120000, // Wallet interactions can be slow
  webServer: {
    command: 'bun run dev',
    url: `http://localhost:${BAZAAR_PORT}`,
    timeout: 120000,
  },
});

