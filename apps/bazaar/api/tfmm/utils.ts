/**
 * TFMM utility functions for business logic
 * Shared between API routes and hooks
 *
 * Fetches pool data from:
 * 1. Indexer GraphQL API (primary source)
 * 2. contracts.json config (fallback for freshly deployed pools)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getIndexerGraphqlUrl, getL2RpcUrl } from '@jejunetwork/config'
import { AddressSchema, expect } from '@jejunetwork/types'
import { type Address, createPublicClient, http } from 'viem'
import { jeju, jejuLocalnet } from '../../config/chains'
import type {
  TFMMCreatePoolParams,
  TFMMTriggerRebalanceParams,
  TFMMUpdateStrategyParams,
} from '../../schemas/api'

export interface TFMMPool {
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
}

export interface TFMMStrategy {
  type: string
  name: string
  description: string
  params: Record<string, number>
  performance: {
    return30d: number
    sharpe: number
    maxDrawdown: number
    winRate: number
  }
}

export interface OracleStatus {
  pythAvailable: boolean
  chainlinkAvailable: boolean
  twapAvailable: boolean
  currentSource: string
  lastUpdate: number
}

// Available strategy types with default parameters
const AVAILABLE_STRATEGIES: TFMMStrategy[] = [
  {
    type: 'momentum',
    name: 'Momentum',
    description: 'Allocates more to assets with positive price momentum',
    params: { lookbackPeriod: 7, updateFrequency: 24, maxWeightChange: 5 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
  {
    type: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Rebalances when assets deviate from historical averages',
    params: { deviationThreshold: 10, lookbackPeriod: 30, updateFrequency: 12 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
  {
    type: 'trend_following',
    name: 'Trend Following',
    description: 'Follows medium-term price trends using moving averages',
    params: { shortMA: 7, longMA: 21, updateFrequency: 6, maxWeightChange: 10 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
  {
    type: 'volatility_targeting',
    name: 'Volatility Targeting',
    description: 'Adjusts allocations to maintain target portfolio volatility',
    params: { targetVolatility: 15, lookbackPeriod: 30, updateFrequency: 24 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
]

// TFMMPool ABI for on-chain reads
const TFMM_POOL_ABI = [
  {
    name: 'getPoolState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'tokens', type: 'address[]' },
          { name: 'balances', type: 'uint256[]' },
          { name: 'currentWeights', type: 'uint256[]' },
          { name: 'targetWeights', type: 'uint256[]' },
          { name: 'weightDeltas', type: 'int256[]' },
          { name: 'lastUpdateBlock', type: 'uint256' },
          { name: 'swapFeeBps', type: 'uint256' },
          { name: 'totalSupply', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

interface IndexerTFMMPoolRaw {
  id: string
  address: string
  name: string
  symbol: string
  tokens: string[]
  currentWeights: string[]
  targetWeights: string[]
  tvl: string
  tvlUSD: string
  volume24h: string
  volumeUSD24h: string
  totalSupply: string
  swapFeeBps: number
  apy: string | null
  strategyRule: string | null
}

// Formatting utilities
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`
  return `$${num.toFixed(2)}`
}

function parseFormattedValue(formatted: string): number {
  const clean = formatted.replace(/[$,]/g, '')
  if (clean.endsWith('M')) return parseFloat(clean) * 1_000_000
  if (clean.endsWith('K')) return parseFloat(clean) * 1_000
  return parseFloat(clean) || 0
}

/**
 * Get all TFMM pools
 * Tries indexer first, falls back to config file for freshly deployed pools
 */
export async function getAllTFMMPools(): Promise<TFMMPool[]> {
  // Try indexer first
  const indexerPools = await fetchPoolsFromIndexer()
  if (indexerPools.length > 0) {
    return indexerPools
  }

  // Fall back to config file for freshly deployed pools
  return await fetchPoolsFromConfig()
}

