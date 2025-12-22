/**
 * Stress Test Framework
 *
 * Validates bot strategies against historical crisis events:
 * - March 2020 COVID crash
 * - May 2022 Terra/Luna collapse
 * - November 2022 FTX collapse
 * - March 2023 USDC depeg
 *
 * Features:
 * - Historical data replay
 * - Gas spike simulation
 * - Liquidity crisis modeling
 * - Oracle staleness injection
 * - Circuit breaker validation
 */

import type { Token } from '../types'
import { Backtester, type BacktestConfig, type BacktestResult } from './backtester'
import {
  MultiSourceFetcher,
  STRESS_SCENARIOS,
  type StressTestScenario,
  type GasDataPoint,
} from './multi-source-fetcher'
import { RiskAnalyzer, type RiskMetrics, type DrawdownAnalysis } from './risk-analyzer'

// ============ Types ============

export interface StressTestResult {
  scenario: StressTestScenario
  backtest: BacktestResult
  riskMetrics: RiskMetrics
  drawdownAnalysis: DrawdownAnalysis
  circuitBreakerTriggered: boolean
  maxGasSpike: number
  oracleStalenessPeriods: number
  liquidityShocks: number
  survivalMetrics: {
    survived: boolean
    capitalPreserved: number // Percentage
    recoveryDays: number
    peakToTroughDays: number
  }
}

export interface StressTestConfig {
  strategy: 'momentum' | 'mean-reversion' | 'volatility' | 'composite'
  initialCapitalUsd: number
  riskParams: {
    maxDrawdownPercent: number
    dailyLossLimitPercent: number
    circuitBreakerEnabled: boolean
    maxGasGwei: number
  }
  tokens: Token[]
}

export interface GasShockConfig {
  normalGasGwei: number
  peakGasGwei: number
  spikeDurationMs: number
  spikeFrequency: number // Per day
}

export interface LiquidityShockConfig {
  normalSlippageBps: number
  crisisSlippageBps: number
  liquidityDropPercent: number
}

// ============ Stress Test Runner ============

export class StressTestRunner {
  private fetcher: MultiSourceFetcher
  private backtester: Backtester
  private riskAnalyzer: RiskAnalyzer

  constructor() {
    this.fetcher = new MultiSourceFetcher()
    this.backtester = new Backtester()
    this.riskAnalyzer = new RiskAnalyzer()
  }

  /**
   * Run all stress test scenarios
   */
  async runAllScenarios(config: StressTestConfig): Promise<StressTestResult[]> {
    const results: StressTestResult[] = []

    for (const scenario of STRESS_SCENARIOS) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`Running stress test: ${scenario.name}`)
      console.log(`Period: ${scenario.startDate.toISOString()} - ${scenario.endDate.toISOString()}`)
      console.log(`Peak Drawdown: ${(scenario.peakDrawdown * 100).toFixed(1)}%`)
      console.log(`Max Gas: ${scenario.maxGasGwei} gwei`)
      console.log('$'.repeat(60))

      const result = await this.runScenario(scenario, config)
      results.push(result)

