/**
 * Synpress Wallet Setup for Otto E2E Tests
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Test seed phrase (DO NOT use in production)
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  // Import wallet
  await metamask.importWallet(SEED_PHRASE);

  // Add Jeju Network
  await metamask.addNetwork({
    name: 'Jeju Network',
    rpcUrl: 'http://localhost:8545',
    chainId: 420691,
    symbol: 'JEJU',
    blockExplorer: 'http://localhost:4000',
  });

  // Switch to Jeju Network
  await metamask.switchNetwork('Jeju Network');
});

export { SEED_PHRASE, PASSWORD };

