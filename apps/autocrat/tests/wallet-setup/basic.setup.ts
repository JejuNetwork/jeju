/**
 * @fileoverview Wallet setup for Synpress tests
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Anvil's first account seed phrase
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  // Import wallet using anvil's seed phrase
  await metamask.importWallet(SEED_PHRASE);

  // Add localnet network
  await metamask.addNetwork({
    name: 'Localnet',
    rpcUrl: 'http://localhost:8545',
    chainId: 1337,
    symbol: 'ETH',
  });
});

export { SEED_PHRASE, PASSWORD };
