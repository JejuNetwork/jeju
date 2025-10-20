/**
 * Synpress Configuration for Predimarket Wallet Testing
 * 
 * Uses Synpress (@synthetixio/synpress) instead of Dappwright
 * for more reliable and faster MetaMask testing
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'TestPassword123!';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  // Import wallet with seed phrase
  await metamask.importWallet(SEED_PHRASE);

  // Add Jeju Local network
  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: 'http://localhost:9545',
    chainId: 1337,
    symbol: 'ETH',
  });

  // Switch to Jeju network
  await metamask.switchNetwork('Jeju Local');
});

