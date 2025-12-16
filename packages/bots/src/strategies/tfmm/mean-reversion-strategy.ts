/**
 * Mean Reversion Strategy for TFMM
 * 
 * Increases weight of assets that have fallen below their moving average,
 * decreases weight of assets that have risen above their moving average.
 * 
 * Philosophy: "Buy low, sell high" - assets that deviate significantly
 * from their average tend to revert to the mean.
 * 
 * Parameters:
 * - lookbackPeriod: Period for calculating the mean (default: 14 days)
 * - deviationThreshold: Min deviation from mean to trigger rebalance (2 std devs)
 * - sensitivity: How aggressively to rebalance
 */

import { BaseTFMMStrategy, type StrategyContext, type WeightCalculation, type StrategySignal } from './base-strategy';
import type { OracleAggregator } from '../../oracles';

const WEIGHT_PRECISION = 10n ** 18n;

export interface MeanReversionConfig {
  lookbackPeriodMs: number;       // Default: 14 days
  shortTermPeriodMs: number;      // For recent price (1 day)
  deviationThreshold: number;     // Standard deviations from mean (default: 1.5)
  sensitivity: number;            // Rebalance aggressiveness
  useBollinger: boolean;          // Use Bollinger Bands for threshold
  bollingerMultiplier: number;    // Bollinger Band width (default: 2)
  blocksToTarget: number;
}

const DEFAULT_CONFIG: MeanReversionConfig = {
  lookbackPeriodMs: 14 * 24 * 60 * 60 * 1000,  // 14 days
  shortTermPeriodMs: 24 * 60 * 60 * 1000,      // 1 day
  deviationThreshold: 1.5,
  sensitivity: 1.0,
  useBollinger: true,
  bollingerMultiplier: 2.0,
  blocksToTarget: 300,
};

export class MeanReversionStrategy extends BaseTFMMStrategy {
  private config: MeanReversionConfig;

