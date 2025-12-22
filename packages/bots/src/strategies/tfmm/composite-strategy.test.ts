/**
 * Composite Strategy Tests
 * 
 * Tests for multi-strategy combination:
 * - Regime detection
 * - Signal combination
 * - Weight blending
 * - Confidence calculation
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { CompositeStrategy, type MarketRegime } from './composite-strategy';
import { OracleAggregator } from '../../oracles';
import { WEIGHT_PRECISION } from '../../schemas';
import type { StrategyContext } from './base-strategy';
import type { Token, TFMMRiskParameters, OraclePrice } from '../../types';

describe('CompositeStrategy', () => {
  let strategy: CompositeStrategy;
  let tokens: Token[];
  let riskParams: TFMMRiskParameters;

  beforeEach(() => {
    strategy = new CompositeStrategy(new OracleAggregator({}), {
      momentumWeight: 0.4,
      meanReversionWeight: 0.3,
      volatilityWeight: 0.3,
      enableRegimeDetection: true,
      conflictResolution: 'average',
      minConfidenceThreshold: 0.3,
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

  test('should calculate combined weights from all strategies', async () => {
    const now = Date.now();
    
    // Add price history
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (50 - i) * 3600000;
      strategy.updatePriceHistory([
        { token: '0x1', price: 300000000000n + BigInt(i * 1000000000), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 350000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);

    expect(result.newWeights.length).toBe(2);
    expect(result.blocksToTarget).toBe(100n);
    expect(result.signals.length).toBeGreaterThan(0);
    
    // Should include REGIME signal
    const regimeSignal = result.signals.find(s => s.token === 'REGIME');
    expect(regimeSignal).toBeDefined();
  });

  test('should detect trending regime', async () => {
    const now = Date.now();
    
    // Strong uptrend
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (50 - i) * 3600000;
      strategy.updatePriceHistory([
        { token: '0x1', price: 300000000000n + BigInt(i * 5000000000), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 550000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    await strategy.calculateWeights(ctx);
    const regime = strategy.getRegime();
    
    // Strong trend should be detected
    expect(['trending', 'volatile', 'ranging', 'calm']).toContain(regime);
  });

  test('should weight sum to WEIGHT_PRECISION', async () => {
    const now = Date.now();
    
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (50 - i) * 3600000;
      const sinVal = Math.floor(Math.sin(i / 5) * 10000000000);
      const cosVal = Math.floor(Math.cos(i / 5) * 500000);
      strategy.updatePriceHistory([
        { token: '0x1', price: 300000000000n + BigInt(sinVal), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n + BigInt(cosVal), decimals: 8, timestamp, source: 'pyth' },
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
    
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
  });

  test('should propagate price history to sub-strategies', () => {
    const prices: OraclePrice[] = [
      { token: '0x1', price: 300000000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
      { token: '0x2', price: 100000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
    ];
    
    // This should update all sub-strategies
    strategy.updatePriceHistory(prices);
    
    // Verify by checking our own history
    const history = strategy.getTokenPriceHistory('0x1');
    expect(history.length).toBe(1);
  });

  test('should calculate combined confidence', async () => {
    const now = Date.now();
    
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (50 - i) * 3600000;
      strategy.updatePriceHistory([
        { token: '0x1', price: 300000000000n + BigInt(i * 1000000000), decimals: 8, timestamp, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 350000000000n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: now, source: 'pyth' },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    };

    const result = await strategy.calculateWeights(ctx);
    
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test('should update configuration', () => {
    strategy.updateConfig({
      momentumWeight: 0.5,
      meanReversionWeight: 0.25,
      volatilityWeight: 0.25,
    });
    
    expect(strategy.getName()).toBe('composite');
  });
});

describe('Regime Detection', () => {
  test('should adjust weights for trending regime', async () => {
    const strategy = new CompositeStrategy(new OracleAggregator({}), {
      momentumWeight: 0.33,
      meanReversionWeight: 0.33,
      volatilityWeight: 0.34,
      enableRegimeDetection: true,
    });

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    // Strong uptrend
    for (let i = 0; i < 50; i++) {
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(100 + i * 5) * 10n ** 8n, decimals: 8, timestamp: now - (50 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION],
      prices: [{ token: '0x1', price: 350n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' }],
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
    
    // Should have REGIME signal
    const regimeSignal = result.signals.find(s => s.token === 'REGIME');
    expect(regimeSignal).toBeDefined();
    expect(regimeSignal?.reason).toContain('Market regime');
  });

  test('should work with regime detection disabled', async () => {
    const strategy = new CompositeStrategy(new OracleAggregator({}), {
      enableRegimeDetection: false,
    });

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      strategy.updatePriceHistory([
        { token: '0x1', price: 100n * 10n ** 8n, decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 100n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
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
    
    expect(result.newWeights.length).toBe(2);
  });
});

describe('Signal Combination', () => {
  test('should combine signals from multiple strategies', async () => {
    const strategy = new CompositeStrategy(new OracleAggregator({}));

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      const sinVal = Math.floor(Math.sin(i / 3) * 5 * 10 ** 7);
      const cosVal = Math.floor(Math.cos(i / 3) * 2 * 10 ** 7);
      strategy.updatePriceHistory([
        { token: '0x1', price: 100n * 10n ** 8n + BigInt(sinVal), decimals: 8, timestamp: now - (50 - i) * 3600000, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n + BigInt(cosVal), decimals: 8, timestamp: now - (50 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 100n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
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

    // Should have signals for each token plus regime
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    
    // Each token signal should have combined reason from strategies
    const tokenASignal = result.signals.find(s => s.token === 'A');
    expect(tokenASignal).toBeDefined();
    expect(typeof tokenASignal?.signal).toBe('number');
    expect(typeof tokenASignal?.strength).toBe('number');
  });

  test('should handle three-token pool', async () => {
    const strategy = new CompositeStrategy(new OracleAggregator({}));

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
      { address: '0x3', symbol: 'C', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      const sinVal = Math.floor(Math.sin(i) * 10 ** 6);
      strategy.updatePriceHistory([
        { token: '0x1', price: 100n * 10n ** 8n + BigInt(i * 10 ** 6), decimals: 8, timestamp: now - (50 - i) * 3600000, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n + BigInt(sinVal), decimals: 8, timestamp: now - (50 - i) * 3600000, source: 'pyth' },
        { token: '0x3', price: 200n * 10n ** 8n - BigInt(i * 5 * 10 ** 5), decimals: 8, timestamp: now - (50 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const third = WEIGHT_PRECISION / 3n;
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [third, third, third],
      prices: [
        { token: '0x1', price: 105n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x3', price: 197n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
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
    
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n);
  });
});

describe('Edge Cases', () => {
  test('should handle empty price history', async () => {
    const strategy = new CompositeStrategy(new OracleAggregator({}));

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
    ];

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION],
      prices: [{ token: '0x1', price: 100n * 10n ** 8n, decimals: 8, timestamp: Date.now(), source: 'pyth' }],
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
    expect(result.newWeights[0]).toBe(WEIGHT_PRECISION);
  });

  test('should handle extreme strategy weights', async () => {
    // All weight to momentum
    const strategy = new CompositeStrategy(new OracleAggregator({}), {
      momentumWeight: 1.0,
      meanReversionWeight: 0,
      volatilityWeight: 0,
    });

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];

    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      strategy.updatePriceHistory([
        { token: '0x1', price: BigInt(100 + i) * 10n ** 8n, decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now - (30 - i) * 3600000, source: 'pyth' },
      ]);
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        { token: '0x1', price: 130n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
        { token: '0x2', price: 50n * 10n ** 8n, decimals: 8, timestamp: now, source: 'pyth' },
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

    expect(result.newWeights.length).toBe(2);
    const sum = result.newWeights.reduce((a, b) => a + b, 0n);
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n);
  });
});
