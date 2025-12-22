/**
 * Risk Analysis Module
 * 
 * Calculates comprehensive risk metrics for strategy evaluation:
 * - Value at Risk (VaR)
 * - Conditional VaR / Expected Shortfall
 * - Drawdown analysis
 * - Sharpe, Sortino, Calmar ratios
 */

import type { PortfolioSnapshot, RiskMetrics } from '../types';

export interface DrawdownAnalysis {
  maxDrawdown: number;
  maxDrawdownDuration: number;
  currentDrawdown: number;
  recoveryTime: number;
  avgRecoveryDays?: number;
  longestRecoveryDays?: number;
  drawdownPeriods: {
    start: Date;
    end: Date;
    depth: number;
    duration: number;
  }[];
}

export { RiskMetrics };

export class RiskAnalyzer {
  private riskFreeRate = 0.05; // 5% annual

  /**
   * Calculate comprehensive risk metrics
   */
  calculateMetrics(snapshots: PortfolioSnapshot[]): RiskMetrics {
    const returns = this.calculateReturns(snapshots);
    const annualizationFactor = Math.sqrt(365); // Assuming daily data

    // Basic statistics
    const meanReturn = this.mean(returns);
    const stdDev = this.standardDeviation(returns);
    const annualizedMean = meanReturn * 365;
    const annualizedStdDev = stdDev * annualizationFactor;

    // Value at Risk
    const var95 = this.calculateVaR(returns, 0.95);
    const var99 = this.calculateVaR(returns, 0.99);

    // Conditional VaR (Expected Shortfall)
    const cvar95 = this.calculateCVaR(returns, 0.95);

    // Drawdown
    const maxDrawdown = this.calculateMaxDrawdown(snapshots);

    // Risk-adjusted returns
    const dailyRiskFree = this.riskFreeRate / 365;
    
    // Validate we have enough data for meaningful statistics
    if (stdDev === 0) {
      throw new Error('Insufficient variance in returns data - cannot calculate risk metrics');
    }
    
    const sharpeRatio = (meanReturn - dailyRiskFree) / stdDev * annualizationFactor;

    // Sortino ratio (downside deviation only)
    const negativeReturns = returns.filter(r => r < 0);
    const downsideDeviation = negativeReturns.length > 0 
      ? this.standardDeviation(negativeReturns)
      : stdDev; // Use total volatility if no downside moves
    const sortinoRatio = (meanReturn - dailyRiskFree) / downsideDeviation * annualizationFactor;

    // Calmar ratio (return / max drawdown)
    // If no drawdown, return Infinity to indicate perfect performance
    const calmarRatio = maxDrawdown > 0 ? annualizedMean / maxDrawdown : Infinity;

    return {
      meanReturn: annualizedMean,
      stdDev: annualizedStdDev,
      var95,
      var99,
      cvar95,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
    };
  }

  /**
   * Analyze drawdowns in detail
   */
  analyzeDrawdowns(snapshots: PortfolioSnapshot[]): DrawdownAnalysis {
    const drawdownPeriods: DrawdownAnalysis['drawdownPeriods'] = [];
    let peak = snapshots[0].valueUsd;
    let peakIndex = 0;
    let maxDrawdown = 0;
    let maxDrawdownDuration = 0;
    let inDrawdown = false;
    let drawdownStart = 0;

    for (let i = 0; i < snapshots.length; i++) {
      const value = snapshots[i].valueUsd;

      if (value > peak) {
        // New peak
        if (inDrawdown) {
          // Record completed drawdown
          const duration = i - drawdownStart;
          drawdownPeriods.push({
            start: snapshots[drawdownStart].date,
            end: snapshots[i].date,
            depth: maxDrawdown,
            duration,
          });
          inDrawdown = false;
        }
        peak = value;
        peakIndex = i;
      } else {
        // In drawdown
        const drawdown = (peak - value) / peak;

        if (!inDrawdown) {
          inDrawdown = true;
          drawdownStart = peakIndex;
        }

        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }

        const duration = i - drawdownStart;
        if (duration > maxDrawdownDuration) {
          maxDrawdownDuration = duration;
        }
      }
    }

    // Handle ongoing drawdown
    const lastValue = snapshots[snapshots.length - 1].valueUsd;
    const currentDrawdown = (peak - lastValue) / peak;
    const recoveryTime = inDrawdown ? snapshots.length - drawdownStart : 0;

    return {
      maxDrawdown,
      maxDrawdownDuration,
      currentDrawdown: currentDrawdown > 0 ? currentDrawdown : 0,
      recoveryTime,
      drawdownPeriods,
    };
  }

  /**
   * Calculate rolling metrics
   */
  calculateRollingMetrics(
    snapshots: PortfolioSnapshot[],
    windowSize: number
  ): Map<string, number[]> {
    const metrics = new Map<string, number[]>();
    const rollingSharpe: number[] = [];
    const rollingVol: number[] = [];
    const rollingReturn: number[] = [];

    for (let i = windowSize; i < snapshots.length; i++) {
      const windowSnapshots = snapshots.slice(i - windowSize, i);
      const windowReturns = this.calculateReturns(windowSnapshots);

      const mean = this.mean(windowReturns);
      const std = this.standardDeviation(windowReturns);
      // Skip if no variance in this window
      if (std === 0) {
        rollingSharpe.push(0);
        rollingVol.push(0);
        rollingReturn.push(mean * 365);
        continue;
      }
      const sharpe = (mean - this.riskFreeRate / 365) / std * Math.sqrt(365);

      rollingSharpe.push(sharpe);
      rollingVol.push(std * Math.sqrt(365));
      rollingReturn.push(mean * 365);
    }

    metrics.set('sharpe', rollingSharpe);
    metrics.set('volatility', rollingVol);
    metrics.set('return', rollingReturn);

    return metrics;
  }

  /**
   * Stress test the portfolio
   */
  stressTest(
    snapshots: PortfolioSnapshot[],
    scenarios: { name: string; shock: number }[]
  ): Map<string, number> {
    const results = new Map<string, number>();
    const lastValue = snapshots[snapshots.length - 1].valueUsd;
    const vol = this.standardDeviation(this.calculateReturns(snapshots));

    for (const scenario of scenarios) {
      // Assume shock is in standard deviations
      const loss = lastValue * vol * scenario.shock;
      const stressedValue = lastValue - loss;
      results.set(scenario.name, stressedValue);
    }

    return results;
  }

  // ============ Private Methods ============

  private calculateReturns(snapshots: PortfolioSnapshot[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const ret = (snapshots[i].valueUsd - snapshots[i - 1].valueUsd) / snapshots[i - 1].valueUsd;
      returns.push(ret);
    }
    return returns;
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private standardDeviation(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.mean(values);
    const squareDiffs = values.map(v => (v - avg) ** 2);
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private calculateVaR(returns: number[], confidence: number): number {
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return -sorted[index]; // Return positive number for loss
  }

  private calculateCVaR(returns: number[], confidence: number): number {
    const sorted = [...returns].sort((a, b) => a - b);
    const cutoff = Math.floor((1 - confidence) * sorted.length);
    const tailReturns = sorted.slice(0, cutoff);
    return -this.mean(tailReturns);
  }

  private calculateMaxDrawdown(snapshots: PortfolioSnapshot[]): number {
    let maxDrawdown = 0;
    let peak = snapshots[0].valueUsd;

    for (const snapshot of snapshots) {
      if (snapshot.valueUsd > peak) {
        peak = snapshot.valueUsd;
      }
      const drawdown = (peak - snapshot.valueUsd) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }
}

