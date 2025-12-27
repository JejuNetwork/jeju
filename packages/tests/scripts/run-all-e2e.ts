#!/usr/bin/env bun

/**
 * Run All E2E Tests Across All Apps
 *
 * This script:
 * 1. Discovers all apps with E2E test configurations
 * 2. Starts infrastructure (chain, contracts)
 * 3. Starts each app and runs its E2E tests
 * 4. Generates a comprehensive coverage report
 *
 * Usage:
 *   bun run packages/tests/scripts/run-all-e2e.ts
 *   bun run packages/tests/scripts/run-all-e2e.ts --app gateway
 *   bun run packages/tests/scripts/run-all-e2e.ts --parallel
 *   bun run packages/tests/scripts/run-all-e2e.ts --headless
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { type Subprocess, spawn } from 'bun'

interface AppManifest {
  name: string
  displayName?: string
  enabled?: boolean
  type?: string
  ports?: {
    main?: number
    frontend?: number
  }
  commands?: {
    dev?: string
    start?: string
  }
  testing?: {
    e2e?: {
      command?: string
      timeout?: number
      requiresChain?: boolean
      requiresWallet?: boolean
    }
  }
}

interface TestResult {
  app: string
  passed: boolean
  duration: number
  testsRun: number
  testsPassed: number
  testsFailed: number
  output: string
}

interface RunOptions {
  targetApp?: string
  parallel?: boolean
  headless?: boolean
  verbose?: boolean
  skipInfra?: boolean
  keepApps?: boolean
}

// Parse CLI args
function parseArgs(): RunOptions {
  const args = process.argv.slice(2)
  const options: RunOptions = {
    headless: true,
    verbose: false,
    parallel: false,
    skipInfra: false,
    keepApps: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--app' && args[i + 1]) {
      options.targetApp = args[++i]
    } else if (arg === '--parallel') {
      options.parallel = true
    } else if (arg === '--headless') {
      options.headless = true
    } else if (arg === '--headed') {
      options.headless = false
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true
    } else if (arg === '--skip-infra') {
      options.skipInfra = true
    } else if (arg === '--keep-apps') {
      options.keepApps = true
    }
  }

  return options
}

// Find monorepo root
function findMonorepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

// Discover apps with E2E tests
function discoverTestableApps(
  rootDir: string,
): Array<{ name: string; manifest: AppManifest; path: string }> {
  const appsDir = join(rootDir, 'apps')
  const apps: Array<{ name: string; manifest: AppManifest; path: string }> = []

  if (!existsSync(appsDir)) return apps

  const entries = readdirSync(appsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const appPath = join(appsDir, entry.name)
    const manifestPath = join(appPath, 'jeju-manifest.json')

    if (!existsSync(manifestPath)) continue

    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    ) as AppManifest

    // Skip disabled apps
    if (manifest.enabled === false) continue

    // Skip storage apps (no frontend)
    if (manifest.type === 'storage') continue

    // Check for E2E test capability
    const hasSynpress = existsSync(join(appPath, 'synpress.config.ts'))
    const hasPlaywright = existsSync(join(appPath, 'playwright.config.ts'))
    const hasE2ETests =
      existsSync(join(appPath, 'tests', 'e2e')) ||
      existsSync(join(appPath, 'tests', 'synpress'))

    if (hasSynpress || hasPlaywright || hasE2ETests) {
      apps.push({
        name: entry.name,
        manifest,
        path: appPath,
      })
    }
  }

  return apps
}

// Start app in background
// Uses 'bun run start' for production-like testing against DWS infrastructure
async function startApp(
  appPath: string,
  manifest: AppManifest,
  env: Record<string, string>,
): Promise<Subprocess | null> {
  // Prefer 'start' command for production-like testing, fall back to 'dev'
  const startCommand = manifest.commands?.start || 'bun run start'
  const [cmd, ...args] = startCommand.split(' ')

  console.log(`  Starting ${manifest.name} (production mode)...`)

  const proc = spawn([cmd, ...args], {
    cwd: appPath,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for app to be ready
  const port = manifest.ports?.main || manifest.ports?.frontend || 3000
  const startTime = Date.now()
  const timeout = 60000

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok || response.status < 500) {
        console.log(`  ${manifest.name} ready on port ${port}`)
        return proc
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  console.log(`  Warning: ${manifest.name} may not be ready (timeout)`)
  return proc
}

// Run E2E tests for an app
async function runAppTests(
  appPath: string,
  manifest: AppManifest,
  options: RunOptions,
): Promise<TestResult> {
  const startTime = Date.now()
  const appName = manifest.name

  console.log(`\nRunning E2E tests for ${appName}...`)

  // Determine test command
  let testCommand = manifest.testing?.e2e?.command

  if (!testCommand) {
    // Check for playwright config and E2E test directories
    // Prefer standard Playwright tests over synpress for compatibility
    const hasPlaywright = existsSync(join(appPath, 'playwright.config.ts'))
    const hasE2ETests = existsSync(join(appPath, 'tests', 'e2e'))

    // Run only full-coverage tests with --no-deps to avoid port conflicts
    const baseCmd =
      'bunx playwright test tests/e2e/full-coverage.spec.ts --reporter=list'

    if (hasPlaywright && hasE2ETests) {
      testCommand = baseCmd
    } else if (hasPlaywright) {
      testCommand = baseCmd
    } else if (hasE2ETests) {
      testCommand = baseCmd
    } else {
      // Skip apps without test directories
      console.log(`  No E2E test directory found for ${appName}`)
      return {
        app: appName,
        passed: true,
        duration: Date.now() - startTime,
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        output: 'No E2E test directory found',
      }
    }
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CI: options.headless ? 'true' : '',
    PWTEST_SKIP_TEST_OUTPUT: '1',
  }

  const [cmd, ...args] = testCommand.split(' ')

  // Add headless flag if needed
  if (options.headless && !args.includes('--headed')) {
    // Playwright uses CI env for headless
  }

  const proc = spawn([cmd, ...args], {
    cwd: appPath,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Collect output
  const outputChunks: string[] = []
  const reader = proc.stdout.getReader()

  const readOutput = async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = new TextDecoder().decode(value)
      outputChunks.push(text)
      if (options.verbose) {
        process.stdout.write(text)
      }
    }
  }

  readOutput()

  const exitCode = await proc.exited
  const output = outputChunks.join('')
  const duration = Date.now() - startTime

  // Parse test results from output
  const passedMatch = output.match(/(\d+)\s+passed/)
  const failedMatch = output.match(/(\d+)\s+failed/)

  const testsPassed = passedMatch ? parseInt(passedMatch[1], 10) : 0
  const testsFailed = failedMatch ? parseInt(failedMatch[1], 10) : 0

  return {
    app: appName,
    passed: exitCode === 0,
    duration,
    testsRun: testsPassed + testsFailed,
    testsPassed,
    testsFailed,
    output,
  }
}

// Main execution
async function main() {
  const options = parseArgs()
  const rootDir = findMonorepoRoot()

  console.log('='.repeat(60))
  console.log('FULL E2E TEST SUITE')
  console.log('='.repeat(60))

  // Discover apps
  let apps = discoverTestableApps(rootDir)

  if (options.targetApp) {
    apps = apps.filter((a) => a.name === options.targetApp)
    if (apps.length === 0) {
      console.error(`App not found: ${options.targetApp}`)
      process.exit(1)
    }
  }

  console.log(`\nDiscovered ${apps.length} apps with E2E tests:`)
  for (const app of apps) {
    console.log(`  - ${app.name}`)
  }

  // Results collection
  const results: TestResult[] = []
  const runningApps: Map<string, Subprocess> = new Map()

  // Setup environment
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    CI: options.headless ? 'true' : '',
    L2_RPC_URL: process.env.L2_RPC_URL || 'http://127.0.0.1:6546',
    JEJU_RPC_URL: process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546',
    CHAIN_ID: '31337',
  }

  // Cleanup function
  const cleanup = async () => {
    console.log('\nCleaning up...')
    for (const [name, proc] of runningApps) {
      try {
        proc.kill()
        console.log(`  Stopped ${name}`)
      } catch {
        // Process may have already exited
      }
    }
  }

  process.on('SIGINT', async () => {
    await cleanup()
    process.exit(130)
  })

  process.on('SIGTERM', async () => {
    await cleanup()
    process.exit(143)
  })

  try {
    // Run tests for each app
    for (const app of apps) {
      // Start app if needed
      if (!options.skipInfra) {
        const proc = await startApp(app.path, app.manifest, env)
        if (proc) {
          runningApps.set(app.name, proc)
        }
      }

      // Run tests
      const result = await runAppTests(app.path, app.manifest, options)
      results.push(result)

      // Log result
      const status = result.passed ? '✓' : '✗'
      console.log(
        `\n${status} ${app.name}: ${result.testsPassed}/${result.testsRun} passed (${result.duration}ms)`,
      )

      if (!result.passed && result.testsFailed > 0) {
        console.log(`  Failed tests: ${result.testsFailed}`)
      }

      // Stop app if not keeping
      if (!options.keepApps && runningApps.has(app.name)) {
        const proc = runningApps.get(app.name)
        proc?.kill()
        runningApps.delete(app.name)
      }
    }

    // Print summary
    console.log(`\n${'='.repeat(60)}`)
    console.log('TEST SUMMARY')
    console.log('='.repeat(60))

    let totalTests = 0
    let totalPassed = 0
    let totalFailed = 0
    let appsFailed = 0

    for (const result of results) {
      totalTests += result.testsRun
      totalPassed += result.testsPassed
      totalFailed += result.testsFailed

      if (!result.passed) {
        appsFailed++
      }

      const status = result.passed ? '✓' : '✗'
      console.log(
        `${status} ${result.app.padEnd(20)} ${result.testsPassed}/${result.testsRun} passed (${(result.duration / 1000).toFixed(1)}s)`,
      )
    }

    console.log('-'.repeat(60))
    console.log(`Total: ${totalPassed}/${totalTests} tests passed`)
    console.log(`Apps: ${apps.length - appsFailed}/${apps.length} passed`)
    console.log('='.repeat(60))

    // Write results to file
    const resultsDir = join(rootDir, 'test-results')
    mkdirSync(resultsDir, { recursive: true })

    const reportPath = join(resultsDir, 'e2e-summary.json')
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          totalApps: apps.length,
          appsPassed: apps.length - appsFailed,
          totalTests,
          testsPassed: totalPassed,
          testsFailed: totalFailed,
          results: results.map((r) => ({
            app: r.app,
            passed: r.passed,
            duration: r.duration,
            testsRun: r.testsRun,
            testsPassed: r.testsPassed,
            testsFailed: r.testsFailed,
          })),
        },
        null,
        2,
      ),
    )
    console.log(`\nResults written to: ${reportPath}`)

    // Cleanup
    await cleanup()

    // Exit with failure if any tests failed
    if (totalFailed > 0 || appsFailed > 0) {
      process.exit(1)
    }
  } catch (error) {
    console.error('Test run failed:', error)
    await cleanup()
    process.exit(1)
  }
}

main()
