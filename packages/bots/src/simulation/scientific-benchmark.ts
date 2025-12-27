/**
 * Scientific Benchmarking Framework
 *
 * Implements rigorous statistical testing for MEV/arbitrage strategies:
 * - Monte Carlo simulation with confidence intervals
 * - Walk-forward validation to prevent overfitting
 * - Statistical significance testing (t-test, Sharpe ratio)
 * - Risk-adjusted performance metrics
 * - Comparison against null hypothesis (random trading)
 *
 * Based on academic literature:
 * - Bailey et al. (2014) "The Deflated Sharpe Ratio"
 * - Harvey et al. (2016) "...and the Cross-Section of Expected Returns"
 * - Marcos López de Prado (2018) "Advances in Financial ML"
 */

// ============ Types ============

interface BenchmarkConfig {
  numSimulations: number // Monte Carlo iterations
  confidenceLevel: number // e.g., 0.95 for 95% CI
  lookbackDays: number
  walkForwardDays: number
  minTradesForSignificance: number
  riskFreeRate: number // Annual, e.g., 0.05 for 5%
}

interface TradeRecord {
  timestamp: number
  strategy: string
  chain: number
  grossProfit: number
  netProfit: number
  gasCost: number
  slippage: number
  executionTime: number // ms
  success: boolean
}

interface StrategyMetrics {
  name: string
  totalTrades: number
  successfulTrades: number
  winRate: number
  totalPnl: number
  avgPnl: number
  stdPnl: number
  maxDrawdown: number
  sharpeRatio: number
  sortinRatio: number
  calmarRatio: number
  profitFactor: number
  avgExecutionTime: number
  confidenceInterval: [number, number]
  pValue: number
  isSignificant: boolean
}

interface WalkForwardResult {
  inSampleMetrics: StrategyMetrics
  outOfSampleMetrics: StrategyMetrics
  overfitRatio: number // in-sample / out-of-sample performance
  isRobust: boolean
}

interface MonteCarloResult {
  meanPnl: number
  medianPnl: number
  p5Pnl: number // 5th percentile
  p95Pnl: number // 95th percentile
  probabilityOfProfit: number
  valueAtRisk: number // 95% VaR
  conditionalVaR: number // Expected shortfall
  distribution: number[]
}

interface BenchmarkReport {
  timestamp: Date
  config: BenchmarkConfig
  strategies: Map<string, StrategyMetrics>
  walkForward: Map<string, WalkForwardResult>
  monteCarlo: Map<string, MonteCarloResult>
  comparison: StrategyComparison
  recommendations: string[]
}

interface StrategyComparison {
  bestStrategy: string
  worstStrategy: string
  rankings: Array<{ strategy: string; score: number }>
  pairwiseTests: Map<string, Map<string, { tStat: number; pValue: number }>>
}

// ============ Statistical Functions ============

/** Calculate mean */
function statMean(data: number[]): number {
  if (data.length === 0) return 0
  return data.reduce((a, b) => a + b, 0) / data.length
}

/** Calculate standard deviation (sample) */
function statStd(data: number[]): number {
  if (data.length < 2) return 0
  const avg = statMean(data)
  const squareDiffs = data.map((x) => (x - avg) ** 2)
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / (data.length - 1))
}

/** Calculate standard error of the mean */
function statSem(data: number[]): number {
  return statStd(data) / Math.sqrt(data.length)
}

