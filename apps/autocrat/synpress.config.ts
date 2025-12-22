/**
 * Autocrat Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createSynpressConfig, createWalletSetup, PASSWORD } from '@jejunetwork/tests';

const AUTOCRAT_PORT = parseInt(process.env.PORT || '8010');
const CEO_PORT = parseInt(process.env.CEO_PORT || '8004');

export default createSynpressConfig({
  appName: 'autocrat',
  port: AUTOCRAT_PORT,
  testDir: './tests/synpress',
  timeout: 120000,
  overrides: {
    // Autocrat needs both API and CEO servers
    webServer: [
      {
        command: 'bun run src/index.ts',
        url: `http://localhost:${AUTOCRAT_PORT}/health`,
        reuseExistingServer: true,
        timeout: 60000,
      },
      {
        command: 'bun run src/ceo-server.ts',
        url: `http://localhost:${CEO_PORT}/health`,
        reuseExistingServer: true,
        timeout: 60000,
      },
    ],
  },
});

export const basicSetup = createWalletSetup();
export { PASSWORD };
