/**
 * Monte Carlo Simulation & Statistical Validation
 *
 * Provides:
 * - Monte Carlo simulation for strategy performance
 * - Bootstrap confidence intervals
 * - Statistical significance testing
 * - Walk-forward optimization
 * - Out-of-sample validation
 */
export interface MonteCarloConfig {
  simulations: number
  confidenceLevel: number // 0.95 for 95%
  blockSize: number // For block bootstrap
  seed?: number
}

export interface MonteCarloResult {
  simulations: number
  meanReturn: number
  medianReturn: number
  stdDev: number
  skewness: number
  kurtosis: number
  var95: number // Value at Risk
  cvar95: number // Conditional VaR
  sharpeRatio: {
    mean: number
    ci95: [number, number]
  }
  maxDrawdown: {
    mean: number
    ci95: [number, number]
  }
  winRate: {
    mean: number
    ci95: [number, number]
  }
  profitFactor: {
    mean: number
    ci95: [number, number]
  }
  probabilityOfProfit: number
  probabilityOfRuin: number // P(drawdown > 50%)
  kelly: number // Kelly criterion optimal fraction
  distribution: number[] // Return distribution
}

export interface StatisticalTest {
  name: string
  testStatistic: number
  pValue: number
  significant: boolean
  interpretation: string
}

export interface ValidationResult {
  inSample: BacktestMetrics
  outOfSample: BacktestMetrics
  overfit: boolean
  overfitScore: number // 0-1, higher = more overfit
  degradation: number // Performance degradation %
  statisticalTests: StatisticalTest[]
  recommendations: string[]
}

interface BacktestMetrics {
  totalReturn: number
  sharpeRatio: number
  maxDrawdown: number
  winRate: number
  profitFactor: number
  trades: number
}

export interface WalkForwardResult {
  periods: WalkForwardPeriod[]
  aggregateMetrics: BacktestMetrics
  consistency: number // % of profitable periods
  robustness: number // 0-1 score
}

interface WalkForwardPeriod {
  trainStart: Date
  trainEnd: Date
  testStart: Date
  testEnd: Date
  trainMetrics: BacktestMetrics
  testMetrics: BacktestMetrics
}
class SeededRandom {
  private seed: number

  constructor(seed: number = Date.now()) {
    this.seed = seed
  }

