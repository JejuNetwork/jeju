/**
 * Dynamic Gas Estimation - Real-time gas price tracking
 *
 * Features:
 * - EIP-1559 base fee tracking
 * - Priority fee estimation based on mempool
 * - Gas price prediction
 * - Optimal gas strategy per opportunity
 */

import {
  type Block,
  type Chain,
  createPublicClient,
  http,
  type PublicClient,
} from 'viem'
import { arbitrum, base, mainnet, optimism } from 'viem/chains'
import { createLogger } from '../../sdk/logger'
import type { ChainId } from '../autocrat-types'

const log = createLogger('GasOracle')

interface GasStats {
  baseFee: bigint
  avgPriorityFee: bigint
  minPriorityFee: bigint
  maxPriorityFee: bigint
  pendingTxCount: number
  blockUtilization: number // 0-1
  timestamp: number
}

interface GasPrediction {
  expectedBaseFee: bigint
  recommendedPriorityFee: bigint
  maxFee: bigint
  urgency: 'low' | 'medium' | 'high' | 'urgent'
  confidenceMs: number // How long this prediction is valid
}

const CHAIN_DEFS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
}

// Historical window for analysis
const HISTORY_BLOCKS = 20

export class GasOracle {
  private clients: Map<ChainId, PublicClient> = new Map()
  private gasHistory: Map<ChainId, GasStats[]> = new Map()
  private currentStats: Map<ChainId, GasStats> = new Map()
  private updateInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Initialize gas oracle for chains
   */
  async initialize(
    chains: Array<{ chainId: ChainId; rpcUrl: string }>,
  ): Promise<void> {
    log.info('Initializing gas oracle')

    for (const chain of chains) {
      const chainDef = CHAIN_DEFS[chain.chainId] || {
        id: chain.chainId,
        name: 'Custom',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [chain.rpcUrl] } },
      }

      const client = createPublicClient({
        chain: chainDef,
        transport: http(chain.rpcUrl),
      })

      this.clients.set(chain.chainId, client)
      this.gasHistory.set(chain.chainId, [])

      // Get initial stats
      await this.updateChainGas(chain.chainId)

