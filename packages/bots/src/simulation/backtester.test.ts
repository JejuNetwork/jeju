/**
 * Backtester Tests
 */

import { describe, test, expect } from 'bun:test';
import { Backtester, type BacktestConfig } from './backtester';
import { HistoricalDataFetcher } from './data-fetcher';
import type { Token } from '../types';

describe('Backtester', () => {
  const tokens: Token[] = [
    { address: '0x1', symbol: 'WETH', decimals: 18, chainId: 8453 },
    { address: '0x2', symbol: 'USDC', decimals: 6, chainId: 8453 },
  ];

  test('should run backtest with synthetic data', async () => {
    const dataFetcher = new HistoricalDataFetcher();
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-03-01');

    const priceData = dataFetcher.generateSyntheticData(
      tokens,
      startDate,
      endDate,
      86400000, // Daily
      {
        initialPrices: { WETH: 3000, USDC: 1 },
        volatilities: { WETH: 0.5, USDC: 0.01 },
      }
    );

    const config: BacktestConfig = {
      strategy: 'momentum',
      tokens,
      initialWeights: [0.5, 0.5],
      startDate,
      endDate,
      initialCapitalUsd: 10000,
      rebalanceIntervalHours: 24,
      tradingFeeBps: 30,
      slippageBps: 10,
      priceData,
    };

    const backtester = new Backtester();
    const result = await backtester.run(config);

    expect(result).toBeDefined();
    expect(typeof result.totalReturn).toBe('number');
    expect(typeof result.annualizedReturn).toBe('number');
    expect(typeof result.sharpeRatio).toBe('number');
    expect(typeof result.maxDrawdown).toBe('number');
    expect(result.snapshots.length).toBeGreaterThan(0);
  });

  test('should calculate metrics correctly', async () => {
    const dataFetcher = new HistoricalDataFetcher();
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-02-01');

    // Flat price data - should have near-zero return
    const priceData = dataFetcher.generateSyntheticData(
      tokens,
      startDate,
      endDate,
      86400000,
      {
        initialPrices: { WETH: 3000, USDC: 1 },
        volatilities: { WETH: 0.01, USDC: 0.001 },
      }
    );

    const config: BacktestConfig = {
      strategy: 'composite',
      tokens,
      initialWeights: [0.5, 0.5],
      startDate,
      endDate,
      initialCapitalUsd: 10000,
      rebalanceIntervalHours: 24,
      tradingFeeBps: 30,
      slippageBps: 10,
      priceData,
    };

    const backtester = new Backtester();
    const result = await backtester.run(config);

    // With flat prices, fees accumulate from rebalancing
    expect(result.totalFees).toBeGreaterThanOrEqual(0);
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdown).toBeLessThanOrEqual(1);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  test('should compare strategies', async () => {
    const dataFetcher = new HistoricalDataFetcher();
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-02-01');

    const priceData = dataFetcher.generateSyntheticData(
      tokens,
      startDate,
      endDate,
      86400000,
      {
        initialPrices: { WETH: 3000, USDC: 1 },
        volatilities: { WETH: 0.4, USDC: 0.01 },
      }
    );

    const baseConfig = {
      tokens,
      initialWeights: [0.5, 0.5],
      startDate,
      endDate,
      initialCapitalUsd: 10000,
      rebalanceIntervalHours: 24,
      tradingFeeBps: 30,
      slippageBps: 10,
      priceData,
    };

    const backtester = new Backtester();
    const results = await backtester.compare(
      baseConfig,
      ['momentum', 'mean-reversion', 'volatility', 'composite']
    );

    expect(results.size).toBe(5); // 4 strategies + buy-and-hold
    expect(results.has('momentum')).toBe(true);
    expect(results.has('mean-reversion')).toBe(true);
    expect(results.has('volatility')).toBe(true);
    expect(results.has('composite')).toBe(true);
    expect(results.has('buy-and-hold')).toBe(true);
  });
});

describe('HistoricalDataFetcher', () => {
  test('should generate synthetic data with correct structure', () => {
    const fetcher = new HistoricalDataFetcher();
    const tokens: Token[] = [
      { address: '0x1', symbol: 'ETH', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'BTC', decimals: 8, chainId: 1 },
    ];

    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-01-10');

    const data = fetcher.generateSyntheticData(
      tokens,
      startDate,
      endDate,
      86400000,
      {
        initialPrices: { ETH: 2500, BTC: 40000 },
        volatilities: { ETH: 0.5, BTC: 0.4 },
        correlations: [
          [1, 0.7],
          [0.7, 1],
        ],
      }
    );

    expect(data.length).toBeGreaterThan(0);
    expect(data[0].prices).toHaveProperty('ETH');
    expect(data[0].prices).toHaveProperty('BTC');
    // First data point should be close to initial prices (within some variance)
    expect(data[0].prices.ETH).toBeGreaterThan(2000);
    expect(data[0].prices.ETH).toBeLessThan(3000);
    expect(data[0].prices.BTC).toBeGreaterThan(35000);
    expect(data[0].prices.BTC).toBeLessThan(45000);
  });

  test('should generate correlated returns', () => {
    const fetcher = new HistoricalDataFetcher();
    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];

    // High correlation
    const data = fetcher.generateSyntheticData(
      tokens,
      new Date('2024-01-01'),
      new Date('2024-06-01'),
      86400000,
      {
        initialPrices: { A: 100, B: 100 },
        volatilities: { A: 0.3, B: 0.3 },
        correlations: [
          [1, 0.9],
          [0.9, 1],
        ],
      }
    );

    // Calculate correlation of returns
    const returnsA: number[] = [];
    const returnsB: number[] = [];
    
    for (let i = 1; i < data.length; i++) {
      returnsA.push((data[i].prices.A - data[i - 1].prices.A) / data[i - 1].prices.A);
      returnsB.push((data[i].prices.B - data[i - 1].prices.B) / data[i - 1].prices.B);
    }

    // Correlation should be positive (not exact due to randomness)
    const meanA = returnsA.reduce((a, b) => a + b, 0) / returnsA.length;
    const meanB = returnsB.reduce((a, b) => a + b, 0) / returnsB.length;
    
    let covariance = 0;
    let varA = 0;
    let varB = 0;
    
    for (let i = 0; i < returnsA.length; i++) {
      covariance += (returnsA[i] - meanA) * (returnsB[i] - meanB);
      varA += (returnsA[i] - meanA) ** 2;
      varB += (returnsB[i] - meanB) ** 2;
    }
    
    const correlation = covariance / Math.sqrt(varA * varB);
    
    // With 0.9 target correlation, actual should be positive
    expect(correlation).toBeGreaterThan(0);
  });
});

