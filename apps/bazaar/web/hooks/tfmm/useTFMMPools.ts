import { useState } from 'react'
import { type Address, formatUnits } from 'viem'
import { useAccount, useReadContract } from 'wagmi'

// TFMM Pool ABI (subset for UI)
const TFMM_POOL_ABI = [
  {
    name: 'getPoolState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'balances', type: 'uint256[]' },
      { name: 'weights', type: 'uint256[]' },
      { name: 'swapFee', type: 'uint256' },
      { name: 'totalSupply', type: 'uint256' },
    ],
  },
  {
    name: 'getSpotPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
    ],
    outputs: [{ name: 'price', type: 'uint256' }],
  },
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountsIn', type: 'uint256[]' },
      { name: 'minLpOut', type: 'uint256' },
    ],
    outputs: [{ name: 'lpAmount', type: 'uint256' }],
  },
  {
    name: 'removeLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'lpAmount', type: 'uint256' },
      { name: 'minAmountsOut', type: 'uint256[]' },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
  },
  {
    name: 'swap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const

export interface TFMMPoolState {
  tokens: Address[]
  balances: bigint[]
  weights: bigint[]
  swapFee: bigint
  totalSupply: bigint
}

export interface TFMMPoolMetrics {
  tvlUsd: number
  apyPercent: number
  volume24hUsd: number
}

export interface TFMMPool {
  address: Address
  name: string
  strategy: string
  /** Formatted TVL string for display (e.g., "$1.2M") */
  tvl: string
  /** Formatted APY string for display (e.g., "12.5%") */
  apy: string
  /** Formatted 24h volume string for display (e.g., "$450K") */
  volume24h: string
  /** Raw numeric metrics for sorting/calculations */
  metrics: TFMMPoolMetrics
  state: TFMMPoolState | null
  userBalance: bigint
}

// Pool registry ABI for fetching pools from on-chain registry
const _POOL_REGISTRY_ABI = [
  {
    name: 'getAllPools',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'pools', type: 'address[]' }],
  },
  {
    name: 'getPoolInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'strategy', type: 'string' },
      { name: 'tvlUsd', type: 'uint256' },
      { name: 'apyBps', type: 'uint256' },
      { name: 'volume24hUsd', type: 'uint256' },
    ],
  },
] as const

export function useTFMMPools() {
  useAccount()
  const [selectedPool, setSelectedPool] = useState<Address | null>(null)
  const [pools, _setPools] = useState<TFMMPool[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // TODO: Replace with actual pool registry address from config when deployed
  // For now, return empty array - pools will be populated when TFMM contracts are deployed

  // Simulating async load for proper loading state
  useState(() => {
    setIsLoading(false)
  })

  return {
    pools,
    selectedPool,
    setSelectedPool,
    isLoading,
  }
}

export function useTFMMPoolState(poolAddress: Address | null) {
  const { data, isLoading, refetch } = useReadContract({
    address: poolAddress ?? undefined,
    abi: TFMM_POOL_ABI,
    functionName: 'getPoolState',
    query: {
      enabled: !!poolAddress,
    },
  })

  const poolState: TFMMPoolState | null = data
    ? {
        tokens: [...data[0]],
        balances: [...data[1]],
        weights: [...data[2]],
        swapFee: data[3],
        totalSupply: data[4],
      }
    : null

  return {
    poolState,
    isLoading,
    refetch,
  }
}

export function useTFMMUserBalance(poolAddress: Address | null) {
  const { address: userAddress } = useAccount()

  const { data: balance, isLoading } = useReadContract({
    address: poolAddress ?? undefined,
    abi: TFMM_POOL_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!poolAddress && !!userAddress,
    },
  })

  return {
    balance: balance ?? 0n,
    isLoading,
  }
}

export function formatWeight(weight: bigint): string {
  // Weights are in 18 decimals, display as percentage
  return `${(Number(formatUnits(weight, 18)) * 100).toFixed(1)}%`
}