  // Mulberry32 PRNG
  next(): number {
    this.seed += 0x6d2b79f5
    let t = this.seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Box-Muller for normal distribution
  nextNormal(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.next()
    const u2 = this.next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return z * stdDev + mean
  }

  // Sample from array
  sample<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  // Shuffle array (Fisher-Yates)
  shuffle<T>(arr: T[]): T[] {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}
export class MonteCarloSimulator {
  private config: MonteCarloConfig
  private rng: SeededRandom

  constructor(config: Partial<MonteCarloConfig> = {}) {
    this.config = {
      simulations: config.simulations ?? 10000,
      confidenceLevel: config.confidenceLevel ?? 0.95,
      blockSize: config.blockSize ?? 20,
      seed: config.seed,
    }
    this.rng = new SeededRandom(this.config.seed)
  }

  /**
   * Run Monte Carlo simulation on trade returns
   */
  simulate(returns: number[]): MonteCarloResult {
    if (returns.length < 10) {
      throw new Error('Need at least 10 data points for Monte Carlo')
    }

    const simResults: number[] = []
    const sharpeResults: number[] = []
    const drawdownResults: number[] = []
    const winRateResults: number[] = []
    const profitFactorResults: number[] = []

    // Run simulations
    for (let i = 0; i < this.config.simulations; i++) {
      // Block bootstrap
      const simReturns = this.blockBootstrap(returns)

      // Calculate metrics for this simulation
      const cumReturn = simReturns.reduce((acc, r) => acc * (1 + r), 1) - 1
      simResults.push(cumReturn)

      const sharpe = this.calculateSharpe(simReturns)
      sharpeResults.push(sharpe)

      const maxDD = this.calculateMaxDrawdown(simReturns)
      drawdownResults.push(maxDD)

      const winRate = simReturns.filter((r) => r > 0).length / simReturns.length
      winRateResults.push(winRate)

      const profitFactor = this.calculateProfitFactor(simReturns)
      profitFactorResults.push(profitFactor)
    }

    // Sort for percentiles
    simResults.sort((a, b) => a - b)
    sharpeResults.sort((a, b) => a - b)
    drawdownResults.sort((a, b) => a - b)

    // Calculate statistics
    const meanReturn = this.mean(simResults)
    const medianReturn = this.percentile(simResults, 0.5)
    const stdDev = this.stdDev(simResults)

    // Higher moments
    const skewness = this.skewness(simResults)
    const kurtosis = this.kurtosis(simResults)

    // Risk metrics
    const alpha = 1 - this.config.confidenceLevel
    const var95 = -this.percentile(simResults, alpha)
    const cvar95 = -this.mean(simResults.filter((r) => r <= -var95))

    // Confidence intervals
    const ciLow = (1 - this.config.confidenceLevel) / 2
    const ciHigh = 1 - ciLow

    // Probability calculations
    const probabilityOfProfit =
      simResults.filter((r) => r > 0).length / simResults.length
    const probabilityOfRuin =
      drawdownResults.filter((d) => d > 0.5).length / drawdownResults.length

    // Kelly criterion
    const kelly = this.calculateKelly(returns)

    return {
      simulations: this.config.simulations,
      meanReturn,
      medianReturn,
      stdDev,
      skewness,
      kurtosis,
      var95,
      cvar95,
      sharpeRatio: {
        mean: this.mean(sharpeResults),
        ci95: [
          this.percentile(sharpeResults, ciLow),
          this.percentile(sharpeResults, ciHigh),
        ],
      },
      maxDrawdown: {
        mean: this.mean(drawdownResults),
        ci95: [
          this.percentile(drawdownResults, ciLow),
          this.percentile(drawdownResults, ciHigh),
        ],
      },
      winRate: {
        mean: this.mean(winRateResults),
        ci95: [
          this.percentile(winRateResults, ciLow),
          this.percentile(winRateResults, ciHigh),
        ],
      },
      profitFactor: {
        mean: this.mean(profitFactorResults),
        ci95: [
          this.percentile(profitFactorResults, ciLow),
          this.percentile(profitFactorResults, ciHigh),
        ],
      },
      probabilityOfProfit,
      probabilityOfRuin,
      kelly,
      distribution: simResults,
    }
  }

  /**
   * Block bootstrap preserves autocorrelation
   */
  private blockBootstrap(data: number[]): number[] {
    const result: number[] = []
    const numBlocks = Math.ceil(data.length / this.config.blockSize)

    for (let i = 0; i < numBlocks; i++) {
      const startIdx = Math.floor(
        this.rng.next() * (data.length - this.config.blockSize),
      )
      for (
        let j = 0;
        j < this.config.blockSize && result.length < data.length;
        j++
      ) {
        result.push(data[startIdx + j])
      }
    }

    return result.slice(0, data.length)
  }

  private calculateSharpe(returns: number[]): number {
    const mean = this.mean(returns)
    const std = this.stdDev(returns)
    if (std === 0) return 0
    return (mean * Math.sqrt(252)) / std // Annualized
  }

  private calculateMaxDrawdown(returns: number[]): number {
    let peak = 1
    let maxDD = 0
    let value = 1

    for (const r of returns) {
      value *= 1 + r
      if (value > peak) peak = value
      const dd = (peak - value) / peak
      if (dd > maxDD) maxDD = dd
    }

    return maxDD
  }

  private calculateProfitFactor(returns: number[]): number {
    const gains = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0)
    const losses = Math.abs(
      returns.filter((r) => r < 0).reduce((a, b) => a + b, 0),
    )
    if (losses === 0) return gains > 0 ? Infinity : 0
    return gains / losses
  }

  private calculateKelly(returns: number[]): number {
    const winRate = returns.filter((r) => r > 0).length / returns.length
    const avgWin = this.mean(returns.filter((r) => r > 0)) || 0
    const avgLoss = Math.abs(this.mean(returns.filter((r) => r < 0))) || 1

    if (avgLoss === 0) return 0
    const oddsRatio = avgWin / avgLoss
    return winRate - (1 - winRate) / oddsRatio
  }

  // Statistical helpers
  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length
  }

