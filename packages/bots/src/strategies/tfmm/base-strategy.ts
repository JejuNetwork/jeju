/**
 * Base Strategy for TFMM Weight Calculation
 * 
 * Provides common functionality for all TFMM strategies:
 * - Price history management
 * - Moving average calculations
 * - Weight normalization
 * - Guard rail enforcement
 */

import type { TFMMRiskParameters, OraclePrice, Token } from '../../types';
import type { OracleAggregator } from '../../oracles';
import { WEIGHT_PRECISION, BPS_PRECISION } from '../../schemas';

// ============ Types ============

export interface StrategyContext {
  pool: string;
  tokens: Token[];
  currentWeights: bigint[];
  prices: OraclePrice[];
  priceHistory: PriceHistory[];
  riskParams: TFMMRiskParameters;
  blockNumber: bigint;
  timestamp: number;
}

export interface PriceHistory {
  timestamp: number;
  prices: Map<string, bigint>; // token address -> price
}

export interface WeightCalculation {
  newWeights: bigint[];
  blocksToTarget: bigint;
  confidence: number;
  signals: StrategySignal[];
}

export interface StrategySignal {
  token: string;
  signal: number;       // -1 to 1, negative = bearish, positive = bullish
  strength: number;     // 0 to 1, confidence in signal
  reason: string;
}

// ============ Base Strategy Class ============

export abstract class BaseTFMMStrategy {
  protected readonly name: string;
  protected priceHistory: PriceHistory[] = [];
  protected maxHistoryLength: number;
  protected readonly oracle: OracleAggregator;

  constructor(
    name: string,
    oracle: OracleAggregator,
    maxHistoryLength = 1000
  ) {
    this.name = name;
    this.oracle = oracle;
    this.maxHistoryLength = maxHistoryLength;
  }

  /**
   * Calculate new weights - must be implemented by subclasses
   */
  abstract calculateWeights(ctx: StrategyContext): Promise<WeightCalculation>;

  /**
   * Update price history
   */
  updatePriceHistory(prices: OraclePrice[]): void {
    const entry: PriceHistory = {
      timestamp: Date.now(),
      prices: new Map(),
    };

    for (const price of prices) {
      entry.prices.set(price.token, price.price);
    }

    this.priceHistory.push(entry);

    // Trim history
    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory = this.priceHistory.slice(-this.maxHistoryLength);
    }
  }

  /**
   * Get price history for a specific token
   */
  getTokenPriceHistory(token: string): { timestamp: number; price: bigint }[] {
    return this.priceHistory
      .filter(h => h.prices.has(token))
      .map(h => ({
        timestamp: h.timestamp,
        price: h.prices.get(token)!,
      }));
  }

  /**
   * Calculate simple moving average
   */
  protected calculateSMA(prices: bigint[], period: number): bigint {
    if (prices.length < period) return 0n;
    
    const slice = prices.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0n);
    return sum / BigInt(period);
  }

  /**
   * Calculate exponential moving average
   */
  protected calculateEMA(prices: bigint[], period: number): bigint {
    if (prices.length === 0) return 0n;
    
    const multiplier = 2n * WEIGHT_PRECISION / BigInt(period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier + ema * (WEIGHT_PRECISION - multiplier)) / WEIGHT_PRECISION;
    }

    return ema;
  }

  /**
   * Calculate standard deviation
   */
  protected calculateStdDev(prices: bigint[]): bigint {
    if (prices.length < 2) return 0n;

    const mean = prices.reduce((a, b) => a + b, 0n) / BigInt(prices.length);
    
    let sumSquaredDiff = 0n;
    for (const price of prices) {
      const diff = price > mean ? price - mean : mean - price;
      sumSquaredDiff += (diff * diff) / WEIGHT_PRECISION;
    }

    const variance = sumSquaredDiff / BigInt(prices.length);
    return this.sqrt(variance * WEIGHT_PRECISION);
  }

  /**
   * Calculate momentum (rate of change)
   */
  protected calculateMomentum(prices: bigint[], period: number): bigint {
    if (prices.length < period) return 0n;

    const current = prices[prices.length - 1];
    const past = prices[prices.length - period];
    
    if (past === 0n) return 0n;
    
    // Return as basis points change
    return ((current - past) * BPS_PRECISION) / past;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  protected calculateRSI(prices: bigint[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0n;
    let losses = 0n;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0n) {
        gains += change;
      } else {
        losses += -change;
      }
    }

    if (losses === 0n) return 100;
    if (gains === 0n) return 0;

    const rs = (gains * 100n) / losses;
    const rsi = Number((100n * rs) / (rs + 100n));
    
    return rsi;
  }

  /**
   * Normalize weights to sum to WEIGHT_PRECISION
   */
  protected normalizeWeights(weights: bigint[]): bigint[] {
    const sum = weights.reduce((a, b) => a + b, 0n);
    if (sum === 0n) {
      // Equal weights fallback
      const equalWeight = WEIGHT_PRECISION / BigInt(weights.length);
      return weights.map(() => equalWeight);
    }

    return weights.map(w => (w * WEIGHT_PRECISION) / sum);
  }

  /**
   * Apply guard rails to weight changes
   */
  protected applyGuardRails(
    currentWeights: bigint[],
    targetWeights: bigint[],
    params: TFMMRiskParameters
  ): bigint[] {
    const result: bigint[] = [];
    const maxChangeBps = BigInt(params.maxWeightChangeBps);

    for (let i = 0; i < targetWeights.length; i++) {
      let newWeight = targetWeights[i];
      const currentWeight = currentWeights[i];

      // Enforce min/max weight
      if (newWeight < params.minWeight) newWeight = params.minWeight;
      if (newWeight > params.maxWeight) newWeight = params.maxWeight;

      // Enforce max change per update
      const change = newWeight > currentWeight 
        ? newWeight - currentWeight 
        : currentWeight - newWeight;
      
      const maxChange = (currentWeight * maxChangeBps) / BPS_PRECISION;
      
      if (change > maxChange) {
        if (newWeight > currentWeight) {
          newWeight = currentWeight + maxChange;
        } else {
          newWeight = currentWeight - maxChange;
        }
      }

      result.push(newWeight);
    }

    // Re-normalize after guard rails
    return this.normalizeWeights(result);
  }

  /**
   * Integer square root using Newton's method
   */
  protected sqrt(n: bigint): bigint {
    if (n < 0n) throw new Error('Cannot sqrt negative');
    if (n < 2n) return n;

    let x = n;
    let y = (x + 1n) / 2n;
    
    while (y < x) {
      x = y;
      y = (x + n / x) / 2n;
    }
    
    return x;
  }

  /**
   * Get strategy name
   */
  getName(): string {
    return this.name;
  }
}


