/**
 * Volatility Strategy for TFMM
 * 
 * Adjusts weights based on volatility metrics:
 * - Low volatility assets get higher weight (safer)
 * - High volatility assets get lower weight (riskier)
 * - Uses volatility targeting for risk parity
 * 
 * Philosophy: Risk-adjusted returns. Allocate more to stable assets
 * to reduce overall portfolio volatility while maintaining returns.
 * 
 * Parameters:
 * - targetVolatility: Desired annualized portfolio volatility (default: 15%)
 * - lookbackPeriod: Period for volatility calculation (default: 30 days)
 * - rebalanceOnVolSpike: Trigger rebalance on volatility spike
 */

import { BaseTFMMStrategy, type StrategyContext, type WeightCalculation, type StrategySignal } from './base-strategy';
import type { OracleAggregator } from '../../oracles';
import { WEIGHT_PRECISION } from '../../shared';

export interface VolatilityConfig {
  lookbackPeriodMs: number;         // Default: 30 days
  targetVolatilityPct: number;      // Target annualized vol (e.g., 15%)
  maxVolatilityPct: number;         // Max acceptable vol per asset (e.g., 100%)
  volSpikeThreshold: number;        // Vol increase to trigger emergency rebalance
  useInverseVolWeighting: boolean;  // Weight inversely to volatility
  minVolSampleSize: number;         // Minimum data points for vol calculation
  blocksToTarget: number;
}

const DEFAULT_CONFIG: VolatilityConfig = {
  lookbackPeriodMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
  targetVolatilityPct: 15,
  maxVolatilityPct: 100,
  volSpikeThreshold: 2.0,  // 2x normal vol triggers rebalance
  useInverseVolWeighting: true,
  minVolSampleSize: 20,
  blocksToTarget: 300,
};

interface VolatilityMetrics {
  dailyVol: number;
  annualizedVol: number;
  historicalVol: number;
  recentVol: number;
  volRatio: number;  // recent / historical
}

export class VolatilityStrategy extends BaseTFMMStrategy {
  private config: VolatilityConfig;
  private historicalVols: Map<string, number[]> = new Map();

  constructor(
    oracle: OracleAggregator,
    config: Partial<VolatilityConfig> = {}
  ) {
    super('volatility', oracle);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async calculateWeights(ctx: StrategyContext): Promise<WeightCalculation> {
    const { tokens, currentWeights, riskParams } = ctx;
    const signals: StrategySignal[] = [];
    const volatilities: VolatilityMetrics[] = [];

    // Calculate volatility for each token
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const priceHistory = this.getTokenPriceHistory(token.address);

      if (priceHistory.length < this.config.minVolSampleSize) {
        // Not enough data - use default volatility assumption
        volatilities.push({
          dailyVol: 0.02,        // 2% daily
          annualizedVol: 0.32,   // ~32% annual
          historicalVol: 0.32,
          recentVol: 0.32,
          volRatio: 1.0,
        });
        signals.push({
          token: token.symbol,
          signal: 0,
          strength: 0,
          reason: 'Insufficient data - using default volatility',
        });
        continue;
      }

      const now = Date.now();
      const cutoff = now - this.config.lookbackPeriodMs;
      const shortCutoff = now - (7 * 24 * 60 * 60 * 1000); // 7 days

      const allPrices = priceHistory
        .filter(p => p.timestamp >= cutoff)
        .map(p => p.price);

      const recentPrices = priceHistory
        .filter(p => p.timestamp >= shortCutoff)
        .map(p => p.price);

      // Calculate returns
      const returns = this.calculateReturns(allPrices);
      const recentReturns = this.calculateReturns(recentPrices);

      // Calculate volatilities
      const historicalVol = this.calculateVolatility(returns);
      const recentVol = recentReturns.length > 3 
        ? this.calculateVolatility(recentReturns)
        : historicalVol;

      // Annualize (assuming ~288 price points per day for 5-minute intervals)
      const samplesPerDay = Math.max(1, allPrices.length / 30); // Estimate
      const annualizationFactor = Math.sqrt(365 * samplesPerDay);
      
      const dailyVol = historicalVol;
      const annualizedVol = dailyVol * annualizationFactor;
      // Avoid division by zero - if historical vol is 0, treat ratio as 1 (normal)
      const volRatio = historicalVol > 0 ? recentVol / historicalVol : 1.0;

      volatilities.push({
        dailyVol,
        annualizedVol: Math.min(annualizedVol, this.config.maxVolatilityPct / 100),
        historicalVol,
        recentVol,
        volRatio,
      });

      // Update historical volatility tracking - empty array is valid initial state
      const tokenVols = this.historicalVols.get(token.address) ?? [];
      tokenVols.push(annualizedVol);
      if (tokenVols.length > 100) tokenVols.shift();
      this.historicalVols.set(token.address, tokenVols);

      // Generate signal based on volatility changes
      let signal = 0;
      let strength = 0;
      let reason = '';

      if (volRatio > this.config.volSpikeThreshold) {
        // Volatility spike - reduce weight
        signal = -Math.min(1, (volRatio - 1) / 2);
        strength = Math.min(1, volRatio / 3);
        reason = `Volatility spike: ${(volRatio * 100).toFixed(0)}% of normal`;
      } else if (volRatio < 0.5) {
        // Low volatility period - can increase weight
        signal = 0.3;
        strength = 0.5;
        reason = `Low volatility: ${(volRatio * 100).toFixed(0)}% of normal`;
      } else {
        reason = `Normal volatility: ${(annualizedVol * 100).toFixed(1)}% annual`;
      }

      signals.push({
        token: token.symbol,
        signal,
        strength,
        reason,
      });
    }

    // Calculate new weights using inverse volatility weighting
    let newWeights: bigint[];

    if (this.config.useInverseVolWeighting) {
      newWeights = this.calculateInverseVolWeights(volatilities, currentWeights);
    } else {
      newWeights = this.calculateVolTargetWeights(volatilities, currentWeights);
    }

    // Apply guard rails
    const safeWeights = this.applyGuardRails(currentWeights, newWeights, riskParams);

    // Calculate portfolio volatility for confidence
    const portfolioVol = this.calculatePortfolioVolatility(volatilities, safeWeights);
    const volGap = Math.abs(portfolioVol - this.config.targetVolatilityPct / 100);
    const confidence = Math.max(0, 1 - volGap * 5); // 20% gap = 0 confidence

    return {
      newWeights: safeWeights,
      blocksToTarget: BigInt(this.config.blocksToTarget),
      confidence,
      signals,
    };
  }

