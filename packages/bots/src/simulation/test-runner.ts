/** Bot testing pipeline. */

import { getExternalRpc } from '@jejunetwork/config'
import type { Token } from '../types'
import { type BacktestConfig, Backtester } from './backtester'
import { type FlashLoanTestConfig, runFlashLoanTests } from './flashloan-tests'
import { runMEVCompetitionSim } from './mev-competition'
import { createScanner } from './multi-chain-scanner'
import { MultiSourceFetcher } from './multi-source-fetcher'
import {
  STRESS_SCENARIOS,
  type StressTestConfig,
  StressTestRunner,
} from './stress-tests'
export interface TestPipelineConfig {
  // Data sources
  alchemyApiKey?: string
  heliusApiKey?: string

  // Test selection
  runBacktest: boolean
  runStressTests: boolean
  runFlashLoanTests: boolean
  runMEVSimulation: boolean
  runMultiChainScan: boolean

  // Strategy
  strategy: 'momentum' | 'mean-reversion' | 'volatility' | 'composite'
  initialCapitalUsd: number

  // Chain
  chainId: number
  rpcUrl: string
  testPrivateKey?: string

  // Specific scenarios
  stressScenarios?: string[] // Names of scenarios to run
}

export interface TestPipelineResult {
  timestamp: number
  duration: number
  summary: {
    passed: number
    failed: number
    warnings: number
    totalTests: number
  }
  backtestResults?: BacktestSummary
  stressTestResults?: StressTestSummary
  flashLoanResults?: FlashLoanSummary
  mevSimResults?: MEVSimSummary
  scanResults?: ScanSummary
  recommendations: string[]
}

interface BacktestSummary {
  totalReturn: number
  maxDrawdown: number
  sharpeRatio: number
  winRate: number
  profitable: boolean
}

interface StressTestSummary {
  scenariosRun: number
  scenariosSurvived: number
  avgCapitalPreserved: number
  worstDrawdown: number
  circuitBreakersTriggered: number
}

interface FlashLoanSummary {
  testsRun: number
  testsPassed: number
  avgGasUsed: number
  profitabilityVerified: boolean
}

interface MEVSimSummary {
  winRate: number
  netProfit: number
  competitorAdvantage: string
  latencyImpact: number
}

interface ScanSummary {
  chainsScanned: number
  opportunitiesFound: number
  totalValueUsd: number
  bestOpportunity: string
}
export class TestPipeline {
  private config: TestPipelineConfig
  private results: Partial<TestPipelineResult> = {}
  private startTime: number = 0

  constructor(config: TestPipelineConfig) {
    this.config = config
  }