/** Calculate percentile */
function statPercentile(data: number[], p: number): number {
  if (data.length === 0) return 0
  const sorted = [...data].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

/** Calculate max drawdown */
function statMaxDrawdown(returns: number[]): number {
  let peak = 0
  let maxDd = 0
  let cumulative = 0

  for (const r of returns) {
    cumulative += r
    if (cumulative > peak) {
      peak = cumulative
    }
    const dd = (peak - cumulative) / Math.max(peak, 1)
    if (dd > maxDd) {
      maxDd = dd
    }
  }

  return maxDd
}

/** Calculate Sharpe ratio (annualized) */
function statSharpeRatio(
  returns: number[],
  riskFreeRate: number,
  periodsPerYear: number = 365,
): number {
  if (returns.length < 2) return 0

  const mean = statMean(returns)
  const std = statStd(returns)

  if (std === 0) return mean > 0 ? Infinity : mean < 0 ? -Infinity : 0

  const dailyRf = riskFreeRate / periodsPerYear
  const excessReturn = mean - dailyRf
  const annualizationFactor = Math.sqrt(periodsPerYear)

  return (excessReturn / std) * annualizationFactor
}

/** Calculate Sortino ratio (using downside deviation) */
function statSortinoRatio(
  returns: number[],
  riskFreeRate: number,
  periodsPerYear: number = 365,
): number {
  if (returns.length < 2) return 0

  const mean = statMean(returns)
  const dailyRf = riskFreeRate / periodsPerYear
  const excessReturn = mean - dailyRf

  const negativeReturns = returns.filter((r) => r < 0)
  if (negativeReturns.length === 0) return Infinity

  const downsideDeviation = Math.sqrt(
    negativeReturns.map((r) => r ** 2).reduce((a, b) => a + b, 0) /
      returns.length,
  )

  if (downsideDeviation === 0) return excessReturn > 0 ? Infinity : 0

  const annualizationFactor = Math.sqrt(periodsPerYear)
  return (excessReturn / downsideDeviation) * annualizationFactor
}

/** Calculate Calmar ratio (return / max drawdown) */
function statCalmarRatio(
  returns: number[],
  periodsPerYear: number = 365,
): number {
  const annualReturn = statMean(returns) * periodsPerYear
  const maxDd = statMaxDrawdown(returns)
  if (maxDd === 0) return annualReturn > 0 ? Infinity : 0
  return annualReturn / maxDd
}

/** Standard normal CDF */
function normalCDF(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + p * absX)
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)

  return 0.5 * (1 + sign * y)
}

/** Incomplete beta function (simplified) */
function incompleteBeta(a: number, b: number, x: number): number {
  const maxIterations = 100
  const epsilon = 1e-10

  let result = 0
  let term = 1

  for (let n = 0; n < maxIterations; n++) {
    term *= (x * (a + n)) / (a + b + n)
    result += term
    if (Math.abs(term) < epsilon) break
  }

  return (x ** a * (1 - x) ** b * result) / a
}

/** Approximate t-distribution p-value using normal approximation for large df */
function tDistPValue(t: number, df: number): number {
  if (df > 30) {
    return normalCDF(-Math.abs(t))
  }
  const x = df / (df + t * t)
  return 0.5 * incompleteBeta(df / 2, 0.5, x)
}

/** One-sample t-test (test if mean is significantly different from 0) */
function statTTest(data: number[]): { tStat: number; pValue: number } {
  if (data.length < 2) return { tStat: 0, pValue: 1 }

  const mean = statMean(data)
  const sem = statSem(data)

  if (sem === 0) return { tStat: mean > 0 ? Infinity : -Infinity, pValue: 0 }

  const tStat = mean / sem
  const df = data.length - 1

  const pValue = tDistPValue(Math.abs(tStat), df) * 2
  return { tStat, pValue }
}

/** Two-sample t-test (compare two strategies) */
function statTwoSampleTTest(
  data1: number[],
  data2: number[],
): { tStat: number; pValue: number } {
  if (data1.length < 2 || data2.length < 2) return { tStat: 0, pValue: 1 }

  const mean1 = statMean(data1)
  const mean2 = statMean(data2)
  const var1 = statStd(data1) ** 2
  const var2 = statStd(data2) ** 2
  const n1 = data1.length
  const n2 = data2.length

  const pooledSE = Math.sqrt(var1 / n1 + var2 / n2)
  if (pooledSE === 0) return { tStat: 0, pValue: 1 }

  const tStat = (mean1 - mean2) / pooledSE

  const df = Math.floor(
    (var1 / n1 + var2 / n2) ** 2 /
      ((var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1)),
  )

  const pValue = tDistPValue(Math.abs(tStat), df) * 2
  return { tStat, pValue }
}

/** Confidence interval for the mean */
function statConfidenceInterval(
  data: number[],
  confidence: number,
): [number, number] {
  if (data.length < 2) return [0, 0]

  const mean = statMean(data)
  const sem = statSem(data)
  const df = data.length - 1

  let tCritical: number
  if (confidence >= 0.99) tCritical = 2.576
  else if (confidence >= 0.95) tCritical = 1.96
  else if (confidence >= 0.9) tCritical = 1.645
  else tCritical = 1.28

  if (df < 30) {
    tCritical *= 1 + 1 / df
  }

  const margin = tCritical * sem
  return [mean - margin, mean + margin]
}

