/**
 * Risk Analyzer Tests
 */

import { describe, test, expect } from 'bun:test';
import { RiskAnalyzer } from './risk-analyzer';
import type { PortfolioSnapshot } from '../types';

describe('RiskAnalyzer', () => {
  const analyzer = new RiskAnalyzer();

  function createSnapshots(values: number[]): PortfolioSnapshot[] {
    return values.map((value, i) => ({
      date: new Date(Date.now() + i * 86400000),
      timestamp: Date.now() + i * 86400000,
      weights: [0.5, 0.5],
      balances: [],
      valueUsd: value,
      cumulativeFeesUsd: 0,
      impermanentLossPercent: 0,
      rebalanceCount: 0,
    }));
  }

  test('should calculate risk metrics', () => {
    // Steadily increasing portfolio
    const values = [10000, 10100, 10200, 10150, 10300, 10400, 10350, 10500];
    const snapshots = createSnapshots(values);

    const metrics = analyzer.calculateMetrics(snapshots);

    expect(metrics.meanReturn).toBeDefined();
    expect(metrics.stdDev).toBeGreaterThanOrEqual(0);
    expect(metrics.var95).toBeGreaterThanOrEqual(0);
    expect(metrics.var99).toBeGreaterThanOrEqual(0);
    expect(metrics.sharpeRatio).toBeDefined();
    expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(1);
  });

  test('should calculate max drawdown correctly', () => {
    // Portfolio with clear drawdown
    const values = [10000, 11000, 12000, 10000, 9000, 11000, 12000];
    const snapshots = createSnapshots(values);

    const metrics = analyzer.calculateMetrics(snapshots);

    // Max drawdown from 12000 to 9000 = 25%
    expect(metrics.maxDrawdown).toBeCloseTo(0.25, 2);
  });

  test('should analyze drawdowns', () => {
    const values = [10000, 11000, 12000, 10000, 9000, 11000, 12000, 11000, 13000];
    const snapshots = createSnapshots(values);

    const analysis = analyzer.analyzeDrawdowns(snapshots);

    expect(analysis.maxDrawdown).toBeCloseTo(0.25, 2);
    expect(analysis.drawdownPeriods.length).toBeGreaterThan(0);
  });

  test('should calculate VaR and CVaR', () => {
    // Random walk with some losses
    const values: number[] = [10000];
    for (let i = 1; i < 100; i++) {
      const change = (Math.random() - 0.5) * 200;
      values.push(values[i - 1] + change);
    }
    const snapshots = createSnapshots(values);

    const metrics = analyzer.calculateMetrics(snapshots);

    // VaR should be positive (representing loss)
    expect(metrics.var95).toBeGreaterThanOrEqual(0);
    expect(metrics.var99).toBeGreaterThanOrEqual(0);
    // 99% VaR should be >= 95% VaR
    expect(metrics.var99).toBeGreaterThanOrEqual(metrics.var95 - 0.01);
    // CVaR should be >= VaR
    expect(metrics.cvar95).toBeGreaterThanOrEqual(metrics.var95 - 0.01);
  });

  test('should calculate Sortino ratio', () => {
    const values = [10000, 10100, 10200, 10150, 10300, 10400, 10350, 10500];
    const snapshots = createSnapshots(values);

    const metrics = analyzer.calculateMetrics(snapshots);

    // Sortino should be defined
    expect(typeof metrics.sortinoRatio).toBe('number');
    expect(isFinite(metrics.sortinoRatio)).toBe(true);
  });

  test('should calculate Calmar ratio', () => {
    const values = [10000, 10500, 11000, 10500, 11500, 12000];
    const snapshots = createSnapshots(values);

    const metrics = analyzer.calculateMetrics(snapshots);

    expect(typeof metrics.calmarRatio).toBe('number');
    expect(isFinite(metrics.calmarRatio)).toBe(true);
  });

  test('should calculate rolling metrics', () => {
    const values: number[] = [];
    for (let i = 0; i < 50; i++) {
      values.push(10000 + i * 50 + (Math.random() - 0.5) * 100);
    }
    const snapshots = createSnapshots(values);

    const rollingMetrics = analyzer.calculateRollingMetrics(snapshots, 10);

    expect(rollingMetrics.has('sharpe')).toBe(true);
    expect(rollingMetrics.has('volatility')).toBe(true);
    expect(rollingMetrics.has('return')).toBe(true);
    
    const rollingSharpe = rollingMetrics.get('sharpe')!;
    expect(rollingSharpe.length).toBe(40); // 50 - 10 = 40 windows
  });

  test('should perform stress test', () => {
    const values = [10000, 10100, 10200, 10300, 10400, 10500];
    const snapshots = createSnapshots(values);

    const scenarios = [
      { name: '1 Std Dev', shock: 1 },
      { name: '2 Std Dev', shock: 2 },
      { name: '3 Std Dev', shock: 3 },
    ];

    const results = analyzer.stressTest(snapshots, scenarios);

    expect(results.size).toBe(3);
    expect(results.has('1 Std Dev')).toBe(true);
    expect(results.has('2 Std Dev')).toBe(true);
    expect(results.has('3 Std Dev')).toBe(true);

    // Higher shock = lower stressed value
    expect(results.get('3 Std Dev')!).toBeLessThan(results.get('1 Std Dev')!);
  });

  test('should handle edge case with minimal data (non-zero variance)', () => {
    // Need at least some variance for meaningful metrics
    const snapshots = createSnapshots([10000, 10100, 10050]);
    const metrics = analyzer.calculateMetrics(snapshots);

    expect(metrics).toBeDefined();
    expect(typeof metrics.maxDrawdown).toBe('number');
  });

  test('should throw for flat portfolio with zero variance', () => {
    const snapshots = createSnapshots([10000, 10000, 10000, 10000, 10000]);
    
    // Zero variance portfolio cannot have meaningful risk metrics
    expect(() => analyzer.calculateMetrics(snapshots)).toThrow('Insufficient variance');
  });

  test('should handle near-flat portfolio with tiny variance', () => {
    // Small but non-zero variance
    const snapshots = createSnapshots([10000, 10000.01, 10000.02, 10000.01, 10000.03]);
    const metrics = analyzer.calculateMetrics(snapshots);

    // Max drawdown should be essentially 0 for nearly flat portfolio
    expect(metrics.maxDrawdown).toBeLessThan(0.001);
    expect(metrics).toBeDefined();
    expect(typeof metrics.sharpeRatio).toBe('number');
  });
});

