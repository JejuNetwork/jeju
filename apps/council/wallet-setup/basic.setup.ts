import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SEED_PHRASE);
  
  // Add Jeju network
  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: 'http://localhost:9545',
    chainId: 420691,
    symbol: 'ETH',
  });
});