  private stdDev(arr: number[]): number {
    const avg = this.mean(arr)
    const squareDiffs = arr.map((x) => (x - avg) ** 2)
    return Math.sqrt(this.mean(squareDiffs))
  }

  private percentile(sortedArr: number[], p: number): number {
    const idx = p * (sortedArr.length - 1)
    const lower = Math.floor(idx)
    const upper = Math.ceil(idx)
    if (lower === upper) return sortedArr[lower]
    return (
      sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower)
    )
  }

  private skewness(arr: number[]): number {
    const n = arr.length
    const mean = this.mean(arr)
    const std = this.stdDev(arr)
    if (std === 0) return 0

    const m3 = arr.reduce((acc, x) => acc + ((x - mean) / std) ** 3, 0) / n
    return m3
  }

  private kurtosis(arr: number[]): number {
    const n = arr.length
    const mean = this.mean(arr)
    const std = this.stdDev(arr)
    if (std === 0) return 0

    const m4 = arr.reduce((acc, x) => acc + ((x - mean) / std) ** 4, 0) / n
    return m4 - 3 // Excess kurtosis
  }
}
export class StatisticalValidator {
  /**
   * Run comprehensive statistical tests
   */
  runTests(
    inSampleReturns: number[],
    outOfSampleReturns: number[],
  ): StatisticalTest[] {
    const tests: StatisticalTest[] = []

    // 1. T-test for mean difference
    tests.push(this.tTest(inSampleReturns, outOfSampleReturns))

    // 2. Kolmogorov-Smirnov test for distribution
    tests.push(this.ksTest(inSampleReturns, outOfSampleReturns))

    // 3. Jarque-Bera test for normality
    tests.push(this.jarqueBeraTest(outOfSampleReturns))

    // 4. Ljung-Box test for autocorrelation
    tests.push(this.ljungBoxTest(outOfSampleReturns))

    // 5. Runs test for randomness
    tests.push(this.runsTest(outOfSampleReturns))

    return tests
  }

  /**
   * Two-sample t-test
   */
  private tTest(sample1: number[], sample2: number[]): StatisticalTest {
    const n1 = sample1.length
    const n2 = sample2.length
    const mean1 = sample1.reduce((a, b) => a + b, 0) / n1
    const mean2 = sample2.reduce((a, b) => a + b, 0) / n2

    const var1 = sample1.reduce((a, x) => a + (x - mean1) ** 2, 0) / (n1 - 1)
    const var2 = sample2.reduce((a, x) => a + (x - mean2) ** 2, 0) / (n2 - 1)

    const pooledSE = Math.sqrt(var1 / n1 + var2 / n2)
    const t = (mean1 - mean2) / pooledSE

    // Approximate p-value using normal distribution
    const pValue = 2 * (1 - this.normalCDF(Math.abs(t)))

    return {
      name: 'Two-Sample T-Test',
      testStatistic: t,
      pValue,
      significant: pValue < 0.05,
      interpretation:
        pValue < 0.05
          ? 'Significant difference between in-sample and out-of-sample returns (potential overfit)'
          : 'No significant difference (good generalization)',
    }
  }

  /**
   * Kolmogorov-Smirnov test
   */
  private ksTest(sample1: number[], sample2: number[]): StatisticalTest {
    const sorted1 = [...sample1].sort((a, b) => a - b)
    const sorted2 = [...sample2].sort((a, b) => a - b)

    const all = [...new Set([...sorted1, ...sorted2])].sort((a, b) => a - b)
    let maxD = 0

    for (const x of all) {
      const cdf1 = sorted1.filter((v) => v <= x).length / sorted1.length
      const cdf2 = sorted2.filter((v) => v <= x).length / sorted2.length
      maxD = Math.max(maxD, Math.abs(cdf1 - cdf2))
    }

    // Approximate p-value
    const n = Math.sqrt(
      (sample1.length * sample2.length) / (sample1.length + sample2.length),
    )
    const pValue = 2 * Math.exp(-2 * (maxD * n) ** 2)

    return {
      name: 'Kolmogorov-Smirnov Test',
      testStatistic: maxD,
      pValue,
      significant: pValue < 0.05,
      interpretation:
        pValue < 0.05
          ? 'Return distributions differ significantly (regime change or overfit)'
          : 'Similar return distributions (consistent strategy)',
    }
  }

