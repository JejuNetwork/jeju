/**
 * Synpress Wallet Fixtures for Gateway Portal
 * Re-exports from centralized @jejunetwork/tests package
 */

import { createWalletSetup } from '@jejunetwork/tests';

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
} from '@jejunetwork/tests';

export {
  SEED_PHRASE,
  PASSWORD,
  TEST_WALLET_ADDRESS,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  createWalletSetup,
} from '@jejunetwork/tests';

// Re-export MetaMask class for use in tests
export { MetaMask } from '@synthetixio/synpress/playwright';

// Default export for tests that import: import basicSetup from '../fixtures/synpress-wallet'
const basicSetup = createWalletSetup();
export default basicSetup;

// Legacy exports for backwards compatibility
export const JEJU_TEST_WALLET = {
  seed: 'test test test test test test test test test test test junk',
  password: 'Tester@1234',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

export const JEJU_NETWORK = {
  name: 'Network Local',
  networkName: 'Network Local', // Alias for backwards compatibility
  rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  symbol: 'ETH',
};