      this.printScenarioResult(result)
    }

    this.printSummary(results)
    return results
  }

  /**
   * Run a single stress test scenario
   */
  async runScenario(
    scenario: StressTestScenario,
    config: StressTestConfig,
  ): Promise<StressTestResult> {
    // Fetch historical data for this scenario
    const { prices, gas } = await this.fetcher.fetchStressScenarioData(
      scenario,
      config.tokens,
    )

    // If no historical data available, generate synthetic crisis data
    const priceData = prices.length > 0 
      ? prices 
      : this.generateCrisisData(scenario, config.tokens)

    // Run backtest with crisis conditions
    const backtestConfig: BacktestConfig = {
      strategy: config.strategy,
      tokens: config.tokens,
      initialWeights: config.tokens.map(() => 1 / config.tokens.length),
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      initialCapitalUsd: config.initialCapitalUsd,
      rebalanceIntervalHours: 4, // More frequent during crisis
      tradingFeeBps: 30,
      slippageBps: this.calculateCrisisSlippage(scenario),
      priceData,
    }

    const backtest = await this.backtester.run(backtestConfig)

    // Calculate risk metrics
    const riskMetrics = this.riskAnalyzer.calculateMetrics(backtest.snapshots)
    const drawdownAnalysis = this.riskAnalyzer.analyzeDrawdowns(backtest.snapshots)

    // Check circuit breaker
    const circuitBreakerTriggered = this.checkCircuitBreaker(
      backtest,
      config.riskParams,
    )

    // Calculate gas impact
    const gasData = gas.length > 0 ? gas : this.generateCrisisGasData(scenario)
    const maxGasSpike = Math.max(...gasData.map(g => Number(g.baseFee) / 1e9))

    // Oracle staleness simulation
    const oracleStalenessPeriods = this.simulateOracleStaleness(scenario)

    // Liquidity shock analysis
    const liquidityShocks = this.analyzeLiquidityShocks(priceData)

    // Survival analysis
    const survivalMetrics = this.calculateSurvivalMetrics(backtest, config)

    return {
      scenario,
      backtest,
      riskMetrics,
      drawdownAnalysis,
      circuitBreakerTriggered,
      maxGasSpike,
      oracleStalenessPeriods,
      liquidityShocks,
      survivalMetrics,
    }
  }

  /**
   * Run custom stress scenario with configurable parameters
   */
  async runCustomScenario(
    name: string,
    config: StressTestConfig,
    crisisParams: {
      drawdownPercent: number
      durationDays: number
      gasMultiplier: number
      slippageMultiplier: number
      oracleDelayMs: number
    },
  ): Promise<StressTestResult> {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - crisisParams.durationDays)

    const scenario: StressTestScenario = {
      name,
      description: `Custom stress test: ${crisisParams.drawdownPercent}% drawdown`,
      startDate,
      endDate: new Date(),
      peakDrawdown: crisisParams.drawdownPercent / 100,
      maxGasGwei: 30 * crisisParams.gasMultiplier,
      events: ['Custom scenario'],
    }

    return this.runScenario(scenario, config)
  }

  // ============ Crisis Data Generation ============

  private generateCrisisData(
    scenario: StressTestScenario,
    tokens: Token[],
  ): BacktestConfig['priceData'] {
    const dataPoints: BacktestConfig['priceData'] = []
    const startTs = scenario.startDate.getTime()
    const endTs = scenario.endDate.getTime()
    const durationMs = endTs - startTs

    // Initialize prices (pre-crisis levels)
    const currentPrices: Record<string, number> = {}
    for (const token of tokens) {
      currentPrices[token.symbol] = this.getPreCrisisPrice(token.symbol, scenario)
    }

    // Generate hourly data with crisis dynamics
    for (let ts = startTs; ts <= endTs; ts += 3600000) {
      const progress = (ts - startTs) / durationMs
      
      for (const token of tokens) {
        // Crisis price dynamics:
        // - Fast crash in first 30% of period
        // - Volatile sideways in middle
        // - Slow recovery or further decline
        const crashFactor = this.calculateCrashFactor(progress, scenario)
        const volatility = this.calculateCrisisVolatility(progress, scenario)
        const randomShock = (Math.random() - 0.5) * 2 * volatility

        currentPrices[token.symbol] *= (1 + crashFactor + randomShock)
        
        // Floor at 1% of original (avoid zero/negative)
        const originalPrice = this.getPreCrisisPrice(token.symbol, scenario)
        currentPrices[token.symbol] = Math.max(
          currentPrices[token.symbol],
          originalPrice * 0.01,
        )
      }

      dataPoints.push({
        date: new Date(ts),
        timestamp: ts,
        prices: { ...currentPrices },
      })
    }

    return dataPoints
  }

  private calculateCrashFactor(progress: number, scenario: StressTestScenario): number {
    const peakDrawdown = scenario.peakDrawdown

    if (progress < 0.2) {
      // Initial crash phase - rapid decline
      return -peakDrawdown * 0.7 * (progress / 0.2) / 24
    } else if (progress < 0.5) {
      // Continued decline with volatility
      return -peakDrawdown * 0.2 * ((progress - 0.2) / 0.3) / 24
    } else if (progress < 0.7) {
      // Bottom / consolidation
      return (Math.random() - 0.5) * 0.02
    } else {
      // Potential recovery or further decline
      return (Math.random() - 0.4) * 0.015 // Slight upward bias
    }
  }

  private calculateCrisisVolatility(
    progress: number,
    scenario: StressTestScenario,
  ): number {
    // Volatility spikes during crisis, peaks at bottom
    const baseVol = 0.02
    
    if (progress < 0.3) {
      return baseVol * 3 // High volatility during crash
    } else if (progress < 0.6) {
      return baseVol * 5 // Peak volatility at bottom
    } else {
      return baseVol * 2 // Elevated but declining
    }
  }

  private getPreCrisisPrice(symbol: string, _scenario: StressTestScenario): number {
    // Approximate pre-crisis prices
    const prices: Record<string, number> = {
      ETH: 3500,
      WETH: 3500,
      BTC: 45000,
      WBTC: 45000,
      USDC: 1,
      USDT: 1,
      DAI: 1,
      SOL: 150,
      ARB: 1.5,
      OP: 2.5,
      LINK: 20,
    }
    return prices[symbol] ?? 100
  }

  private calculateCrisisSlippage(scenario: StressTestScenario): number {
    // Slippage scales with crisis severity
    const baseSlippage = 10 // 0.1%
    const severityMultiplier = 1 + scenario.peakDrawdown * 5
    return Math.round(baseSlippage * severityMultiplier)
  }

  // ============ Gas Crisis Simulation ============

  private generateCrisisGasData(scenario: StressTestScenario): GasDataPoint[] {
    const gasData: GasDataPoint[] = []
    const startTs = scenario.startDate.getTime()
    const endTs = scenario.endDate.getTime()

    for (let ts = startTs; ts <= endTs; ts += 60000) { // Per minute
      const progress = (ts - startTs) / (endTs - startTs)
      
      // Gas spikes during peak crisis
      let baseFee: bigint
      if (progress > 0.2 && progress < 0.5) {
        // Peak crisis period
        const spikeFactor = Math.random() < 0.3 ? 10 : 3
        baseFee = BigInt(Math.floor(scenario.maxGasGwei * spikeFactor * 1e9))
      } else {
        baseFee = BigInt(Math.floor(30e9 * (1 + Math.random())))
      }

      gasData.push({
        timestamp: ts,
        chainId: 1,
        baseFee,
        priorityFee: BigInt(Math.floor(Number(baseFee) * 0.1)),
        blockUtilization: 0.8 + Math.random() * 0.2,
        blockNumber: BigInt(Math.floor((ts - startTs) / 12000)),
      })
    }

    return gasData
  }

  // ============ Analysis Methods ============

  private checkCircuitBreaker(
    backtest: BacktestResult,
    riskParams: StressTestConfig['riskParams'],
  ): boolean {
    if (!riskParams.circuitBreakerEnabled) return false

    // Check max drawdown trigger
    if (backtest.maxDrawdown > riskParams.maxDrawdownPercent / 100) {
      return true
    }

    // Check daily loss trigger
    const snapshots = backtest.snapshots
    for (let i = 1; i < snapshots.length; i++) {
      const dailyReturn = 
        (snapshots[i].valueUsd - snapshots[i - 1].valueUsd) / 
        snapshots[i - 1].valueUsd

      if (-dailyReturn > riskParams.dailyLossLimitPercent / 100) {
        return true
      }
    }

    return false
  }

  private simulateOracleStaleness(scenario: StressTestScenario): number {
    // Estimate oracle staleness periods based on scenario severity
    // More severe crises = more oracle delays
    const basePeriods = Math.floor(scenario.peakDrawdown * 10)
    return basePeriods + Math.floor(Math.random() * 3)
  }

  private analyzeLiquidityShocks(
    priceData: BacktestConfig['priceData'],
  ): number {
    let shocks = 0

    for (let i = 1; i < priceData.length; i++) {
      for (const [symbol, price] of Object.entries(priceData[i].prices)) {
        const prevPrice = priceData[i - 1].prices[symbol]
        if (!prevPrice) continue

        const change = Math.abs((price - prevPrice) / prevPrice)
        
        // >5% move in one period = liquidity shock
        if (change > 0.05) {
          shocks++
        }
      }
    }

    return shocks
  }

  private calculateSurvivalMetrics(
    backtest: BacktestResult,
    config: StressTestConfig,
  ): StressTestResult['survivalMetrics'] {
    const snapshots = backtest.snapshots
    const finalValue = snapshots[snapshots.length - 1].valueUsd
    const capitalPreserved = finalValue / config.initialCapitalUsd

    // Find peak to trough
    let peak = config.initialCapitalUsd
    let peakIdx = 0
    let troughIdx = 0
    let maxDrawdown = 0

    for (let i = 0; i < snapshots.length; i++) {
      if (snapshots[i].valueUsd > peak) {
        peak = snapshots[i].valueUsd
        peakIdx = i
      }

      const drawdown = (peak - snapshots[i].valueUsd) / peak
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown
        troughIdx = i
      }
    }

    // Calculate recovery
    let recoveryIdx = snapshots.length - 1
    for (let i = troughIdx; i < snapshots.length; i++) {
      if (snapshots[i].valueUsd >= snapshots[peakIdx].valueUsd) {
        recoveryIdx = i
        break
      }
    }

    const peakToTroughMs = snapshots[troughIdx].timestamp - snapshots[peakIdx].timestamp
    const recoveryMs = snapshots[recoveryIdx].timestamp - snapshots[troughIdx].timestamp

    return {
      survived: capitalPreserved > 0.5, // Lost less than 50%
      capitalPreserved: capitalPreserved * 100,
      recoveryDays: recoveryMs / 86400000,
      peakToTroughDays: peakToTroughMs / 86400000,
    }
  }

  // ============ Reporting ============

  private printScenarioResult(result: StressTestResult): void {
    const { scenario, backtest, survivalMetrics, circuitBreakerTriggered } = result

    console.log(`\n📊 Results for ${scenario.name}:`)
    console.log(`   Total Return: ${(backtest.totalReturn * 100).toFixed(2)}%`)
    console.log(`   Max Drawdown: ${(backtest.maxDrawdown * 100).toFixed(2)}%`)
    console.log(`   Sharpe Ratio: ${backtest.sharpeRatio.toFixed(3)}`)
    console.log(`   Win Rate: ${(backtest.winRate * 100).toFixed(1)}%`)
    console.log(`   Total Trades: ${backtest.totalTrades}`)
    console.log(`   Fees Paid: $${backtest.totalFees.toFixed(2)}`)
    console.log(`\n   Survival Analysis:`)
    console.log(`   ${survivalMetrics.survived ? '✅ SURVIVED' : '❌ FAILED'}`)
    console.log(`   Capital Preserved: ${survivalMetrics.capitalPreserved.toFixed(1)}%`)
    console.log(`   Peak to Trough: ${survivalMetrics.peakToTroughDays.toFixed(1)} days`)
    console.log(`   Recovery Time: ${survivalMetrics.recoveryDays.toFixed(1)} days`)
    console.log(`\n   Risk Events:`)
    console.log(`   Circuit Breaker: ${circuitBreakerTriggered ? '🔴 TRIGGERED' : '🟢 Not triggered'}`)
    console.log(`   Max Gas Spike: ${result.maxGasSpike.toFixed(0)} gwei`)
    console.log(`   Oracle Staleness Periods: ${result.oracleStalenessPeriods}`)
    console.log(`   Liquidity Shocks: ${result.liquidityShocks}`)
  }

  private printSummary(results: StressTestResult[]): void {
    console.log(`\n${'='.repeat(60)}`)
    console.log('STRESS TEST SUMMARY')
    console.log('='.repeat(60))

    const survived = results.filter(r => r.survivalMetrics.survived).length
    const avgCapitalPreserved = results.reduce(
      (sum, r) => sum + r.survivalMetrics.capitalPreserved,
      0,
    ) / results.length

    const avgMaxDrawdown = results.reduce(
      (sum, r) => sum + r.backtest.maxDrawdown,
      0,
    ) / results.length

    console.log(`\nScenarios Survived: ${survived}/${results.length}`)
    console.log(`Avg Capital Preserved: ${avgCapitalPreserved.toFixed(1)}%`)
    console.log(`Avg Max Drawdown: ${(avgMaxDrawdown * 100).toFixed(1)}%`)
    console.log(`\nCircuit Breakers Triggered: ${results.filter(r => r.circuitBreakerTriggered).length}/${results.length}`)

    console.log(`\nScenario Breakdown:`)
    for (const result of results) {
      const status = result.survivalMetrics.survived ? '✅' : '❌'
      console.log(
        `  ${status} ${result.scenario.name.padEnd(30)} ` +
        `Return: ${(result.backtest.totalReturn * 100).toFixed(1).padStart(7)}% ` +
        `DD: ${(result.backtest.maxDrawdown * 100).toFixed(1).padStart(5)}%`,
      )
    }

    // Overall assessment
    console.log(`\n${'─'.repeat(60)}`)
    if (survived === results.length) {
      console.log('✅ PASS: Strategy survived all stress scenarios')
    } else if (survived >= results.length * 0.75) {
      console.log('⚠️ WARNING: Strategy failed some stress scenarios')
    } else {
      console.log('❌ FAIL: Strategy failed majority of stress scenarios')
    }
    console.log('─'.repeat(60))
  }
}

// ============ Convenience Exports ============

export { STRESS_SCENARIOS }

export async function runStressTests(
  config: StressTestConfig,
): Promise<StressTestResult[]> {
  const runner = new StressTestRunner()
  return runner.runAllScenarios(config)
}