async function fetchPoolsFromIndexer(): Promise<TFMMPool[]> {
  const indexerUrl = getIndexerGraphqlUrl()

  const response = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetTFMMPools {
          tfmMPools(orderBy: tvlUSD_DESC, limit: 100) {
            id
            address
            name
            symbol
            tokens
            currentWeights
            targetWeights
            tvl
            tvlUSD
            volume24h
            volumeUSD24h
            totalSupply
            swapFeeBps
            apy
            strategyRule
          }
        }
      `,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (!response?.ok) {
    return []
  }

  const json = (await response.json()) as {
    data?: { tfmMPools: IndexerTFMMPoolRaw[] }
    errors?: { message: string }[]
  }

  if (json.errors?.length) {
    console.warn('[TFMM] Indexer error:', json.errors[0].message)
    return []
  }

  return (json.data?.tfmMPools ?? []).map((pool) => ({
    address: pool.address,
    name: pool.name,
    symbol: pool.symbol,
    strategy: pool.strategyRule ?? 'none',
    tokens: pool.tokens,
    weights: pool.currentWeights.map((w) => Number(BigInt(w)) / 1e16), // Convert to percentage
    targetWeights: pool.targetWeights.map((w) => Number(BigInt(w)) / 1e16),
    tvl: pool.tvl,
    tvlUSD: pool.tvlUSD,
    apy: pool.apy ?? '0%',
    volume24h: pool.volumeUSD24h,
    totalSupply: pool.totalSupply,
    swapFeeBps: pool.swapFeeBps,
  }))
}

async function fetchPoolsFromConfig(): Promise<TFMMPool[]> {
  // Check tfmm deployment file based on current network
  const contractsDir = join(
    import.meta.dirname,
    '../../../../packages/contracts',
  )
  const rpcUrl = getL2RpcUrl()
  const isLocalnet =
    rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')
  const networkName = isLocalnet ? 'localnet' : 'testnet'
  const tfmmDeployPath = join(
    contractsDir,
    `deployments/tfmm-${networkName}.json`,
  )

  if (!existsSync(tfmmDeployPath)) {
    return []
  }

  const deployData = JSON.parse(readFileSync(tfmmDeployPath, 'utf-8')) as {
    pools: Array<{
      address: string
      name: string
      symbol: string
      tokens: string[]
      weights?: string[]
      liquidity?: string[]
    }>
  }

  if (!deployData.pools?.length) {
    return []
  }

  // Fetch on-chain state for each pool
  const chain = isLocalnet ? jejuLocalnet : jeju

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const pools: TFMMPool[] = []

  for (const deployedPool of deployData.pools) {
    const poolState = await client
      .readContract({
        address: deployedPool.address as Address,
        abi: TFMM_POOL_ABI,
        functionName: 'getPoolState',
      })
      .catch(() => null)

    if (!poolState) {
      continue
    }

    const state = poolState as {
      tokens: readonly Address[]
      balances: readonly bigint[]
      currentWeights: readonly bigint[]
      targetWeights: readonly bigint[]
      weightDeltas: readonly bigint[]
      lastUpdateBlock: bigint
      swapFeeBps: bigint
      totalSupply: bigint
    }

    // Calculate TVL from balances (simplified - assumes 18 decimals)
    const totalBalance = state.balances.reduce((sum, b) => sum + b, 0n)
    const tvlFormatted = formatNumber(Number(totalBalance) / 1e18)

    pools.push({
      address: deployedPool.address,
      name: deployedPool.name,
      symbol: deployedPool.symbol,
      strategy: 'none',
      tokens: [...state.tokens],
      weights: state.currentWeights.map((w) => Number(w) / 1e16),
      targetWeights: state.targetWeights.map((w) => Number(w) / 1e16),
      tvl: tvlFormatted,
      tvlUSD: tvlFormatted,
      apy: '0%',
      volume24h: '$0',
      totalSupply: state.totalSupply.toString(),
      swapFeeBps: Number(state.swapFeeBps),
    })
  }

  return pools
}

/**
 * Get a specific pool by address
 */
export async function getTFMMPool(
  poolAddress: string,
): Promise<TFMMPool | null> {
  AddressSchema.parse(poolAddress)

  const allPools = await getAllTFMMPools()
  return (
    allPools.find(
      (p) => p.address.toLowerCase() === poolAddress.toLowerCase(),
    ) ?? null
  )
}

/**
 * Get all available strategies
 */
export function getTFMMStrategies(): TFMMStrategy[] {
  return AVAILABLE_STRATEGIES
}

/**
 * Get oracle status for all tokens
 * Returns empty object until oracle integrations are live
 */
export function getOracleStatus(): Record<string, OracleStatus> {
  return {}
}

/**
 * Create a new TFMM pool
 */
export async function createTFMMPool(
  params: TFMMCreatePoolParams,
): Promise<{ poolAddress: string; message: string }> {
  for (const token of params.tokens) {
    AddressSchema.parse(token)
  }
  expect(params.tokens.length >= 2, 'At least 2 tokens required')

  throw new Error(
    'TFMM pool creation from API not yet available - use jeju seed or deploy scripts',
  )
}

/**
 * Update pool strategy
 */
export async function updatePoolStrategy(
  params: TFMMUpdateStrategyParams,
): Promise<{ message: string; effectiveAt: number }> {
  AddressSchema.parse(params.poolAddress)

  throw new Error(
    'TFMM strategy updates not yet available - contracts pending deployment',
  )
}

/**
 * Trigger pool rebalance
 */
export async function triggerPoolRebalance(
  params: TFMMTriggerRebalanceParams,
): Promise<{ message: string; txHash: string }> {
  AddressSchema.parse(params.poolAddress)

  throw new Error(
    'TFMM rebalancing not yet available - contracts pending deployment',
  )
}

/**
 * Calculate aggregate stats for all pools
 */
export async function getTFMMStats(): Promise<{
  totalTvl: string
  totalVolume24h: string
  poolCount: number
}> {
  const pools = await getAllTFMMPools()

  let totalTvlNum = 0
  let totalVolumeNum = 0

  for (const pool of pools) {
    // Parse formatted values back to numbers
    totalTvlNum += parseFormattedValue(pool.tvlUSD)
    totalVolumeNum += parseFormattedValue(pool.volume24h)
  }

  return {
    totalTvl: formatNumber(totalTvlNum),
    totalVolume24h: formatNumber(totalVolumeNum),
    poolCount: pools.length,
  }
}
