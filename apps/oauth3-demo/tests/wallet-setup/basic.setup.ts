import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

export const PASSWORD = 'Tester@1234';
export const SEED_PHRASE = 'test test test test test test test test test test test junk';

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '420691');
const RPC_URL = process.env.JEJU_RPC_URL || 'http://localhost:9545';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  await metamask.importWallet(SEED_PHRASE);

  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    symbol: 'ETH',
  });

  await metamask.switchNetwork('Jeju Local');
});
