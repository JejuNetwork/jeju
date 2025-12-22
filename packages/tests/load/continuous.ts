#!/usr/bin/env bun
/**
 * Continuous Improvement Loop
 *
 * Runs load tests in a loop, identifies bottlenecks, and tracks improvements over time.
 * Designed to be used with AI agents that can analyze results and make code changes.
 *
 * Usage:
 *   bun packages/tests/load/continuous.ts --iterations=10 --interval=300
 *   bun packages/tests/load/continuous.ts --apps=gateway-rpc,indexer --watch
 */

import { analyzeResults, printResults } from './analyzer'
import { API_CONFIGS, getConfigByName } from './configs'
import { LoadTestSimulator, SCENARIOS } from './simulator'
import type {
  AppLoadTestConfig,
  BottleneckAnalysis,
  CombinedLoadTestResult,
  ContinuousImprovementState,
  ImprovementRecord,
  LoadTestResult,
  LoadTestScenario,
} from './types'

interface ContinuousOptions {
  apps: string[]
  scenario: string
  network: 'localnet' | 'testnet' | 'mainnet'
  iterations: number
  intervalSeconds: number
  watch: boolean
  outputJson: boolean
}

function parseArgs(): ContinuousOptions {
  const args = process.argv.slice(2)
  const options: ContinuousOptions = {
    apps: API_CONFIGS.map((c) => c.name),
    scenario: 'light',
    network: 'localnet',
    iterations: 5,
    intervalSeconds: 60,
    watch: false,
    outputJson: false,
  }

  for (const arg of args) {
    if (arg.startsWith('--apps=')) {
      options.apps = (arg.split('=')[1] ?? '').split(',').filter(Boolean)
    } else if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1] ?? 'light'
    } else if (arg.startsWith('--network=')) {
      const network = arg.split('=')[1]
      if (
        network === 'localnet' ||
        network === 'testnet' ||
        network === 'mainnet'
      ) {
        options.network = network
      }
    } else if (arg.startsWith('--iterations=')) {
      options.iterations = parseInt(arg.split('=')[1] ?? '5', 10)
    } else if (arg.startsWith('--interval=')) {
      options.intervalSeconds = parseInt(arg.split('=')[1] ?? '60', 10)
    } else if (arg === '--watch') {
      options.watch = true
      options.iterations = Infinity
    } else if (arg === '--json') {
      options.outputJson = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`
Continuous Improvement Loop

Usage:
  bun packages/tests/load/continuous.ts [options]

Options:
  --apps=<names>      Comma-separated list of apps to test
  --scenario=<name>   Test scenario: smoke, light, normal, heavy, stress
  --network=<name>    Network: localnet, testnet, mainnet
  --iterations=<n>    Number of test iterations (default: 5)
  --interval=<s>      Seconds between iterations (default: 60)
  --watch             Run indefinitely until stopped
  --json              Output results as JSON
  --help, -h          Show this help

Examples:
  bun packages/tests/load/continuous.ts --iterations=10 --interval=120
  bun packages/tests/load/continuous.ts --apps=gateway-rpc,indexer --watch
  bun packages/tests/load/continuous.ts --scenario=normal --json

The continuous loop:
1. Runs load tests against specified apps
2. Identifies bottlenecks and weak points
3. Tracks metrics over time to detect improvements or regressions
4. Outputs actionable recommendations for AI agents

Use with AI agents:
- Run with --json to get machine-readable output
- AI agents can parse bottlenecks and make code changes
- Re-run tests to verify improvements
`)
}

function getBaseUrl(
  config: AppLoadTestConfig,
  network: 'localnet' | 'testnet' | 'mainnet',
): string {
  if (network === 'testnet' && config.testnet?.baseUrl) {
    return config.testnet.baseUrl
  }
  if (network === 'mainnet' && config.mainnet?.baseUrl) {
    return config.mainnet.baseUrl
  }
  return config.baseUrl
}

