/**
 * @jejunetwork/shared browser stub
 * 
 * Provides browser-safe stubs and re-exports for shared utilities.
 */

import { type Address, formatEther, parseEther } from 'viem'

// Environment utilities
export function getEnv(key: string, defaultValue?: string): string {
  if (typeof window !== 'undefined') {
    // Try window.__ENV__ first (injected by server)
    const windowEnv = (window as Record<string, Record<string, string>>).__ENV__
    if (windowEnv && key in windowEnv) {
      return windowEnv[key]
    }
  }
  return defaultValue ?? ''
}

export function getEnvVar(key: string, defaultValue?: string): string {
  return getEnv(key, defaultValue)
}

// Cache client stub
export interface CacheClient {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, ttl?: number) => Promise<void>
  delete: (key: string) => Promise<void>
}

export function getCacheClient(): CacheClient {
  // Use localStorage as a simple browser cache
  return {
    get: async (key: string) => localStorage.getItem(key),
    set: async (key: string, value: string) => localStorage.setItem(key, value),
    delete: async (key: string) => localStorage.removeItem(key),
  }
}

// Storage types
export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'

// =============================================================================
// EIL (Economic Interoperability Layer) - Browser Safe
// =============================================================================

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

export function getChainById(chainId: number): ChainInfo | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId)
}

export function isCrossChainSwap(
  sourceChainId: number,
  destChainId: number,
): boolean {
  return sourceChainId !== destChainId
}

export function calculateSwapFee(
  amount: bigint,
  sourceChainId: number,
  destinationChainId: number,
): { networkFee: bigint; xlpFee: bigint; totalFee: bigint } {
  const networkFee = parseEther('0.001')
  const xlpFee = (amount * 5n) / 10000n
  const crossChainPremium =
    sourceChainId !== destinationChainId ? parseEther('0.0005') : 0n

  return {
    networkFee: networkFee + crossChainPremium,
    xlpFee,
    totalFee: networkFee + crossChainPremium + xlpFee,
  }
}

export function estimateSwapTime(
  sourceChainId: number,
  destinationChainId: number,
): number {
  if (sourceChainId === destinationChainId) return 0
  const l1Chains = [1]
  const isL1ToL2 = l1Chains.includes(sourceChainId)
  const isL2ToL1 = l1Chains.includes(destinationChainId)
  if (isL1ToL2) return 15
  if (isL2ToL1) return 600
  return 10
}

export function formatSwapRoute(
  sourceChain: ChainInfo,
  destChain: ChainInfo,
): string {
  return `${sourceChain.icon} ${sourceChain.name} → ${destChain.icon} ${destChain.name}`
}
