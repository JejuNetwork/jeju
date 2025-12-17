/**
 * Basic Wallet Setup for Synpress Tests
 * Uses a test seed phrase for automated testing
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Standard test seed phrase - DO NOT USE IN PRODUCTION
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  
  // Import the wallet using the seed phrase
  await metamask.importWallet(SEED_PHRASE);
  
  // Add Jeju localnet network
  await metamask.addNetwork({
    name: 'Jeju Localnet',
    rpcUrl: 'http://localhost:8545',
    chainId: 31337,
    symbol: 'ETH',
  });
});

// Export wallet password for tests
export const walletPassword = PASSWORD;


