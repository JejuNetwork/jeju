import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

export const basicSetup = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SEED_PHRASE);
  
  await metamask.addNetwork({
    networkName: 'Jeju Testnet',
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:9545',
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 420690,
    symbol: 'ETH',
  });
});

basicSetup.walletPassword = PASSWORD;
basicSetup.seedPhrase = SEED_PHRASE;

export default basicSetup;