  /**
   * Run the complete test pipeline
   */
  async run(): Promise<TestPipelineResult> {
    this.startTime = Date.now()
    const recommendations: string[] = []
    let passed = 0
    let failed = 0
    let warnings = 0

    console.log(`\n${'═'.repeat(70)}`)
    console.log('  BOT VALIDATION PIPELINE')
    console.log('═'.repeat(70))
    console.log(`  Strategy: ${this.config.strategy}`)
    console.log(
      `  Initial Capital: $${this.config.initialCapitalUsd.toLocaleString()}`,
    )
    console.log(`  Chain: ${this.config.chainId}`)
    console.log(`${'═'.repeat(70)}\n`)

    // 1. Historical Backtest
    if (this.config.runBacktest) {
      console.log('\n📈 PHASE 1: HISTORICAL BACKTEST')
      console.log('─'.repeat(50))

      try {
        this.results.backtestResults = await this.runBacktest()

        if (this.results.backtestResults.profitable) {
          passed++
          console.log(
            '✅ Backtest PASSED - Strategy is profitable on historical data',
          )
        } else {
          failed++
          console.log('❌ Backtest FAILED - Strategy unprofitable')
          recommendations.push(
            'Review strategy parameters - not profitable on historical data',
          )
        }

        if (this.results.backtestResults.maxDrawdown > 0.3) {
          warnings++
          recommendations.push(
            'High drawdown risk - consider reducing position sizes',
          )
        }

        if (this.results.backtestResults.sharpeRatio < 1) {
          warnings++
          recommendations.push(
            'Low Sharpe ratio - risk-adjusted returns could be improved',
          )
        }
      } catch (error) {
        failed++
        console.error('❌ Backtest error:', error)
        recommendations.push('Fix backtest infrastructure before proceeding')
      }
    }

    // 2. Stress Tests
    if (this.config.runStressTests) {
      console.log('\n🔥 PHASE 2: STRESS TESTS')
      console.log('─'.repeat(50))

      try {
        this.results.stressTestResults = await this.runStressTests()

        const survivalRate =
          this.results.stressTestResults.scenariosSurvived /
          this.results.stressTestResults.scenariosRun

        if (survivalRate >= 0.75) {
          passed++
          console.log(
            `✅ Stress tests PASSED - Survived ${this.results.stressTestResults.scenariosSurvived}/${this.results.stressTestResults.scenariosRun} scenarios`,
          )
        } else if (survivalRate >= 0.5) {
          warnings++
          console.log(
            `⚠️ Stress tests WARNING - Survived only ${survivalRate * 100}% of scenarios`,
          )
          recommendations.push(
            'Strategy struggles in extreme conditions - add circuit breakers',
          )
        } else {
          failed++
          console.log(
            `❌ Stress tests FAILED - Survived only ${survivalRate * 100}% of scenarios`,
          )
          recommendations.push(
            'Strategy fails in crisis - requires major risk management improvements',
          )
        }
      } catch (error) {
        failed++
        console.error('❌ Stress test error:', error)
      }
    }

    // 3. Flash Loan Tests
    if (this.config.runFlashLoanTests) {
      console.log('\n⚡ PHASE 3: FLASH LOAN TESTS')
      console.log('─'.repeat(50))

      if (!this.config.testPrivateKey) {
        warnings++
        console.log(
          '⚠️ Skipping flash loan tests - no test private key configured',
        )
        recommendations.push(
          'Configure TEST_PRIVATE_KEY to run flash loan tests',
        )
      } else {
        try {
          this.results.flashLoanResults = await this.runFlashLoanTestSuite()

          if (
            this.results.flashLoanResults.testsPassed ===
            this.results.flashLoanResults.testsRun
          ) {
            passed++
            console.log('✅ Flash loan tests PASSED')
          } else {
            const passRate =
              this.results.flashLoanResults.testsPassed /
              this.results.flashLoanResults.testsRun
            if (passRate >= 0.8) {
              warnings++
              console.log(
                `⚠️ Flash loan tests WARNING - ${passRate * 100}% passed`,
              )
            } else {
              failed++
              console.log(
                `❌ Flash loan tests FAILED - ${passRate * 100}% passed`,
              )
              recommendations.push(
                'Flash loan execution issues - review contract interactions',
              )
            }
          }
        } catch (error) {
          failed++
          console.error('❌ Flash loan test error:', error)
          console.log('   Note: Requires Anvil (Foundry) installed')
        }
      }
    }

    // 4. MEV Competition Simulation
    if (this.config.runMEVSimulation) {
      console.log('\n🏁 PHASE 4: MEV COMPETITION SIMULATION')
      console.log('─'.repeat(50))

      try {
        this.results.mevSimResults = await this.runMEVSimulation()

        // MEV is highly competitive - realistic thresholds
        // >5% is good, >2% is acceptable (profitable), <1% is concerning
        if (
          this.results.mevSimResults.winRate >= 0.02 &&
          this.results.mevSimResults.netProfit > 0
        ) {
          passed++
          console.log(
            `✅ MEV simulation PASSED - ${(this.results.mevSimResults.winRate * 100).toFixed(1)}% win rate, profitable`,
          )
        } else if (
          this.results.mevSimResults.winRate >= 0.01 ||
          this.results.mevSimResults.netProfit > 0
        ) {
          warnings++
          console.log(
            `⚠️ MEV simulation WARNING - Marginal profitability ${(this.results.mevSimResults.winRate * 100).toFixed(1)}%`,
          )
          recommendations.push(
            'Consider latency improvements or niche strategy focus',
          )
        } else {
          failed++
          console.log(`❌ MEV simulation FAILED - Not profitable`)
          recommendations.push(
            'Current MEV approach not competitive - consider alternative strategies',
          )
        }

        console.log(
          `   Net profit potential: $${this.results.mevSimResults.netProfit.toFixed(2)}/week`,
        )
        console.log(
          `   Competitor advantage: ${this.results.mevSimResults.competitorAdvantage}`,
        )
      } catch (error) {
        failed++
        console.error('❌ MEV simulation error:', error)
      }
    }

    // 5. Multi-Chain Opportunity Scan
    if (this.config.runMultiChainScan) {
      console.log('\n🔍 PHASE 5: MULTI-CHAIN OPPORTUNITY SCAN')
      console.log('─'.repeat(50))

      try {
        this.results.scanResults = await this.runMultiChainScan()

        if (this.results.scanResults.opportunitiesFound > 0) {
          passed++
          console.log(
            `✅ Scan PASSED - Found ${this.results.scanResults.opportunitiesFound} opportunities`,
          )
          console.log(
            `   Total value: $${this.results.scanResults.totalValueUsd.toFixed(2)}`,
          )
          console.log(`   Best: ${this.results.scanResults.bestOpportunity}`)
        } else {
          warnings++
          console.log(
            '⚠️ Scan found no profitable opportunities in current market',
          )
          recommendations.push(
            'Current market conditions may not favor arbitrage',
          )
        }
      } catch (error) {
        warnings++
        console.error('⚠️ Scan error (non-critical):', error)
      }
    }

    // Final Summary
    const duration = Date.now() - this.startTime
    const totalTests = passed + failed + warnings

    console.log(`\n${'═'.repeat(70)}`)
    console.log('  PIPELINE SUMMARY')
    console.log('═'.repeat(70))
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`)
    console.log(`  Tests Run: ${totalTests}`)
    console.log(`  ✅ Passed: ${passed}`)
    console.log(`  ❌ Failed: ${failed}`)
    console.log(`  ⚠️ Warnings: ${warnings}`)

    if (recommendations.length > 0) {
      console.log('\n  📋 Recommendations:')
      for (const rec of recommendations) {
        console.log(`     • ${rec}`)
      }
    }

    const overallStatus =
      failed === 0
        ? warnings === 0
          ? '✅ ALL TESTS PASSED'
          : '⚠️ PASSED WITH WARNINGS'
        : '❌ SOME TESTS FAILED'

    console.log(`\n  ${overallStatus}`)
    console.log(`${'═'.repeat(70)}\n`)

    return {
      timestamp: this.startTime,
      duration,
      summary: { passed, failed, warnings, totalTests },
      backtestResults: this.results.backtestResults,
      stressTestResults: this.results.stressTestResults,
      flashLoanResults: this.results.flashLoanResults,
      mevSimResults: this.results.mevSimResults,
      scanResults: this.results.scanResults,
      recommendations,
    }
  }
  private async runBacktest(): Promise<BacktestSummary> {
    const fetcher = new MultiSourceFetcher({
      alchemyApiKey: this.config.alchemyApiKey,
      heliusApiKey: this.config.heliusApiKey,
    })

    const tokens: Token[] = [
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
    ]

    // Fetch 6 months of data
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - 6)

    let priceData = await fetcher.fetchDefiLlamaPrices(
      tokens,
      startDate,
      endDate,
      86400000,
    )

    // If no data, generate synthetic
    if (priceData.length === 0) {
      console.log('   Using synthetic data (no historical data available)')
      const basicFetcher = await import('./data-fetcher').then(
        (m) => new m.HistoricalDataFetcher(),
      )
      priceData = basicFetcher.generateSyntheticData(
        tokens,
        startDate,
        endDate,
        86400000,
        {
          initialPrices: { ETH: 3500, USDC: 1 },
          volatilities: { ETH: 0.8, USDC: 0.001 },
          trend: -0.0005, // Slight bearish
        },
      )
    }

    const backtestConfig: BacktestConfig = {
      strategy: this.config.strategy,
      tokens,
      initialWeights: [0.6, 0.4],
      startDate,
      endDate,
      initialCapitalUsd: this.config.initialCapitalUsd,
      rebalanceIntervalHours: 24,
      tradingFeeBps: 30,
      slippageBps: 10,
      priceData,
    }

    const backtester = new Backtester()
    const result = await backtester.run(backtestConfig)

    return {
      totalReturn: result.totalReturn,
      maxDrawdown: result.maxDrawdown,
      sharpeRatio: result.sharpeRatio,
      winRate: result.winRate,
      profitable: result.totalReturn > 0,
    }
  }

  private async runStressTests(): Promise<StressTestSummary> {
    const tokens: Token[] = [
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
    ]

    const stressConfig: StressTestConfig = {
      strategy: this.config.strategy,
      initialCapitalUsd: this.config.initialCapitalUsd,
      riskParams: {
        maxDrawdownPercent: 25,
        dailyLossLimitPercent: 5,
        circuitBreakerEnabled: true,
        maxGasGwei: 200,
      },
      tokens,
    }

    const runner = new StressTestRunner()

    // Filter scenarios if specified
    let scenarios = STRESS_SCENARIOS
    if (this.config.stressScenarios && this.config.stressScenarios.length > 0) {
      scenarios = STRESS_SCENARIOS.filter((s) =>
        this.config.stressScenarios?.some((name) =>
          s.name.toLowerCase().includes(name.toLowerCase()),
        ),
      )
    }

    let survived = 0
    let totalCapitalPreserved = 0
    let worstDrawdown = 0
    let circuitBreakers = 0

    for (const scenario of scenarios) {
      const result = await runner.runScenario(scenario, stressConfig)

      if (result.survivalMetrics.survived) survived++
      totalCapitalPreserved += result.survivalMetrics.capitalPreserved
      worstDrawdown = Math.max(worstDrawdown, result.backtest.maxDrawdown)
      if (result.circuitBreakerTriggered) circuitBreakers++
    }

    return {
      scenariosRun: scenarios.length,
      scenariosSurvived: survived,
      avgCapitalPreserved: totalCapitalPreserved / scenarios.length,
      worstDrawdown,
      circuitBreakersTriggered: circuitBreakers,
    }
  }

  private async runFlashLoanTestSuite(): Promise<FlashLoanSummary> {
    if (!this.config.testPrivateKey) {
      throw new Error('Test private key required for flash loan tests')
    }

    const flashConfig: FlashLoanTestConfig = {
      chainId: this.config.chainId,
      rpcUrl: this.config.rpcUrl,
      testPrivateKey: this.config.testPrivateKey,
    }

    const results = await runFlashLoanTests(flashConfig)

    const passed = results.filter((r) => r.success).length
    const avgGas =
      results
        .filter((r) => r.gasUsed)
        .reduce((sum, r) => sum + Number(r.gasUsed), 0) / results.length

    return {
      testsRun: results.length,
      testsPassed: passed,
      avgGasUsed: avgGas,
      profitabilityVerified: results.some(
        (r) => r.testName === 'Profitability Calculation' && r.success,
      ),
    }
  }

  private async runMEVSimulation(): Promise<MEVSimSummary> {
    const result = await runMEVCompetitionSim({
      blocks: 1000,
      opportunitiesPerBlock: 3,
      gasPriceGwei: 30,
      ethPriceUsd: 3500,
      ourLatencyMs: 50,
      ourSuccessRate: 0.2,
    })

    const competitorAdvantage =
      result.competitionAnalysis.avgCompetitors > 5
        ? 'High competition - focus on niche strategies'
        : result.competitionAnalysis.avgCompetitors > 3
          ? 'Moderate competition - optimize latency'
          : 'Low competition - good opportunity'

    return {
      winRate: result.winRate,
      netProfit: result.netProfit,
      competitorAdvantage,
      latencyImpact: result.latencyImpact.optimalLatencyGain,
    }
  }

  private async runMultiChainScan(): Promise<ScanSummary> {
    const scanner = createScanner({
      chains: [
        { chainId: 1, rpcUrl: this.config.rpcUrl, name: 'Ethereum' },
        { chainId: 8453, rpcUrl: 'https://mainnet.base.org', name: 'Base' },
        {
          chainId: 42161,
          rpcUrl: 'https://arb1.arbitrum.io/rpc',
          name: 'Arbitrum',
        },
      ],
      tokens: ['WETH', 'USDC'],
      minSpreadBps: 5,
      minProfitUsd: 1,
      heliusApiKey: this.config.heliusApiKey,
    })

    const result = await scanner.scan()

    const allOpps = [
      ...result.crossChainOpportunities,
      ...result.sameChainOpportunities,
    ]

    const bestOpp = allOpps[0]
    const bestDesc = bestOpp
      ? `${bestOpp.token} - $${bestOpp.netProfitUsd.toFixed(2)}`
      : 'None found'

    return {
      chainsScanned: result.chainStatus.length,
      opportunitiesFound: allOpps.length,
      totalValueUsd: result.totalOpportunityValue,
      bestOpportunity: bestDesc,
    }
  }
}
async function main() {
  const args = process.argv.slice(2)

  const config: TestPipelineConfig = {
    // Data sources from env
    alchemyApiKey: process.env.ALCHEMY_API_KEY,
    heliusApiKey: process.env.HELIUS_API_KEY,

    // Default: run all tests
    runBacktest: true,
    runStressTests: true,
    runFlashLoanTests: false, // Requires Anvil
    runMEVSimulation: true,
    runMultiChainScan: true,

    // Strategy
    strategy: 'momentum',
    initialCapitalUsd: 100000,

    // Chain
    chainId: 1,
    rpcUrl: getExternalRpc('ethereum'),
    testPrivateKey: process.env.TEST_PRIVATE_KEY,
  }

  // Parse CLI args
  for (const arg of args) {
    if (arg === '--full') {
      config.runFlashLoanTests = true
    }
    if (arg.startsWith('--scenario=')) {
      config.stressScenarios = [arg.split('=')[1]]
    }
    if (arg.startsWith('--strategy=')) {
      config.strategy = arg.split('=')[1] as TestPipelineConfig['strategy']
    }
    if (arg === '--backtest-only') {
      config.runStressTests = false
      config.runFlashLoanTests = false
      config.runMEVSimulation = false
      config.runMultiChainScan = false
    }
    if (arg === '--stress-only') {
      config.runBacktest = false
      config.runFlashLoanTests = false
      config.runMEVSimulation = false
      config.runMultiChainScan = false
    }
  }

  const pipeline = new TestPipeline(config)
  const result = await pipeline.run()

  // Exit with error code if tests failed
  if (result.summary.failed > 0) {
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error)
}
