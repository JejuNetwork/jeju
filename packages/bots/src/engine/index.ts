/**
 * Bot Engine
 *
 * Core orchestration for running multiple bot strategies
 */

import { EventEmitter } from 'node:events'
import {
  type CrossChainArbConfig,
  CrossChainArbitrage,
} from '../strategies/cross-chain-arbitrage'
import {
  TFMMRebalancer,
  type TFMMRebalancerConfig,
} from '../strategies/tfmm/rebalancer'
import type { BotStats, EVMChainId, StrategyType, TradeResult } from '../types'

// ============ Types ============

export interface BotEngineConfig {
  chainId: EVMChainId
  rpcUrl: string
  privateKey: string
  enabledStrategies: StrategyType[]
  tfmmConfig?: Partial<TFMMRebalancerConfig>
  crossChainConfig?: Partial<CrossChainArbConfig>
  healthCheckIntervalMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export interface StrategyStats {
  type: StrategyType
  enabled: boolean
  running: boolean
  profitUsd: number
  trades: number
  successRate: number
  lastActivity: number
}

// ============ Bot Engine ============

// Maximum history entries to prevent memory leaks
const MAX_TRADE_HISTORY = 10000

export class BotEngine extends EventEmitter {
  private config: BotEngineConfig
  private tfmmRebalancer: TFMMRebalancer | null = null
  private crossChainArb: CrossChainArbitrage | null = null
  private running = false
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private startTime = 0
  private totalProfit = 0
  private totalTrades = 0
  private tradeHistory: TradeResult[] = []

  constructor(config: BotEngineConfig) {
    super()

    // Validate private key format before use
    if (!config.privateKey.match(/^0x[a-fA-F0-9]{64}$/)) {
      throw new Error(
        'Invalid private key format: must be 0x-prefixed 64 hex characters',
      )
    }

    this.config = config

    // Initialize enabled strategies
    if (config.enabledStrategies.includes('tfmm-rebalancer')) {
      this.tfmmRebalancer = new TFMMRebalancer({
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        privateKey: config.privateKey,
        updateIntervalMs: 300000, // 5 minutes
        minConfidenceThreshold: 0.3,
        maxGasPrice: BigInt(100e9), // 100 gwei
        gasBuffer: 1.2,
        ...config.tfmmConfig,
      })

      this.tfmmRebalancer.on('rebalance-success', (result) => {
        this.onTradeComplete('tfmm-rebalancer', result)
      })
    }

    if (config.enabledStrategies.includes('cross-chain-arbitrage')) {
      this.crossChainArb = new CrossChainArbitrage({
        ...config.crossChainConfig,
      })

      this.crossChainArb.on('completed', (opp) => {
        this.onTradeComplete('cross-chain-arbitrage', opp)
      })
    }
  }

  /**
   * Start all enabled strategies
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.startTime = Date.now()

    console.log('Starting Bot Engine...')
    console.log(
      `  Enabled strategies: ${this.config.enabledStrategies.join(', ')}`,
    )

    if (this.tfmmRebalancer) {
      this.tfmmRebalancer.start()
    }

    if (this.crossChainArb) {
      this.crossChainArb.start()
    }

    // Start health check
    this.healthCheckInterval = setInterval(
      () => this.healthCheck(),
      this.config.healthCheckIntervalMs,
    )

    this.emit('started')
  }

  /**
   * Stop all strategies
   */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    console.log('Stopping Bot Engine...')

    if (this.tfmmRebalancer) {
      this.tfmmRebalancer.stop()
    }

    if (this.crossChainArb) {
      this.crossChainArb.stop()
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    this.emit('stopped')
  }

