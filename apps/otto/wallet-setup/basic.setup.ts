/**
 * Synpress Wallet Setup
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Test wallet - DO NOT use with real funds
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  
  // Import the test wallet
  await metamask.importWallet(SEED_PHRASE);
  
  // Add Jeju Network
  await metamask.addNetwork({
    name: 'Jeju Network',
    rpcUrl: process.env.JEJU_RPC_URL ?? 'http://localhost:8545',
    chainId: 420691,
    symbol: 'JEJU',
  });
});

