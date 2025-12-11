import type { Address } from 'viem';

export interface PresaleConfig {
  contractAddress: Address;
  tokenAddress: Address;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  
  // Schedule (Unix timestamps)
  whitelistStart: number;
  publicStart: number;
  presaleEnd: number;
  tgeTimestamp: number;
  
  // CCA (Continuous Clearing Auction) config
  useCCA: boolean;
  ccaContract?: Address;
  auctionDuration?: number;
  floorPrice?: bigint;
}

// Sale type
export type SaleType = 'presale' | 'cca';

export interface SaleInfo {
  type: SaleType;
  name: string;
  description: string;
}

// Mainnet configuration (Jeju L2)
export const MAINNET_CONFIG: PresaleConfig = {
  contractAddress: '0x0000000000000000000000000000000000000000' as Address,
  tokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  chainId: 420691,
  rpcUrl: 'https://rpc.jeju.network',
  blockExplorer: 'https://explorer.jeju.network',
  
  // CCA auction (Q1 2025)
  whitelistStart: 0, // TBD
  publicStart: 0, // TBD - CCA auction start
  presaleEnd: 0, // TBD - CCA auction end (7 days after start)
  tgeTimestamp: 0, // TBD - Immediate after CCA
  
  // CCA enabled for mainnet
  useCCA: true,
  ccaContract: '0x0000000000000000000000000000000000000000' as Address,
  auctionDuration: 7 * 24 * 60 * 60, // 7 days
  floorPrice: 1n * 10n ** 12n, // 0.000001 ETH minimum
};

// Testnet configuration (Jeju Testnet)
export const TESTNET_CONFIG: PresaleConfig = {
  contractAddress: '0x0000000000000000000000000000000000000000' as Address,
  tokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  chainId: 420690,
  rpcUrl: 'https://testnet-rpc.jeju.network',
  blockExplorer: 'https://testnet.jeju.network',
  
  // Demo dates (update when deploying)
  whitelistStart: Math.floor(Date.now() / 1000) + 60,
  publicStart: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  presaleEnd: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
  tgeTimestamp: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
  
  // Standard presale for testnet
  useCCA: false,
};

// Localnet configuration
export const LOCALNET_CONFIG: PresaleConfig = {
  contractAddress: '0x0000000000000000000000000000000000000000' as Address,
  tokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  chainId: 1337,
  rpcUrl: 'http://127.0.0.1:9545',
  blockExplorer: '',
  
  // Local demo dates
  whitelistStart: Math.floor(Date.now() / 1000) + 60,
  publicStart: Math.floor(Date.now() / 1000) + 300,
  presaleEnd: Math.floor(Date.now() / 1000) + 600,
  tgeTimestamp: Math.floor(Date.now() / 1000) + 600,
  
  useCCA: false,
};

// Get config based on environment
export function getPresaleConfig(): PresaleConfig {
  const network = process.env.NEXT_PUBLIC_NETWORK || 'testnet';
  
  switch (network) {
    case 'mainnet':
      return MAINNET_CONFIG;
    case 'localnet':
      return LOCALNET_CONFIG;
    default:
      return TESTNET_CONFIG;
  }
}

// Get sale info
export function getSaleInfo(): SaleInfo {
  const config = getPresaleConfig();
  
  if (config.useCCA) {
    return {
      type: 'cca',
      name: 'Uniswap CCA Auction',
      description: 'Market-driven price discovery via Continuous Clearing Auction',
    };
  }
  
  return {
    type: 'presale',
    name: 'Token Presale',
    description: 'Fixed-price presale with whitelist and public phases',
  };
}

// ABI for the presale contract
export const PRESALE_ABI = [
  {
    name: 'contribute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'refund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'currentPhase',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'getPresaleStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'raised', type: 'uint256' },
      { name: 'participants', type: 'uint256' },
      { name: 'tokensSold', type: 'uint256' },
      { name: 'softCap', type: 'uint256' },
      { name: 'hardCap', type: 'uint256' },
      { name: 'phase', type: 'uint8' },
    ],
  },
  {
    name: 'getContribution',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'ethAmount', type: 'uint256' },
      { name: 'tokenAllocation', type: 'uint256' },
      { name: 'bonusTokens', type: 'uint256' },
      { name: 'claimedTokens', type: 'uint256' },
      { name: 'claimable', type: 'uint256' },
      { name: 'refunded', type: 'bool' },
    ],
  },
  {
    name: 'getTimeInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'whitelistStart', type: 'uint256' },
      { name: 'publicStart', type: 'uint256' },
      { name: 'presaleEnd', type: 'uint256' },
      { name: 'tgeTimestamp', type: 'uint256' },
      { name: 'currentTime', type: 'uint256' },
    ],
  },
  {
    name: 'whitelist',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'config',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'softCap', type: 'uint256' },
      { name: 'hardCap', type: 'uint256' },
      { name: 'minContribution', type: 'uint256' },
      { name: 'maxContribution', type: 'uint256' },
      { name: 'tokenPrice', type: 'uint256' },
      { name: 'whitelistStart', type: 'uint256' },
      { name: 'publicStart', type: 'uint256' },
      { name: 'presaleEnd', type: 'uint256' },
      { name: 'tgeTimestamp', type: 'uint256' },
    ],
  },
] as const;
