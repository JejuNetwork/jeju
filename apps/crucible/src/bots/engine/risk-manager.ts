/**
 * Risk Management System
 *
 * Features:
 * - Position sizing using Kelly criterion
 * - Daily/weekly loss limits
 * - Concurrent exposure limits
 * - Builder reliability tracking
 * - Reorg risk assessment
 * - Circuit breakers
 */

import { createLogger } from '../../sdk/logger'
import type {
  ChainId,
  OpportunityExecutionResult,
} from '../autocrat-types-source'

const log = createLogger('RiskManager')

// Simplified opportunity type for risk assessment
interface RiskOpportunity {
  id: string
  type: string
  inputAmount?: string
  expectedProfit?: string
  chainId?: ChainId
}

export interface RiskConfig {
  // Position limits
  maxPositionSizeWei: bigint // Max per trade
  maxDailyLossWei: bigint // Stop trading if exceeded
  maxWeeklyLossWei: bigint // Longer-term limit
  maxConcurrentExposureWei: bigint // Total capital at risk

  // Profit requirements
  minProfitBps: number // Minimum profit in basis points
  minNetProfitWei: bigint // Minimum absolute profit

  // Builder requirements
  minBuilderInclusionRate: number // 0-1, min historical inclusion rate

  // Risk adjustments
  maxSlippageBps: number // Maximum allowed slippage
  reorgRiskMultiplier: number // Discount for reorg-prone chains

  // Circuit breakers
  maxConsecutiveFails: number // Pause after N consecutive failures
  cooldownAfterFailMs: number // Wait time after circuit break
}

interface TradeRecord {
  id: string
  chainId: ChainId
  type: string
  inputAmount: bigint
  expectedProfit: bigint
  actualProfit: bigint
  success: boolean
  timestamp: number
  txHash?: string
}

interface BuilderStats {
  name: string
  submissions: number
  inclusions: number
  lastInclusion: number
  avgLatencyMs: number
}

interface ChainRiskProfile {
  chainId: ChainId
  reorgDepth: number // Average reorg depth
  blockTime: number // Seconds per block
  finality: number // Blocks until finality
  riskMultiplier: number // 0-1, lower = riskier
}

const DEFAULT_CONFIG: RiskConfig = {
  maxPositionSizeWei: BigInt(10e18), // 10 ETH max per trade
  maxDailyLossWei: BigInt(1e18), // 1 ETH daily loss limit
  maxWeeklyLossWei: BigInt(5e18), // 5 ETH weekly loss limit
  maxConcurrentExposureWei: BigInt(50e18), // 50 ETH max concurrent

  minProfitBps: 10, // 0.1% minimum profit
  minNetProfitWei: BigInt(1e15), // 0.001 ETH minimum

  minBuilderInclusionRate: 0.1, // 10% minimum inclusion

  maxSlippageBps: 50, // 0.5% max slippage
  reorgRiskMultiplier: 0.9, // 10% discount for reorg risk

  maxConsecutiveFails: 5, // Pause after 5 fails
  cooldownAfterFailMs: 60000, // 1 minute cooldown
}

const CHAIN_RISK_PROFILES: Record<number, ChainRiskProfile> = {
  1: {
    chainId: 1,
    reorgDepth: 1,
    blockTime: 12,
    finality: 32,
    riskMultiplier: 0.95,
  },
  42161: {
    chainId: 42161,
    reorgDepth: 0,
    blockTime: 0.25,
    finality: 1,
    riskMultiplier: 1.0,
  },
  10: {
    chainId: 10,
    reorgDepth: 0,
    blockTime: 2,
    finality: 1,
    riskMultiplier: 1.0,
  },
  8453: {
    chainId: 8453,
    reorgDepth: 0,
    blockTime: 2,
    finality: 1,
    riskMultiplier: 1.0,
  },
  1337: {
    chainId: 1337,
    reorgDepth: 0,
    blockTime: 1,
    finality: 1,
    riskMultiplier: 1.0,
  },
}

