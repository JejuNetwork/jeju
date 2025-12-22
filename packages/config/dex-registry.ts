/**
 * DEX Registry Configuration
 * 
 * Defines all DEX factory/router addresses across supported chains.
 * Used by indexer for pool discovery and by price aggregator for quotes.
 * 
 * No external APIs - all data comes from on-chain reads via our RPC nodes.
 */

import type { Address } from 'viem';

export type DEXType = 'uniswap_v2' | 'uniswap_v3' | 'balancer_v2' | 'curve' | 'aerodrome' | 'camelot';

export interface DEXConfig {
  name: string;
  type: DEXType;
  chainId: number;
  factory: Address;
  router?: Address;
  quoter?: Address;
  positionManager?: Address;
  initCodeHash?: string;
  defaultFee?: number;
}

export interface PoolCreatedEvent {
  signature: string;
  tokenIndexes: [number, number];
  poolIndex: number;
}

export interface SwapEvent {
  signature: string;
  amountIndexes: {
    amount0In?: number;
    amount1In?: number;
    amount0Out?: number;
    amount1Out?: number;
    amount0?: number;
    amount1?: number;
  };
}

export interface DEXEventConfig {
  poolCreated: PoolCreatedEvent;
  swap: SwapEvent;
  sync?: string;
  mint?: string;
  burn?: string;
}

// Event signatures for DEX event processing
export const DEX_EVENTS: Record<DEXType, DEXEventConfig> = {
  uniswap_v2: {
    poolCreated: {
      signature: 'PairCreated(address,address,address,uint256)',
      tokenIndexes: [0, 1],
      poolIndex: 2,
    },
    swap: {
      signature: 'Swap(address,uint256,uint256,uint256,uint256,address)',
      amountIndexes: { amount0In: 1, amount1In: 2, amount0Out: 3, amount1Out: 4 },
    },
    sync: 'Sync(uint112,uint112)',
    mint: 'Mint(address,uint256,uint256)',
    burn: 'Burn(address,uint256,uint256,address)',
  },
  uniswap_v3: {
    poolCreated: {
      signature: 'PoolCreated(address,address,uint24,int24,address)',
      tokenIndexes: [0, 1],
      poolIndex: 4,
    },
    swap: {
      signature: 'Swap(address,address,int256,int256,uint160,uint128,int24)',
      amountIndexes: { amount0: 2, amount1: 3 },
    },
    mint: 'Mint(address,address,int24,int24,uint128,uint256,uint256)',
    burn: 'Burn(address,int24,int24,uint128,uint256,uint256)',
  },
  balancer_v2: {
    poolCreated: {
      signature: 'PoolRegistered(bytes32,address,uint8)',
      tokenIndexes: [0, 0], // Balancer uses pool ID
      poolIndex: 1,
    },
    swap: {
      signature: 'Swap(bytes32,address,address,uint256,uint256)',
      amountIndexes: { amount0: 3, amount1: 4 },
    },
  },
  curve: {
    poolCreated: {
      signature: 'PlainPoolDeployed(address[4],uint256,uint256,address)',
      tokenIndexes: [0, 0],
      poolIndex: 3,
    },
    swap: {
      signature: 'TokenExchange(address,int128,uint256,int128,uint256)',
      amountIndexes: { amount0: 2, amount1: 4 },
    },
  },
  aerodrome: {
    poolCreated: {
      signature: 'PoolCreated(address,address,bool,address,uint256)',
      tokenIndexes: [0, 1],
      poolIndex: 3,
    },
    swap: {
      signature: 'Swap(address,uint256,uint256,uint256,uint256,address)',
      amountIndexes: { amount0In: 1, amount1In: 2, amount0Out: 3, amount1Out: 4 },
    },
    sync: 'Sync(uint256,uint256)',
  },
  camelot: {
    poolCreated: {
      signature: 'PairCreated(address,address,address,uint256)',
      tokenIndexes: [0, 1],
      poolIndex: 2,
    },
    swap: {
      signature: 'Swap(address,uint256,uint256,uint256,uint256,address)',
      amountIndexes: { amount0In: 1, amount1In: 2, amount0Out: 3, amount1Out: 4 },
    },
    sync: 'Sync(uint112,uint112)',
  },
};