async function runSingleIteration(
  configs: AppLoadTestConfig[],
  scenario: LoadTestScenario,
  network: 'localnet' | 'testnet' | 'mainnet',
): Promise<LoadTestResult[]> {
  const results: LoadTestResult[] = []

  // Run tests in parallel
  const promises = configs.map(async (config) => {
    const baseUrl = getBaseUrl(config, network)
    const simulator = new LoadTestSimulator(baseUrl)

    const available = await simulator.checkHealth(config.healthEndpoint)
    if (!available) {
      console.log(`⏭️  [${config.name}] Skipping - not available`)
      return null
    }

    return simulator.runTest(config, scenario, network)
  })

  const allResults = await Promise.all(promises)
  for (const result of allResults) {
    if (result) results.push(result)
  }

  return results
}

function compareBottlenecks(
  previous: BottleneckAnalysis[],
  current: BottleneckAnalysis[],
): ImprovementRecord[] {
  const improvements: ImprovementRecord[] = []

  for (const prev of previous) {
    const curr = current.find(
      (c) =>
        c.app === prev.app &&
        c.metric === prev.metric &&
        c.endpoint === prev.endpoint,
    )

    if (!curr) {
      // Bottleneck resolved
      improvements.push({
        timestamp: new Date(),
        bottleneck: prev,
        action: 'resolved',
        result: 'improved',
        before: prev.value,
        after: prev.threshold, // Met threshold
      })
    } else if (curr.value < prev.value) {
      // Metric improved but still a bottleneck
      improvements.push({
        timestamp: new Date(),
        bottleneck: curr,
        action: 'improved',
        result: 'improved',
        before: prev.value,
        after: curr.value,
      })
    } else if (curr.value > prev.value * 1.1) {
      // Metric degraded by more than 10%
      improvements.push({
        timestamp: new Date(),
        bottleneck: curr,
        action: 'degraded',
        result: 'degraded',
        before: prev.value,
        after: curr.value,
      })
    }
  }

  // Check for new bottlenecks
  for (const curr of current) {
    const existed = previous.find(
      (p) =>
        p.app === curr.app &&
        p.metric === curr.metric &&
        p.endpoint === curr.endpoint,
    )
    if (!existed) {
      improvements.push({
        timestamp: new Date(),
        bottleneck: curr,
        action: 'new',
        result: 'degraded',
        before: curr.threshold, // Was meeting threshold
        after: curr.value,
      })
    }
  }

  return improvements
}

function printIterationSummary(
  iteration: number,
  result: CombinedLoadTestResult,
  improvements: ImprovementRecord[],
): void {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`  ITERATION ${iteration} SUMMARY`)
  console.log('─'.repeat(70))

  const healthy = result.apps.filter((a) => a.thresholdsPassed).length
  const total = result.apps.length
  console.log(`  Apps: ${healthy}/${total} healthy`)

  const criticals = result.bottlenecks.filter(
    (b) => b.severity === 'critical',
  ).length
  const warnings = result.bottlenecks.filter(
    (b) => b.severity === 'warning',
  ).length
  console.log(`  Bottlenecks: ${criticals} critical, ${warnings} warnings`)

  if (improvements.length > 0) {
    const improved = improvements.filter((i) => i.result === 'improved').length
    const degraded = improvements.filter((i) => i.result === 'degraded').length
    console.log(`  Changes: ${improved} improved, ${degraded} degraded`)

    if (improved > 0) {
      console.log('\n  ✅ Improvements:')
      for (const imp of improvements.filter((i) => i.result === 'improved')) {
        console.log(
          `     [${imp.bottleneck.app}] ${imp.bottleneck.metric}: ${imp.before.toFixed(0)} → ${imp.after.toFixed(0)}`,
        )
      }
    }

    if (degraded > 0) {
      console.log('\n  ❌ Regressions:')
      for (const imp of improvements.filter((i) => i.result === 'degraded')) {
        console.log(
          `     [${imp.bottleneck.app}] ${imp.bottleneck.metric}: ${imp.before.toFixed(0)} → ${imp.after.toFixed(0)}`,
        )
      }
    }
  }
}

