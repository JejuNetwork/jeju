import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'SynpressIsAwesome123!';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  // This is called when MetaMask is being set up before any tests
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  await metamask.importWallet(SEED_PHRASE);

  // Wait for wallet to be ready
  await walletPage.waitForTimeout(2000);
});