export class RiskManager {
  private config: RiskConfig
  private trades: TradeRecord[] = []
  private pendingTrades: Map<string, TradeRecord> = new Map()
  private builderStats: Map<string, BuilderStats> = new Map()
  private consecutiveFails: number = 0
  private lastFailTime: number = 0
  private paused: boolean = false

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if an opportunity should be executed
   */
  canExecute(opportunity: RiskOpportunity): {
    allowed: boolean
    reason?: string
    adjustedSize?: bigint
  } {
    // Check circuit breaker
    if (this.paused) {
      const cooldownRemaining =
        this.lastFailTime + this.config.cooldownAfterFailMs - Date.now()
      if (cooldownRemaining > 0) {
        return {
          allowed: false,
          reason: `Circuit breaker active (${Math.ceil(cooldownRemaining / 1000)}s remaining)`,
        }
      }
      this.paused = false
      this.consecutiveFails = 0
    }

    const inputAmount = BigInt(opportunity.inputAmount || '0')
    const expectedProfit = BigInt(opportunity.expectedProfit || '0')

    // Validate input amount to prevent division by zero
    if (inputAmount <= 0n) {
      return { allowed: false, reason: 'Input amount must be greater than 0' }
    }

    // Check minimum profit
    if (expectedProfit < this.config.minNetProfitWei) {
      return {
        allowed: false,
        reason: `Profit ${expectedProfit} below minimum ${this.config.minNetProfitWei}`,
      }
    }

    // Check profit percentage (safe - inputAmount > 0 validated above)
    const profitBps = Number((expectedProfit * 10000n) / inputAmount)
    if (profitBps < this.config.minProfitBps) {
      return {
        allowed: false,
        reason: `Profit ${profitBps} bps below minimum ${this.config.minProfitBps}`,
      }
    }

    // Check position size
    let adjustedSize = inputAmount
    if (inputAmount > this.config.maxPositionSizeWei) {
      adjustedSize = this.config.maxPositionSizeWei
    }

    // Check concurrent exposure
    const currentExposure = this.getCurrentExposure()
    if (currentExposure + adjustedSize > this.config.maxConcurrentExposureWei) {
      const availableExposure =
        this.config.maxConcurrentExposureWei - currentExposure
      if (availableExposure <= 0n) {
        return { allowed: false, reason: 'Max concurrent exposure reached' }
      }
      adjustedSize = availableExposure
    }

    // Check daily loss
    const dailyPnL = this.getDailyPnL()
    if (dailyPnL < -this.config.maxDailyLossWei) {
      return { allowed: false, reason: 'Daily loss limit reached' }
    }

    // Check weekly loss
    const weeklyPnL = this.getWeeklyPnL()
    if (weeklyPnL < -this.config.maxWeeklyLossWei) {
      return { allowed: false, reason: 'Weekly loss limit reached' }
    }

    // Apply Kelly criterion for optimal sizing
    const kellySizing = this.calculateKellySize(opportunity)
    if (kellySizing < adjustedSize) {
      adjustedSize = kellySizing
    }

    // Apply chain risk adjustment
    const chainId = opportunity.chainId ?? 1337
    const chainRisk = CHAIN_RISK_PROFILES[chainId]?.riskMultiplier || 1.0
    adjustedSize = BigInt(Math.floor(Number(adjustedSize) * chainRisk))

    if (adjustedSize < BigInt(1e16)) {
      // Min 0.01 ETH
      return {
        allowed: false,
        reason: 'Adjusted size too small after risk adjustments',
      }
    }

    return { allowed: true, adjustedSize }
  }

