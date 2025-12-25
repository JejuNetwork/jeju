/**
 * TFMM utility functions for business logic
 * Shared between API routes and hooks
 *
 * Note: TFMM pools are not yet deployed. All functions return empty data
 * until contracts are deployed and indexed.
 */

import { AddressSchema, expect } from '@jejunetwork/types'
import type {
  TFMMCreatePoolParams,
  TFMMTriggerRebalanceParams,
  TFMMUpdateStrategyParams,
} from '../../schemas/api'

export interface TFMMPool {
  address: string
  name: string
  strategy: string
  tokens: string[]
  weights: number[]
  targetWeights: number[]
  tvl: string
  apy: string
  volume24h: string
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

// Available strategy types - these are the supported strategies when pools are deployed
const AVAILABLE_STRATEGIES: TFMMStrategy[] = [
  {
    type: 'momentum',
    name: 'Momentum',
    description: 'Allocates more to assets with positive price momentum',
    params: {
      lookbackPeriod: 7,
      updateFrequency: 24,
      maxWeightChange: 5,
    },
    performance: {
      return30d: 0,
      sharpe: 0,
      maxDrawdown: 0,
      winRate: 0,
    },
  },
  {
    type: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Rebalances when assets deviate from historical averages',
    params: {
      deviationThreshold: 10,
      lookbackPeriod: 30,
      updateFrequency: 12,
    },
    performance: {
      return30d: 0,
      sharpe: 0,
      maxDrawdown: 0,
      winRate: 0,
    },
  },
  {
    type: 'trend_following',
    name: 'Trend Following',
    description: 'Follows medium-term price trends using moving averages',
    params: {
      shortMA: 7,
      longMA: 21,
      updateFrequency: 6,
      maxWeightChange: 10,
    },
    performance: {
      return30d: 0,
      sharpe: 0,
      maxDrawdown: 0,
      winRate: 0,
    },
  },
  {
    type: 'volatility_targeting',
    name: 'Volatility Targeting',
    description: 'Adjusts allocations to maintain target portfolio volatility',
    params: {
      targetVolatility: 15,
      lookbackPeriod: 30,
      updateFrequency: 24,
    },
    performance: {
      return30d: 0,
      sharpe: 0,
      maxDrawdown: 0,
      winRate: 0,
    },
  },
]

/**
 * Get all TFMM pools from indexer
 * Returns empty array until pools are deployed
 */
export function getAllTFMMPools(): TFMMPool[] {
  // No pools deployed yet - return empty array
  return []
}

/**
 * Get a specific pool by address
 */
export function getTFMMPool(poolAddress: string): TFMMPool | null {
  AddressSchema.parse(poolAddress)
  // No pools deployed yet
  return null
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
    'TFMM pool creation not yet available - contracts pending deployment',
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
export function getTFMMStats(): {
  totalTvl: string
  totalVolume24h: string
  poolCount: number
} {
  const pools = getAllTFMMPools()
  return {
    totalTvl: '$0',
    totalVolume24h: '$0',
    poolCount: pools.length,
  }
}
