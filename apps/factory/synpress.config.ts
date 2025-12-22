/**
 * Factory Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createSynpressConfig, PASSWORD } from '@jejunetwork/tests';
import basicSetup from '@jejunetwork/tests/wallet-setup';

const FACTORY_PORT = parseInt(process.env.PORT || '4009');

export default createSynpressConfig({
  appName: 'factory',
  port: FACTORY_PORT,
  testDir: './tests/synpress',
  timeout: 120000,
});

export { basicSetup, PASSWORD };
