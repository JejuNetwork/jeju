#!/usr/bin/env bun
/**
 * Load Test Runner
 *
 * Unified runner for load testing individual apps or all apps simultaneously.
 *
 * Usage:
 *   bun packages/tests/load/runner.ts --app=gateway-rpc --scenario=normal
 *   bun packages/tests/load/runner.ts --all --scenario=light
 *   bun packages/tests/load/runner.ts --all --scenario=stress --network=testnet
 */

import { analyzeResults, printResults } from './analyzer'
import { ALL_CONFIGS, API_CONFIGS, getConfigByName } from './configs'
import { LoadTestSimulator, SCENARIOS } from './simulator'
import type {
  AppLoadTestConfig,
  CombinedLoadTestResult,
  LoadTestResult,
  LoadTestScenario,
} from './types'

interface RunnerOptions {
  apps: string[]
  scenario: string
  network: 'localnet' | 'testnet' | 'mainnet'
  parallel: boolean
  skipUnavailable: boolean
  verbose: boolean
}

function parseArgs(): RunnerOptions {
  const args = process.argv.slice(2)
  const options: RunnerOptions = {
    apps: [],
    scenario: 'light',
    network: 'localnet',
    parallel: true,
    skipUnavailable: true,
    verbose: false,
  }

  for (const arg of args) {
    if (arg === '--all') {
      options.apps = API_CONFIGS.map((c) => c.name)
    } else if (arg === '--all-ui') {
      options.apps = ALL_CONFIGS.map((c) => c.name)
    } else if (arg.startsWith('--app=')) {
      const app = arg.split('=')[1]
      if (app) options.apps.push(app)
    } else if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1] ?? 'light'
    } else if (arg.startsWith('--network=')) {
      const network = arg.split('=')[1]
      if (network === 'localnet' || network === 'testnet' || network === 'mainnet') {
        options.network = network
      }
    } else if (arg === '--sequential') {
      options.parallel = false
    } else if (arg === '--no-skip') {
      options.skipUnavailable = false
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`
Load Test Runner

Usage:
  bun packages/tests/load/runner.ts [options]

Options:
  --app=<name>        Test a specific app (can be repeated)
  --all               Test all API-focused apps
  --all-ui            Test all apps including UI-only apps
  --scenario=<name>   Test scenario: smoke, light, normal, heavy, stress, soak
  --network=<name>    Network: localnet, testnet, mainnet (default: localnet)
  --sequential        Run tests sequentially instead of in parallel
  --no-skip           Fail if any app is unavailable (default: skip unavailable)
  --verbose, -v       Verbose output
  --help, -h          Show this help

Examples:
  bun packages/tests/load/runner.ts --app=gateway-rpc --scenario=normal
  bun packages/tests/load/runner.ts --all --scenario=light
  bun packages/tests/load/runner.ts --all --scenario=stress --network=testnet
  bun packages/tests/load/runner.ts --app=indexer --app=dws --scenario=heavy

Available Apps:
  ${API_CONFIGS.map((c) => c.name).join(', ')}

Available Scenarios:
  smoke   - Quick test, minimal load (5 users, 10s)
  light   - Baseline performance (20 users, 30s)
  normal  - Typical production (50 users, 60s)
  heavy   - Peak traffic (100 users, 120s)
  stress  - Breaking point (200 users, 60s)
  soak    - Extended duration (30 users, 600s)
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

async function runAppTest(
  config: AppLoadTestConfig,
  scenario: LoadTestScenario,
  network: 'localnet' | 'testnet' | 'mainnet',
  skipUnavailable: boolean,
): Promise<LoadTestResult | null> {
  const baseUrl = getBaseUrl(config, network)
  const simulator = new LoadTestSimulator(baseUrl)

  // Check health
  const available = await simulator.checkHealth(config.healthEndpoint)
  if (!available) {
    if (skipUnavailable) {
      console.log(`⏭️  [${config.name}] Skipping - not available at ${baseUrl}`)
      return null
    }
    throw new Error(`[${config.name}] Not available at ${baseUrl}`)
  }

  return simulator.runTest(config, scenario, network)
}

async function runTests(options: RunnerOptions): Promise<CombinedLoadTestResult> {
  const scenario = SCENARIOS[options.scenario.toUpperCase()]
  if (!scenario) {
    console.error(`Unknown scenario: ${options.scenario}`)
    console.error(`Available: ${Object.keys(SCENARIOS).join(', ').toLowerCase()}`)
    process.exit(1)
  }

  const configs: AppLoadTestConfig[] = []
  for (const appName of options.apps) {
    const config = getConfigByName(appName)
    if (!config) {
      console.error(`Unknown app: ${appName}`)
      console.error(`Available: ${API_CONFIGS.map((c) => c.name).join(', ')}`)
      process.exit(1)
    }
    configs.push(config)
  }

  console.log('\n' + '═'.repeat(70))
  console.log('  JEJU NETWORK LOAD TESTING')
  console.log('═'.repeat(70))
  console.log(`  Network: ${options.network}`)
  console.log(`  Scenario: ${scenario.name} (${scenario.description})`)
  console.log(`  Apps: ${configs.map((c) => c.name).join(', ')}`)
  console.log(`  Mode: ${options.parallel ? 'Parallel' : 'Sequential'}`)
  console.log('═'.repeat(70) + '\n')

  let results: LoadTestResult[]

  if (options.parallel) {
    // Run all tests in parallel
    const promises = configs.map((config) =>
      runAppTest(config, scenario, options.network, options.skipUnavailable),
    )
    const allResults = await Promise.all(promises)
    results = allResults.filter((r): r is LoadTestResult => r !== null)
  } else {
    // Run tests sequentially
    results = []
    for (const config of configs) {
      const result = await runAppTest(
        config,
        scenario,
        options.network,
        options.skipUnavailable,
      )
      if (result) results.push(result)
    }
  }

  // Analyze and return results
  return analyzeResults(results, options.network, scenario.name)
}

async function main(): Promise<void> {
  const options = parseArgs()

  if (options.apps.length === 0) {
    console.error('No apps specified. Use --app=<name> or --all')
    printHelp()
    process.exit(1)
  }

  const result = await runTests(options)
  printResults(result)

  // Exit with error if there are critical issues
  const criticalCount = result.bottlenecks.filter(
    (b) => b.severity === 'critical',
  ).length
  if (criticalCount > 0) {
    console.log(`\n❌ ${criticalCount} critical issues found`)
    process.exit(1)
  }

  // Exit with warning code if there are warnings
  const warningCount = result.bottlenecks.filter(
    (b) => b.severity === 'warning',
  ).length
  if (warningCount > 0) {
    console.log(`\n⚠️  ${warningCount} warnings found`)
    process.exit(0) // Warnings don't fail the test
  }

  console.log('\n✅ All load tests passed')
}

main().catch((err) => {
  console.error('Load test failed:', err)
  process.exit(1)
})

export { runTests }

