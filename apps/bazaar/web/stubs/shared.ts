// Browser stub for @jejunetwork/shared
// Provides minimal browser-safe exports

import type { Address } from 'viem'

export function createLogger(name: string) {
  return {
    info: (...args: unknown[]) => console.info(`[${name}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${name}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${name}]`, ...args),
    debug: (...args: unknown[]) => console.debug(`[${name}]`, ...args),
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

// Environment utilities
export function getEnv(key: string, defaultValue?: string): string {
  if (typeof window !== 'undefined') {
    const config = (window as { __JEJU_CONFIG__?: Record<string, string> })
      .__JEJU_CONFIG__
    if (config && key in config) {
      return config[key]
    }
  }
  return defaultValue ?? ''
}

// Cache stub (not available in browser)
export interface CacheClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl?: number): Promise<void>
  del(key: string): Promise<void>
}

export function getCacheClient(): CacheClient {
  return {
    async get(key: string) {
      return localStorage.getItem(key)
    },
    async set(key: string, value: string, _ttl?: number) {
      localStorage.setItem(key, value)
    },
    async del(key: string) {
      localStorage.removeItem(key)
    },
  }
}

// Storage tier type
export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'

// ============================================================================
// EIL (Economic Interoperability Layer) Exports
// ============================================================================

export interface ChainInfo {
  id: number
  name: string
  icon: string
  rpcUrl: string
  paymasterAddress?: Address
  crossChainPaymaster?: Address
  isSource: boolean
  isDestination: boolean
}

export interface CrossChainSwapParams {
  sourceToken: Address
  destinationToken: Address
  amount: bigint
  sourceChainId: number
  destinationChainId: number
  minAmountOut?: bigint
  recipient?: Address
}

export type SwapStatus =
  | 'idle'
  | 'approving'
  | 'creating'
  | 'waiting'
  | 'complete'
  | 'error'

export const SUPPORTED_CHAINS: ChainInfo[] = [
  {
    id: 420691,
    name: 'Network',
    icon: '🏝️',
    rpcUrl: 'https://rpc.jejunetwork.org',
    isSource: true,
    isDestination: true,
  },
  {
    id: 420690,
    name: 'Testnet',
    icon: '🏝️',
    rpcUrl: 'https://testnet-rpc.jejunetwork.org',
    isSource: true,
    isDestination: true,
  },
  {
    id: 42161,
    name: 'Arbitrum',
    icon: '🔵',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    isSource: true,
    isDestination: true,
  },
  {
    id: 10,
    name: 'Optimism',
    icon: '🔴',
    rpcUrl: 'https://mainnet.optimism.io',
    isSource: true,
    isDestination: true,
  },
  {
    id: 1,
    name: 'Ethereum',
    icon: '💎',
    rpcUrl: 'https://eth.llamarpc.com',
    isSource: true,
    isDestination: true,
  },
  {
    id: 11155111,
    name: 'Sepolia',
    icon: '🧪',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    isSource: true,
    isDestination: true,
  },
]

export const CROSS_CHAIN_PAYMASTER_ABI = [
  {
    type: 'function',
    name: 'createVoucherRequest',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'gasOnDestination', type: 'uint256' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'feeIncrement', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getCurrentFee',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'supportedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTotalLiquidity',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const
