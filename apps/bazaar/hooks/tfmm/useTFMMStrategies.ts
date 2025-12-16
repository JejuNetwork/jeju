'use client'

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { type Address } from 'viem'
import { useCallback } from 'react'

// Strategy Rule ABI
const STRATEGY_RULE_ABI = [
  {
    name: 'getStrategyConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'lookbackPeriod', type: 'uint256' },
      { name: 'updateInterval', type: 'uint256' },
      { name: 'maxWeightChange', type: 'uint256' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    name: 'getLastUpdate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'timestamp', type: 'uint256' },
      { name: 'weights', type: 'uint256[]' },
    ],
  },
] as const

// Weight Update Runner ABI
const WEIGHT_UPDATE_RUNNER_ABI = [
  {
    name: 'getPoolStrategy',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [
      { name: 'strategyRule', type: 'address' },
      { name: 'oracleRegistry', type: 'address' },
      { name: 'lastUpdate', type: 'uint256' },
      { name: 'updateInterval', type: 'uint256' },
    ],
  },
  {
    name: 'updateWeights',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [],
  },
  {
    name: 'canUpdate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: 'canUpdate', type: 'bool' }],
  },
] as const

export type StrategyType = 'momentum' | 'mean-reversion' | 'volatility' | 'composite'

export interface StrategyConfig {
  type: StrategyType
  name: string
  description: string
  lookbackPeriod: number
  updateInterval: number
  maxWeightChange: number
  enabled: boolean
}

export interface StrategyPerformance {
  totalReturn: number
  sharpeRatio: number
  maxDrawdown: number
  winRate: number
  rebalanceCount: number
}

export const STRATEGY_CONFIGS: Record<StrategyType, Omit<StrategyConfig, 'lookbackPeriod' | 'updateInterval' | 'maxWeightChange' | 'enabled'>> = {
  momentum: {
    type: 'momentum',
    name: 'Momentum Strategy',
    description: 'Increases allocation to assets with positive price momentum, decreases for negative momentum.',
  },
  'mean-reversion': {
    type: 'mean-reversion',
    name: 'Mean Reversion Strategy',
    description: 'Buys assets that are below their historical average, sells those above.',
  },
  volatility: {
    type: 'volatility',
    name: 'Volatility Strategy',
    description: 'Reduces exposure to high volatility assets, increases to stable assets.',
  },
  composite: {
    type: 'composite',
    name: 'Composite Strategy',
    description: 'Combines multiple strategies with configurable weights for balanced performance.',
  },
}

export function useTFMMStrategies(weightUpdateRunnerAddress: Address | null) {
  // Mock data for development - will be replaced with on-chain queries
  const strategies: StrategyConfig[] = [
    {
      ...STRATEGY_CONFIGS.momentum,
      lookbackPeriod: 14,
      updateInterval: 3600,
      maxWeightChange: 250,
      enabled: true,
    },
    {
      ...STRATEGY_CONFIGS['mean-reversion'],
      lookbackPeriod: 30,
      updateInterval: 7200,
      maxWeightChange: 150,
      enabled: true,
    },
    {
      ...STRATEGY_CONFIGS.volatility,
      lookbackPeriod: 7,
      updateInterval: 1800,
      maxWeightChange: 200,
      enabled: true,
    },
    {
      ...STRATEGY_CONFIGS.composite,
      lookbackPeriod: 14,
      updateInterval: 3600,
      maxWeightChange: 200,
      enabled: true,
    },
  ]

  return {
    strategies,
    isLoading: false,
  }
}

export function useStrategyPerformance(strategyType: StrategyType): StrategyPerformance {
  // Mock performance data - will be replaced with actual backtesting results
  const performances: Record<StrategyType, StrategyPerformance> = {
    momentum: {
      totalReturn: 15.2,
      sharpeRatio: 1.45,
      maxDrawdown: 8.3,
      winRate: 58.5,
      rebalanceCount: 89,
    },
    'mean-reversion': {
      totalReturn: 12.8,
      sharpeRatio: 1.72,
      maxDrawdown: 5.6,
      winRate: 62.3,
      rebalanceCount: 67,
    },
    volatility: {
      totalReturn: 18.5,
      sharpeRatio: 2.1,
      maxDrawdown: 4.2,
      winRate: 71.2,
      rebalanceCount: 45,
    },
    composite: {
      totalReturn: 14.5,
      sharpeRatio: 1.85,
      maxDrawdown: 6.1,
      winRate: 64.8,
      rebalanceCount: 72,
    },
  }

  return performances[strategyType]
}

export function useUpdateWeights(weightUpdateRunnerAddress: Address | null) {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const updateWeights = useCallback(
    async (poolAddress: Address) => {
      if (!weightUpdateRunnerAddress) return

      writeContract({
        address: weightUpdateRunnerAddress,
        abi: WEIGHT_UPDATE_RUNNER_ABI,
        functionName: 'updateWeights',
        args: [poolAddress],
      })
    },
    [weightUpdateRunnerAddress, writeContract]
  )

  return {
    updateWeights,
    isLoading: isPending || isConfirming,
    isSuccess,
    error,
    hash,
  }
}

export function useCanUpdate(weightUpdateRunnerAddress: Address | null, poolAddress: Address | null) {
  const { data: canUpdate, isLoading } = useReadContract({
    address: weightUpdateRunnerAddress ?? undefined,
    abi: WEIGHT_UPDATE_RUNNER_ABI,
    functionName: 'canUpdate',
    args: poolAddress ? [poolAddress] : undefined,
    query: {
      enabled: !!weightUpdateRunnerAddress && !!poolAddress,
    },
  })

  return {
    canUpdate: canUpdate ?? false,
    isLoading,
  }
}

export function formatStrategyParam(value: number, type: 'time' | 'bps' | 'days'): string {
  switch (type) {
    case 'time':
      if (value >= 86400) return `${Math.floor(value / 86400)}d`
      if (value >= 3600) return `${Math.floor(value / 3600)}h`
      if (value >= 60) return `${Math.floor(value / 60)}m`
      return `${value}s`
    case 'bps':
      return `${(value / 100).toFixed(2)}%`
    case 'days':
      return `${value} days`
    default:
      return String(value)
  }
}

