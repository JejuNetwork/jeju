/**
 * Composite Strategy for TFMM
 *
 * Combines multiple strategies (momentum, mean-reversion, volatility)
 * using configurable weights and signal aggregation.
 *
 * Philosophy: Diversified alpha. No single strategy works in all market
 * conditions, so we blend multiple approaches.
 *
 * Features:
 * - Weighted combination of strategy signals
 * - Regime detection (trending vs. ranging)
 * - Dynamic strategy weight adjustment
 * - Conflict resolution between opposing signals
 */

import type { OracleAggregator } from '../../oracles'
import {
  BaseTFMMStrategy,
  type StrategyContext,
  type StrategySignal,
  type WeightCalculation,
} from './base-strategy'
import {
  type MeanReversionConfig,
  MeanReversionStrategy,
} from './mean-reversion-strategy'
import { type MomentumConfig, MomentumStrategy } from './momentum-strategy'
import {
  type VolatilityConfig,
  VolatilityStrategy,
} from './volatility-strategy'

export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'calm'

export interface CompositeConfig {
  // Strategy weights (should sum to 1)
  momentumWeight: number
  meanReversionWeight: number
  volatilityWeight: number

  // Individual strategy configs
  momentumConfig?: Partial<MomentumConfig>
  meanReversionConfig?: Partial<MeanReversionConfig>
  volatilityConfig?: Partial<VolatilityConfig>

  // Composite behavior
  enableRegimeDetection: boolean
  conflictResolution:
    | 'average'
    | 'strongest'
    | 'momentum-first'
    | 'volatility-first'
  minConfidenceThreshold: number // Minimum confidence to act
  blocksToTarget: number
}

const DEFAULT_CONFIG: CompositeConfig = {
  momentumWeight: 0.4,
  meanReversionWeight: 0.3,
  volatilityWeight: 0.3,
  enableRegimeDetection: true,
  conflictResolution: 'average',
  minConfidenceThreshold: 0.3,
  blocksToTarget: 300,
}

export class CompositeStrategy extends BaseTFMMStrategy {
  private config: CompositeConfig
  private momentumStrategy: MomentumStrategy
  private meanReversionStrategy: MeanReversionStrategy
  private volatilityStrategy: VolatilityStrategy
  private currentRegime: MarketRegime = 'calm'

  constructor(oracle: OracleAggregator, config: Partial<CompositeConfig> = {}) {
    super('composite', oracle)
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize sub-strategies
    this.momentumStrategy = new MomentumStrategy(oracle, config.momentumConfig)
    this.meanReversionStrategy = new MeanReversionStrategy(
      oracle,
      config.meanReversionConfig,
    )
    this.volatilityStrategy = new VolatilityStrategy(
      oracle,
      config.volatilityConfig,
    )
  }

  async calculateWeights(ctx: StrategyContext): Promise<WeightCalculation> {
    // Run all strategies
    const [momentumResult, meanRevResult, volResult] = await Promise.all([
      this.momentumStrategy.calculateWeights(ctx),
      this.meanReversionStrategy.calculateWeights(ctx),
      this.volatilityStrategy.calculateWeights(ctx),
    ])

    // Detect market regime if enabled
    let strategyWeights = {
      momentum: this.config.momentumWeight,
      meanReversion: this.config.meanReversionWeight,
      volatility: this.config.volatilityWeight,
    }

    if (this.config.enableRegimeDetection) {
      this.currentRegime = this.detectRegime(ctx, momentumResult, volResult)
      strategyWeights = this.adjustWeightsForRegime(
        strategyWeights,
        this.currentRegime,
      )
    }

    // Combine signals
    const combinedSignals = this.combineSignals(
      ctx.tokens.map((t) => t.symbol),
      [
        { signals: momentumResult.signals, weight: strategyWeights.momentum },
        {
          signals: meanRevResult.signals,
          weight: strategyWeights.meanReversion,
        },
        { signals: volResult.signals, weight: strategyWeights.volatility },
      ],
    )

    // Combine weights
    const combinedWeights = this.combineWeights(
      [momentumResult, meanRevResult, volResult],
      [
        strategyWeights.momentum,
        strategyWeights.meanReversion,
        strategyWeights.volatility,
      ],
    )

    // Normalize and apply guard rails
    const normalizedWeights = this.normalizeWeights(combinedWeights)
    const safeWeights = this.applyGuardRails(
      ctx.currentWeights,
      normalizedWeights,
      ctx.riskParams,
    )

    // Calculate combined confidence
    const confidence = this.calculateCombinedConfidence(
      [
        momentumResult.confidence,
        meanRevResult.confidence,
        volResult.confidence,
      ],
      [
        strategyWeights.momentum,
        strategyWeights.meanReversion,
        strategyWeights.volatility,
      ],
    )

    // Add regime info to signals
    combinedSignals.push({
      token: 'REGIME',
      signal: this.regimeToSignal(this.currentRegime),
      strength: 0.8,
      reason: `Market regime: ${this.currentRegime}`,
    })

    return {
      newWeights: safeWeights,
      blocksToTarget: BigInt(this.config.blocksToTarget),
      confidence,
      signals: combinedSignals,
    }
  }