/** Statistics namespace for backward compatibility */
const Statistics = {
  mean: statMean,
  std: statStd,
  sem: statSem,
  percentile: statPercentile,
  maxDrawdown: statMaxDrawdown,
  sharpeRatio: statSharpeRatio,
  sortinoRatio: statSortinoRatio,
  calmarRatio: statCalmarRatio,
  tTest: statTTest,
  twoSampleTTest: statTwoSampleTTest,
  confidenceInterval: statConfidenceInterval,
}

// ============ Benchmark Engine ============

export class ScientificBenchmark {
  private config: BenchmarkConfig
  private trades: TradeRecord[] = []
  private strategies: Set<string> = new Set()

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = {
      numSimulations: config.numSimulations ?? 10000,
      confidenceLevel: config.confidenceLevel ?? 0.95,
      lookbackDays: config.lookbackDays ?? 30,
      walkForwardDays: config.walkForwardDays ?? 7,
      minTradesForSignificance: config.minTradesForSignificance ?? 30,
      riskFreeRate: config.riskFreeRate ?? 0.05,
    }
  }

  /**
   * Add trade record
   */
  addTrade(trade: TradeRecord): void {
    this.trades.push(trade)
    this.strategies.add(trade.strategy)
  }

  /**
   * Add multiple trades
   */
  addTrades(trades: TradeRecord[]): void {
    for (const trade of trades) {
      this.addTrade(trade)
    }
  }

  /**
   * Calculate metrics for a strategy
   */
  calculateMetrics(strategyName: string): StrategyMetrics {
    const strategyTrades = this.trades.filter(
      (t) => t.strategy === strategyName,
    )
    const pnls = strategyTrades.map((t) => t.netProfit)
    const successfulTrades = strategyTrades.filter((t) => t.success).length

    const totalPnl = pnls.reduce((a, b) => a + b, 0)
    const avgPnl = Statistics.mean(pnls)
    const stdPnl = Statistics.std(pnls)
    const maxDrawdown = Statistics.maxDrawdown(pnls)
    const sharpeRatio = Statistics.sharpeRatio(pnls, this.config.riskFreeRate)
    const sortinoRatio = Statistics.sortinoRatio(pnls, this.config.riskFreeRate)
    const calmarRatio = Statistics.calmarRatio(pnls)

    // Profit factor
    const gains = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0)
    const losses = Math.abs(
      pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0),
    )
    const profitFactor = losses > 0 ? gains / losses : gains > 0 ? Infinity : 0

    // Statistical significance
    const { pValue } = Statistics.tTest(pnls)
    const isSignificant =
      pValue < 1 - this.config.confidenceLevel &&
      strategyTrades.length >= this.config.minTradesForSignificance

    // Confidence interval
    const confidenceInterval = Statistics.confidenceInterval(
      pnls,
      this.config.confidenceLevel,
    )

    // Average execution time
    const avgExecutionTime = Statistics.mean(
      strategyTrades.map((t) => t.executionTime),
    )

    return {
      name: strategyName,
      totalTrades: strategyTrades.length,
      successfulTrades,
      winRate:
        strategyTrades.length > 0
          ? successfulTrades / strategyTrades.length
          : 0,
      totalPnl,
      avgPnl,
      stdPnl,
      maxDrawdown,
      sharpeRatio,
      sortinRatio: sortinoRatio,
      calmarRatio,
      profitFactor,
      avgExecutionTime,
      confidenceInterval,
      pValue,
      isSignificant,
    }
  }

  /**
   * Run walk-forward validation
   */
  runWalkForward(strategyName: string): WalkForwardResult {
    const strategyTrades = this.trades
      .filter((t) => t.strategy === strategyName)
      .sort((a, b) => a.timestamp - b.timestamp)

    if (strategyTrades.length < 50) {
      throw new Error('Not enough trades for walk-forward validation')
    }

    const cutoffIdx = Math.floor(strategyTrades.length * 0.7) // 70/30 split
    const inSampleTrades = strategyTrades.slice(0, cutoffIdx)
    const outOfSampleTrades = strategyTrades.slice(cutoffIdx)

    // Calculate metrics for each period
    const _inSamplePnls = inSampleTrades.map((t) => t.netProfit)
    const _outOfSamplePnls = outOfSampleTrades.map((t) => t.netProfit)

    const inSampleMetrics = this.calculateMetricsFromPnls(
      strategyName,
      inSampleTrades,
    )
    const outOfSampleMetrics = this.calculateMetricsFromPnls(
      strategyName,
      outOfSampleTrades,
    )

    // Overfit ratio: how much worse is out-of-sample vs in-sample
    const overfitRatio =
      inSampleMetrics.avgPnl > 0
        ? outOfSampleMetrics.avgPnl / inSampleMetrics.avgPnl
        : 0

    // Strategy is robust if out-of-sample performance is at least 50% of in-sample
    const isRobust = overfitRatio >= 0.5 && outOfSampleMetrics.isSignificant

    return {
      inSampleMetrics,
      outOfSampleMetrics,
      overfitRatio,
      isRobust,
    }
  }

  /**
   * Run Monte Carlo simulation
   */
  runMonteCarlo(strategyName: string): MonteCarloResult {
    const strategyTrades = this.trades.filter(
      (t) => t.strategy === strategyName,
    )
    const pnls = strategyTrades.map((t) => t.netProfit)

    if (pnls.length === 0) {
      return {
        meanPnl: 0,
        medianPnl: 0,
        p5Pnl: 0,
        p95Pnl: 0,
        probabilityOfProfit: 0,
        valueAtRisk: 0,
        conditionalVaR: 0,
        distribution: [],
      }
    }

    const simulations: number[] = []

    for (let i = 0; i < this.config.numSimulations; i++) {
      // Bootstrap: sample with replacement
      let simPnl = 0
      for (let j = 0; j < pnls.length; j++) {
        const idx = Math.floor(Math.random() * pnls.length)
        simPnl += pnls[idx]
      }
      simulations.push(simPnl)
    }

    simulations.sort((a, b) => a - b)

    const meanPnl = Statistics.mean(simulations)
    const medianPnl = Statistics.percentile(simulations, 50)
    const p5Pnl = Statistics.percentile(simulations, 5)
    const p95Pnl = Statistics.percentile(simulations, 95)

    const probabilityOfProfit =
      simulations.filter((s) => s > 0).length / simulations.length

    // VaR: 5th percentile loss
    const valueAtRisk = -p5Pnl

    // CVaR: Expected loss given we're in the worst 5%
    const worstIdx = Math.floor(0.05 * simulations.length)
    const conditionalVaR = -Statistics.mean(simulations.slice(0, worstIdx))

    return {
      meanPnl,
      medianPnl,
      p5Pnl,
      p95Pnl,
      probabilityOfProfit,
      valueAtRisk,
      conditionalVaR,
      distribution: simulations,
    }
  }

  /**
   * Compare all strategies
   */
  compareStrategies(): StrategyComparison {
    const metrics = new Map<string, StrategyMetrics>()
    const pnlsByStrategy = new Map<string, number[]>()

    for (const strategy of this.strategies) {
      metrics.set(strategy, this.calculateMetrics(strategy))
      pnlsByStrategy.set(
        strategy,
        this.trades
          .filter((t) => t.strategy === strategy)
          .map((t) => t.netProfit),
      )
    }

    // Rank strategies by risk-adjusted return (Sharpe ratio)
    const rankings = Array.from(metrics.entries())
      .map(([name, m]) => ({ strategy: name, score: m.sharpeRatio }))
      .sort((a, b) => b.score - a.score)

    // Pairwise t-tests
    const pairwiseTests = new Map<
      string,
      Map<string, { tStat: number; pValue: number }>
    >()

    for (const s1 of this.strategies) {
      pairwiseTests.set(s1, new Map())
      for (const s2 of this.strategies) {
        if (s1 !== s2) {
          const pnl1 = pnlsByStrategy.get(s1) ?? []
          const pnl2 = pnlsByStrategy.get(s2) ?? []
          const test = Statistics.twoSampleTTest(pnl1, pnl2)
          pairwiseTests.get(s1)?.set(s2, test)
        }
      }
    }

    return {
      bestStrategy: rankings[0].strategy ?? '',
      worstStrategy: rankings[rankings.length - 1].strategy ?? '',
      rankings,
      pairwiseTests,
    }
  }

  /**
   * Generate full benchmark report
   */
  generateReport(): BenchmarkReport {
    const strategies = new Map<string, StrategyMetrics>()
    const walkForward = new Map<string, WalkForwardResult>()
    const monteCarlo = new Map<string, MonteCarloResult>()

    for (const strategy of this.strategies) {
      strategies.set(strategy, this.calculateMetrics(strategy))

      try {
        walkForward.set(strategy, this.runWalkForward(strategy))
      } catch {
        // Not enough data for walk-forward
      }

      monteCarlo.set(strategy, this.runMonteCarlo(strategy))
    }

    const comparison = this.compareStrategies()
    const recommendations = this.generateRecommendations(
      strategies,
      walkForward,
      monteCarlo,
    )

    return {
      timestamp: new Date(),
      config: this.config,
      strategies,
      walkForward,
      monteCarlo,
      comparison,
      recommendations,
    }
  }

  /**
   * Print report to console
   */
  printReport(): void {
    const report = this.generateReport()

    console.log(`\n${'═'.repeat(80)}`)
    console.log('                    SCIENTIFIC BENCHMARK REPORT')
    console.log('═'.repeat(80))
    console.log(`  Generated: ${report.timestamp.toISOString()}`)
    console.log(`  Trades analyzed: ${this.trades.length}`)
    console.log(`  Strategies: ${this.strategies.size}`)

    console.log(`\n${'─'.repeat(80)}`)
    console.log('  STRATEGY METRICS')
    console.log('─'.repeat(80))

    for (const [name, metrics] of report.strategies) {
      console.log(`\n  📊 ${name}`)
      console.log(
        `     Trades: ${metrics.totalTrades} | Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`,
      )
      console.log(
        `     Total PnL: $${metrics.totalPnl.toFixed(2)} | Avg: $${metrics.avgPnl.toFixed(2)}`,
      )
      console.log(
        `     Sharpe: ${metrics.sharpeRatio.toFixed(2)} | Sortino: ${metrics.sortinRatio.toFixed(2)}`,
      )
      console.log(
        `     Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(1)}%`,
      )
      console.log(
        `     95% CI: [$${metrics.confidenceInterval[0].toFixed(2)}, $${metrics.confidenceInterval[1].toFixed(2)}]`,
      )
      console.log(
        `     p-value: ${metrics.pValue.toFixed(4)} | Significant: ${metrics.isSignificant ? '✅' : '❌'}`,
      )
    }

    console.log(`\n${'─'.repeat(80)}`)
    console.log('  WALK-FORWARD VALIDATION')
    console.log('─'.repeat(80))

    for (const [name, wf] of report.walkForward) {
      console.log(`\n  📈 ${name}`)
      console.log(
        `     In-sample Sharpe: ${wf.inSampleMetrics.sharpeRatio.toFixed(2)}`,
      )
      console.log(
        `     Out-of-sample Sharpe: ${wf.outOfSampleMetrics.sharpeRatio.toFixed(2)}`,
      )
      console.log(`     Overfit Ratio: ${(wf.overfitRatio * 100).toFixed(1)}%`)
      console.log(`     Robust: ${wf.isRobust ? '✅' : '❌'}`)
    }

    console.log(`\n${'─'.repeat(80)}`)
    console.log('  MONTE CARLO ANALYSIS')
    console.log('─'.repeat(80))

    for (const [name, mc] of report.monteCarlo) {
      console.log(`\n  🎲 ${name}`)
      console.log(
        `     Mean PnL: $${mc.meanPnl.toFixed(2)} | Median: $${mc.medianPnl.toFixed(2)}`,
      )
      console.log(
        `     5th-95th percentile: [$${mc.p5Pnl.toFixed(2)}, $${mc.p95Pnl.toFixed(2)}]`,
      )
      console.log(
        `     Probability of Profit: ${(mc.probabilityOfProfit * 100).toFixed(1)}%`,
      )
      console.log(
        `     95% VaR: $${mc.valueAtRisk.toFixed(2)} | CVaR: $${mc.conditionalVaR.toFixed(2)}`,
      )
    }

    console.log(`\n${'─'.repeat(80)}`)
    console.log('  STRATEGY RANKINGS')
    console.log('─'.repeat(80))

    for (let i = 0; i < report.comparison.rankings.length; i++) {
      const r = report.comparison.rankings[i]
      console.log(`  ${i + 1}. ${r.strategy}: Sharpe = ${r.score.toFixed(2)}`)
    }

    console.log(`\n${'─'.repeat(80)}`)
    console.log('  RECOMMENDATIONS')
    console.log('─'.repeat(80))

    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`)
    }

    console.log(`\n${'═'.repeat(80)}`)
  }

  private calculateMetricsFromPnls(
    name: string,
    trades: TradeRecord[],
  ): StrategyMetrics {
    const pnls = trades.map((t) => t.netProfit)
    const successfulTrades = trades.filter((t) => t.success).length
    const totalPnl = pnls.reduce((a, b) => a + b, 0)
    const { pValue } = Statistics.tTest(pnls)

    return {
      name,
      totalTrades: trades.length,
      successfulTrades,
      winRate: trades.length > 0 ? successfulTrades / trades.length : 0,
      totalPnl,
      avgPnl: Statistics.mean(pnls),
      stdPnl: Statistics.std(pnls),
      maxDrawdown: Statistics.maxDrawdown(pnls),
      sharpeRatio: Statistics.sharpeRatio(pnls, this.config.riskFreeRate),
      sortinRatio: Statistics.sortinoRatio(pnls, this.config.riskFreeRate),
      calmarRatio: Statistics.calmarRatio(pnls),
      profitFactor: this.calculateProfitFactor(pnls),
      avgExecutionTime: Statistics.mean(trades.map((t) => t.executionTime)),
      confidenceInterval: Statistics.confidenceInterval(
        pnls,
        this.config.confidenceLevel,
      ),
      pValue,
      isSignificant:
        pValue < 1 - this.config.confidenceLevel &&
        trades.length >= this.config.minTradesForSignificance,
    }
  }

  private calculateProfitFactor(pnls: number[]): number {
    const gains = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0)
    const losses = Math.abs(
      pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0),
    )
    return losses > 0 ? gains / losses : gains > 0 ? Infinity : 0
  }

  private generateRecommendations(
    strategies: Map<string, StrategyMetrics>,
    walkForward: Map<string, WalkForwardResult>,
    monteCarlo: Map<string, MonteCarloResult>,
  ): string[] {
    const recommendations: string[] = []

    for (const [name, metrics] of strategies) {
      if (!metrics.isSignificant) {
        recommendations.push(
          `${name}: Need more trades (${metrics.totalTrades} < ${this.config.minTradesForSignificance}) for statistical significance`,
        )
      }

      if (metrics.sharpeRatio < 1) {
        recommendations.push(
          `${name}: Sharpe ratio < 1 indicates poor risk-adjusted returns`,
        )
      }

      if (metrics.maxDrawdown > 0.2) {
        recommendations.push(
          `${name}: High max drawdown (${(metrics.maxDrawdown * 100).toFixed(1)}%) - consider position sizing`,
        )
      }

      const wf = walkForward.get(name)
      if (wf && !wf.isRobust) {
        recommendations.push(
          `${name}: Strategy may be overfit (${(wf.overfitRatio * 100).toFixed(1)}% out-of-sample performance)`,
        )
      }

      const mc = monteCarlo.get(name)
      if (mc && mc.probabilityOfProfit < 0.6) {
        recommendations.push(
          `${name}: Low probability of profit (${(mc.probabilityOfProfit * 100).toFixed(1)}%)`,
        )
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'All strategies show statistically significant positive returns',
      )
    }

    return recommendations
  }
}

// ============ Demo ============

async function main() {
  console.log('Running scientific benchmark demo...\n')

  const benchmark = new ScientificBenchmark({
    numSimulations: 10000,
    confidenceLevel: 0.95,
    minTradesForSignificance: 30,
  })

  // Generate synthetic trade data for testing
  const strategies = ['arbitrage', 'liquidation', 'backrun', 'jit']
  const chains = [1, 8453, 42161]

  const now = Date.now()

  for (const strategy of strategies) {
    // Each strategy has different characteristics
    let meanProfit: number
    let stdProfit: number
    let successRate: number

    switch (strategy) {
      case 'arbitrage':
        meanProfit = 50
        stdProfit = 100
        successRate = 0.65
        break
      case 'liquidation':
        meanProfit = 200
        stdProfit = 300
        successRate = 0.4
        break
      case 'backrun':
        meanProfit = 30
        stdProfit = 80
        successRate = 0.55
        break
      case 'jit':
        meanProfit = 20
        stdProfit = 50
        successRate = 0.7
        break
      default:
        meanProfit = 0
        stdProfit = 0
        successRate = 0
    }

    // Generate 100 trades per strategy
    for (let i = 0; i < 100; i++) {
      const success = Math.random() < successRate
      const gasCost = 5 + Math.random() * 20
      const grossProfit = success
        ? meanProfit + (Math.random() - 0.5) * 2 * stdProfit
        : -gasCost

      benchmark.addTrade({
        timestamp: now - (100 - i) * 3600000, // 1 hour apart
        strategy,
        chain: chains[Math.floor(Math.random() * chains.length)],
        grossProfit,
        netProfit: grossProfit - gasCost,
        gasCost,
        slippage: Math.random() * 0.01,
        executionTime: 50 + Math.random() * 100,
        success,
      })
    }
  }

  benchmark.printReport()
}

if (import.meta.main) {
  main()
}

export { Statistics }