  /**
   * Calculate returns from prices
   */
  private calculateReturns(prices: bigint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = Number(prices[i - 1]);
      const curr = Number(prices[i]);
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  /**
   * Calculate volatility (standard deviation of returns)
   */
  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => (r - mean) ** 2);
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Calculate inverse volatility weights
   * Lower vol = higher weight
   */
  private calculateInverseVolWeights(
    volatilities: VolatilityMetrics[],
    currentWeights: bigint[]
  ): bigint[] {
    // Calculate inverse vol scores
    const inverseVols = volatilities.map(v => {
      const vol = Math.max(0.01, v.annualizedVol); // Min 1% vol
      return 1 / vol;
    });

    // Normalize
    const totalInverseVol = inverseVols.reduce((a, b) => a + b, 0);
    const targetWeights = inverseVols.map(iv => iv / totalInverseVol);

    // Blend with current weights (gradual adjustment)
    const blendFactor = 0.3; // 30% new, 70% current
    const blendedWeights: bigint[] = [];

    for (let i = 0; i < currentWeights.length; i++) {
      const currentPct = Number(currentWeights[i]) / Number(WEIGHT_PRECISION);
      const targetPct = targetWeights[i];
      const blendedPct = currentPct * (1 - blendFactor) + targetPct * blendFactor;
      blendedWeights.push(BigInt(Math.floor(blendedPct * Number(WEIGHT_PRECISION))));
    }

    return this.normalizeWeights(blendedWeights);
  }

  /**
   * Calculate weights to achieve target portfolio volatility
   */
  private calculateVolTargetWeights(
    volatilities: VolatilityMetrics[],
    currentWeights: bigint[]
  ): bigint[] {
    const targetVol = this.config.targetVolatilityPct / 100;
    
    // Simple approach: scale weights to target vol
    // More sophisticated would use covariance matrix
    const currentPortfolioVol = this.calculatePortfolioVolatility(volatilities, currentWeights);
    
    if (currentPortfolioVol === 0) return currentWeights;

    const scaleFactor = targetVol / currentPortfolioVol;
    
    // Apply scaling with limits
    const cappedScale = Math.max(0.5, Math.min(2.0, scaleFactor));
    
    // Adjust high-vol assets down, low-vol assets up
    const avgVol = volatilities.reduce((s, v) => s + v.annualizedVol, 0) / volatilities.length;
    
    const adjustedWeights: bigint[] = [];
    for (let i = 0; i < currentWeights.length; i++) {
      const volRatio = volatilities[i].annualizedVol / avgVol;
      const adjustment = 1 / volRatio; // Higher vol = lower adjustment
      const scaledAdjustment = 1 + (adjustment - 1) * (cappedScale - 1);
      
      const newWeight = (currentWeights[i] * BigInt(Math.floor(scaledAdjustment * 1000))) / 1000n;
      adjustedWeights.push(newWeight);
    }

    return this.normalizeWeights(adjustedWeights);
  }

  /**
   * Calculate portfolio volatility (simplified - assumes no correlation)
   */
  private calculatePortfolioVolatility(
    volatilities: VolatilityMetrics[],
    weights: bigint[]
  ): number {
    // Simple weighted average of volatilities
    // More accurate would include correlation matrix
    let portfolioVar = 0;
    
    for (let i = 0; i < volatilities.length; i++) {
      const weight = Number(weights[i]) / Number(WEIGHT_PRECISION);
      const vol = volatilities[i].annualizedVol;
      portfolioVar += (weight * vol) ** 2;
    }

    return Math.sqrt(portfolioVar);
  }

  updateConfig(config: Partial<VolatilityConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