  /**
   * Detect current market regime
   */
  private detectRegime(
    _ctx: StrategyContext,
    momentumResult: WeightCalculation,
    volResult: WeightCalculation,
  ): MarketRegime {
    // Analyze momentum signals for trend detection
    const momentumStrength =
      momentumResult.signals
        .filter((s) => s.token !== 'REGIME')
        .reduce((sum, s) => sum + Math.abs(s.signal) * s.strength, 0) /
      momentumResult.signals.length

    // Analyze volatility signals
    const volStrength =
      volResult.signals
        .filter((s) => s.token !== 'REGIME')
        .reduce((sum, s) => sum + Math.abs(s.signal) * s.strength, 0) /
      volResult.signals.length

    // Check for volatility spikes
    const hasVolSpike = volResult.signals.some(
      (s) => s.reason.includes('spike') && s.strength > 0.5,
    )

    // Determine regime
    if (hasVolSpike || volStrength > 0.7) {
      return 'volatile'
    }

    if (momentumStrength > 0.5) {
      return 'trending'
    }

    if (momentumStrength < 0.2 && volStrength < 0.3) {
      return 'calm'
    }

    return 'ranging'
  }

  /**
   * Adjust strategy weights based on detected regime
   */
  private adjustWeightsForRegime(
    baseWeights: {
      momentum: number
      meanReversion: number
      volatility: number
    },
    regime: MarketRegime,
  ): { momentum: number; meanReversion: number; volatility: number } {
    switch (regime) {
      case 'trending':
        // Favor momentum in trending markets
        return {
          momentum: 0.6,
          meanReversion: 0.2,
          volatility: 0.2,
        }

      case 'ranging':
        // Favor mean reversion in ranging markets
        return {
          momentum: 0.2,
          meanReversion: 0.5,
          volatility: 0.3,
        }

      case 'volatile':
        // Favor volatility strategy during high vol
        return {
          momentum: 0.2,
          meanReversion: 0.2,
          volatility: 0.6,
        }

      case 'calm':
        // Balanced approach in calm markets
        return baseWeights

      default:
        return baseWeights
    }
  }

  /**
   * Combine signals from multiple strategies
   */
  private combineSignals(
    tokens: string[],
    strategyResults: { signals: StrategySignal[]; weight: number }[],
  ): StrategySignal[] {
    const combined: StrategySignal[] = []

    for (const token of tokens) {
      let totalSignal = 0
      let totalStrength = 0
      let totalWeight = 0
      const reasons: string[] = []

      for (const { signals, weight } of strategyResults) {
        const signal = signals.find((s) => s.token === token)
        if (signal) {
          totalSignal += signal.signal * signal.strength * weight
          totalStrength += signal.strength * weight
          totalWeight += weight
          if (signal.strength > 0.3) {
            reasons.push(signal.reason)
          }
        }
      }

      if (totalWeight > 0) {
        combined.push({
          token,
          signal: totalSignal / totalWeight,
          strength: totalStrength / totalWeight,
          reason:
            reasons.length > 0 ? reasons.join(' | ') : 'No strong signals',
        })
      }
    }

    return combined
  }

  /**
   * Combine weights from multiple strategies
   */
  private combineWeights(
    results: WeightCalculation[],
    weights: number[],
  ): bigint[] {
    const numTokens = results[0].newWeights.length
    const combined: bigint[] = new Array(numTokens).fill(0n)

    for (let i = 0; i < results.length; i++) {
      const strategyWeight = BigInt(Math.floor(weights[i] * 1000))
      for (let j = 0; j < numTokens; j++) {
        combined[j] += (results[i].newWeights[j] * strategyWeight) / 1000n
      }
    }

    return combined
  }

  /**
   * Calculate combined confidence score
   */
  private calculateCombinedConfidence(
    confidences: number[],
    weights: number[],
  ): number {
    let totalConfidence = 0
    let totalWeight = 0

    for (let i = 0; i < confidences.length; i++) {
      totalConfidence += confidences[i] * weights[i]
      totalWeight += weights[i]
    }

    return totalWeight > 0 ? totalConfidence / totalWeight : 0
  }

  /**
   * Convert regime to signal value
   */
  private regimeToSignal(regime: MarketRegime): number {
    switch (regime) {
      case 'trending':
        return 0.5
      case 'ranging':
        return 0
      case 'volatile':
        return -0.5
      case 'calm':
        return 0.2
      default:
        return 0
    }
  }

  /**
   * Get current detected regime
   */
  getRegime(): MarketRegime {
    return this.currentRegime
  }

  /**
   * Sync price history to all sub-strategies
   */
  override updatePriceHistory(
    prices: import('../../types').OraclePrice[],
  ): void {
    super.updatePriceHistory(prices)
    this.momentumStrategy.updatePriceHistory(prices)
    this.meanReversionStrategy.updatePriceHistory(prices)
    this.volatilityStrategy.updatePriceHistory(prices)
  }

  updateConfig(config: Partial<CompositeConfig>): void {
    this.config = { ...this.config, ...config }

    if (config.momentumConfig) {
      this.momentumStrategy.updateConfig(config.momentumConfig)
    }
    if (config.meanReversionConfig) {
      this.meanReversionStrategy.updateConfig(config.meanReversionConfig)
    }
    if (config.volatilityConfig) {
      this.volatilityStrategy.updateConfig(config.volatilityConfig)
    }
  }
}