  /**
   * Jarque-Bera normality test
   */
  private jarqueBeraTest(returns: number[]): StatisticalTest {
    const n = returns.length
    const mean = returns.reduce((a, b) => a + b, 0) / n
    const std = Math.sqrt(returns.reduce((a, x) => a + (x - mean) ** 2, 0) / n)

    if (std === 0) {
      return {
        name: 'Jarque-Bera Normality Test',
        testStatistic: 0,
        pValue: 1,
        significant: false,
        interpretation: 'Constant returns - cannot test normality',
      }
    }

    // Skewness and kurtosis
    const m3 = returns.reduce((a, x) => a + ((x - mean) / std) ** 3, 0) / n
    const m4 = returns.reduce((a, x) => a + ((x - mean) / std) ** 4, 0) / n - 3

    const jb = (n / 6) * (m3 ** 2 + m4 ** 2 / 4)

    // Chi-squared distribution with 2 df
    const pValue = 1 - this.chi2CDF(jb, 2)

    return {
      name: 'Jarque-Bera Normality Test',
      testStatistic: jb,
      pValue,
      significant: pValue < 0.05,
      interpretation:
        pValue < 0.05
          ? 'Returns are non-normal (fat tails or skew - good for MEV)'
          : 'Returns approximately normal',
    }
  }

  /**
   * Ljung-Box test for autocorrelation
   */
  private ljungBoxTest(returns: number[], lags: number = 10): StatisticalTest {
    const n = returns.length
    const mean = returns.reduce((a, b) => a + b, 0) / n

    // Calculate autocorrelations
    const gamma0 = returns.reduce((a, x) => a + (x - mean) ** 2, 0) / n
    let Q = 0

    for (let k = 1; k <= lags; k++) {
      let gammaK = 0
      for (let t = k; t < n; t++) {
        gammaK += (returns[t] - mean) * (returns[t - k] - mean)
      }
      gammaK /= n

      const rhoK = gammaK / gamma0
      Q += rhoK ** 2 / (n - k)
    }
    Q *= n * (n + 2)

    const pValue = 1 - this.chi2CDF(Q, lags)

    return {
      name: 'Ljung-Box Autocorrelation Test',
      testStatistic: Q,
      pValue,
      significant: pValue < 0.05,
      interpretation:
        pValue < 0.05
          ? 'Significant autocorrelation (momentum or reversion patterns)'
          : 'No significant autocorrelation (efficient market behavior)',
    }
  }

  /**
   * Runs test for randomness
   */
  private runsTest(returns: number[]): StatisticalTest {
    const median = [...returns].sort((a, b) => a - b)[
      Math.floor(returns.length / 2)
    ]
    const signs = returns.map((r) => (r >= median ? 1 : 0))

    let runs = 1
    for (let i = 1; i < signs.length; i++) {
      if (signs[i] !== signs[i - 1]) runs++
    }

    const n1 = signs.filter((s) => s === 1).length
    const n2 = signs.filter((s) => s === 0).length
    const n = n1 + n2

    const expectedRuns = (2 * n1 * n2) / n + 1
    const varianceRuns = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n ** 2 * (n - 1))

    const z = (runs - expectedRuns) / Math.sqrt(varianceRuns)
    const pValue = 2 * (1 - this.normalCDF(Math.abs(z)))

