/**
 * Comprehensive Bot Validation Pipeline
 *
 * Complete data science validation with:
 * - Historical backtesting with realistic economics
 * - Monte Carlo simulation with confidence intervals
 * - Statistical significance testing
 * - Walk-forward analysis
 * - Stress testing against historical crashes
 * - MEV competition simulation
 * - Slippage and market impact modeling
 * - HTML report generation with charts
 */

import type { BacktestResult, PortfolioSnapshot, Token } from '../types'
import { type BacktestConfig, Backtester } from './backtester'
import { HistoricalDataFetcher } from './data-fetcher'
import {
  createEconomicsCalculator,
  GasCostModel,
  ImpermanentLossCalculator,
  MarketImpactModel,
  SlippageModel,
  type TradeEconomics,
} from './economics'
import {
  type CompetitionSimResult,
  runMEVCompetitionSim,
} from './mev-competition'
import {
  createValidationSuite,
  type MonteCarloResult,
  type ValidationResult,
  type WalkForwardResult,
} from './monte-carlo'
import { createScanner, type ScanResult } from './multi-chain-scanner'
import { STRESS_SCENARIOS } from './multi-source-fetcher'
import {
  type StressTestConfig,
  type StressTestResult,
  StressTestRunner,
} from './stress-tests'
import { ASCIICharts, HTMLReportGenerator, TerminalReport } from './visualizer'
export interface FullValidationConfig {
  // Strategy
  strategy: 'momentum' | 'mean-reversion' | 'volatility' | 'composite'
  tokens: Token[]
  initialCapitalUsd: number

  // Economic parameters
  ethPriceUsd: number
  avgPoolTvlUsd: number
  avgDailyVolumeUsd: number
  tradeSizeUsd: number

  // Risk parameters
  maxDrawdownPercent: number
  maxDailyLossPercent: number
  maxSlippageBps: number
  usePrivateMempool: boolean

  // Monte Carlo
  monteCarloSimulations: number
  confidenceLevel: number

  // Data sources
  alchemyApiKey?: string
  heliusApiKey?: string

  // Output
  generateHtmlReport: boolean
  htmlReportPath?: string
}

export interface FullValidationResult {
  timestamp: number
  duration: number

  // Core results
  backtest: BacktestResult
  economics: EconomicsAnalysis
  monteCarlo: MonteCarloResult
  validation: ValidationResult
  walkForward: WalkForwardResult
  stressTests: StressTestResult[]
  mevSim: CompetitionSimResult
  scan: ScanResult

  // Summary
  summary: ValidationSummary

  // Generated reports
  htmlReport?: string
}

interface EconomicsAnalysis {
  tradeEconomics: TradeEconomics
  slippageModel: {
    expectedBps: number
    worstCaseBps: number
    liquidityDepthUsd: number
  }
  marketImpact: {
    temporaryBps: number
    permanentBps: number
    totalBps: number
  }
  gasCosts: {
    perTrade: number
    perMonth: number
    asPercentOfProfit: number
  }
  impermanentLoss: {
    expected30dBps: number
    expected90dBps: number
  }
  breakeven: {
    minSpreadBps: number
    minTradeSizeUsd: number
    maxGasGwei: number
  }
}

interface ValidationSummary {
  overallScore: number // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'

  profitability: {
    score: number
    status: 'pass' | 'warning' | 'fail'
    details: string
  }
  risk: {
    score: number
    status: 'pass' | 'warning' | 'fail'
    details: string
  }
  robustness: {
    score: number
    status: 'pass' | 'warning' | 'fail'
    details: string
  }
  economics: {
    score: number
    status: 'pass' | 'warning' | 'fail'
    details: string
  }

  recommendations: string[]
  warnings: string[]
  criticalIssues: string[]
}
export class FullValidationRunner {
  private config: FullValidationConfig

  constructor(config: FullValidationConfig) {
    this.config = config
  }

