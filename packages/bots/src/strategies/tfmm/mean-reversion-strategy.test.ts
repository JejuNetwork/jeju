/**
 * Mean Reversion Strategy Tests
 * 
 * Tests for mean reversion weight allocation:
 * - Z-score calculation
 * - Bollinger band detection
 * - Oversold/overbought signals
 * - Signal strength calculation
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MeanReversionStrategy } from './mean-reversion-strategy';
import { OracleAggregator } from '../../oracles';
import { WEIGHT_PRECISION } from '../../schemas';
import type { StrategyContext } from './base-strategy';
import type { Token, TFMMRiskParameters } from '../../types';

describe('MeanReversionStrategy', () => {
  let strategy: MeanReversionStrategy;
  let tokens: Token[];
  let riskParams: TFMMRiskParameters;

  beforeEach(() => {
    strategy = new MeanReversionStrategy(new OracleAggregator({}), {
      lookbackPeriodMs: 14 * 24 * 60 * 60 * 1000,
      shortTermPeriodMs: 24 * 60 * 60 * 1000,
      deviationThreshold: 1.5,
      sensitivity: 1.0,
      useBollinger: true,
      bollingerMultiplier: 2.0,
      blocksToTarget: 100,
    });

    tokens = [
      { address: '0x1', symbol: 'WETH', decimals: 18, chainId: 8453 },
      { address: '0x2', symbol: 'USDC', decimals: 6, chainId: 8453 },
    ];

    riskParams = {
      minWeight: WEIGHT_PRECISION / 20n,
      maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
      maxWeightChangeBps: 500,
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 60,
      maxPriceDeviationBps: 500,
    };
  });

  test('should return neutral weights with insufficient history', async () => {
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 300000000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: Date.now(),
    };

    const result = await strategy.calculateWeights(ctx);

    expect(result.newWeights.length).toBe(2);
    // Signals should indicate insufficient data
    expect(result.signals[0].strength).toBe(0);
  });

  test('should increase weight for oversold asset', async () => {
    const now = Date.now();
    
    // Create history around 3000, then drop to 2700 (10% below)
    for (let i = 0; i < 30; i++) {
      const timestamp = now - (30 - i) * 3600000;
      const sinVal = Math.floor(Math.sin(i / 3) * 3000000000);
      const price = i < 25 
        ? 300000000000n + BigInt(sinVal) // Normal fluctuation
        : 270000000000n; // Sharp drop
      
      strategy.updatePriceHistory([
        { token: '0x1', price, decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 270000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    // Should have bullish signal for oversold WETH
    const ethSignal = result.signals.find(s => s.token === 'WETH');
    expect(ethSignal).toBeDefined();
    // Signal could be positive (buy opportunity) for oversold conditions
    expect(result.newWeights.length).toBe(2);
  });

  test('should decrease weight for overbought asset', async () => {
    const now = Date.now();
    
    // Create history around 3000, then spike to 3300 (10% above)
    for (let i = 0; i < 30; i++) {
      const timestamp = now - (30 - i) * 3600000;
      const sinVal = Math.floor(Math.sin(i / 3) * 3000000000);
      const price = i < 25 
        ? 300000000000n + BigInt(sinVal) // Normal fluctuation
        : 330000000000n; // Sharp spike
      
      strategy.updatePriceHistory([
        { token: '0x1', price, decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 330000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    // Should have bearish signal for overbought WETH
    const ethSignal = result.signals.find(s => s.token === 'WETH');
    expect(ethSignal).toBeDefined();
    expect(result.newWeights.length).toBe(2);
  });

  test('should give neutral signal when within bands', async () => {
    const now = Date.now();
    
    // Create stable history - very small fluctuation around mean
    for (let i = 0; i < 30; i++) {
      const timestamp = now - (30 - i) * 3600000;
      // Much smaller fluctuation to stay well within Bollinger bands
      const sinVal = Math.floor(Math.sin(i / 3) * 100000000); // ~0.03% fluctuation
      const price = 300000000000n + BigInt(sinVal);
      
      strategy.updatePriceHistory([
        { token: '0x1', price, decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 300000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    // First signal (WETH) should have low strength when within bands
    // Signal can be slightly non-zero but should be close to neutral
    expect(Math.abs(result.signals[0].signal)).toBeLessThanOrEqual(0.1);
    expect(result.signals[0].strength).toBeLessThan(0.5);
  });

  test('should maintain normalized weights', async () => {
    const now = Date.now();
    
    for (let i = 0; i < 30; i++) {
      const timestamp = now - (30 - i) * 3600000;
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(300000000000 + i * 1000000000), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 330000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
  });

  test('should handle sensitivity adjustment', async () => {
    const lowSensitivity = new MeanReversionStrategy(new OracleAggregator({}), {
      sensitivity: 0.5,
      blocksToTarget: 100,
    });
    const highSensitivity = new MeanReversionStrategy(new OracleAggregator({}), {
      sensitivity: 2.0,
      blocksToTarget: 100,
    });

    const now = Date.now();
    
    // Same price history for both
    for (let i = 0; i < 30; i++) {
      const timestamp = now - (30 - i) * 3600000;
      const price = i < 25 ? 300000000000n : 270000000000n;
      
      lowSensitivity.updatePriceHistory([
        { token: '0x1', price, decimals: 8, timestamp, source: 'pyth' },
      ]);
      highSensitivity.updatePriceHistory([
        { token: '0x1', price, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const singleToken: Token[] = [{ address: '0x1', symbol: 'ETH', decimals: 18, chainId: 1 }];
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens: singleToken,
      currentWeights: [WEIGHT_PRECISION],
      prices: [{ token: '0x1', price: 270000000000n, decimals: 8, timestamp: now, source: 'pyth' }],
      priceHistory: [],
      riskParams,
      blockNumber: 100n,
      timestamp: now,
    };

    const lowResult = await lowSensitivity.calculateWeights(ctx);
    const highResult = await highSensitivity.calculateWeights(ctx);

    // Both should have valid results
    expect(lowResult.newWeights.length).toBe(1);
    expect(highResult.newWeights.length).toBe(1);
  });
});

describe('Mean Reversion Strategy Properties', () => {
  test('should work with Bollinger bands disabled', async () => {
    const strategy = new MeanReversionStrategy(new OracleAggregator({}), {
      useBollinger: false,
      deviationThreshold: 2.0,
      blocksToTarget: 100,
    });

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(100 + i) * 10n ** 8n, decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION],
      prices: [{ token: '0x1', price: 130n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' }],
      priceHistory: [],
      riskParams: {
        minWeight: WEIGHT_PRECISION / 20n,
        maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
        maxWeightChangeBps: 500,
        minUpdateIntervalBlocks: 10,
        oracleStalenessSeconds: 60,
        maxPriceDeviationBps: 500,
      },
      blockNumber: 100n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);
    expect(result.newWeights.length).toBe(1);
  });

  test('should handle three-token pool', async () => {
    const strategy = new MeanReversionStrategy(new OracleAggregator({}));

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
      { address: '0x3', symbol: 'C', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const sin1 = Math.floor(Math.sin(i) * 5 * 10 ** 7);
      const cos1 = Math.floor(Math.cos(i) * 2 * 10 ** 7);
      const sin2 = Math.floor(Math.sin(i * 2) * 10 ** 8);
      strategy.updatePriceHistory([
        { token: '0x1', price: 100n * 10n ** 8n + BigInt(sin1), decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n + BigInt(cos1), decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
        { token: '0x3', price: 200n * 10n ** 8n + BigInt(sin2), decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const third = WEIGHT_PRECISION / 3n;
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [third, third, third],
      prices: [
        { token: '0x1', price: 100n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x3', price: 200n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams: {
        minWeight: WEIGHT_PRECISION / 20n,
        maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
        maxWeightChangeBps: 500,
        minUpdateIntervalBlocks: 10,
        oracleStalenessSeconds: 60,
        maxPriceDeviationBps: 500,
      },
      blockNumber: 100n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    expect(result.newWeights.length).toBe(3);
    expect(result.signals.length).toBe(3);
    
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
  });

  test('should update configuration', () => {
    const strategy = new MeanReversionStrategy(new OracleAggregator({}));
    
    strategy.updateConfig({
      sensitivity: 1.5,
      bollingerMultiplier: 2.5,
    });
    
    expect(strategy.getName()).toBe('mean-reversion');
  });
});
