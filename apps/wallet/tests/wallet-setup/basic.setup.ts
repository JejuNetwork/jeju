/**
 * Basic Wallet Setup for Synpress
 * 
 * Sets up a MetaMask wallet with test networks for E2E testing.
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';
import { TEST_MNEMONIC, TEST_PASSWORD, TEST_NETWORKS } from '../fixtures/accounts';

export default defineWalletSetup(TEST_PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, TEST_PASSWORD);
  
  // Import the test wallet
  await metamask.importWallet(TEST_MNEMONIC);
  
  // Add Network Localnet (primary for E2E)
  await metamask.addNetwork({
    name: TEST_NETWORKS.jeju.name,
    rpcUrl: TEST_NETWORKS.jeju.rpcUrl,
    chainId: TEST_NETWORKS.jeju.chainId,
    symbol: TEST_NETWORKS.jeju.symbol,
    blockExplorerUrl: '',
  });
  
  // Add Base network
  await metamask.addNetwork({
    name: TEST_NETWORKS.base.name,
    rpcUrl: TEST_NETWORKS.base.rpcUrl,
    chainId: TEST_NETWORKS.base.chainId,
    symbol: TEST_NETWORKS.base.symbol,
    blockExplorerUrl: TEST_NETWORKS.base.blockExplorer,
  });
  
  // Add Base Sepolia testnet
  await metamask.addNetwork({
    name: TEST_NETWORKS.baseSepolia.name,
    rpcUrl: TEST_NETWORKS.baseSepolia.rpcUrl,
    chainId: TEST_NETWORKS.baseSepolia.chainId,
    symbol: TEST_NETWORKS.baseSepolia.symbol,
    blockExplorerUrl: TEST_NETWORKS.baseSepolia.blockExplorer,
  });
});

export { TEST_PASSWORD as PASSWORD, TEST_MNEMONIC as SEED_PHRASE };
