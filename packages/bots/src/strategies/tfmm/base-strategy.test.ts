/**
 * Base Strategy Math Function Tests
 * 
 * Tests for all mathematical functions in the base strategy:
 * - Moving averages (SMA, EMA)
 * - Standard deviation
 * - Momentum (Rate of Change)
 * - RSI (Relative Strength Index)
 * - Weight normalization
 * - Guard rails
 * - Integer square root
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { BaseTFMMStrategy, type StrategyContext, type WeightCalculation } from './base-strategy';
import { OracleAggregator } from '../../oracles';
import { WEIGHT_PRECISION, BPS_PRECISION } from '../../schemas';
import type { TFMMRiskParameters, OraclePrice, Token } from '../../types';

// Concrete implementation for testing protected methods
class TestableStrategy extends BaseTFMMStrategy {
  constructor() {
    super('test', new OracleAggregator({}));
  }

  async calculateWeights(ctx: StrategyContext): Promise<WeightCalculation> {
    return {
      newWeights: ctx.currentWeights,
      blocksToTarget: 100n,
      confidence: 1,
      signals: [],
    };
  }

  // Expose protected methods for testing
  public testCalculateSMA(prices: bigint[], period: number): bigint {
    return this.calculateSMA(prices, period);
  }

  public testCalculateEMA(prices: bigint[], period: number): bigint {
    return this.calculateEMA(prices, period);
  }

  public testCalculateStdDev(prices: bigint[]): bigint {
    return this.calculateStdDev(prices);
  }

  public testCalculateMomentum(prices: bigint[], period: number): bigint {
    return this.calculateMomentum(prices, period);
  }

  public testCalculateRSI(prices: bigint[], period: number): number {
    return this.calculateRSI(prices, period);
  }

  public testNormalizeWeights(weights: bigint[]): bigint[] {
    return this.normalizeWeights(weights);
  }

  public testApplyGuardRails(
    currentWeights: bigint[],
    targetWeights: bigint[],
    params: TFMMRiskParameters
  ): bigint[] {
    return this.applyGuardRails(currentWeights, targetWeights, params);
  }

  public testSqrt(n: bigint): bigint {
    return this.sqrt(n);
  }
}

describe('BaseTFMMStrategy Math Functions', () => {
  let strategy: TestableStrategy;

  beforeEach(() => {
    strategy = new TestableStrategy();
  });

  describe('calculateSMA', () => {
    test('should calculate simple moving average correctly', () => {
      const prices = [100n, 110n, 120n, 130n, 140n];
      const sma = strategy.testCalculateSMA(prices, 5);
      // (100 + 110 + 120 + 130 + 140) / 5 = 120
      expect(sma).toBe(120n);
    });

    test('should use only last N prices for period', () => {
      const prices = [50n, 60n, 100n, 110n, 120n, 130n, 140n];
      const sma = strategy.testCalculateSMA(prices, 5);
      // Uses last 5: (100 + 110 + 120 + 130 + 140) / 5 = 120
      expect(sma).toBe(120n);
    });

    test('should return 0 for insufficient data', () => {
      const prices = [100n, 110n];
      const sma = strategy.testCalculateSMA(prices, 5);
      expect(sma).toBe(0n);
    });

    test('should handle single price', () => {
      const prices = [100n];
      const sma = strategy.testCalculateSMA(prices, 1);
      expect(sma).toBe(100n);
    });

    test('should handle large prices (8 decimals)', () => {
      const prices = [
        300000000000n,  // $3000 with 8 decimals
        310000000000n,
        320000000000n,
        330000000000n,
        340000000000n,
      ];
      const sma = strategy.testCalculateSMA(prices, 5);
      expect(sma).toBe(320000000000n); // $3200
    });

    test('should handle period = 1', () => {
      const prices = [100n, 200n, 300n];
      const sma = strategy.testCalculateSMA(prices, 1);
      expect(sma).toBe(300n); // Just the last price
    });
  });

  describe('calculateEMA', () => {
    test('should weight recent prices more heavily', () => {
      const prices = [100n, 200n];
      const sma = strategy.testCalculateSMA(prices, 2);
      const ema = strategy.testCalculateEMA(prices, 2);
      
      // EMA should be closer to 200 (most recent) than SMA
      // SMA = 150, EMA > 150
      expect(sma).toBe(150n);
      expect(ema).toBeGreaterThanOrEqual(150n);
    });

    test('should return 0 for empty prices', () => {
      const ema = strategy.testCalculateEMA([], 5);
      expect(ema).toBe(0n);
    });

    test('should return single price for single element', () => {
      const ema = strategy.testCalculateEMA([100n], 5);
      expect(ema).toBe(100n);
    });

    test('should converge for constant prices', () => {
      const prices = [100n, 100n, 100n, 100n, 100n];
      const ema = strategy.testCalculateEMA(prices, 5);
      expect(ema).toBe(100n);
    });

    test('should handle trending prices', () => {
      const prices = [100n, 110n, 120n, 130n, 140n, 150n, 160n, 170n, 180n, 190n];
      const ema = strategy.testCalculateEMA(prices, 5);
      // EMA should be between min and max
      expect(ema).toBeGreaterThan(100n);
      expect(ema).toBeLessThan(200n);
    });
  });

  describe('calculateStdDev', () => {
    test('should return 0 for constant prices', () => {
      // Use WEIGHT_PRECISION scale values for realistic testing
      const base = WEIGHT_PRECISION;
      const prices = [base, base, base, base, base];
      const stdDev = strategy.testCalculateStdDev(prices);
      expect(stdDev).toBe(0n);
    });

    test('should return 0 for insufficient data', () => {
      const stdDev = strategy.testCalculateStdDev([WEIGHT_PRECISION]);
      expect(stdDev).toBe(0n);
    });

    test('should calculate positive std dev for varying prices', () => {
      // Use WEIGHT_PRECISION scale for meaningful calculations
      const base = WEIGHT_PRECISION;
      const prices = [
        base,
        base + base / 10n,  // +10%
        base - base / 10n,  // -10%
        base + base / 5n,   // +20%
        base - base / 5n,   // -20%
      ];
      const stdDev = strategy.testCalculateStdDev(prices);
      expect(stdDev).toBeGreaterThan(0n);
    });

    test('should increase with more spread', () => {
      const base = WEIGHT_PRECISION;
      const narrowPrices = [
        base,
        base + base / 100n,  // +1%
        base - base / 100n,  // -1%
        base,
        base + base / 100n,  // +1%
      ];
      const widePrices = [
        base,
        base + base / 2n,   // +50%
        base / 2n,          // -50%
        base + base / 5n,   // +20%
        base - base / 5n,   // -20%
      ];
      
      const narrowStdDev = strategy.testCalculateStdDev(narrowPrices);
      const wideStdDev = strategy.testCalculateStdDev(widePrices);
      
      expect(wideStdDev).toBeGreaterThan(narrowStdDev);
    });

    test('should handle prices with 18 decimals (WEIGHT_PRECISION scale)', () => {
      const base = WEIGHT_PRECISION;
      const prices = [
        base,
        base + base / 10n,  // +10%
        base - base / 10n,  // -10%
        base + base / 20n,  // +5%
        base - base / 20n,  // -5%
      ];
      const stdDev = strategy.testCalculateStdDev(prices);
      expect(stdDev).toBeGreaterThan(0n);
    });
  });

  describe('calculateMomentum', () => {
    test('should calculate positive momentum for uptrend', () => {
      // Period is how far BACK to look, not an index
      // calculateMomentum(prices, period) compares prices[length-1] to prices[length-period]
      const prices = [100n, 110n, 120n, 130n, 140n, 150n]; // 6 prices
      const momentum = strategy.testCalculateMomentum(prices, 5);
      // Compares prices[5]=150 to prices[1]=110
      // (150 - 110) / 110 * 10000 = 3636 bps
      expect(momentum).toBeGreaterThan(0n);
    });

    test('should calculate negative momentum for downtrend', () => {
      const prices = [150n, 140n, 130n, 120n, 110n, 100n]; // 6 prices
      const momentum = strategy.testCalculateMomentum(prices, 5);
      // Compares prices[5]=100 to prices[1]=140
      // (100 - 140) / 140 * 10000 = -2857 bps
      expect(momentum).toBeLessThan(0n);
    });

    test('should return 0 for insufficient data', () => {
      const prices = [100n, 110n];
      const momentum = strategy.testCalculateMomentum(prices, 5);
      expect(momentum).toBe(0n);
    });

    test('should return 0 when past price is 0', () => {
      // Put 0 at the position that will be looked up
      const prices = [100n, 0n, 110n, 120n, 130n, 140n]; // prices[1] = 0
      const momentum = strategy.testCalculateMomentum(prices, 5);
      // Compares prices[5]=140 to prices[1]=0
      expect(momentum).toBe(0n);
    });

    test('should handle 100% gain correctly', () => {
      const prices = [100n, 100n, 200n]; // 3 prices
      const momentum = strategy.testCalculateMomentum(prices, 2);
      // Compares prices[2]=200 to prices[0]=100
      // (200 - 100) / 100 * 10000 = 10000 bps = 100%
      expect(momentum).toBe(10000n);
    });

    test('should handle 50% loss correctly', () => {
      const prices = [200n, 200n, 100n]; // 3 prices
      const momentum = strategy.testCalculateMomentum(prices, 2);
      // Compares prices[2]=100 to prices[0]=200
      // (100 - 200) / 200 * 10000 = -5000 bps = -50%
      expect(momentum).toBe(-5000n);
    });
  });

  describe('calculateRSI', () => {
    test('should return 50 for insufficient data', () => {
      const prices = [100n, 110n, 120n];
      const rsi = strategy.testCalculateRSI(prices, 14);
      expect(rsi).toBe(50);
    });

    test('should return 100 for all gains', () => {
      // 16 prices with 15 consecutive gains
      const prices: bigint[] = [];
      for (let i = 0; i < 16; i++) {
        prices.push(BigInt(100 + i * 10));
      }
      const rsi = strategy.testCalculateRSI(prices, 14);
      expect(rsi).toBe(100);
    });

    test('should return 0 for all losses', () => {
      // 16 prices with 15 consecutive losses
      const prices: bigint[] = [];
      for (let i = 0; i < 16; i++) {
        prices.push(BigInt(200 - i * 10));
      }
      const rsi = strategy.testCalculateRSI(prices, 14);
      expect(rsi).toBe(0);
    });

    test('should return ~50 for balanced gains/losses', () => {
      // Alternating gains and losses of equal magnitude
      const prices: bigint[] = [];
      for (let i = 0; i < 16; i++) {
        prices.push(i % 2 === 0 ? 100n : 110n);
      }
      const rsi = strategy.testCalculateRSI(prices, 14);
      // RSI should be around 50 for equal up/down moves
      expect(rsi).toBeGreaterThan(30);
      expect(rsi).toBeLessThan(70);
    });

    test('should be between 0 and 100', () => {
      // Random walk
      const prices: bigint[] = [100n];
      for (let i = 1; i < 20; i++) {
        const change = i % 3 === 0 ? 10n : i % 3 === 1 ? -5n : 3n;
        prices.push(prices[i - 1] + change);
      }
      const rsi = strategy.testCalculateRSI(prices, 14);
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    });
  });

  describe('sqrt', () => {
    test('should calculate sqrt(0) = 0', () => {
      expect(strategy.testSqrt(0n)).toBe(0n);
    });

    test('should calculate sqrt(1) = 1', () => {
      expect(strategy.testSqrt(1n)).toBe(1n);
    });

    test('should calculate sqrt of perfect squares', () => {
      expect(strategy.testSqrt(4n)).toBe(2n);
      expect(strategy.testSqrt(9n)).toBe(3n);
      expect(strategy.testSqrt(16n)).toBe(4n);
      expect(strategy.testSqrt(100n)).toBe(10n);
      expect(strategy.testSqrt(10000n)).toBe(100n);
    });

    test('should floor non-perfect squares', () => {
      expect(strategy.testSqrt(5n)).toBe(2n);  // sqrt(5) ≈ 2.236
      expect(strategy.testSqrt(10n)).toBe(3n); // sqrt(10) ≈ 3.162
      expect(strategy.testSqrt(99n)).toBe(9n); // sqrt(99) ≈ 9.95
    });

    test('should handle large numbers (10^18 scale)', () => {
      const large = 10n ** 18n;
      expect(strategy.testSqrt(large)).toBe(10n ** 9n);
    });

    test('should throw for negative numbers', () => {
      expect(() => strategy.testSqrt(-1n)).toThrow('Cannot sqrt negative');
    });

    test('should handle WEIGHT_PRECISION scale', () => {
      // Common case: variance in 10^18 scale
      const variance = WEIGHT_PRECISION / 100n; // 1% variance in 10^18 scale
      const stdDev = strategy.testSqrt(variance * WEIGHT_PRECISION);
      expect(stdDev).toBeGreaterThan(0n);
    });
  });

  describe('normalizeWeights', () => {
    test('should normalize weights to sum to approximately WEIGHT_PRECISION', () => {
      const weights = [100n, 200n, 300n];
      const normalized = strategy.testNormalizeWeights(weights);
      
      const sum = normalized.reduce((a, b) => a + b, 0n);
      // Allow for small rounding error due to integer division
      expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 10n);
      expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION);
    });

    test('should maintain proportions', () => {
      const weights = [100n, 300n]; // 25% / 75%
      const normalized = strategy.testNormalizeWeights(weights);
      
      // First should be 25% of WEIGHT_PRECISION
      const expectedFirst = WEIGHT_PRECISION / 4n;
      expect(normalized[0]).toBe(expectedFirst);
      
      // Second should be 75% of WEIGHT_PRECISION
      const expectedSecond = (WEIGHT_PRECISION * 3n) / 4n;
      expect(normalized[1]).toBe(expectedSecond);
    });

    test('should handle equal weights', () => {
      const weights = [100n, 100n, 100n, 100n];
      const normalized = strategy.testNormalizeWeights(weights);
      
      const expectedEach = WEIGHT_PRECISION / 4n;
      for (const w of normalized) {
        expect(w).toBe(expectedEach);
      }
    });

    test('should handle zero sum by returning equal weights', () => {
      const weights = [0n, 0n, 0n];
      const normalized = strategy.testNormalizeWeights(weights);
      
      const expectedEach = WEIGHT_PRECISION / 3n;
      for (const w of normalized) {
        expect(w).toBe(expectedEach);
      }
    });

    test('should handle single weight', () => {
      const weights = [500n];
      const normalized = strategy.testNormalizeWeights(weights);
      expect(normalized[0]).toBe(WEIGHT_PRECISION);
    });

    test('should handle weights already at WEIGHT_PRECISION', () => {
      const weights = [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n];
      const normalized = strategy.testNormalizeWeights(weights);
      expect(normalized[0]).toBe(WEIGHT_PRECISION / 2n);
      expect(normalized[1]).toBe(WEIGHT_PRECISION / 2n);
    });
  });

  describe('applyGuardRails', () => {
    const defaultParams: TFMMRiskParameters = {
      minWeight: WEIGHT_PRECISION / 20n,  // 5%
      maxWeight: (WEIGHT_PRECISION * 95n) / 100n, // 95%
      maxWeightChangeBps: 500, // 5%
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 60,
      maxPriceDeviationBps: 500,
    };

    test('should enforce minimum weight', () => {
      const currentWeights = [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n];
      const targetWeights = [WEIGHT_PRECISION / 100n, (WEIGHT_PRECISION * 99n) / 100n]; // 1% / 99%
      
      const result = strategy.testApplyGuardRails(currentWeights, targetWeights, defaultParams);
      
      // First weight should be at least 5%
      expect(result[0]).toBeGreaterThanOrEqual(defaultParams.minWeight);
    });

    test('should enforce maximum weight', () => {
      const currentWeights = [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n];
      const targetWeights = [(WEIGHT_PRECISION * 99n) / 100n, WEIGHT_PRECISION / 100n]; // 99% / 1%
      
      const result = strategy.testApplyGuardRails(currentWeights, targetWeights, defaultParams);
      
      // First weight should be at most 95%
      expect(result[0]).toBeLessThanOrEqual(defaultParams.maxWeight);
    });

    test('should limit weight change per update', () => {
      const currentWeight = WEIGHT_PRECISION / 2n; // 50%
      const currentWeights = [currentWeight, currentWeight];
      
      // Try to change from 50% to 80%
      const targetWeights = [(WEIGHT_PRECISION * 80n) / 100n, (WEIGHT_PRECISION * 20n) / 100n];
      
      const result = strategy.testApplyGuardRails(currentWeights, targetWeights, defaultParams);
      
      // Change should be limited to 5% of current weight
      const maxChange = (currentWeight * BigInt(defaultParams.maxWeightChangeBps)) / BPS_PRECISION;
      const actualChange = result[0] > currentWeight 
        ? result[0] - currentWeight 
        : currentWeight - result[0];
      
      expect(actualChange).toBeLessThanOrEqual(maxChange);
    });

    test('should re-normalize after applying guard rails', () => {
      const currentWeights = [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n];
      const targetWeights = [WEIGHT_PRECISION / 4n, (WEIGHT_PRECISION * 3n) / 4n];
      
      const result = strategy.testApplyGuardRails(currentWeights, targetWeights, defaultParams);
      
      // Sum should be approximately WEIGHT_PRECISION
      const sum = result.reduce((a, b) => a + b, 0n);
      expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
      expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
    });

    test('should handle three tokens', () => {
      const thirdWeight = WEIGHT_PRECISION / 3n;
      const currentWeights = [thirdWeight, thirdWeight, thirdWeight];
      const targetWeights = [
        (WEIGHT_PRECISION * 50n) / 100n,
        (WEIGHT_PRECISION * 30n) / 100n,
        (WEIGHT_PRECISION * 20n) / 100n,
      ];
      
      const result = strategy.testApplyGuardRails(currentWeights, targetWeights, defaultParams);
      
      expect(result.length).toBe(3);
      for (const w of result) {
        expect(w).toBeGreaterThanOrEqual(defaultParams.minWeight);
        expect(w).toBeLessThanOrEqual(defaultParams.maxWeight);
      }
    });

    test('should preserve weights when no change needed', () => {
      const weights = [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n];
      
      const result = strategy.testApplyGuardRails(weights, weights, defaultParams);
      
      expect(result[0]).toBe(weights[0]);
      expect(result[1]).toBe(weights[1]);
    });
  });
});

describe('Price History Management', () => {
  test('should track price history', () => {
    const strategy = new TestableStrategy();
    
    const prices: OraclePrice[] = [
      { token: '0x1', price: 300000000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
    ];
    
    strategy.updatePriceHistory(prices);
    
    const history = strategy.getTokenPriceHistory('0x1');
    expect(history.length).toBe(1);
    expect(history[0].price).toBe(300000000000n);
  });

  test('should trim history to max length', () => {
    const strategy = new TestableStrategy();
    
    // Add more than max history
    for (let i = 0; i < 1100; i++) {
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(i), decimals: 8, timestamp: Date.now() + i, source: 'pyth' },
      ]);
    }
    
    const history = strategy.getTokenPriceHistory('0x1');
    expect(history.length).toBeLessThanOrEqual(1000);
  });

  test('should handle multiple tokens', () => {
    const strategy = new TestableStrategy();
    
    strategy.updatePriceHistory([
      { token: '0x1', price: 100n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
      { token: '0x2', price: 200n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
    ]);
    
    expect(strategy.getTokenPriceHistory('0x1').length).toBe(1);
    expect(strategy.getTokenPriceHistory('0x2').length).toBe(1);
    expect(strategy.getTokenPriceHistory('0x1')[0].price).toBe(100n);
    expect(strategy.getTokenPriceHistory('0x2')[0].price).toBe(200n);
  });

  test('should return empty for unknown token', () => {
    const strategy = new TestableStrategy();
    
    const history = strategy.getTokenPriceHistory('0xUnknown');
    expect(history.length).toBe(0);
  });
});

describe('Property-based Tests', () => {
  let strategy: TestableStrategy;

  beforeEach(() => {
    strategy = new TestableStrategy();
  });

  test('SMA of constant prices equals that constant', () => {
    for (let c = 1; c <= 10; c++) {
      const constant = BigInt(c * 100);
      const prices = Array(10).fill(constant);
      const sma = strategy.testCalculateSMA(prices, 5);
      expect(sma).toBe(constant);
    }
  });

  test('normalized weights always sum to approximately WEIGHT_PRECISION', () => {
    for (let trial = 0; trial < 20; trial++) {
      const numWeights = Math.floor(Math.random() * 5) + 2; // 2-6 weights
      const weights: bigint[] = [];
      for (let i = 0; i < numWeights; i++) {
        weights.push(BigInt(Math.floor(Math.random() * 1000) + 1));
      }
      
      const normalized = strategy.testNormalizeWeights(weights);
      const sum = normalized.reduce((a, b) => a + b, 0n);
      
      // Allow for small rounding error due to integer division
      expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - BigInt(numWeights));
      expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION);
    }
  });

  test('sqrt squared should be close to original', () => {
    const testValues = [1n, 4n, 100n, 10000n, 1000000n, WEIGHT_PRECISION];
    
    for (const val of testValues) {
      const sqrt = strategy.testSqrt(val);
      const squared = sqrt * sqrt;
      
      // squared should be <= val (since we floor)
      expect(squared).toBeLessThanOrEqual(val);
      // (sqrt + 1)^2 should be > val
      expect((sqrt + 1n) * (sqrt + 1n)).toBeGreaterThan(val);
    }
  });

  test('momentum is directionally correct', () => {
    // If prices go 100 -> 200 (100% up), and 200 -> 100 (50% down)
    // The momentum calculations should reflect these directions correctly
    // Note: Need 3 prices for period=2 (compares index length-1 to index length-period)
    
    const upPrices = [100n, 150n, 200n];
    const downPrices = [200n, 150n, 100n];
    
    const upMomentum = strategy.testCalculateMomentum(upPrices, 2);
    const downMomentum = strategy.testCalculateMomentum(downPrices, 2);
    
    expect(upMomentum).toBeGreaterThan(0n);
    expect(downMomentum).toBeLessThan(0n);
  });

  test('RSI is bounded 0-100 for any price series', () => {
    for (let trial = 0; trial < 10; trial++) {
      const prices: bigint[] = [100n];
      for (let i = 1; i < 20; i++) {
        const change = BigInt(Math.floor(Math.random() * 20) - 10);
        prices.push(prices[i - 1] + change);
      }
      
      const rsi = strategy.testCalculateRSI(prices, 14);
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    }
  });

  test('guard rails preserve weight sum invariant', () => {
    const params: TFMMRiskParameters = {
      minWeight: WEIGHT_PRECISION / 20n,
      maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
      maxWeightChangeBps: 500,
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 60,
      maxPriceDeviationBps: 500,
    };

    for (let trial = 0; trial < 10; trial++) {
      const numTokens = Math.floor(Math.random() * 4) + 2; // 2-5 tokens
      const currentWeights = strategy.testNormalizeWeights(
        Array(numTokens).fill(0).map(() => BigInt(Math.floor(Math.random() * 1000) + 100))
      );
      const targetWeights = strategy.testNormalizeWeights(
        Array(numTokens).fill(0).map(() => BigInt(Math.floor(Math.random() * 1000) + 100))
      );
      
      const result = strategy.testApplyGuardRails(currentWeights, targetWeights, params);
      const sum = result.reduce((a, b) => a + b, 0n);
      
      // Allow small rounding error
      expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
      expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
    }
  });
});