function outputJsonState(state: ContinuousImprovementState): void {
  const output = {
    runId: state.runId,
    iteration: state.iteration,
    startTime: state.startTime.toISOString(),
    latestResult: state.results[state.results.length - 1],
    bottlenecks: state.currentBottlenecks.map((b) => ({
      app: b.app,
      severity: b.severity,
      category: b.category,
      endpoint: b.endpoint,
      message: b.message,
      metric: b.metric,
      value: b.value,
      threshold: b.threshold,
      recommendation: b.recommendation,
    })),
    improvements: state.improvements.slice(-10), // Last 10 improvements
    summary: {
      totalIterations: state.iteration,
      resolvedBottlenecks: state.resolvedBottlenecks.length,
      currentBottlenecks: state.currentBottlenecks.length,
      criticalCount: state.currentBottlenecks.filter(
        (b) => b.severity === 'critical',
      ).length,
    },
  }
  console.log(JSON.stringify(output, null, 2))
}

async function runContinuousLoop(options: ContinuousOptions): Promise<void> {
  const scenario = SCENARIOS[options.scenario.toUpperCase()]
  if (!scenario) {
    console.error(`Unknown scenario: ${options.scenario}`)
    process.exit(1)
  }

  const configs: AppLoadTestConfig[] = []
  for (const appName of options.apps) {
    const config = getConfigByName(appName)
    if (config) configs.push(config)
  }

  if (configs.length === 0) {
    console.error('No valid apps specified')
    process.exit(1)
  }

  const state: ContinuousImprovementState = {
    runId: `load-${Date.now()}`,
    iteration: 0,
    startTime: new Date(),
    results: [],
    currentBottlenecks: [],
    resolvedBottlenecks: [],
    improvements: [],
  }

  if (!options.outputJson) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  CONTINUOUS IMPROVEMENT LOOP')
    console.log('═'.repeat(70))
    console.log(`  Run ID: ${state.runId}`)
    console.log(`  Network: ${options.network}`)
    console.log(`  Scenario: ${scenario.name}`)
    console.log(`  Apps: ${configs.map((c) => c.name).join(', ')}`)
    console.log(
      `  Iterations: ${options.watch ? 'Infinite (--watch)' : options.iterations}`,
    )
    console.log(`  Interval: ${options.intervalSeconds}s`)
    console.log('═'.repeat(70))
  }

  let running = true
  process.on('SIGINT', () => {
    console.log('\n\n⚠️  Stopping continuous loop...')
    running = false
  })

  while (running && state.iteration < options.iterations) {
    state.iteration++

    if (!options.outputJson) {
      console.log(
        `\n\n🔄 ITERATION ${state.iteration}/${options.watch ? '∞' : options.iterations}`,
      )
    }

    // Run tests
    const results = await runSingleIteration(configs, scenario, options.network)
    const combinedResult = analyzeResults(
      results,
      options.network,
      scenario.name,
    )
    state.results.push(combinedResult)

    // Compare with previous iteration
    const previousBottlenecks = state.currentBottlenecks
    state.currentBottlenecks = combinedResult.bottlenecks

    const improvements = compareBottlenecks(
      previousBottlenecks,
      state.currentBottlenecks,
    )
    state.improvements.push(...improvements)

    // Track resolved bottlenecks
    for (const imp of improvements) {
      if (imp.action === 'resolved') {
        state.resolvedBottlenecks.push(imp.bottleneck)
      }
    }

    if (options.outputJson) {
      outputJsonState(state)
    } else {
      printResults(combinedResult)
      if (state.iteration > 1) {
        printIterationSummary(state.iteration, combinedResult, improvements)
      }
    }

    // Wait for next iteration
    if (running && state.iteration < options.iterations) {
      if (!options.outputJson) {
        console.log(
          `\n⏳ Waiting ${options.intervalSeconds}s before next iteration...`,
        )
      }
      await new Promise((resolve) =>
        setTimeout(resolve, options.intervalSeconds * 1000),
      )
    }
  }

  // Final summary
  if (!options.outputJson) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('  CONTINUOUS LOOP COMPLETE')
    console.log('═'.repeat(70))
    console.log(`  Total iterations: ${state.iteration}`)
    console.log(`  Bottlenecks resolved: ${state.resolvedBottlenecks.length}`)
    console.log(`  Current bottlenecks: ${state.currentBottlenecks.length}`)
    console.log(`  Total improvements tracked: ${state.improvements.length}`)
    console.log('═'.repeat(70))
  }
}

async function main(): Promise<void> {
  const options = parseArgs()
  await runContinuousLoop(options)
}

main().catch((err) => {
  console.error('Continuous loop failed:', err)
  process.exit(1)
})

export { runContinuousLoop }
