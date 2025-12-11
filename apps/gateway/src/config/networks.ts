import type { Address } from 'viem';
import { ZERO_ADDRESS } from '../lib/contracts.js';

// Network selection: NETWORK env var or default to testnet
export type NetworkId = 'mainnet' | 'testnet' | 'localnet';
export const NETWORK: NetworkId = (process.env.NETWORK as NetworkId) || 'testnet';

export const CHAIN_IDS = {
  mainnet: 420691,
  testnet: 420690,
  localnet: 1337,
} as const;

export const JEJU_CHAIN_ID = CHAIN_IDS[NETWORK];
export const IS_TESTNET = NETWORK === 'testnet' || NETWORK === 'localnet';

// Public RPC endpoints (defaults, can be overridden with *_RPC_URL env vars)
export const RPC_URLS = {
  // Jeju
  420691: process.env.JEJU_RPC_URL || 'https://rpc.jeju.network',
  420690: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
  1337: process.env.LOCALNET_RPC_URL || 'http://localhost:9545',
  // External chains
  1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  11155111: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
  42161: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  10: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
  8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
} as const;

// Public block explorers
export const EXPLORER_URLS = {
  420691: 'https://explorer.jeju.network',
  420690: 'https://testnet-explorer.jeju.network',
  1337: 'http://localhost:4000',
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  42161: 'https://arbiscan.io',
  10: 'https://optimistic.etherscan.io',
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
} as const;

// Chain metadata
export const CHAINS = {
  420691: { name: 'Jeju', shortName: 'JEJU', isTestnet: false },
  420690: { name: 'Jeju Testnet', shortName: 'JEJU-TEST', isTestnet: true },
  1337: { name: 'Localnet', shortName: 'LOCAL', isTestnet: true },
  1: { name: 'Ethereum', shortName: 'ETH', isTestnet: false },
  11155111: { name: 'Sepolia', shortName: 'SEP', isTestnet: true },
  42161: { name: 'Arbitrum One', shortName: 'ARB', isTestnet: false },
  10: { name: 'Optimism', shortName: 'OP', isTestnet: false },
  8453: { name: 'Base', shortName: 'BASE', isTestnet: false },
  84532: { name: 'Base Sepolia', shortName: 'BASE-SEP', isTestnet: true },
} as const;

// Service URLs (defaults, can be overridden)
export const SERVICES = {
  rpcGateway: process.env.RPC_GATEWAY_URL || 'http://localhost:4004',
  indexer: process.env.INDEXER_URL || 'http://127.0.0.1:4350/graphql',
  ipfsApi: process.env.IPFS_API_URL || 'http://localhost:3100',
  ipfsGateway: process.env.IPFS_GATEWAY_URL || 'http://localhost:3100',
} as const;

// Server ports (defaults)
export const PORTS = {
  a2a: Number(process.env.A2A_PORT) || 4003,
  websocket: Number(process.env.WS_PORT) || 4012,
} as const;

// Helper functions
export function getRpcUrl(chainId: number): string {
  return RPC_URLS[chainId as keyof typeof RPC_URLS] || RPC_URLS[JEJU_CHAIN_ID];
}

export function getExplorerUrl(chainId: number): string {
  return EXPLORER_URLS[chainId as keyof typeof EXPLORER_URLS] || EXPLORER_URLS[JEJU_CHAIN_ID];
}

export function getChainName(chainId: number): string {
  return CHAINS[chainId as keyof typeof CHAINS]?.name || 'Unknown';
}

// Common tokens by chain (public addresses)
export const COMMON_TOKENS: Record<number, Record<string, Address>> = {
  1: { ETH: ZERO_ADDRESS, WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  11155111: { ETH: ZERO_ADDRESS, WETH: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' },
  42161: { ETH: ZERO_ADDRESS, WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  10: { ETH: ZERO_ADDRESS, WETH: '0x4200000000000000000000000000000000000006', USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  420691: { ETH: ZERO_ADDRESS, WETH: '0x4200000000000000000000000000000000000006' },
  420690: { ETH: ZERO_ADDRESS, WETH: '0x4200000000000000000000000000000000000006' },
  1337: { ETH: ZERO_ADDRESS, WETH: '0x4200000000000000000000000000000000000006' },
};
