/**
 * Protocol Token configuration and utilities
 * 
 * ONLY includes tokens with deployed paymasters.
 * These are the tokens users can:
 * - Bridge from Base to Jeju
 * - Use to pay for gas
 * - Earn as LP rewards by providing ETH
 */

import type { TokenOption } from '../components/TokenSelector';

export interface ProtocolToken extends TokenOption {
  hasPaymaster: boolean;
  bridged: boolean;
  originChain: string;
  baseAddress?: string;
  vaultAddress?: string;
  distributorAddress?: string;
  paymasterAddress?: string;
}

/**
 * Get all protocol tokens (tokens with paymasters only)
 * 
 * This is the curated list of tokens that:
 * - Have deployed paymaster infrastructure
 * - Can be used for gas payments
 * - Reward ETH LPs with token fees
 */
export function getAllTokens(): TokenOption[] {
  return getProtocolTokens().map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));
}

/**
 * Get full protocol token configs (with paymaster addresses)
 */
export function getProtocolTokens(): ProtocolToken[] {
  const allTokens = [
    {
      symbol: 'elizaOS',
      name: 'elizaOS Token',
      address: import.meta.env.VITE_ELIZAOS_TOKEN_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      decimals: 18,
      priceUSD: 0.10,
      logoUrl: 'https://assets.jeju.network/eliza-logo.png',
      hasPaymaster: true,
      bridged: false,
      originChain: 'jeju',
      vaultAddress: import.meta.env.VITE_ELIZAOS_VAULT_ADDRESS,
      paymasterAddress: import.meta.env.VITE_ELIZAOS_PAYMASTER_ADDRESS,
    },
    {
      symbol: 'CLANKER',
      name: 'tokenbot',
      address: import.meta.env.VITE_CLANKER_TOKEN_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      decimals: 18,
      priceUSD: 26.14,
      logoUrl: 'https://assets.coinmarketcap.com/clanker-logo.png',
      hasPaymaster: true,
      bridged: true,
      originChain: 'base',
      baseAddress: '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb',
      vaultAddress: import.meta.env.VITE_CLANKER_VAULT_ADDRESS,
      paymasterAddress: import.meta.env.VITE_CLANKER_PAYMASTER_ADDRESS,
    },
    {
      symbol: 'VIRTUAL',
      name: 'Virtuals Protocol',
      address: import.meta.env.VITE_VIRTUAL_TOKEN_ADDRESS || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
      decimals: 18,
      priceUSD: 1.85,
      logoUrl: 'https://assets.virtuals.io/logo.png',
      hasPaymaster: true,
      bridged: true,
      originChain: 'base',
      baseAddress: '0x44ff8620b8cA30902395A7bD3F2407e1A091BF73',
      vaultAddress: import.meta.env.VITE_VIRTUAL_VAULT_ADDRESS,
      paymasterAddress: import.meta.env.VITE_VIRTUAL_PAYMASTER_ADDRESS,
    },
    {
      symbol: 'CLANKERMON',
      name: 'Clankermon',
      address: import.meta.env.VITE_CLANKERMON_TOKEN_ADDRESS || '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
      decimals: 18,
      priceUSD: 0.15,
      logoUrl: 'https://assets.clankermon.xyz/logo.png',
      hasPaymaster: true,
      bridged: true,
      originChain: 'base',
      baseAddress: '0x1cDbB57b12f732cFb4DC06f690ACeF476485B2a5',
      vaultAddress: import.meta.env.VITE_CLANKERMON_VAULT_ADDRESS,
      paymasterAddress: import.meta.env.VITE_CLANKERMON_PAYMASTER_ADDRESS,
    },
  ];
  
  // Filter out tokens with zero addresses only in production
  // In test environment, keep all tokens for testing
  const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  if (isTest) {
    return allTokens;
  }
  
  return allTokens.filter(t => t.address !== '0x0000000000000000000000000000000000000000');
}

export function getTokenBySymbol(symbol: string): TokenOption | undefined {
  return getAllTokens().find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function getTokenByAddress(address: string): TokenOption | undefined {
  return getAllTokens().find(t => t.address.toLowerCase() === address.toLowerCase());
}

