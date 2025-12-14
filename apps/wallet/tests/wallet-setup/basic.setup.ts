/**
 * Basic Wallet Setup for Synpress
 * 
 * Sets up a MetaMask wallet with test networks for E2E testing.
 */

import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Test seed phrase - NEVER use in production
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'TestPassword123_';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  
  // Import the test wallet
  await metamask.importWallet(SEED_PHRASE);
  
  // Add Base network (Jeju's primary chain)
  await metamask.addNetwork({
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    chainId: 8453,
    symbol: 'ETH',
    blockExplorerUrl: 'https://basescan.org',
  });
  
  // Add Base Sepolia testnet
  await metamask.addNetwork({
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    chainId: 84532,
    symbol: 'ETH',
    blockExplorerUrl: 'https://sepolia.basescan.org',
  });
  
  // Add Arbitrum
  await metamask.addNetwork({
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
    symbol: 'ETH',
    blockExplorerUrl: 'https://arbiscan.io',
  });
  
  // Add Optimism
  await metamask.addNetwork({
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    chainId: 10,
    symbol: 'ETH',
    blockExplorerUrl: 'https://optimistic.etherscan.io',
  });

  // Add localhost for local testing (anvil on 8545)
  await metamask.addNetwork({
    name: 'Localhost',
    rpcUrl: 'http://127.0.0.1:8545',
    chainId: 31337,
    symbol: 'ETH',
    blockExplorerUrl: '',
  });

  // Add Jeju Localnet (anvil on 9545)
  await metamask.addNetwork({
    name: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:9545',
    chainId: 1337,
    symbol: 'ETH',
    blockExplorerUrl: '',
  });
});

export { PASSWORD, SEED_PHRASE };
