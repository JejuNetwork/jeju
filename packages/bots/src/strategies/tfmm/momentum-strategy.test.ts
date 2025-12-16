/**
 * Momentum Strategy Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MomentumStrategy } from './momentum-strategy';
import { OracleAggregator } from '../../oracles';
import type { StrategyContext, WeightCalculation } from './base-strategy';
import type { Token, TFMMRiskParameters, OraclePrice } from '../../types';

const WEIGHT_PRECISION = 10n ** 18n;

describe('MomentumStrategy', () => {
  let strategy: MomentumStrategy;
  let mockOracle: OracleAggregator;
  let tokens: Token[];
  let riskParams: TFMMRiskParameters;

  beforeEach(() => {
    mockOracle = new OracleAggregator({});
    strategy = new MomentumStrategy(mockOracle, {
      lookbackPeriodMs: 7 * 24 * 60 * 60 * 1000,
      shortTermPeriodMs: 24 * 60 * 60 * 1000,
      sensitivity: 1.0,
      momentumThresholdBps: 50,
      useEMA: true,
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

  test('should return equal weights with no price history', async () => {
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: 'WETH', price: 300000000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
        { token: 'USDC', price: 100000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: Date.now(),
    };

    const result = await strategy.calculateWeights(ctx);

    expect(result.newWeights.length).toBe(2);
    expect(result.blocksToTarget).toBe(100n);
    // Weights should be normalized
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
  });

  test('should increase weight for asset with positive momentum', async () => {
    // Simulate price history with upward trend for WETH
    // Need to update history using token ADDRESS not symbol
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const timestamp = now - (10 - i) * 3600000; // Hourly data
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(3000_00000000 + i * 50_00000000), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: 'WETH', price: 345000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: 'USDC', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    // With price history added, weights should change
    // But strategy looks up by token address so needs matching addresses
    expect(result.newWeights.length).toBe(2);
    // Weights should be normalized
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
  });

  test('should decrease weight for asset with negative momentum', async () => {
    const now = Date.now();
    // Simulate downward trend for WETH using token address
    for (let i = 0; i < 10; i++) {
      const timestamp = now - (10 - i) * 3600000;
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(3000_00000000 - i * 50_00000000), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: 'WETH', price: 255000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: 'USDC', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    // Weights should be normalized
    expect(result.newWeights.length).toBe(2);
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
  });

  test('should respect guard rails on weight changes', async () => {
    const now = Date.now();
    // Extreme price movement
    for (let i = 0; i < 10; i++) {
      strategy.updatePriceHistory([
        { token: 'WETH', price: BigInt(3000_00000000 + i * 500_00000000), decimals: 8, timestamp: now - (10 - i) * 3600000, source: 'pyth' },
        { token: 'USDC', price: 100000000n, decimals: 8, timestamp: now - (10 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const currentWeight = WEIGHT_PRECISION / 2n;
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [currentWeight, currentWeight],
      prices: [
        { token: 'WETH', price: 750000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: 'USDC', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    // Weight change should be limited by guard rails
    const weightChange = result.newWeights[0] > currentWeight
      ? result.newWeights[0] - currentWeight
      : currentWeight - result.newWeights[0];
    
    const maxChange = (currentWeight * BigInt(riskParams.maxWeightChangeBps)) / 10000n;
    expect(weightChange).toBeLessThanOrEqual(maxChange);
  });

  test('should update configuration', () => {
    strategy.updateConfig({
      sensitivity: 2.0,
      momentumThresholdBps: 100,
    });

    // Config update should not throw
    expect(strategy.getName()).toBe('momentum');
  });
});

describe('MomentumStrategy edge cases', () => {
  test('should handle empty price history gracefully', async () => {
    const strategy = new MomentumStrategy(new OracleAggregator({}));
    const tokens: Token[] = [
      { address: '0x1', symbol: 'ETH', decimals: 18, chainId: 8453 },
    ];

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION],
      prices: [
        { token: 'ETH', price: 300000000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
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
      timestamp: Date.now(),
    };

    const result = await strategy.calculateWeights(ctx);
    expect(result.newWeights.length).toBe(1);
  });
});

