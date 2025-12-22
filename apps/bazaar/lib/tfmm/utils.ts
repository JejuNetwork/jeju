/**
 * TFMM utility functions for business logic
 * Shared between API routes and hooks
 */

import { AddressSchema } from '@jejunetwork/types'
import { expect } from '@/lib/validation'
import type {
  TFMMCreatePoolParams,
  TFMMTriggerRebalanceParams,
  TFMMUpdateStrategyParams,
} from '@/schemas/api'

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

// Mock data - in production, this would come from contracts/indexer
const MOCK_POOLS: TFMMPool[] = [
  {
    address: '0x1234567890123456789012345678901234567890',
    name: 'Momentum ETH/BTC',
    strategy: 'momentum',
    tokens: ['ETH', 'BTC'],
    weights: [60, 40],
    targetWeights: [65, 35],
    tvl: '$2.4M',
    apy: '12.5%',
    volume24h: '$890K',
  },
  {
    address: '0x2345678901234567890123456789012345678901',
    name: 'Mean Reversion Stables',
    strategy: 'mean_reversion',
    tokens: ['USDC', 'USDT', 'DAI'],
    weights: [33, 34, 33],
    targetWeights: [33, 33, 34],
    tvl: '$1.2M',
    apy: '8.2%',
    volume24h: '$450K',
  },
  {
    address: '0x3456789012345678901234567890123456789012',
    name: 'Trend Following Multi',
    strategy: 'trend_following',
    tokens: ['ETH', 'BTC', 'SOL', 'ARB'],
    weights: [30, 30, 20, 20],
    targetWeights: [35, 25, 25, 15],
    tvl: '$580K',
    apy: '15.8%',
    volume24h: '$210K',
  },
]

const STRATEGIES: TFMMStrategy[] = [
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
      return30d: 8.5,
      sharpe: 1.8,
      maxDrawdown: -12.3,
      winRate: 62,
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
      return30d: 5.2,
      sharpe: 2.1,
      maxDrawdown: -8.5,
      winRate: 58,
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
      return30d: 12.1,
      sharpe: 1.5,
      maxDrawdown: -18.2,
      winRate: 55,
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
      return30d: 6.8,
      sharpe: 2.3,
      maxDrawdown: -10.1,
      winRate: 60,
    },
  },
]

const ORACLE_STATUS: Record<string, OracleStatus> = {
  ETH: {
    pythAvailable: true,
    chainlinkAvailable: true,
    twapAvailable: true,
    currentSource: 'pyth',
    lastUpdate: Date.now() - 5000,
  },
  BTC: {
    pythAvailable: true,
    chainlinkAvailable: true,
    twapAvailable: false,
    currentSource: 'pyth',
    lastUpdate: Date.now() - 3000,
  },
  USDC: {
    pythAvailable: true,
    chainlinkAvailable: true,
    twapAvailable: true,
    currentSource: 'chainlink',
    lastUpdate: Date.now() - 10000,
  },
  SOL: {
    pythAvailable: true,
    chainlinkAvailable: false,
    twapAvailable: true,
    currentSource: 'pyth',
    lastUpdate: Date.now() - 8000,
  },
  ARB: {
    pythAvailable: true,
    chainlinkAvailable: false,
    twapAvailable: true,
    currentSource: 'twap',
    lastUpdate: Date.now() - 60000,
  },
}

/**
 * Get all TFMM pools
 */
export function getAllTFMMPools(): TFMMPool[] {
  return MOCK_POOLS
}

/**
 * Get a specific pool by address
 */
export function getTFMMPool(poolAddress: string): TFMMPool | null {
  const validatedAddress = AddressSchema.parse(poolAddress)
  const pool = MOCK_POOLS.find(
    (p) => p.address.toLowerCase() === validatedAddress.toLowerCase(),
  )
  return pool || null
}

/**
 * Get all available strategies
 */
export function getTFMMStrategies(): TFMMStrategy[] {
  return STRATEGIES
}

/**
 * Get oracle status for all tokens
 */
export function getOracleStatus(): Record<string, OracleStatus> {
  return ORACLE_STATUS
}

/**
 * Create a new TFMM pool
 * In production, this would deploy a contract
 */
export async function createTFMMPool(
  params: TFMMCreatePoolParams,
): Promise<{ poolAddress: string; message: string }> {
  for (const token of params.tokens) {
    AddressSchema.parse(token)
  }
  expect(params.tokens.length >= 2, 'At least 2 tokens required')

  // In production, deploy contract here
  const poolAddress = `0x${Math.random().toString(16).slice(2, 42)}`

  return {
    poolAddress,
    message: 'Pool creation initiated',
  }
}

/**
 * Update pool strategy
 */
export async function updatePoolStrategy(
  params: TFMMUpdateStrategyParams,
): Promise<{ message: string; effectiveAt: number }> {
  AddressSchema.parse(params.poolAddress)

  // In production, schedule strategy update
  return {
    message: 'Strategy update scheduled',
    effectiveAt: Date.now() + 3600000, // 1 hour delay
  }
}

/**
 * Trigger pool rebalance
 */
export async function triggerPoolRebalance(
  params: TFMMTriggerRebalanceParams,
): Promise<{ message: string; txHash: string }> {
  AddressSchema.parse(params.poolAddress)

  // In production, execute rebalance transaction
  const txHash = `0x${Math.random().toString(16).slice(2, 66)}`

  return {
    message: 'Rebalance triggered',
    txHash,
  }
}

/**
 * Calculate aggregate stats for all pools
 */
export function getTFMMStats(): {
  totalTvl: string
  totalVolume24h: string
  poolCount: number
} {
  return {
    totalTvl: '$4.18M',
    totalVolume24h: '$1.55M',
    poolCount: MOCK_POOLS.length,
  }
}
