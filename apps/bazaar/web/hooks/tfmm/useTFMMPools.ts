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

// Default pools for development (will be replaced by on-chain registry)
const DEFAULT_POOLS: Omit<TFMMPool, 'state' | 'userBalance'>[] = [
  {
    address: '0x0000000000000000000000000000000000000001' as Address,
    name: 'ETH-USDC Momentum',
    strategy: 'momentum',
    tvl: '$1.2M',
    apy: '12.5%',
    volume24h: '$450K',
    metrics: { tvlUsd: 1_200_000, apyPercent: 12.5, volume24hUsd: 450_000 },
  },
  {
    address: '0x0000000000000000000000000000000000000002' as Address,
    name: 'BTC-ETH Mean Reversion',
    strategy: 'mean-reversion',
    tvl: '$890K',
    apy: '8.3%',
    volume24h: '$320K',
    metrics: { tvlUsd: 890_000, apyPercent: 8.3, volume24hUsd: 320_000 },
  },
  {
    address: '0x0000000000000000000000000000000000000003' as Address,
    name: 'Volatility Harvest',
    strategy: 'volatility',
    tvl: '$2.1M',
    apy: '15.2%',
    volume24h: '$780K',
    metrics: { tvlUsd: 2_100_000, apyPercent: 15.2, volume24hUsd: 780_000 },
  },
]

export function useTFMMPools() {
  useAccount()
  const [selectedPool, setSelectedPool] = useState<Address | null>(null)

  // In production, this would query a registry contract
  const pools: TFMMPool[] = DEFAULT_POOLS.map((pool) => ({
    ...pool,
    state: null,
    userBalance: 0n,
  }))

  return {
    pools,
    selectedPool,
    setSelectedPool,
    isLoading: false,
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