    return {
      name: 'Runs Test for Randomness',
      testStatistic: z,
      pValue,
      significant: pValue < 0.05,
      interpretation:
        pValue < 0.05
          ? 'Non-random patterns detected (exploitable structure)'
          : 'Returns appear random',
    }
  }

  // Distribution functions
  private normalCDF(x: number): number {
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x < 0 ? -1 : 1
    x = Math.abs(x) / Math.sqrt(2)
    const t = 1 / (1 + p * x)
    const y =
      1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
    return 0.5 * (1 + sign * y)
  }

  private chi2CDF(x: number, k: number): number {
    // Approximation using Wilson-Hilferty transformation
    if (x <= 0) return 0
    const z = (x / k) ** (1 / 3) - (1 - 2 / (9 * k))
    const se = Math.sqrt(2 / (9 * k))
    return this.normalCDF(z / se)
  }
}
export class WalkForwardAnalyzer {
  /**
   * Perform walk-forward analysis
   */
  analyze(
    data: Array<{ timestamp: number; return: number }>,
    trainRatio: number = 0.7,
    periods: number = 5,
  ): WalkForwardResult {
    const periodLength = Math.floor(data.length / periods)
    const trainLength = Math.floor(periodLength * trainRatio)
    const _testLength = periodLength - trainLength

    const periodResults: WalkForwardPeriod[] = []

    for (let i = 0; i < periods; i++) {
      const periodStart = i * periodLength
      const trainData = data.slice(periodStart, periodStart + trainLength)
      const testData = data.slice(
        periodStart + trainLength,
        periodStart + periodLength,
      )

      if (trainData.length < 10 || testData.length < 5) continue

      const trainMetrics = this.calculateMetrics(trainData.map((d) => d.return))
      const testMetrics = this.calculateMetrics(testData.map((d) => d.return))

      periodResults.push({
        trainStart: new Date(trainData[0].timestamp),
        trainEnd: new Date(trainData[trainData.length - 1].timestamp),
        testStart: new Date(testData[0].timestamp),
        testEnd: new Date(testData[testData.length - 1].timestamp),
        trainMetrics,
        testMetrics,
      })
    }

    // Aggregate test results
    const allTestReturns = periodResults.flatMap((p) =>
      Array.from(
        { length: p.testMetrics.trades },
        () => p.testMetrics.totalReturn / p.testMetrics.trades,
      ),
    )
    const aggregateMetrics = this.calculateMetrics(allTestReturns)

    // Consistency: % of periods with positive test returns
    const profitablePeriods = periodResults.filter(
      (p) => p.testMetrics.totalReturn > 0,
    ).length
    const consistency = profitablePeriods / periodResults.length

    // Robustness: how well does out-of-sample track in-sample
    let robustnessSum = 0
    for (const period of periodResults) {
      const trainSharpe = period.trainMetrics.sharpeRatio
      const testSharpe = period.testMetrics.sharpeRatio
      if (trainSharpe > 0) {
        robustnessSum += Math.min(testSharpe / trainSharpe, 1)
      }
    }
    const robustness = robustnessSum / periodResults.length

    return {
      periods: periodResults,
      aggregateMetrics,
      consistency,
      robustness,
    }
  }

  private calculateMetrics(returns: number[]): BacktestMetrics {
    const n = returns.length
    if (n === 0) {
      return {
        totalReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        trades: 0,
      }
    }

    const totalReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1
    const mean = returns.reduce((a, b) => a + b, 0) / n
    const std = Math.sqrt(returns.reduce((a, x) => a + (x - mean) ** 2, 0) / n)
    const sharpeRatio = std > 0 ? (mean * Math.sqrt(252)) / std : 0

    let peak = 1
    let maxDD = 0
    let value = 1
    for (const r of returns) {
      value *= 1 + r
      if (value > peak) peak = value
      const dd = (peak - value) / peak
      if (dd > maxDD) maxDD = dd
    }

    const winRate = returns.filter((r) => r > 0).length / n
    const gains = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0)
    const losses = Math.abs(
      returns.filter((r) => r < 0).reduce((a, b) => a + b, 0),
    )
    const profitFactor = losses > 0 ? gains / losses : gains > 0 ? Infinity : 0

    return {
      totalReturn,
      sharpeRatio,
      maxDrawdown: maxDD,
      winRate,
      profitFactor,
      trades: n,
    }
  }
}
export class ValidationSuite {
  private monteCarlo: MonteCarloSimulator
  private statValidator: StatisticalValidator
  private walkForward: WalkForwardAnalyzer

