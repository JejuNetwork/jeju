/**
 * Basic Wallet Setup for Synpress Tests
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Test wallet - DO NOT USE IN PRODUCTION
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  
  // Import test wallet
  await metamask.importWallet(SEED_PHRASE);
  
  // Add localhost network for local development
  // Note: MetaMask usually has localhost already configured
});

export const walletPassword = PASSWORD;