  constructor(
    oracle: OracleAggregator,
    config: Partial<MeanReversionConfig> = {}
  ) {
    super('mean-reversion', oracle);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async calculateWeights(ctx: StrategyContext): Promise<WeightCalculation> {
    const { tokens, currentWeights, prices, riskParams } = ctx;
    const signals: StrategySignal[] = [];
    const reversionScores: bigint[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const priceHistory = this.getTokenPriceHistory(token.address);
      
      if (priceHistory.length < 10) {
        // Not enough history
        reversionScores.push(WEIGHT_PRECISION);
        signals.push({
          token: token.symbol,
          signal: 0,
          strength: 0,
          reason: 'Insufficient price history for mean reversion',
        });
        continue;
      }

      const now = Date.now();
      const cutoff = now - this.config.lookbackPeriodMs;
      
      const relevantPrices = priceHistory
        .filter(p => p.timestamp >= cutoff)
        .map(p => p.price);

      if (relevantPrices.length < 5) {
        reversionScores.push(WEIGHT_PRECISION);
        signals.push({
          token: token.symbol,
          signal: 0,
          strength: 0,
          reason: 'Not enough recent prices',
        });
        continue;
      }

      // Calculate mean and standard deviation
      const mean = this.calculateSMA(relevantPrices, relevantPrices.length);
      const stdDev = this.calculateStdDev(relevantPrices);
      
      // Get current price
      const currentPrice = relevantPrices[relevantPrices.length - 1];

      // Calculate z-score (number of std devs from mean)
      let zScore = 0;
      if (stdDev > 0n) {
        const deviation = currentPrice > mean ? currentPrice - mean : mean - currentPrice;
        zScore = Number((deviation * 100n) / stdDev) / 100;
        if (currentPrice < mean) zScore = -zScore;
      }

      // Calculate Bollinger Bands if enabled
      let upperBand: bigint;
      let lowerBand: bigint;
      
      if (this.config.useBollinger) {
        const bandWidth = (stdDev * BigInt(Math.floor(this.config.bollingerMultiplier * 100))) / 100n;
        upperBand = mean + bandWidth;
        lowerBand = mean - bandWidth;
      } else {
        const threshold = BigInt(Math.floor(this.config.deviationThreshold * 100));
        upperBand = mean + (stdDev * threshold) / 100n;
        lowerBand = mean - (stdDev * threshold) / 100n;
      }

      // Determine if price is outside bands
      const isOverbought = currentPrice > upperBand;
      const isOversold = currentPrice < lowerBand;

      // Calculate reversion signal
      // Oversold = increase weight (buy opportunity)
      // Overbought = decrease weight (sell opportunity)
      let signal = 0;
      let strength = 0;
      let reason = '';

      if (isOversold) {
        // Price below lower band - bullish reversion signal
        const distanceFromBand = lowerBand - currentPrice;
        const percentBelow = Number((distanceFromBand * 100n) / mean);
        
        signal = Math.min(1, Math.abs(zScore) / 3); // Max signal at 3 std devs
        strength = Math.min(1, percentBelow / 10); // Max strength at 10% below
        reason = `Oversold: ${Math.abs(zScore).toFixed(2)} std devs below mean (${percentBelow.toFixed(2)}% below band)`;
      } else if (isOverbought) {
        // Price above upper band - bearish reversion signal
        const distanceFromBand = currentPrice - upperBand;
        const percentAbove = Number((distanceFromBand * 100n) / mean);
        
        signal = -Math.min(1, Math.abs(zScore) / 3);
        strength = Math.min(1, percentAbove / 10);
        reason = `Overbought: ${Math.abs(zScore).toFixed(2)} std devs above mean (${percentAbove.toFixed(2)}% above band)`;
      } else {
        // Within bands - no strong signal
        signal = 0;
        strength = 0;
        reason = `Within bands: ${zScore.toFixed(2)} std devs from mean`;
      }

      // Convert signal to weight adjustment
      // Negative signal (overbought) = reduce weight
      // Positive signal (oversold) = increase weight
      const sensitivityMultiplier = this.config.sensitivity;
      const weightAdjustment = signal * strength * sensitivityMultiplier;
      
      // Convert to multiplier (1.0 = no change, 1.1 = 10% increase, 0.9 = 10% decrease)
      const multiplier = 1 + weightAdjustment * 0.2; // Max 20% adjustment per signal
      const weightMultiplier = BigInt(Math.floor(multiplier * Number(WEIGHT_PRECISION)));

      reversionScores.push(weightMultiplier);
      signals.push({
        token: token.symbol,
        signal,
        strength,
        reason,
      });
    }

    // Calculate new weights
    const newWeights: bigint[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const adjustedWeight = (currentWeights[i] * reversionScores[i]) / WEIGHT_PRECISION;
      newWeights.push(adjustedWeight);
    }

    // Normalize and apply guard rails
    const normalizedWeights = this.normalizeWeights(newWeights);
    const safeWeights = this.applyGuardRails(currentWeights, normalizedWeights, riskParams);

    // Calculate confidence
    const avgStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
    const hasSignals = signals.filter(s => s.strength > 0.3).length;
    const confidence = avgStrength * (hasSignals / signals.length);

    return {
      newWeights: safeWeights,
      blocksToTarget: BigInt(this.config.blocksToTarget),
      confidence,
      signals,
    };
  }

  /**
   * Calculate RSI for additional confirmation
   */
  private calculateRSISignal(prices: bigint[]): { rsi: number; signal: string } {
    const rsi = this.calculateRSI(prices, 14);
    
    if (rsi > 70) {
      return { rsi, signal: 'overbought' };
    } else if (rsi < 30) {
      return { rsi, signal: 'oversold' };
    }
    return { rsi, signal: 'neutral' };
  }

  updateConfig(config: Partial<MeanReversionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