  constructor(config?: Partial<MonteCarloConfig>) {
    this.monteCarlo = new MonteCarloSimulator(config)
    this.statValidator = new StatisticalValidator()
    this.walkForward = new WalkForwardAnalyzer()
  }

  /**
   * Run full validation suite
   */
  validate(returns: number[], splitRatio: number = 0.7): ValidationResult {
    const splitIdx = Math.floor(returns.length * splitRatio)
    const inSampleReturns = returns.slice(0, splitIdx)
    const outOfSampleReturns = returns.slice(splitIdx)

    // Calculate metrics
    const inSample = this.calculateMetrics(inSampleReturns)
    const outOfSample = this.calculateMetrics(outOfSampleReturns)

    // Run statistical tests
    const statisticalTests = this.statValidator.runTests(
      inSampleReturns,
      outOfSampleReturns,
    )

    // Calculate overfit score
    const sharpeDegradation =
      inSample.sharpeRatio > 0
        ? Math.max(0, 1 - outOfSample.sharpeRatio / inSample.sharpeRatio)
        : 0
    const returnDegradation =
      inSample.totalReturn > 0
        ? Math.max(0, 1 - outOfSample.totalReturn / inSample.totalReturn)
        : 0
    const overfitScore = (sharpeDegradation + returnDegradation) / 2

    const overfit =
      overfitScore > 0.3 ||
      statisticalTests.filter((t) => t.significant).length >= 2

    // Performance degradation
    const degradation =
      inSample.sharpeRatio > 0
        ? ((inSample.sharpeRatio - outOfSample.sharpeRatio) /
            inSample.sharpeRatio) *
          100
        : 0

    // Recommendations
    const recommendations: string[] = []
    if (overfit) {
      recommendations.push(
        'Strategy shows signs of overfitting - simplify parameters',
      )
    }
    if (outOfSample.maxDrawdown > 0.3) {
      recommendations.push('High out-of-sample drawdown - add risk management')
    }
    if (outOfSample.winRate < 0.4) {
      recommendations.push('Low win rate - review entry/exit criteria')
    }
    if (outOfSample.profitFactor < 1.5) {
      recommendations.push('Low profit factor - improve risk/reward ratio')
    }
    if (degradation > 30) {
      recommendations.push(
        'Significant performance degradation - check for regime sensitivity',
      )
    }

    return {
      inSample,
      outOfSample,
      overfit,
      overfitScore,
      degradation,
      statisticalTests,
      recommendations,
    }
  }

  /**
   * Run Monte Carlo analysis
   */
  runMonteCarlo(returns: number[]): MonteCarloResult {
    return this.monteCarlo.simulate(returns)
  }

  /**
   * Run walk-forward analysis
   */
  runWalkForward(
    data: Array<{ timestamp: number; return: number }>,
  ): WalkForwardResult {
    return this.walkForward.analyze(data)
  }

  private calculateMetrics(returns: number[]): BacktestMetrics {
    const n = returns.length
    if (n === 0) {
      return {
        totalReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        trades: 0,
      }
    }

    const totalReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1
    const mean = returns.reduce((a, b) => a + b, 0) / n
    const std = Math.sqrt(returns.reduce((a, x) => a + (x - mean) ** 2, 0) / n)
    const sharpeRatio = std > 0 ? (mean * Math.sqrt(252)) / std : 0

    let peak = 1
    let maxDD = 0
    let value = 1
    for (const r of returns) {
      value *= 1 + r
      if (value > peak) peak = value
      const dd = (peak - value) / peak
      if (dd > maxDD) maxDD = dd
    }

    const winRate = returns.filter((r) => r > 0).length / n
    const gains = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0)
    const losses = Math.abs(
      returns.filter((r) => r < 0).reduce((a, b) => a + b, 0),
    )
    const profitFactor = losses > 0 ? gains / losses : gains > 0 ? Infinity : 0

    return {
      totalReturn,
      sharpeRatio,
      maxDrawdown: maxDD,
      winRate,
      profitFactor,
      trades: n,
    }
  }
}
export function createValidationSuite(
  config?: Partial<MonteCarloConfig>,
): ValidationSuite {
  return new ValidationSuite(config)
}
