/**
 * @jejunetwork/tests - Shared test utilities for Jeju Network
 * 
 * @example
 * ```typescript
 * // Synpress wallet tests (recommended)
 * import { test, expect, connectAndVerify, verifyAuth } from '@jejunetwork/tests/fixtures/synpress-wallet';
 * 
 * test('should connect and verify', async ({ context, page, metamaskPage, extensionId }) => {
 *   const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);
 *   await connectAndVerify(page, metamask);
 * });
 * 
 * // Synpress config for apps
 * import { createJejuSynpressConfig, createJejuWalletSetup } from '@jejunetwork/tests/synpress.config.base';
 * 
 * export default createJejuSynpressConfig({
 *   appName: 'my-app',
 *   port: 3000,
 *   testDir: './tests/wallet',
 * });
 * ```
 */

// Synpress fixtures and auth helpers
export {
  test,
  expect,
  basicSetup,
  walletPassword,
  connectAndVerify,
  verifyAuth,
  isAuthenticated,
  verifyDisconnected,
  connectWallet,
  approveTransaction,
  signMessage,
  rejectTransaction,
  switchNetwork,
  getWalletAddress,
  verifyWalletConnected,
} from './fixtures/synpress-wallet';

// Synpress config builders
export {
  createJejuSynpressConfig,
  createJejuWalletSetup,
  SEED_PHRASE,
  PASSWORD,
  TEST_WALLET_ADDRESS,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  SYNPRESS_CACHE_DIR,
} from './synpress.config.base';

// Legacy fixtures
export * from './fixtures/wallet';

// Helpers
export * from './helpers/contracts';
export * from './helpers/screenshots';
export * from './helpers/navigation';
export * from './helpers/error-detection';

// Constants
export * from './constants';

