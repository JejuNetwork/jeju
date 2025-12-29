import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getExternalRpc,
  getRpcUrl as getJejuRpcUrl,
  getL2RpcUrl,
  getExplorerUrl as getLocalnetExplorerUrl,
  getServiceUrl,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Network selection: NETWORK env var or config default
export type NetworkId = 'mainnet' | 'testnet' | 'localnet'
export const NETWORK: NetworkId = getCurrentNetwork()

export const CHAIN_IDS = {
  mainnet: 420691,
  testnet: 420690,
  localnet: 31337,
} as const

export const JEJU_CHAIN_ID = CHAIN_IDS[NETWORK]
export const IS_TESTNET = NETWORK === 'testnet' || NETWORK === 'localnet'

// Public RPC endpoints (from config package)
export const RPC_URLS = {
  // Network
  420691: getJejuRpcUrl(),
  420690:
    (typeof process !== 'undefined'
      ? process.env.JEJU_TESTNET_RPC_URL
      : undefined) || 'https://testnet-rpc.jejunetwork.org',
  31337: getL2RpcUrl(),
  // Mainnets
  1: getExternalRpc('ethereum'),
  42161: getExternalRpc('arbitrum'),
  10: getExternalRpc('optimism'),
  8453: getExternalRpc('base'),
  // Testnets
  11155111: getExternalRpc('sepolia'),
  84532: getExternalRpc('base-sepolia'),
  11155420:
    (typeof process !== 'undefined'
      ? process.env.OPTIMISM_SEPOLIA_RPC_URL
      : undefined) || 'https://sepolia.optimism.io',
  421614:
    (typeof process !== 'undefined'
      ? process.env.ARBITRUM_SEPOLIA_RPC_URL
      : undefined) || 'https://sepolia-rollup.arbitrum.io/rpc',
} as const

// Public block explorers
export const EXPLORER_URLS = {
  420691: 'https://explorer.jejunetwork.org',
  420690: 'https://testnet-explorer.jejunetwork.org',
  31337: getLocalnetExplorerUrl(),
  1: 'https://etherscan.io',
  42161: 'https://arbiscan.io',
  10: 'https://optimistic.etherscan.io',
  8453: 'https://basescan.org',
  11155111: 'https://sepolia.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  11155420: 'https://sepolia-optimism.etherscan.io',
  421614: 'https://sepolia.arbiscan.io',
} as const

// Chain metadata
export const CHAINS = {
  420691: { name: 'Network', shortName: 'JEJU', isTestnet: false },
  420690: { name: 'Testnet', shortName: 'JEJU-TEST', isTestnet: true },
  31337: { name: 'Localnet', shortName: 'LOCAL', isTestnet: true },
  1: { name: 'Ethereum', shortName: 'ETH', isTestnet: false },
  42161: { name: 'Arbitrum One', shortName: 'ARB', isTestnet: false },
  10: { name: 'Optimism', shortName: 'OP', isTestnet: false },
  8453: { name: 'Base', shortName: 'BASE', isTestnet: false },
  11155111: { name: 'Sepolia', shortName: 'SEP', isTestnet: true },
  84532: { name: 'Base Sepolia', shortName: 'BASE-SEP', isTestnet: true },
  11155420: { name: 'Optimism Sepolia', shortName: 'OP-SEP', isTestnet: true },
  421614: { name: 'Arbitrum Sepolia', shortName: 'ARB-SEP', isTestnet: true },
} as const

// Service URLs (using centralized port config)
export const SERVICES = {
  rpcGateway: getCoreAppUrl('RPC_GATEWAY'),
  indexer:
    (typeof process !== 'undefined' ? process.env.INDEXER_URL : undefined) ||
    getServiceUrl('indexer', 'graphql', getCurrentNetwork()),
  ipfsApi: getCoreAppUrl('IPFS'),
  ipfsGateway: getCoreAppUrl('IPFS'),
} as const

// Server ports (using centralized port config)
export const PORTS = {
  a2a: CORE_PORTS.GATEWAY.get(),
  websocket:
    (typeof process !== 'undefined' && process.env.WS_PORT
      ? Number(process.env.WS_PORT)
      : undefined) || CORE_PORTS.RPC_GATEWAY.DEFAULT,
  rpc: CORE_PORTS.RPC_GATEWAY.get(),
} as const

// Helper functions
export function getRpcUrl(chainId: number): string {
  return RPC_URLS[chainId as keyof typeof RPC_URLS] || RPC_URLS[JEJU_CHAIN_ID]
}

export function getExplorerUrl(chainId: number): string {
  return (
    EXPLORER_URLS[chainId as keyof typeof EXPLORER_URLS] ||
    EXPLORER_URLS[JEJU_CHAIN_ID]
  )
}

export function getChainName(chainId: number): string {
  return CHAINS[chainId as keyof typeof CHAINS].name ?? 'Unknown'
}

// Common tokens by chain (public addresses)
export const COMMON_TOKENS: Record<number, Record<string, Address>> = {
  1: {
    ETH: ZERO_ADDRESS,
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  11155111: {
    ETH: ZERO_ADDRESS,
    WETH: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
  },
  42161: {
    ETH: ZERO_ADDRESS,
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  10: {
    ETH: ZERO_ADDRESS,
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  420691: {
    ETH: ZERO_ADDRESS,
    WETH: '0x4200000000000000000000000000000000000006',
  },
  420690: {
    ETH: ZERO_ADDRESS,
    WETH: '0x4200000000000000000000000000000000000006',
  },
  31337: {
    ETH: ZERO_ADDRESS,
    WETH: '0x4200000000000000000000000000000000000006',
  },
}
