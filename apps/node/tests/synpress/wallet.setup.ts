import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Test seed phrase - DO NOT use in production
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'TestPassword123!';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  
  // Import wallet using seed phrase
  await metamask.importWallet(SEED_PHRASE);
  
  // Add networks
  await metamask.addNetwork({
    name: 'Testnet',
    rpcUrl: 'https://testnet-rpc.jeju.network',
    chainId: 420691,
    symbol: 'JEJU',
    blockExplorerUrl: 'https://testnet-explorer.jeju.network',
  });
  
  await metamask.addNetwork({
    name: 'Jeju Localnet',
    rpcUrl: 'http://localhost:8545',
    chainId: 1337,
    symbol: 'ETH',
    blockExplorerUrl: 'http://localhost:4000',
  });
});