  /**
   * Run complete validation pipeline
   */
  async run(): Promise<FullValidationResult> {
    const startTime = Date.now()

    console.log(`\n${'█'.repeat(70)}`)
    console.log('  COMPREHENSIVE BOT VALIDATION')
    console.log('█'.repeat(70))
    console.log(`  Strategy: ${this.config.strategy}`)
    console.log(`  Capital: $${this.config.initialCapitalUsd.toLocaleString()}`)
    console.log(`  Trade Size: $${this.config.tradeSizeUsd.toLocaleString()}`)
    console.log(
      `  Monte Carlo: ${this.config.monteCarloSimulations.toLocaleString()} simulations`,
    )
    console.log(`${'█'.repeat(70)}\n`)

    // Phase 1: Historical Backtest
    console.log('\n📈 PHASE 1: HISTORICAL BACKTEST')
    console.log('─'.repeat(50))
    const backtest = await this.runBacktest()
    TerminalReport.printBacktestReport(backtest)

    // Phase 2: Economic Analysis
    console.log('\n💰 PHASE 2: ECONOMIC ANALYSIS')
    console.log('─'.repeat(50))
    const economics = this.analyzeEconomics(backtest)
    this.printEconomicsReport(economics)

    // Phase 3: Monte Carlo
    console.log('\n🎲 PHASE 3: MONTE CARLO SIMULATION')
    console.log('─'.repeat(50))
    const returns = this.extractReturns(backtest)
    const validationSuite = createValidationSuite({
      simulations: this.config.monteCarloSimulations,
      confidenceLevel: this.config.confidenceLevel,
    })
    const monteCarlo = validationSuite.runMonteCarlo(returns)
    TerminalReport.printMonteCarloReport(monteCarlo)

    // Phase 4: Statistical Validation
    console.log('\n🔬 PHASE 4: STATISTICAL VALIDATION')
    console.log('─'.repeat(50))
    const validation = validationSuite.validate(returns)
    TerminalReport.printValidationReport(validation)

    // Phase 5: Walk-Forward Analysis
    console.log('\n📊 PHASE 5: WALK-FORWARD ANALYSIS')
    console.log('─'.repeat(50))
    const walkForward = validationSuite.runWalkForward(
      backtest.snapshots.map((s: PortfolioSnapshot, i: number) => ({
        timestamp: s.timestamp,
        return:
          i === 0
            ? 0
            : (s.valueUsd - backtest.snapshots[i - 1].valueUsd) /
              backtest.snapshots[i - 1].valueUsd,
      })),
    )
    this.printWalkForwardReport(walkForward)

    // Phase 6: Stress Tests
    console.log('\n🔥 PHASE 6: STRESS TESTS')
    console.log('─'.repeat(50))
    const stressTests = await this.runStressTests()
    TerminalReport.printStressTestReport(stressTests)

    // Phase 7: MEV Competition
    console.log('\n🏁 PHASE 7: MEV COMPETITION SIMULATION')
    console.log('─'.repeat(50))
    const mevSim = await this.runMEVSimulation()
    TerminalReport.printMEVReport(mevSim)

    // Phase 8: Live Opportunity Scan
    console.log('\n🔍 PHASE 8: LIVE OPPORTUNITY SCAN')
    console.log('─'.repeat(50))
    const scan = await this.runOpportunityScan()
    this.printScanReport(scan)

    // Generate Summary
    const summary = this.generateSummary(
      backtest,
      economics,
      monteCarlo,
      validation,
      walkForward,
      stressTests,
      mevSim,
    )
    this.printSummary(summary)

    const result: FullValidationResult = {
      timestamp: startTime,
      duration: Date.now() - startTime,
      backtest,
      economics,
      monteCarlo,
      validation,
      walkForward,
      stressTests,
      mevSim,
      scan,
      summary,
    }

    // Generate HTML Report
    if (this.config.generateHtmlReport) {
      const html = HTMLReportGenerator.generate(
        {
          title: `Bot Validation Report - ${this.config.strategy}`,
          outputPath: this.config.htmlReportPath ?? './validation-report.html',
          includeCharts: true,
          includeStats: true,
          includeMonteCarlo: true,
          includeWalkForward: true,
        },
        {
          backtest,
          monteCarlo,
          validation,
          stressTests,
          mevSim,
        },
      )
      result.htmlReport = html

      const reportPath =
        this.config.htmlReportPath ?? './validation-report.html'
      HTMLReportGenerator.save(html, reportPath)
    }

    return result
  }
  private async runBacktest(): Promise<BacktestResult> {
    const fetcher = new HistoricalDataFetcher()

    // Generate 6 months of synthetic data with realistic parameters
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - 6)

