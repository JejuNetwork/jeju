/**
 * Basic wallet setup for Synpress tests
 * Follows official Synpress pattern
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  // Import wallet using seed phrase
  await metamask.importWallet(SEED_PHRASE);

  // Add Jeju Localnet
  await metamask.addNetwork({
    networkName: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:9545',
    chainId: 1337,
    symbol: 'ETH',
  });

  // Switch to Jeju network
  await metamask.switchNetwork('Jeju Localnet');
});

