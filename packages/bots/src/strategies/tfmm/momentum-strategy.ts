/**
 * Momentum Strategy for TFMM
 * 
 * Increases weight of assets with positive price momentum,
 * decreases weight of assets with negative momentum.
 * 
 * Philosophy: "Trend is your friend" - assets that are going up
 * tend to continue going up in the short/medium term.
 * 
 * Parameters:
 * - lookbackPeriod: How far back to measure momentum (default: 7 days)
 * - sensitivity: How aggressively to rebalance (1.0 = normal, 2.0 = aggressive)
 * - momentumThreshold: Minimum momentum to trigger rebalance (in bps)
 */

import { BaseTFMMStrategy, type StrategyContext, type WeightCalculation, type StrategySignal } from './base-strategy';
import type { OracleAggregator } from '../../oracles';

const WEIGHT_PRECISION = 10n ** 18n;
const BPS_PRECISION = 10000n;

export interface MomentumConfig {
  lookbackPeriodMs: number;      // Default: 7 days in ms
  shortTermPeriodMs: number;     // Default: 1 day in ms  
  sensitivity: number;           // 1.0 = normal, higher = more aggressive
  momentumThresholdBps: number;  // Minimum momentum to act on
  useEMA: boolean;               // Use EMA instead of SMA for smoothing
  blocksToTarget: number;        // Blocks to interpolate weights
}

const DEFAULT_CONFIG: MomentumConfig = {
  lookbackPeriodMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  shortTermPeriodMs: 24 * 60 * 60 * 1000,     // 1 day
  sensitivity: 1.0,
  momentumThresholdBps: 50,                   // 0.5% minimum movement
  useEMA: true,
  blocksToTarget: 300,                        // ~1 hour on Ethereum, ~1 min on Jeju
};

export class MomentumStrategy extends BaseTFMMStrategy {
  private config: MomentumConfig;

  constructor(
    oracle: OracleAggregator,
    config: Partial<MomentumConfig> = {}
  ) {
    super('momentum', oracle);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async calculateWeights(ctx: StrategyContext): Promise<WeightCalculation> {
    const { tokens, currentWeights, prices, riskParams } = ctx;
    const signals: StrategySignal[] = [];
    const momentumScores: bigint[] = [];

    // Calculate momentum for each token
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const priceHistory = this.getTokenPriceHistory(token.address);
      
      if (priceHistory.length < 2) {
        // Not enough history - maintain current weight
        momentumScores.push(WEIGHT_PRECISION);
        signals.push({
          token: token.symbol,
          signal: 0,
          strength: 0,
          reason: 'Insufficient price history',
        });
        continue;
      }

      // Get prices for different timeframes
      const now = Date.now();
      const longTermCutoff = now - this.config.lookbackPeriodMs;
      const shortTermCutoff = now - this.config.shortTermPeriodMs;

      const longTermPrices = priceHistory
        .filter(p => p.timestamp >= longTermCutoff)
        .map(p => p.price);
      
      const shortTermPrices = priceHistory
        .filter(p => p.timestamp >= shortTermCutoff)
        .map(p => p.price);

      // Calculate long-term momentum
      const longMomentum = this.calculateMomentum(longTermPrices, longTermPrices.length);
      
      // Calculate short-term momentum
      const shortMomentum = shortTermPrices.length > 1 
        ? this.calculateMomentum(shortTermPrices, shortTermPrices.length)
        : 0n;

      // Calculate moving averages for trend confirmation
      const shortMA = this.config.useEMA
        ? this.calculateEMA(shortTermPrices, Math.min(shortTermPrices.length, 12))
        : this.calculateSMA(shortTermPrices, Math.min(shortTermPrices.length, 12));
      
      const longMA = this.config.useEMA
        ? this.calculateEMA(longTermPrices, Math.min(longTermPrices.length, 24))
        : this.calculateSMA(longTermPrices, Math.min(longTermPrices.length, 24));

      // Combined momentum signal
      // Weight short-term more heavily (60% short, 40% long)
      const combinedMomentum = (shortMomentum * 6n + longMomentum * 4n) / 10n;

      // Check if momentum exceeds threshold
      const absMomentum = combinedMomentum > 0n ? combinedMomentum : -combinedMomentum;
      const meetsThreshold = absMomentum >= BigInt(this.config.momentumThresholdBps);

      // Calculate trend strength (MA crossover)
      const trendStrength = longMA > 0n 
        ? Number((shortMA - longMA) * 100n / longMA) / 100
        : 0;

      // Calculate signal strength (0 to 1)
      const signalStrength = meetsThreshold
        ? Math.min(1, Number(absMomentum) / 500) // Normalize to max 5% momentum
        : 0;

      // Apply sensitivity to momentum score
      const sensitivityMultiplier = BigInt(Math.floor(this.config.sensitivity * 100));
      const adjustedMomentum = meetsThreshold
        ? (combinedMomentum * sensitivityMultiplier) / 100n
        : 0n;

      // Convert momentum to weight multiplier
      // Positive momentum = higher weight, negative = lower weight
      // Scale: 100 bps momentum = 1% weight change
      const weightMultiplier = WEIGHT_PRECISION + (adjustedMomentum * WEIGHT_PRECISION / BPS_PRECISION);
      momentumScores.push(weightMultiplier);

      // Record signal
      const signalValue = Number(combinedMomentum) / Number(BPS_PRECISION);
      signals.push({
        token: token.symbol,
        signal: Math.max(-1, Math.min(1, signalValue)),
        strength: signalStrength,
        reason: this.formatSignalReason(combinedMomentum, trendStrength, meetsThreshold),
      });
    }

    // Calculate new weights based on momentum scores
    const newWeights: bigint[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const adjustedWeight = (currentWeights[i] * momentumScores[i]) / WEIGHT_PRECISION;
      newWeights.push(adjustedWeight);
    }

    // Normalize weights
    const normalizedWeights = this.normalizeWeights(newWeights);

    // Apply guard rails
    const safeWeights = this.applyGuardRails(currentWeights, normalizedWeights, riskParams);

    // Calculate confidence based on signal consistency
    const avgStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
    const signalConsistency = this.calculateSignalConsistency(signals);
    const confidence = avgStrength * signalConsistency;

    return {
      newWeights: safeWeights,
      blocksToTarget: BigInt(this.config.blocksToTarget),
      confidence,
      signals,
    };
  }

  private formatSignalReason(momentum: bigint, trend: number, meetsThreshold: boolean): string {
    const momentumPct = (Number(momentum) / 100).toFixed(2);
    const trendPct = (trend * 100).toFixed(2);
    
    if (!meetsThreshold) {
      return `Momentum ${momentumPct}% below threshold`;
    }
    
    if (momentum > 0n) {
      return `Bullish: ${momentumPct}% momentum, ${trendPct}% trend`;
    } else {
      return `Bearish: ${momentumPct}% momentum, ${trendPct}% trend`;
    }
  }

  private calculateSignalConsistency(signals: StrategySignal[]): number {
    if (signals.length < 2) return 1;

    // Check if signals are pointing in consistent directions
    // (some up, some down is normal - we want to detect conflicting strong signals)
    const strongSignals = signals.filter(s => s.strength > 0.5);
    
    if (strongSignals.length < 2) return 1;

    const positiveCount = strongSignals.filter(s => s.signal > 0).length;
    const negativeCount = strongSignals.filter(s => s.signal < 0).length;
    
    // High consistency if signals mostly agree
    const agreement = Math.max(positiveCount, negativeCount) / strongSignals.length;
    return agreement;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MomentumConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