      console.log(
        `   Chain ${chain.chainId}: ${Number(this.currentStats.get(chain.chainId)?.baseFee || 0n) / 1e9} gwei`,
      )
    }
  }

  /**
   * Start automatic gas tracking
   */
  start(): void {
    if (this.updateInterval) return

    // Update gas every block (~12s on mainnet, faster on L2s)
    this.updateInterval = setInterval(() => {
      this.updateAllChains()
    }, 3000)

    log.info('Gas tracking started')
  }

  /**
   * Stop gas tracking
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
  }

  /**
   * Get current gas stats for a chain
   */
  getGasStats(chainId: ChainId): GasStats | null {
    return this.currentStats.get(chainId) || null
  }

  /**
   * Get gas price prediction
   */
  getGasPrediction(
    chainId: ChainId,
    urgency: 'low' | 'medium' | 'high' | 'urgent' = 'high',
  ): GasPrediction {
    const stats = this.currentStats.get(chainId)
    const history = this.gasHistory.get(chainId) || []

    if (!stats) {
      // Default fallback
      return {
        expectedBaseFee: BigInt(30e9),
        recommendedPriorityFee: BigInt(2e9),
        maxFee: BigInt(50e9),
        urgency,
        confidenceMs: 0,
      }
    }

    // Predict next base fee using EIP-1559 formula
    const expectedBaseFee = this.predictBaseFee(stats, history)

    // Calculate priority fee based on urgency
    const recommendedPriorityFee = this.calculatePriorityFee(stats, urgency)

    // Max fee = expected base fee + priority + buffer
    const buffer = urgency === 'urgent' ? 2n : urgency === 'high' ? 15n : 10n
    const maxFee =
      (expectedBaseFee * (10n + buffer)) / 10n + recommendedPriorityFee

    return {
      expectedBaseFee,
      recommendedPriorityFee,
      maxFee,
      urgency,
      confidenceMs:
        urgency === 'urgent' ? 3000 : urgency === 'high' ? 6000 : 12000,
    }
  }

  /**
   * Calculate optimal gas for a specific trade
   */
  calculateTradeGas(
    chainId: ChainId,
    expectedProfitWei: bigint,
    gasUnits: bigint,
    urgency: 'low' | 'medium' | 'high' | 'urgent' = 'high',
  ): {
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    estimatedCost: bigint
    netProfit: bigint
    profitable: boolean
    profitMargin: number // percentage
  } {
    const prediction = this.getGasPrediction(chainId, urgency)

    const estimatedCost =
      gasUnits *
      (prediction.expectedBaseFee + prediction.recommendedPriorityFee)
    const netProfit = expectedProfitWei - estimatedCost
    const profitMargin = Number((netProfit * 100n) / expectedProfitWei)

    return {
      maxFeePerGas: prediction.maxFee,
      maxPriorityFeePerGas: prediction.recommendedPriorityFee,
      estimatedCost,
      netProfit,
      profitable: netProfit > 0n,
      profitMargin,
    }
  }

  /**
   * Estimate gas for a contract call
   */
  async estimateGas(
    chainId: ChainId,
    to: `0x${string}`,
    data: `0x${string}`,
    value: bigint = 0n,
  ): Promise<bigint> {
    const client = this.clients.get(chainId)
    if (!client) {
      throw new Error(`Chain ${chainId} not configured`)
    }

    return client.estimateGas({
      to,
      data,
      value,
    })
  }

  // ============ Private Methods ============

  private async updateAllChains(): Promise<void> {
    const updates = Array.from(this.clients.keys()).map((chainId) =>
      this.updateChainGas(chainId),
    )
    await Promise.allSettled(updates)
  }

  private async updateChainGas(chainId: ChainId): Promise<void> {
    const client = this.clients.get(chainId)
    if (!client) return

    const [block, feeHistory] = await Promise.all([
      client.getBlock({ blockTag: 'latest' }),
      client.getFeeHistory({
        blockCount: 5,
        rewardPercentiles: [10, 50, 90],
      }),
    ])

    const stats = this.parseGasStats(block, feeHistory, chainId)
    this.currentStats.set(chainId, stats)

    // Add to history
    const history = this.gasHistory.get(chainId) || []
    history.push(stats)

    // Keep only recent history
    if (history.length > HISTORY_BLOCKS) {
      history.shift()
    }
    this.gasHistory.set(chainId, history)
  }

  private parseGasStats(
    block: Block,
    feeHistory: {
      baseFeePerGas: readonly bigint[]
      gasUsedRatio: readonly number[]
      reward?: readonly (readonly bigint[])[]
    },
    _chainId: ChainId,
  ): GasStats {
    if (!block.baseFeePerGas) {
      throw new Error(
        'Block missing baseFeePerGas - cannot parse gas stats without EIP-1559 base fee',
      )
    }
    const baseFee = block.baseFeePerGas

    // Get priority fees from fee history
    let minPriorityFee = BigInt(1e9)
    let avgPriorityFee = BigInt(2e9)
    let maxPriorityFee = BigInt(5e9)

    if (feeHistory.reward && feeHistory.reward.length > 0) {
      const allRewards = feeHistory.reward.flat().filter((r) => r > 0n)
      if (allRewards.length > 0) {
        allRewards.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        minPriorityFee = allRewards[0]
        maxPriorityFee = allRewards[allRewards.length - 1]
        avgPriorityFee = allRewards[Math.floor(allRewards.length / 2)]
      }
    }

    // Calculate block utilization
    const blockUtilization = Number(block.gasUsed) / Number(block.gasLimit)

    return {
      baseFee,
      avgPriorityFee,
      minPriorityFee,
      maxPriorityFee,
      pendingTxCount: 0, // Would need mempool access
      blockUtilization,
      timestamp: Date.now(),
    }
  }

  private predictBaseFee(current: GasStats, _history: GasStats[]): bigint {
    // EIP-1559: base fee changes by up to 12.5% per block
    // based on whether previous block was > or < 50% full

    if (current.blockUtilization > 0.5) {
      // Block was more than half full, base fee will increase
      const increase = current.blockUtilization - 0.5
      const multiplier = 1n + BigInt(Math.floor(increase * 25 * 100)) / 10000n
      return ((current.baseFee * multiplier) / 100n) * 100n
    } else {
      // Block was less than half full, base fee will decrease
      const decrease = 0.5 - current.blockUtilization
      const multiplier = 100n - BigInt(Math.floor(decrease * 25 * 100)) / 100n
      return (current.baseFee * multiplier) / 100n
    }
  }

  private calculatePriorityFee(
    stats: GasStats,
    urgency: 'low' | 'medium' | 'high' | 'urgent',
  ): bigint {
    switch (urgency) {
      case 'low':
        return stats.minPriorityFee
      case 'medium':
        return stats.avgPriorityFee
      case 'high':
        return (stats.avgPriorityFee + stats.maxPriorityFee) / 2n
      case 'urgent':
        return (stats.maxPriorityFee * 15n) / 10n
    }
  }
}

/**
 * Get gas estimation for common operations
 */
export const GAS_ESTIMATES = {
  // Basic operations
  TRANSFER: 21000n,
  ERC20_TRANSFER: 65000n,
  ERC20_APPROVE: 46000n,

  // DEX operations
  UNISWAP_V2_SWAP: 150000n,
  UNISWAP_V3_SWAP: 180000n,
  SUSHISWAP_SWAP: 150000n,

  // Complex operations
  FLASH_LOAN_AAVE: 250000n,
  FLASH_LOAN_BALANCER: 200000n,
  ARBITRAGE_2_POOLS: 350000n,
  ARBITRAGE_3_POOLS: 500000n,
  SANDWICH_FRONTRUN: 200000n,
  SANDWICH_BACKRUN: 200000n,
  LIQUIDATION: 500000n,

  // Margin per pool in path
  PER_POOL_MARGIN: 150000n,
} as const

/**
 * Calculate total gas for a multi-hop swap
 */
export function calculateSwapGas(numPools: number, isV3: boolean): bigint {
  const baseGas = isV3
    ? GAS_ESTIMATES.UNISWAP_V3_SWAP
    : GAS_ESTIMATES.UNISWAP_V2_SWAP
  return baseGas + BigInt(numPools - 1) * GAS_ESTIMATES.PER_POOL_MARGIN
}

/**
 * Calculate total gas for arbitrage
 */
export function calculateArbitrageGas(
  numPools: number,
  useFlashLoan: boolean,
): bigint {
  let gas = BigInt(numPools) * GAS_ESTIMATES.PER_POOL_MARGIN + 50000n // Base overhead

  if (useFlashLoan) {
    gas += GAS_ESTIMATES.FLASH_LOAN_AAVE
  }

  return gas
}
