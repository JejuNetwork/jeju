/**
 * Synpress Wallet Fixtures for Gateway Portal
 * Using official @synthetixio/synpress with MetaMask integration
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

export const JEJU_TEST_WALLET = {
  seed: 'test test test test test test test test test test test junk',
  password: 'Tester@1234',
  // Hardhat/Anvil default account
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

export const JEJU_NETWORK = {
  networkName: 'Jeju Localnet',
  rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  symbol: 'ETH',
};

/**
 * Wallet setup for Synpress
 */
export default defineWalletSetup(JEJU_TEST_WALLET.password, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, JEJU_TEST_WALLET.password);

  // Import test wallet
  await metamask.importWallet(JEJU_TEST_WALLET.seed);

  // Add Jeju network
  await metamask.addNetwork({
    networkName: JEJU_NETWORK.networkName,
    rpcUrl: JEJU_NETWORK.rpcUrl,
    chainId: JEJU_NETWORK.chainId,
    symbol: JEJU_NETWORK.symbol,
  });

  // Switch to Jeju network
  await metamask.switchNetwork(JEJU_NETWORK.networkName);
});

// Export MetaMask class for use in tests
export { MetaMask };