  /**
   * Record a trade starting
   */
  startTrade(opportunity: RiskOpportunity): string {
    const tradeId = `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const record: TradeRecord = {
      id: tradeId,
      chainId: opportunity.chainId ?? (1337 as ChainId),
      type: opportunity.type,
      inputAmount: BigInt(opportunity.inputAmount || '0'),
      expectedProfit: BigInt(opportunity.expectedProfit || '0'),
      actualProfit: 0n,
      success: false,
      timestamp: Date.now(),
    }

    this.pendingTrades.set(tradeId, record)
    return tradeId
  }

  /**
   * Record a trade completing
   */
  completeTrade(tradeId: string, result: OpportunityExecutionResult): void {
    const record = this.pendingTrades.get(tradeId)
    if (!record) return

    record.success = result.success
    record.actualProfit = BigInt(result.actualProfit || '0')
    record.txHash = result.txHash ?? undefined

    this.pendingTrades.delete(tradeId)
    this.trades.push(record)

    // Update consecutive fails
    if (result.success) {
      this.consecutiveFails = 0
    } else {
      this.consecutiveFails++
      this.lastFailTime = Date.now()

      // Check circuit breaker
      if (this.consecutiveFails >= this.config.maxConsecutiveFails) {
        this.paused = true
        console.log(
          `🛑 Circuit breaker triggered after ${this.consecutiveFails} consecutive failures`,
        )
      }
    }

    // Keep only recent trades (7 days)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    this.trades = this.trades.filter((t) => t.timestamp > weekAgo)
  }

  /**
   * Update builder statistics
   */
  updateBuilderStats(name: string, included: boolean, latencyMs: number): void {
    let stats = this.builderStats.get(name)
    if (!stats) {
      stats = {
        name,
        submissions: 0,
        inclusions: 0,
        lastInclusion: 0,
        avgLatencyMs: 0,
      }
      this.builderStats.set(name, stats)
    }

    stats.submissions++
    if (included) {
      stats.inclusions++
      stats.lastInclusion = Date.now()
    }
    stats.avgLatencyMs =
      (stats.avgLatencyMs * (stats.submissions - 1) + latencyMs) /
      stats.submissions
  }

  /**
   * Check if a builder meets reliability requirements
   */
  isBuilderReliable(name: string): boolean {
    const stats = this.builderStats.get(name)
    if (!stats || stats.submissions < 10) return true // Not enough data

    const inclusionRate = stats.inclusions / stats.submissions
    return inclusionRate >= this.config.minBuilderInclusionRate
  }

  /**
   * Get reliable builders sorted by performance
   */
  getReliableBuilders(): string[] {
    return Array.from(this.builderStats.entries())
      .filter(([_, stats]) => {
        if (stats.submissions < 10) return true
        return (
          stats.inclusions / stats.submissions >=
          this.config.minBuilderInclusionRate
        )
      })
      .sort((a, b) => {
        const rateA =
          a[1].submissions > 0 ? a[1].inclusions / a[1].submissions : 0
        const rateB =
          b[1].submissions > 0 ? b[1].inclusions / b[1].submissions : 0
        return rateB - rateA
      })
      .map(([name]) => name)
  }

  /**
   * Get risk metrics
   */
  getMetrics(): {
    dailyPnL: bigint
    weeklyPnL: bigint
    currentExposure: bigint
    successRate: number
    avgProfitPerTrade: bigint
    consecutiveFails: number
    isPaused: boolean
  } {
    const recentTrades = this.trades.filter(
      (t) => t.timestamp > Date.now() - 7 * 24 * 60 * 60 * 1000,
    )
    const successfulTrades = recentTrades.filter((t) => t.success)

    let totalProfit = 0n
    for (const trade of recentTrades) {
      totalProfit += trade.actualProfit
    }

    return {
      dailyPnL: this.getDailyPnL(),
      weeklyPnL: this.getWeeklyPnL(),
      currentExposure: this.getCurrentExposure(),
      successRate:
        recentTrades.length > 0
          ? successfulTrades.length / recentTrades.length
          : 0,
      avgProfitPerTrade:
        recentTrades.length > 0
          ? totalProfit / BigInt(recentTrades.length)
          : 0n,
      consecutiveFails: this.consecutiveFails,
      isPaused: this.paused,
    }
  }

  /**
   * Reset daily stats (should be called at midnight UTC)
   */
  resetDaily(): void {
    // Daily stats are calculated dynamically, no explicit reset needed
    log.info('Daily risk stats reset')
  }

  // ============ Private Methods ============

  private getCurrentExposure(): bigint {
    let exposure = 0n
    for (const [_, trade] of this.pendingTrades) {
      exposure += trade.inputAmount
    }
    return exposure
  }

  private getDailyPnL(): bigint {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    let pnl = 0n

    for (const trade of this.trades) {
      if (trade.timestamp > dayAgo) {
        pnl += trade.actualProfit
      }
    }

    return pnl
  }

  private getWeeklyPnL(): bigint {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    let pnl = 0n

    for (const trade of this.trades) {
      if (trade.timestamp > weekAgo) {
        pnl += trade.actualProfit
      }
    }

    return pnl
  }

  /**
   * Calculate optimal position size using Kelly criterion
   *
   * Kelly fraction = (W * R - L) / R
   * where:
   *   W = win probability
   *   L = loss probability (1 - W)
   *   R = win/loss ratio (avg win / avg loss)
   */
  private calculateKellySize(opportunity: RiskOpportunity): bigint {
    // Get historical win rate and avg profit/loss
    const recentTrades = this.trades.filter(
      (t) =>
        t.type === opportunity.type &&
        t.timestamp > Date.now() - 24 * 60 * 60 * 1000,
    )

    if (recentTrades.length < 5) {
      // Not enough data, use conservative sizing (10% of max)
      return this.config.maxPositionSizeWei / 10n
    }

    const wins = recentTrades.filter((t) => t.actualProfit > 0n)
    const losses = recentTrades.filter((t) => t.actualProfit <= 0n)

    if (wins.length === 0 || losses.length === 0) {
      return this.config.maxPositionSizeWei / 10n
    }

    const winRate = wins.length / recentTrades.length
    const avgWin =
      wins.reduce((sum, t) => sum + t.actualProfit, 0n) / BigInt(wins.length)
    const avgLoss =
      losses.reduce(
        (sum, t) => sum + BigInt(Math.abs(Number(t.actualProfit))),
        0n,
      ) / BigInt(losses.length)

    if (avgLoss === 0n) {
      return this.config.maxPositionSizeWei / 10n
    }

    const winLossRatio = Number(avgWin) / Number(avgLoss)
    const kellyFraction =
      (winRate * winLossRatio - (1 - winRate)) / winLossRatio

    // Cap Kelly at 25% and apply half-Kelly for safety
    const cappedKelly = Math.min(0.25, Math.max(0, kellyFraction)) * 0.5

    const inputAmount = BigInt(opportunity.inputAmount || '0')
    return BigInt(Math.floor(Number(inputAmount) * cappedKelly))
  }
}

export { DEFAULT_CONFIG as DEFAULT_RISK_CONFIG }