// DEX configurations per chain
export const DEX_REGISTRY: Record<number, DEXConfig[]> = {
  // Ethereum Mainnet
  1: [
    {
      name: 'Uniswap V2',
      type: 'uniswap_v2',
      chainId: 1,
      factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      initCodeHash: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
    },
    {
      name: 'Uniswap V3',
      type: 'uniswap_v3',
      chainId: 1,
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    },
    {
      name: 'Sushiswap',
      type: 'uniswap_v2',
      chainId: 1,
      factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
      router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      initCodeHash: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
    },
    {
      name: 'Balancer V2',
      type: 'balancer_v2',
      chainId: 1,
      factory: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Vault is the main entry point
    },
  ],

  // Arbitrum One
  42161: [
    {
      name: 'Uniswap V3',
      type: 'uniswap_v3',
      chainId: 42161,
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    },
    {
      name: 'Camelot',
      type: 'camelot',
      chainId: 42161,
      factory: '0x6EcCab422D763aC031210895C81787E87B43A652',
      router: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    },
    {
      name: 'Sushiswap V2',
      type: 'uniswap_v2',
      chainId: 42161,
      factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
      router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    },
    {
      name: 'Balancer V2',
      type: 'balancer_v2',
      chainId: 42161,
      factory: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
  ],

  // Base
  8453: [
    {
      name: 'Uniswap V3',
      type: 'uniswap_v3',
      chainId: 8453,
      factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
      quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
      positionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
    },
    {
      name: 'Aerodrome',
      type: 'aerodrome',
      chainId: 8453,
      factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
      router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    },
    {
      name: 'Balancer V2',
      type: 'balancer_v2',
      chainId: 8453,
      factory: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
  ],

  // Optimism
  10: [
    {
      name: 'Uniswap V3',
      type: 'uniswap_v3',
      chainId: 10,
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    },
    {
      name: 'Velodrome',
      type: 'aerodrome', // Same interface as Aerodrome (fork)
      chainId: 10,
      factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
      router: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858',
    },
    {
      name: 'Balancer V2',
      type: 'balancer_v2',
      chainId: 10,
      factory: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
  ],

  // Jeju Network
  420691: [
    // Add Jeju DEX configurations as they are deployed
  ],

  // Jeju Testnet
  420690: [
    // Add testnet DEX configurations
  ],
};

// Stablecoin addresses per chain for USD price calculation
export const STABLECOINS: Record<number, Address[]> = {
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EesDeAC495271d0F', // DAI
  ],
  42161: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
  ],
  8453: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
  ],
  10: [
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
  ],
};

// Wrapped native token addresses per chain
export const WRAPPED_NATIVE: Record<number, Address> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',     // WETH
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  8453: '0x4200000000000000000000000000000000000006',  // WETH
  10: '0x4200000000000000000000000000000000000006',    // WETH
  420691: '0x4200000000000000000000000000000000000006', // WETH (Jeju)
};

// Price routing tokens (commonly used intermediaries)
export const ROUTING_TOKENS: Record<number, Address[]> = {
  1: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  42161: [
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', // WBTC
  ],
  8453: [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  ],
  10: [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
  ],
};

// Helper functions
export function getDEXsForChain(chainId: number): DEXConfig[] {
  return DEX_REGISTRY[chainId] ?? [];
}

export function getStablecoinsForChain(chainId: number): Address[] {
  return STABLECOINS[chainId] ?? [];
}

export function getWrappedNative(chainId: number): Address | undefined {
  return WRAPPED_NATIVE[chainId];
}

export function isStablecoin(chainId: number, address: Address): boolean {
  const stables = STABLECOINS[chainId];
  if (!stables) return false;
  return stables.some(s => s.toLowerCase() === address.toLowerCase());
}

export function getEventConfig(dexType: DEXType): DEXEventConfig {
  return DEX_EVENTS[dexType];
}

