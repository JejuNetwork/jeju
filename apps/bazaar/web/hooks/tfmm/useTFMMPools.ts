/**
 * TFMM Pools Hook
 *
 * Fetches TFMM pool data from the indexer and provides pool state management.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { type Address, formatUnits } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { CHAIN_ID, INDEXER_URL } from '../../../config'
import { checkIndexerHealth } from '../../../lib/data-client'

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

interface IndexerPoolRaw {
  id: string
  address: string
  name: string
  strategy: string
  tvlUsd: string
  apyPercent: number
  volume24hUsd: string
  swapFee: string
  totalSupply: string
  tokens: Array<{
    address: string
    symbol: string
    balance: string
    weight: string
  }>
}

function formatUSD(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function parseFormattedNumber(s: string): number {
  const clean = s.replace(/[$,%]/g, '')
  if (clean.endsWith('M')) return parseFloat(clean) * 1e6
  if (clean.endsWith('K')) return parseFloat(clean) * 1e3
  return parseFloat(clean) || 0
}

async function fetchPoolsFromIndexer(): Promise<TFMMPool[]> {
  const response = await fetch(INDEXER_URL || '/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetTFMMPools($chainId: Int!) {
          tfmmPools(
            where: { chainId_eq: $chainId }
            orderBy: tvlUsd_DESC
            limit: 50
          ) {
            id
            address
            name
            strategy
            tvlUsd
            apyPercent
            volume24hUsd
            swapFee
            totalSupply
            tokens {
              address
              symbol
              balance
              weight
            }
          }
        }
      `,
      variables: { chainId: CHAIN_ID },
    }),
  })

  const json = (await response.json()) as {
    data?: { tfmmPools: IndexerPoolRaw[] }
    errors?: { message: string }[]
  }

  if (json.errors?.length) {
    console.warn('[useTFMMPools] Indexer error:', json.errors[0].message)
    return []
  }

  return (json.data?.tfmmPools ?? []).map((pool) => {
    const tvlUsd = parseFloat(pool.tvlUsd)
    const volume24hUsd = parseFloat(pool.volume24hUsd)

    return {
      address: pool.address as Address,
      name: pool.name,
      strategy: pool.strategy,
      tvl: formatUSD(tvlUsd),
      apy: `${pool.apyPercent.toFixed(1)}%`,
      volume24h: formatUSD(volume24hUsd),
      metrics: {
        tvlUsd,
        apyPercent: pool.apyPercent,
        volume24hUsd,
      },
      state: {
        tokens: pool.tokens.map((t) => t.address as Address),
        balances: pool.tokens.map((t) => BigInt(t.balance)),
        weights: pool.tokens.map((t) => BigInt(t.weight)),
        swapFee: BigInt(pool.swapFee),
        totalSupply: BigInt(pool.totalSupply),
      },
      userBalance: 0n, // Will be fetched separately per user
    }
  })
}

async function fetchPoolsFromApi(): Promise<TFMMPool[]> {
  // Fallback to Bazaar API for pools (works without indexer)
  const response = await fetch('/api/tfmm')

  if (!response.ok) {
    console.warn('[useTFMMPools] API fetch failed:', response.status)
    return []
  }

  const json = (await response.json()) as {
    pools: Array<{
      address: string
      name: string
      symbol: string
      strategy: string
      tokens: string[]
      weights: number[]
      targetWeights: number[]
      tvl: string
      tvlUSD: string
      apy: string
      volume24h: string
      totalSupply: string
      swapFeeBps: number
    }>
  }

  return (json.pools ?? []).map((pool) => {
    const tvlUsd = parseFormattedNumber(pool.tvlUSD)
    const volume24hUsd = parseFormattedNumber(pool.volume24h)
    const apyPercent = parseFormattedNumber(pool.apy)

    return {
      address: pool.address as Address,
      name: pool.name,
      strategy: pool.strategy,
      tvl: pool.tvl,
      apy: pool.apy,
      volume24h: pool.volume24h,
      metrics: {
        tvlUsd,
        apyPercent,
        volume24hUsd,
      },
      state: {
        tokens: pool.tokens as Address[],
        balances: [], // Will be fetched on-chain
        weights: pool.weights.map((w) => BigInt(Math.floor(w * 1e16))),
        swapFee: BigInt(pool.swapFeeBps * 100), // Convert bps to basis
        totalSupply: BigInt(pool.totalSupply || '0'),
      },
      userBalance: 0n,
    }
  })
}

export function useTFMMPools() {
  useAccount() // For re-rendering when wallet changes
  const [selectedPool, setSelectedPool] = useState<Address | null>(null)

  const {
    data: pools = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tfmm-pools', CHAIN_ID],
    queryFn: async () => {
      // Try indexer first
      const isIndexerUp = await checkIndexerHealth()
      if (isIndexerUp) {
        const indexerPools = await fetchPoolsFromIndexer()
        if (indexerPools.length > 0) {
          return indexerPools
        }
      }
      // Fallback to API (reads from config/on-chain)
      return fetchPoolsFromApi()
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  })

  return {
    pools,
    selectedPool,
    setSelectedPool,
    isLoading,
    error,
    refetch,
  }
}

export function useTFMMPoolState(poolAddress: Address | null) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tfmm-pool-state', poolAddress],
    queryFn: async () => {
      if (!poolAddress || !publicClient) return null

      const result = await publicClient.readContract({
        address: poolAddress,
        abi: TFMM_POOL_ABI,
        functionName: 'getPoolState',
      })

      return {
        tokens: [...result[0]] as Address[],
        balances: [...result[1]],
        weights: [...result[2]],
        swapFee: result[3],
        totalSupply: result[4],
      } as TFMMPoolState
    },
    enabled: !!poolAddress && !!publicClient,
    staleTime: 10000,
  })

  return {
    poolState: data ?? null,
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