    const priceData = fetcher.generateSyntheticData(
      this.config.tokens,
      startDate,
      endDate,
      86400000, // Daily
      {
        initialPrices: Object.fromEntries(
          this.config.tokens.map((t) => [
            t.symbol,
            this.getTypicalPrice(t.symbol),
          ]),
        ),
        volatilities: Object.fromEntries(
          this.config.tokens.map((t) => [
            t.symbol,
            this.getTypicalVolatility(t.symbol),
          ]),
        ),
        correlations: this.generateCorrelationMatrix(this.config.tokens.length),
        trend: -0.0002, // Slight bearish (current market)
      },
    )

    const backtestConfig: BacktestConfig = {
      strategy: this.config.strategy,
      tokens: this.config.tokens,
      initialWeights: this.config.tokens.map(
        () => 1 / this.config.tokens.length,
      ),
      startDate,
      endDate,
      initialCapitalUsd: this.config.initialCapitalUsd,
      rebalanceIntervalHours: 24,
      tradingFeeBps: 30,
      slippageBps: Math.round(
        SlippageModel.estimateSlippage(
          this.config.tradeSizeUsd,
          this.config.avgPoolTvlUsd,
        ).expectedSlippageBps,
      ),
      priceData,
    }

    const backtester = new Backtester()
    return backtester.run(backtestConfig)
  }

  private analyzeEconomics(backtest: BacktestResult): EconomicsAnalysis {
    const calculator = createEconomicsCalculator({
      ethPriceUsd: this.config.ethPriceUsd,
      gasMultiplier: 1.2,
      mevRiskFactor: this.config.usePrivateMempool ? 0.1 : 0.5,
      liquidityConfidence: 0.8,
    })

    // Calculate trade economics
    const avgSpreadBps =
      backtest.totalReturn > 0
        ? (backtest.totalReturn / backtest.totalTrades) * 10000
        : 10

    const tradeEconomics = calculator.calculate({
      tradeSizeUsd: this.config.tradeSizeUsd,
      expectedSpreadBps: avgSpreadBps,
      poolTvlUsd: this.config.avgPoolTvlUsd,
      chainId: 1, // Assume mainnet for worst-case gas
      hops: 2,
      isPrivateMempool: this.config.usePrivateMempool,
      dailyVolumeUsd: this.config.avgDailyVolumeUsd,
    })

    // Slippage model
    const slippage = SlippageModel.estimateSlippage(
      this.config.tradeSizeUsd,
      this.config.avgPoolTvlUsd,
      30,
    )

    // Market impact
    const impact = MarketImpactModel.calculateImpact(
      this.config.tradeSizeUsd,
      this.config.avgDailyVolumeUsd,
      0.02,
      0.01,
    )

    // Gas costs
    const gasCost = GasCostModel.estimate('multiHop2', 1, {
      ethPriceUsd: this.config.ethPriceUsd,
      gasMultiplier: 1.2,
      mevRiskFactor: 0.5,
      liquidityConfidence: 0.8,
    })

    const tradesPerMonth = 30 * 24 // Hourly trades
    const gasPerMonth = gasCost.totalCostUsd * tradesPerMonth
    const profitPerMonth =
      (backtest.totalReturn * this.config.initialCapitalUsd) / 6

    // Impermanent loss
    const il30 = ImpermanentLossCalculator.estimateExpectedIL(0.8, 30)
    const il90 = ImpermanentLossCalculator.estimateExpectedIL(0.8, 90)

    // Breakeven calculations
    const minSpreadForProfit =
      ((tradeEconomics.slippageCostUsd + tradeEconomics.gasCostUsd) /
        this.config.tradeSizeUsd) *
      10000

    return {
      tradeEconomics,
      slippageModel: {
        expectedBps: slippage.expectedSlippageBps,
        worstCaseBps: slippage.worstCaseSlippageBps,
        liquidityDepthUsd: slippage.liquidityDepthUsd,
      },
      marketImpact: {
        temporaryBps: impact.temporaryImpactBps,
        permanentBps: impact.permanentImpactBps,
        totalBps: impact.totalImpactBps,
      },
      gasCosts: {
        perTrade: gasCost.totalCostUsd,
        perMonth: gasPerMonth,
        asPercentOfProfit:
          profitPerMonth > 0 ? (gasPerMonth / profitPerMonth) * 100 : 100,
      },
      impermanentLoss: {
        expected30dBps: il30.expectedIlBps,
        expected90dBps: il90.expectedIlBps,
      },
      breakeven: {
        minSpreadBps: minSpreadForProfit,
        minTradeSizeUsd: tradeEconomics.gasCostUsd / (avgSpreadBps / 10000),
        maxGasGwei:
          ((tradeEconomics.grossProfitUsd / Number(gasCost.totalGasUnits)) *
            1e9) /
          this.config.ethPriceUsd,
      },
    }
  }

  private async runStressTests(): Promise<StressTestResult[]> {
    const stressConfig: StressTestConfig = {
      strategy: this.config.strategy,
      initialCapitalUsd: this.config.initialCapitalUsd,
      riskParams: {
        maxDrawdownPercent: this.config.maxDrawdownPercent,
        dailyLossLimitPercent: this.config.maxDailyLossPercent,
        circuitBreakerEnabled: true,
        maxGasGwei: 200,
      },
      tokens: this.config.tokens,
    }

    const runner = new StressTestRunner()
    const results: StressTestResult[] = []

    for (const scenario of STRESS_SCENARIOS) {
      const result = await runner.runScenario(scenario, stressConfig)
      results.push(result)
    }

    return results
  }

  private async runMEVSimulation(): Promise<CompetitionSimResult> {
    return runMEVCompetitionSim({
      blocks: 1000,
      opportunitiesPerBlock: 3,
      gasPriceGwei: 30,
      ethPriceUsd: this.config.ethPriceUsd,
      ourLatencyMs: 50,
      ourSuccessRate: 0.2,
    })
  }

  private async runOpportunityScan(): Promise<ScanResult> {
    const scanner = createScanner({
      chains: [
        { chainId: 1, rpcUrl: 'https://eth.llamarpc.com', name: 'Ethereum' },
        { chainId: 8453, rpcUrl: 'https://mainnet.base.org', name: 'Base' },
        {
          chainId: 42161,
          rpcUrl: 'https://arb1.arbitrum.io/rpc',
          name: 'Arbitrum',
        },
      ],
      tokens: this.config.tokens.map((t) => t.symbol),
      minSpreadBps: 5,
      minProfitUsd: 1,
      heliusApiKey: this.config.heliusApiKey,
    })

    return scanner.scan()
  }
  private generateSummary(
    backtest: BacktestResult,
    economics: EconomicsAnalysis,
    monteCarlo: MonteCarloResult,
    validation: ValidationResult,
    walkForward: WalkForwardResult,
    stressTests: StressTestResult[],
    mevSim: CompetitionSimResult,
  ): ValidationSummary {
    const recommendations: string[] = []
    const warnings: string[] = []
    const criticalIssues: string[] = []

    // Profitability Score (0-25)
    let profitScore = 0
    if (backtest.totalReturn > 0.1) profitScore = 25
    else if (backtest.totalReturn > 0.05) profitScore = 20
    else if (backtest.totalReturn > 0) profitScore = 15
    else profitScore = 0

    const profitStatus =
      profitScore >= 20 ? 'pass' : profitScore >= 15 ? 'warning' : 'fail'

    if (profitScore < 20) {
      recommendations.push('Improve entry/exit criteria for higher returns')
    }
    if (economics.breakeven.minSpreadBps > 50) {
      warnings.push(
        `High breakeven spread required: ${economics.breakeven.minSpreadBps.toFixed(0)} bps`,
      )
    }

    // Risk Score (0-25)
    let riskScore = 25
    if (backtest.maxDrawdown > 0.3) riskScore -= 15
    else if (backtest.maxDrawdown > 0.2) riskScore -= 10
    else if (backtest.maxDrawdown > 0.1) riskScore -= 5

    if (monteCarlo.probabilityOfRuin > 0.1) riskScore -= 10
    if (monteCarlo.cvar95 > 0.2) riskScore -= 5

    riskScore = Math.max(0, riskScore)
    const riskStatus =
      riskScore >= 20 ? 'pass' : riskScore >= 15 ? 'warning' : 'fail'

    if (backtest.maxDrawdown > 0.25) {
      criticalIssues.push('Excessive drawdown risk - add stop losses')
    }
    if (monteCarlo.probabilityOfRuin > 0.05) {
      warnings.push(
        `${(monteCarlo.probabilityOfRuin * 100).toFixed(1)}% probability of >50% drawdown`,
      )
    }

    // Robustness Score (0-25)
    let robustnessScore = 25
    if (validation.overfit) robustnessScore -= 15
    else if (validation.overfitScore > 0.2) robustnessScore -= 10

    const stressSurvivalRate =
      stressTests.filter((s) => s.survivalMetrics.survived).length /
      stressTests.length
    if (stressSurvivalRate < 0.75) robustnessScore -= 10
    else if (stressSurvivalRate < 1) robustnessScore -= 5

    if (walkForward.consistency < 0.6) robustnessScore -= 5

    robustnessScore = Math.max(0, robustnessScore)
    const robustnessStatus =
      robustnessScore >= 20
        ? 'pass'
        : robustnessScore >= 15
          ? 'warning'
          : 'fail'

    if (validation.overfit) {
      criticalIssues.push('Strategy shows overfitting - simplify parameters')
    }
    if (stressSurvivalRate < 0.75) {
      warnings.push(
        `Only survived ${(stressSurvivalRate * 100).toFixed(0)}% of stress scenarios`,
      )
    }

    // Economics Score (0-25)
    let economicsScore = 25
    if (economics.tradeEconomics.netProfitUsd < 0) economicsScore = 0
    else if (economics.tradeEconomics.breakEvenProbability < 0.6)
      economicsScore -= 15
    else if (economics.tradeEconomics.breakEvenProbability < 0.8)
      economicsScore -= 10

    if (economics.gasCosts.asPercentOfProfit > 30) economicsScore -= 10
    else if (economics.gasCosts.asPercentOfProfit > 20) economicsScore -= 5

    if (mevSim.winRate < 0.02) economicsScore -= 5

    economicsScore = Math.max(0, economicsScore)
    const economicsStatus =
      economicsScore >= 20 ? 'pass' : economicsScore >= 15 ? 'warning' : 'fail'

    if (economics.tradeEconomics.netProfitUsd <= 0) {
      criticalIssues.push('Trades are not profitable after costs')
    }
    if (economics.gasCosts.asPercentOfProfit > 30) {
      recommendations.push(
        'Gas costs too high - target L2 chains or larger trades',
      )
    }
    if (economics.slippageModel.expectedBps > 100) {
      recommendations.push(
        'High slippage - reduce trade size or target deeper pools',
      )
    }

    // Overall Score
    const overallScore =
      profitScore + riskScore + robustnessScore + economicsScore
    let grade: ValidationSummary['grade']
    if (overallScore >= 90) grade = 'A'
    else if (overallScore >= 75) grade = 'B'
    else if (overallScore >= 60) grade = 'C'
    else if (overallScore >= 40) grade = 'D'
    else grade = 'F'

    return {
      overallScore,
      grade,
      profitability: {
        score: profitScore,
        status: profitStatus,
        details: `${(backtest.totalReturn * 100).toFixed(1)}% return, ${backtest.sharpeRatio.toFixed(2)} Sharpe`,
      },
      risk: {
        score: riskScore,
        status: riskStatus,
        details: `${(backtest.maxDrawdown * 100).toFixed(1)}% max DD, ${(monteCarlo.probabilityOfRuin * 100).toFixed(1)}% ruin risk`,
      },
      robustness: {
        score: robustnessScore,
        status: robustnessStatus,
        details: `${(stressSurvivalRate * 100).toFixed(0)}% stress survival, ${(walkForward.consistency * 100).toFixed(0)}% period consistency`,
      },
      economics: {
        score: economicsScore,
        status: economicsStatus,
        details: `${(economics.tradeEconomics.breakEvenProbability * 100).toFixed(0)}% break-even prob, ${economics.gasCosts.asPercentOfProfit.toFixed(0)}% gas overhead`,
      },
      recommendations,
      warnings,
      criticalIssues,
    }
  }
  private printEconomicsReport(economics: EconomicsAnalysis): void {
    console.log('\n📊 TRADE ECONOMICS')
    console.log('─'.repeat(40))
    console.log(
      `  Gross Profit:       $${economics.tradeEconomics.grossProfitUsd.toFixed(2)}`,
    )
    console.log(
      `  Slippage Cost:      $${economics.tradeEconomics.slippageCostUsd.toFixed(2)}`,
    )
    console.log(
      `  Gas Cost:           $${economics.tradeEconomics.gasCostUsd.toFixed(2)}`,
    )
    console.log(
      `  MEV Risk Cost:      $${economics.tradeEconomics.mevRiskCostUsd.toFixed(2)}`,
    )
    console.log(
      `  Net Profit:         $${economics.tradeEconomics.netProfitUsd.toFixed(2)}`,
    )
    console.log(
      `  Return:             ${economics.tradeEconomics.returnBps.toFixed(1)} bps`,
    )
    console.log(
      `  Break-even Prob:    ${(economics.tradeEconomics.breakEvenProbability * 100).toFixed(1)}%`,
    )

    console.log('\n📉 SLIPPAGE & IMPACT')
    console.log('─'.repeat(40))
    console.log(
      `  Expected Slippage:  ${economics.slippageModel.expectedBps.toFixed(1)} bps`,
    )
    console.log(
      `  Worst Case:         ${economics.slippageModel.worstCaseBps.toFixed(1)} bps`,
    )
    console.log(
      `  Liquidity Depth:    $${(economics.slippageModel.liquidityDepthUsd / 1000).toFixed(0)}k`,
    )
    console.log(
      `  Temp Impact:        ${economics.marketImpact.temporaryBps.toFixed(2)} bps`,
    )
    console.log(
      `  Perm Impact:        ${economics.marketImpact.permanentBps.toFixed(2)} bps`,
    )

    console.log('\n⛽ GAS COSTS')
    console.log('─'.repeat(40))
    console.log(
      `  Per Trade:          $${economics.gasCosts.perTrade.toFixed(2)}`,
    )
    console.log(
      `  Per Month (est):    $${economics.gasCosts.perMonth.toFixed(0)}`,
    )
    console.log(
      `  % of Profit:        ${economics.gasCosts.asPercentOfProfit.toFixed(1)}%`,
    )

    console.log('\n📊 BREAKEVEN ANALYSIS')
    console.log('─'.repeat(40))
    console.log(
      `  Min Spread:         ${economics.breakeven.minSpreadBps.toFixed(1)} bps`,
    )
    console.log(
      `  Min Trade Size:     $${economics.breakeven.minTradeSizeUsd.toFixed(0)}`,
    )
    console.log(
      `  Max Gas Price:      ${economics.breakeven.maxGasGwei.toFixed(0)} gwei`,
    )
  }

  private printWalkForwardReport(result: WalkForwardResult): void {
    console.log(`  Periods:            ${result.periods.length}`)
    console.log(
      `  Consistency:        ${(result.consistency * 100).toFixed(0)}%`,
    )
    console.log(
      `  Robustness:         ${(result.robustness * 100).toFixed(0)}%`,
    )

    console.log('\n  Period-by-Period:')
    console.log(
      ASCIICharts.table(
        ['Period', 'Train Sharpe', 'Test Sharpe', 'Degradation'],
        result.periods.map((p, i) => [
          `${i + 1}`,
          p.trainMetrics.sharpeRatio.toFixed(2),
          p.testMetrics.sharpeRatio.toFixed(2),
          `${p.trainMetrics.sharpeRatio > 0 ? ((1 - p.testMetrics.sharpeRatio / p.trainMetrics.sharpeRatio) * 100).toFixed(0) : 'N/A'}%`,
        ]),
      ),
    )
  }

  private printScanReport(result: ScanResult): void {
    console.log(`  Chains Scanned:     ${result.chainStatus.length}`)
    console.log(
      `  Cross-chain Opps:   ${result.crossChainOpportunities.length}`,
    )
    console.log(`  Same-chain Opps:    ${result.sameChainOpportunities.length}`)
    console.log(
      `  Total Value:        $${result.totalOpportunityValue.toFixed(2)}`,
    )

    if (result.crossChainOpportunities.length > 0) {
      console.log('\n  Top Cross-Chain Opportunities:')
      for (const opp of result.crossChainOpportunities.slice(0, 3)) {
        console.log(
          `    ${opp.token}: ${opp.spreadBps.toFixed(1)} bps ($${opp.netProfitUsd.toFixed(2)})`,
        )
      }
    }
  }

  private printSummary(summary: ValidationSummary): void {
    console.log(`\n${'█'.repeat(70)}`)
    console.log('  VALIDATION SUMMARY')
    console.log('█'.repeat(70))

    const gradeColors: Record<string, string> = {
      A: '\x1b[32m', // Green
      B: '\x1b[36m', // Cyan
      C: '\x1b[33m', // Yellow
      D: '\x1b[33m', // Yellow
      F: '\x1b[31m', // Red
    }
    const reset = '\x1b[0m'

    console.log(`\n  Overall Score: ${summary.overallScore}/100`)
    console.log(
      `  Grade: ${gradeColors[summary.grade]}${summary.grade}${reset}`,
    )

    console.log('\n  Category Breakdown:')
    const categories = [
      { name: 'Profitability', ...summary.profitability },
      { name: 'Risk', ...summary.risk },
      { name: 'Robustness', ...summary.robustness },
      { name: 'Economics', ...summary.economics },
    ]

    for (const cat of categories) {
      const statusIcon =
        cat.status === 'pass' ? '✅' : cat.status === 'warning' ? '⚠️' : '❌'
      const bar = '█'.repeat(cat.score) + '░'.repeat(25 - cat.score)
      console.log(
        `  ${statusIcon} ${cat.name.padEnd(15)} [${bar}] ${cat.score}/25`,
      )
      console.log(`     ${cat.details}`)
    }

    if (summary.criticalIssues.length > 0) {
      console.log('\n  🚨 CRITICAL ISSUES:')
      for (const issue of summary.criticalIssues) {
        console.log(`     • ${issue}`)
      }
    }

    if (summary.warnings.length > 0) {
      console.log('\n  ⚠️ WARNINGS:')
      for (const warning of summary.warnings) {
        console.log(`     • ${warning}`)
      }
    }

    if (summary.recommendations.length > 0) {
      console.log('\n  💡 RECOMMENDATIONS:')
      for (const rec of summary.recommendations) {
        console.log(`     • ${rec}`)
      }
    }

    console.log(`\n${'█'.repeat(70)}`)
    if (summary.grade === 'A' || summary.grade === 'B') {
      console.log('  ✅ STRATEGY VALIDATED - Ready for production testing')
    } else if (summary.grade === 'C') {
      console.log(
        '  ⚠️ STRATEGY NEEDS IMPROVEMENT - Address warnings before deployment',
      )
    } else {
      console.log('  ❌ STRATEGY NOT READY - Critical issues must be resolved')
    }
    console.log(`${'█'.repeat(70)}\n`)
  }
  private extractReturns(backtest: BacktestResult): number[] {
    const returns: number[] = []
    for (let i = 1; i < backtest.snapshots.length; i++) {
      const prev = backtest.snapshots[i - 1].valueUsd
      const curr = backtest.snapshots[i].valueUsd
      returns.push((curr - prev) / prev)
    }
    return returns
  }

  private getTypicalPrice(symbol: string): number {
    const prices: Record<string, number> = {
      ETH: 3500,
      WETH: 3500,
      BTC: 95000,
      WBTC: 95000,
      USDC: 1,
      USDT: 1,
      DAI: 1,
      SOL: 200,
      ARB: 1.2,
      OP: 2.5,
    }
    return prices[symbol] ?? 1
  }

  private getTypicalVolatility(symbol: string): number {
    const volatilities: Record<string, number> = {
      ETH: 0.8,
      WETH: 0.8,
      BTC: 0.6,
      WBTC: 0.6,
      USDC: 0.001,
      USDT: 0.001,
      DAI: 0.002,
      SOL: 1.2,
      ARB: 1.5,
      OP: 1.3,
    }
    return volatilities[symbol] ?? 0.8
  }

  private generateCorrelationMatrix(n: number): number[][] {
    // Generate a valid correlation matrix with high correlations between crypto assets
    const matrix: number[][] = []
    for (let i = 0; i < n; i++) {
      matrix[i] = []
      for (let j = 0; j < n; j++) {
        if (i === j) matrix[i][j] = 1
        else if (matrix[j]?.[i] !== undefined) matrix[i][j] = matrix[j][i]
        else matrix[i][j] = 0.6 + Math.random() * 0.3 // 0.6-0.9 correlation
      }
    }
    return matrix
  }
}
async function main() {
  const config: FullValidationConfig = {
    strategy: 'momentum',
    tokens: [
      {
        symbol: 'ETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        decimals: 18,
        chainId: 1,
      },
      {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
        chainId: 1,
      },
    ],
    initialCapitalUsd: 100000,
    ethPriceUsd: 3500,
    avgPoolTvlUsd: 50000000,
    avgDailyVolumeUsd: 100000000,
    tradeSizeUsd: 10000,
    maxDrawdownPercent: 25,
    maxDailyLossPercent: 5,
    maxSlippageBps: 50,
    usePrivateMempool: true,
    monteCarloSimulations: 10000,
    confidenceLevel: 0.95,
    generateHtmlReport: true,
    htmlReportPath: './validation-report.html',
  }

  const runner = new FullValidationRunner(config)
  const result = await runner.run()

  console.log(
    `\nValidation completed in ${(result.duration / 1000).toFixed(1)}s`,
  )
  if (result.htmlReport) {
    console.log(`HTML report saved to: ${config.htmlReportPath}`)
  }
}

if (import.meta.main) {
  main().catch(console.error)
}