  /**
   * Get overall bot stats
   */
  getStats(): BotStats {
    const lastTrade =
      this.tradeHistory.length > 0
        ? this.tradeHistory[this.tradeHistory.length - 1]
        : null

    return {
      uptime: this.running ? Date.now() - this.startTime : 0,
      totalProfitUsd: this.totalProfit,
      totalTrades: this.totalTrades,
      successRate: this.calculateSuccessRate(),
      activeStrategies: this.config.enabledStrategies,
      pendingOpportunities: this.crossChainArb
        ? this.crossChainArb.getOpportunities().length
        : 0,
      liquidityPositions: 0,
      tfmmPoolsManaged: this.tfmmRebalancer
        ? this.tfmmRebalancer.getPools().length
        : 0,
      lastTradeAt: lastTrade ? lastTrade.timestamp : 0,
      lastWeightUpdate: this.tfmmRebalancer
        ? this.tfmmRebalancer.getStats().lastUpdateTime
        : 0,
    }
  }

  /**
   * Get stats for a specific strategy
   */
  getStrategyStats(strategy: StrategyType): StrategyStats {
    const trades = this.tradeHistory.filter((t) => t.strategy === strategy)
    const successfulTrades = trades.filter((t) => t.success)
    const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null

    return {
      type: strategy,
      enabled: this.config.enabledStrategies.includes(strategy),
      running: this.isStrategyRunning(strategy),
      profitUsd: trades.reduce((sum, t) => sum + t.profitUsd, 0),
      trades: trades.length,
      successRate:
        trades.length > 0 ? successfulTrades.length / trades.length : 0,
      lastActivity: lastTrade ? lastTrade.timestamp : 0,
    }
  }

  /**
   * Register a TFMM pool for management
   */
  async registerTFMMPool(
    poolAddress: `0x${string}`,
    updateIntervalMs?: number,
  ): Promise<void> {
    if (!this.tfmmRebalancer) {
      throw new Error('TFMM rebalancer not enabled')
    }
    await this.tfmmRebalancer.registerPool(poolAddress, updateIntervalMs)
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit = 100): TradeResult[] {
    return this.tradeHistory.slice(-limit)
  }

  /**
   * Health check
   */
  private healthCheck(): void {
    const stats = this.getStats()

    this.log('info', 'Health check', {
      uptime: Math.floor(stats.uptime / 1000),
      profit: stats.totalProfitUsd.toFixed(2),
      trades: stats.totalTrades,
      pools: stats.tfmmPoolsManaged,
    })

    this.emit('health', stats)
  }

  /**
   * Handle trade completion
   */
  private onTradeComplete(
    strategy: StrategyType,
    result: TradeResult | { netProfitUsd: string; id: string },
  ): void {
    const tradeResult: TradeResult =
      'netProfitUsd' in result
        ? {
            id: result.id,
            strategy,
            chainType: 'evm',
            chainId: this.config.chainId,
            txHash: '',
            profitUsd: Number(result.netProfitUsd),
            gasUsed: 0n,
            timestamp: Date.now(),
            success: true,
          }
        : result

    this.tradeHistory.push(tradeResult)
    this.totalTrades++

    // Prevent unbounded memory growth - trim oldest entries
    if (this.tradeHistory.length > MAX_TRADE_HISTORY) {
      this.tradeHistory = this.tradeHistory.slice(-MAX_TRADE_HISTORY)
    }

    if (tradeResult.success) {
      this.totalProfit += tradeResult.profitUsd
    }

    this.emit('trade', tradeResult)
    this.log('info', `Trade completed: ${strategy}`, {
      profit: tradeResult.profitUsd,
      success: tradeResult.success,
    })
  }

  private isStrategyRunning(strategy: StrategyType): boolean {
    switch (strategy) {
      case 'tfmm-rebalancer':
        return this.tfmmRebalancer !== null
      case 'cross-chain-arbitrage':
        return this.crossChainArb !== null
      default:
        return false
    }
  }

  private calculateSuccessRate(): number {
    if (this.tradeHistory.length === 0) return 0
    const successful = this.tradeHistory.filter((t) => t.success).length
    return successful / this.tradeHistory.length
  }

  private log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const levels = ['debug', 'info', 'warn', 'error']
    if (levels.indexOf(level) >= levels.indexOf(this.config.logLevel)) {
      console.log(
        `[${level.toUpperCase()}] ${message}`,
        data ? JSON.stringify(data) : '',
      )
    }
  }
}
