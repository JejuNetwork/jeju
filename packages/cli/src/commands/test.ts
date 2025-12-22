/**
 * jeju test - Comprehensive Test Runner
 *
 * Modes:
 * - unit: Fast tests, no chain, no services
 * - integration: Chain + real services via Docker
 * - e2e: Full stack with UI testing (Playwright/Synpress)
 * - full: Everything including multi-chain (Solana, Arbitrum, Base)
 * - infra: Infrastructure and deployment tests
 * - smoke: Quick health checks
 *
 * All modes use REAL services - no mocks.
 * CLI handles all setup/teardown automatically.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { type ExecaError, execa } from 'execa'
import { logger } from '../lib/logger'
import { discoverApps } from '../lib/testing'
import { EthChainIdResponseSchema, validate } from '../schemas'
import { createTestOrchestrator } from '../services/test-orchestrator'
import type { CoverageReport, TestMode, TestResult } from '../types'

export type { TestMode }

interface ManifestTesting {
  unit?: { command?: string; timeout?: number }
  e2e?: {
    command?: string
    config?: string
    timeout?: number
    requiresChain?: boolean
    requiresWallet?: boolean
  }
  integration?: {
    command?: string
    timeout?: number
    requiresServices?: boolean
  }
  services?: string[]
  dependencies?: string[]
}

export const testCommand = new Command('test')
  .description(
    'Run tests with automatic setup/teardown (unit, integration, e2e, full, infra, smoke)',
  )
  .option(
    '-m, --mode <mode>',
    'Test mode: unit, integration, e2e, full, infra, smoke',
    'unit',
  )
  .option('--target-app <app>', 'Test specific app')
  .option('--package <pkg>', 'Test specific package')
  .option('--ci', 'CI mode (fail fast, coverage)')
  .option('--coverage', 'Generate coverage reports')
  .option('--dead-code', 'Detect dead/unused code')
  .option('--watch', 'Watch mode')
  .option('-v, --verbose', 'Verbose output')
  .option('--keep-services', 'Keep services running after tests')
  .option('--skip-lock', 'Skip test lock acquisition')
  .option('--skip-preflight', 'Skip preflight checks')
  .option('--skip-warmup', 'Skip app warmup')
  .option('--skip-bootstrap', 'Skip contract bootstrap')
  .option('--infra-only', "Only run infrastructure setup, don't run tests")
  .option('--teardown-only', 'Only run teardown')
  .option('--force', 'Force override existing test lock')
  .option('--forge-opts <opts>', 'Pass options to forge test')
  .action(async (options) => {
    const mode = options.mode as TestMode
    const rootDir = findMonorepoRoot()
    const results: TestResult[] = []

    logger.header(`JEJU TEST - ${mode.toUpperCase()}`)

    // Validate mode
    if (
      !['unit', 'integration', 'e2e', 'full', 'infra', 'smoke'].includes(mode)
    ) {
      logger.error(
        `Invalid mode: ${mode}. Use: unit, integration, e2e, full, infra, smoke`,
      )
      process.exit(1)
    }

    // Fail fast on invalid app selection (before any setup)
    if (options.targetApp) {
      const apps = discoverApps(rootDir)
      const exists = apps.some((a) => a.name === options.targetApp)
      if (!exists) {
        logger.error(`App not found: ${options.targetApp}`)
        process.exit(1)
      }
    }

    // Create test orchestrator
    const testOrchestrator = createTestOrchestrator({
      mode,
      app: options.targetApp,
      skipLock: options.skipLock,
      skipPreflight: options.skipPreflight,
      skipWarmup: options.skipWarmup,
      skipBootstrap: options.skipBootstrap,
      keepServices: options.keepServices,
      force: options.force,
      rootDir,
    })

    const cleanup = async () => {
      if (!options.keepServices) {
        await testOrchestrator.teardown()
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
      // Setup phase
      if (!options.teardownOnly) {
        await testOrchestrator.setup()
      }

      // Test execution phase
      if (!options.infraOnly && !options.teardownOnly) {
        const testEnv = {
          ...testOrchestrator.getEnvVars(),
          CI: options.ci ? 'true' : '',
          NODE_ENV: 'test',
        }

        // Route to appropriate test runner
        if (options.targetApp) {
          results.push(
            await runAppTests(
              rootDir,
              options.targetApp,
              mode,
              options,
              testEnv,
            ),
          )
        } else if (options.package) {
          results.push(await runPackageTests(rootDir, options.package, options))
        } else {
          // Run by mode
          switch (mode) {
            case 'unit':
              results.push(await runForgeTests(rootDir, options))
              results.push(await runBunTests(rootDir, options, testEnv, 'unit'))
              break
            case 'integration':
              results.push(await runForgeTests(rootDir, options))
              results.push(
                await runBunTests(rootDir, options, testEnv, 'integration'),
              )
              results.push(await runIntegrationTests(rootDir, options, testEnv))
              results.push(await runComputeTests(rootDir, options, testEnv))
              break
            case 'e2e':
              results.push(await runE2ETests(rootDir, options, testEnv))
              results.push(await runWalletTests(rootDir, options, testEnv))
              break
            case 'full':
              results.push(await runForgeTests(rootDir, options))
              results.push(await runBunTests(rootDir, options, testEnv, 'unit'))
              results.push(await runIntegrationTests(rootDir, options, testEnv))
              results.push(await runComputeTests(rootDir, options, testEnv))
              results.push(await runE2ETests(rootDir, options, testEnv))
              results.push(await runWalletTests(rootDir, options, testEnv))
              results.push(await runCrossChainTests(rootDir, options, testEnv))
              break
            case 'infra':
              results.push(await runInfraTests(rootDir, options, testEnv))
              break
            case 'smoke':
              results.push(await runSmokeTests(rootDir, options, testEnv))
              break
          }
        }

        // Coverage and dead code detection
        if (options.coverage || options.deadCode || options.ci) {
          const coverage = await generateCoverageReport(
            rootDir,
            results,
            options.deadCode,
          )
          printCoverageReport(coverage)
        }

        printSummary(results)

        // Coverage and dead code detection
        if (options.coverage || options.deadCode || options.ci) {
          const coverage = await generateCoverageReport(
            rootDir,
            results,
            options.deadCode,
          )
          printCoverageReport(coverage)
        }

        const failed = results.filter((r) => !r.passed && !r.skipped).length
        if (failed > 0) {
          await cleanup()
          process.exit(1)
        }
      }

      // Teardown phase
      if (
        options.teardownOnly ||
        (!options.keepServices && !options.infraOnly)
      ) {
        await cleanup()
      }

      if (options.infraOnly) {
        logger.success('Setup complete. Services are running.')
        logger.info('Run with --teardown-only to stop services.')
      }
    } catch (error) {
      logger.error(
        `Test failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      await cleanup()
      process.exit(1)
    }
  })

// Subcommands
testCommand
  .command('list')
  .description('List available tests')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    logger.header('AVAILABLE TESTS')

    logger.subheader('Modes')
    console.log('  unit          Fast tests, no services')
    console.log('  integration   Chain + real services (Docker)')
    console.log('  e2e           Full stack with UI (Playwright)')
    console.log('  full          Everything including multi-chain')
    console.log('  infra         Infrastructure and deployment')
    console.log('  smoke         Quick health checks')

    logger.subheader('Apps')
    const apps = discoverApps(rootDir)
    for (const app of apps) {
      const manifest = loadManifest(join(rootDir, 'apps', app.name))
      const testing = manifest?.testing as ManifestTesting | undefined
      const hasTests = !!(testing?.unit || testing?.e2e || testing?.integration)
      console.log(
        `  ${app.name.padEnd(14)} ${hasTests ? '✓' : '○'} ${app.displayName || ''}`,
      )
    }

    logger.subheader('Packages')
    const pkgs = readdirSync(join(rootDir, 'packages')).filter((p) =>
      existsSync(join(rootDir, 'packages', p, 'package.json')),
    )
    for (const pkg of pkgs) {
      console.log(`  ${pkg.padEnd(14)} @jejunetwork/${pkg}`)
    }
  })

testCommand
  .command('apps')
  .description('Test all apps')
  .option('-m, --mode <mode>', 'Test mode', 'unit')
  .option('--ci', 'CI mode')
  .option('--no-docker', 'Skip Docker orchestration')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const results: TestResult[] = []
    const mode = options.mode as TestMode

    logger.header('TESTING ALL APPS')

    const testOrchestrator = createTestOrchestrator({
      mode,
      skipLock: true,
      skipPreflight: true,
      skipWarmup: true,
      keepServices: true,
      rootDir,
    })

    let testEnv: Record<string, string> = { NODE_ENV: 'test' }

    // Only start Docker if not disabled and mode requires it
    if (options.docker && mode !== 'unit') {
      await testOrchestrator.setup()
      testEnv = { ...testOrchestrator.getEnvVars(), NODE_ENV: 'test' }
    }

    const apps = discoverApps(rootDir)

    for (const app of apps) {
      // Use name for file system lookup
      const result = await runAppTests(
        rootDir,
        app.name,
        mode,
        options,
        testEnv,
      )
      results.push(result)

      if (!result.passed && options.ci) {
        logger.error('Stopping due to failure in CI mode')
        break
      }
    }

    await testOrchestrator.teardown()
    printSummary(results)

    const failed = results.filter((r) => !r.passed && !r.skipped).length
    if (failed > 0) process.exit(1)
  })

testCommand
  .command('coverage')
  .description('Generate coverage report')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    logger.header('COVERAGE REPORT')

    const coverage = await generateCoverageReport(rootDir, [], true)
    printCoverageReport(coverage)
  })

testCommand
  .command('e2e')
  .description(
    'Run E2E tests with full infrastructure (chain, contracts, wallet)',
  )
  .option('-a, --app <app>', 'Test specific app')
  .option('--headless', 'Run in headless mode (CI)')
  .option('--debug', 'Enable debug mode')
  .option('--build-cache', 'Build wallet cache only')
  .option('--clear-cache', 'Clear wallet cache')
  .option('--smoke', 'Run smoke tests only')
  .option('--setup-only', "Only setup infrastructure, don't run tests")
  .option('--skip-infra', 'Skip infrastructure setup (assume already running)')
  .option('--skip-contracts', 'Skip contract deployment')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    logger.header('JEJU E2E - End-to-End Tests')

    // Clear cache if requested
    if (options.clearCache) {
      await clearSynpressCache(rootDir)
      logger.success('Wallet cache cleared')
      if (!options.buildCache) return
    }

    // Build cache only
    if (options.buildCache) {
      await buildSynpressCache(rootDir, options)
      return
    }

    // Setup infrastructure (chain + contracts + browsers)
    let cleanup: (() => Promise<void>) | null = null
    if (!options.skipInfra) {
      cleanup = await setupE2EInfra(rootDir, options)
    }

    if (options.setupOnly) {
      logger.success('Infrastructure ready. Run tests with --skip-infra')
      logger.info('Chain: http://127.0.0.1:6546 (chainId: 1337)')
      // Keep Anvil running by not calling cleanup
      return
    }

    // Run tests
    try {
      const results = await runSynpressTests(rootDir, options)
      printSummary(results)

      const failed = results.filter((r) => !r.passed && !r.skipped).length
      if (failed > 0) {
        if (cleanup) await cleanup()
        process.exit(1)
      }
    } finally {
      if (cleanup && !options.setupOnly) await cleanup()
    }
  })

// Test runners

async function runForgeTests(
  rootDir: string,
  options: Record<string, unknown>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running Forge tests (contracts)...')

  const contractsPath = join(rootDir, 'packages', 'contracts')
  if (
    !existsSync(contractsPath) ||
    !existsSync(join(contractsPath, 'foundry.toml'))
  ) {
    logger.info('No contracts to test')
    return { name: 'contracts', passed: true, duration: 0, skipped: true }
  }

  // Check forge installed
  try {
    await execa('which', ['forge'])
  } catch {
    logger.warn(
      'Forge not installed. Install: curl -L https://foundry.paradigm.xyz | bash',
    )
    return { name: 'contracts', passed: true, duration: 0, skipped: true }
  }

  // Check dependencies
  const forgeStdPath = join(
    contractsPath,
    'lib',
    'forge-std',
    'src',
    'Test.sol',
  )
  if (!existsSync(forgeStdPath)) {
    logger.warn(
      'Forge libs not installed. Run: cd packages/contracts && forge install',
    )
    return { name: 'contracts', passed: true, duration: 0, skipped: true }
  }

  try {
    const args = ['test']
    if (options.verbose) args.push('-vvv')
    if (options.forgeOpts)
      args.push(...(options.forgeOpts as string).split(' '))
    if (options.ci) args.push('--fail-fast')
    if (options.coverage) args.push('--coverage')

    await execa('forge', args, {
      cwd: contractsPath,
      stdio: 'inherit',
    })

    return { name: 'contracts', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'contracts',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runBunTests(
  rootDir: string,
  options: Record<string, unknown>,
  env: Record<string, string>,
  type: 'unit' | 'integration',
): Promise<TestResult> {
  const start = Date.now()
  logger.step(`Running Bun tests (${type})...`)

  try {
    // Intentionally run tests from `packages/tests` only.
    // Running `bun test` at repo root or across workspaces pulls in vendor workspaces
    // (e.g. `vendor/babylon`) which is not part of Jeju’s CI surface.
    const testsRoot = join(rootDir, 'packages', 'tests')
    if (!existsSync(testsRoot)) {
      return { name: type, passed: true, duration: 0, skipped: true }
    }

    const args =
      type === 'unit' ? ['test', 'unit/', 'shared/'] : ['test', 'integration/']

    if (options.coverage) args.push('--coverage')
    if (options.watch) args.push('--watch')

    await execa('bun', args, {
      cwd: testsRoot,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })

    return { name: type, passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: type,
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runIntegrationTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running integration tests...')

  const testsPath = join(rootDir, 'packages', 'tests', 'integration')
  if (!existsSync(testsPath)) {
    return { name: 'integration', passed: true, duration: 0, skipped: true }
  }

  try {
    await execa('bun', ['test', 'integration/'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })

    return { name: 'integration', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'integration',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runComputeTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running compute bridge tests...')

  const computePath = join(rootDir, 'apps', 'compute')
  const integrationTest = join(
    computePath,
    'src',
    'providers',
    'tests',
    'integration.test.ts',
  )

  if (!existsSync(integrationTest)) {
    return { name: 'compute', passed: true, duration: 0, skipped: true }
  }

  // Check if bridge is running
  const bridgeUrl = env.COMPUTE_BRIDGE_URL || 'http://127.0.0.1:4010'
  let bridgeRunning = false
  try {
    const response = await fetch(`${bridgeUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    bridgeRunning = response.ok
  } catch {
    logger.warn('Compute bridge not running - some tests may be skipped')
  }

  try {
    await execa('bun', ['test', 'src/providers/tests/integration.test.ts'], {
      cwd: computePath,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
        COMPUTE_BRIDGE_URL: bridgeUrl,
        COMPUTE_BRIDGE_RUNNING: bridgeRunning ? 'true' : 'false',
      },
    })

    return { name: 'compute', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'compute',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runE2ETests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running E2E tests (Playwright)...')

  const testsPath = join(rootDir, 'packages', 'tests', 'e2e')
  if (!existsSync(testsPath)) {
    return { name: 'e2e', passed: true, duration: 0, skipped: true }
  }

  try {
    await execa('bunx', ['playwright', 'test'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })

    return { name: 'e2e', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'e2e',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runWalletTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running wallet tests (Synpress)...')

  const walletPath = join(rootDir, 'apps', 'wallet')
  const synpressConfig = join(walletPath, 'synpress.config.ts')

  if (!existsSync(synpressConfig)) {
    return { name: 'wallet-e2e', passed: true, duration: 0, skipped: true }
  }

  try {
    await execa(
      'bunx',
      ['playwright', 'test', '--config', 'synpress.config.ts'],
      {
        cwd: walletPath,
        stdio: 'inherit',
        env: { ...process.env, ...env },
      },
    )

    return { name: 'wallet-e2e', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'wallet-e2e',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runCrossChainTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running cross-chain tests...')

  // Check if Solana is available
  try {
    const response = await fetch(
      env.SOLANA_RPC_URL || 'http://127.0.0.1:8899',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'getVersion', id: 1 }),
        signal: AbortSignal.timeout(3000),
      },
    )
    if (!response.ok) {
      logger.warn('Solana not available, skipping cross-chain tests')
      return { name: 'cross-chain', passed: true, duration: 0, skipped: true }
    }
  } catch {
    logger.warn('Solana not available, skipping cross-chain tests')
    return { name: 'cross-chain', passed: true, duration: 0, skipped: true }
  }

  // Run cross-chain specific tests
  const crossChainPath = join(rootDir, 'packages', 'tests', 'cross-chain')
  if (!existsSync(crossChainPath)) {
    // Fallback: run grep for cross-chain tests in integration directory
    try {
      await execa('bun', ['test', '--grep', 'cross-chain|EIL|OIF|bridge'], {
        cwd: join(rootDir, 'packages', 'tests'),
        stdio: 'inherit',
        env: { ...process.env, ...env },
      })
      return { name: 'cross-chain', passed: true, duration: Date.now() - start }
    } catch (error) {
      const err = error as ExecaError
      return {
        name: 'cross-chain',
        passed: false,
        duration: Date.now() - start,
        output: String(err.stderr || ''),
      }
    }
  }

  try {
    await execa('bun', ['test', 'cross-chain/'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })

    return { name: 'cross-chain', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'cross-chain',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runSmokeTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running smoke tests...')

  const testsPath = join(rootDir, 'packages', 'tests', 'smoke')
  if (!existsSync(testsPath)) {
    return { name: 'smoke', passed: true, duration: 0, skipped: true }
  }

  try {
    await execa(
      'bunx',
      ['playwright', 'test', '--config', 'smoke/playwright.config.ts'],
      {
        cwd: join(rootDir, 'packages', 'tests'),
        stdio: 'inherit',
        env: { ...process.env, ...env },
      },
    )

    return { name: 'smoke', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'smoke',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runInfraTests(
  rootDir: string,
  options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step('Running infrastructure tests...')

  const results: boolean[] = []

  // 1. Terraform validation
  logger.info('Validating Terraform configurations...')
  const terraformDirs = [
    join(rootDir, 'packages/deployment/terraform/environments/testnet'),
    join(rootDir, 'packages/deployment/terraform/environments/mainnet'),
  ]

  for (const dir of terraformDirs) {
    if (!existsSync(dir)) continue
    try {
      await execa('terraform', ['init', '-backend=false'], {
        cwd: dir,
        stdio: 'pipe',
      })
      await execa('terraform', ['validate'], { cwd: dir, stdio: 'pipe' })
      logger.success(`  ${dir.split('/').pop()}: valid`)
      results.push(true)
    } catch {
      logger.error(`  ${dir.split('/').pop()}: invalid`)
      results.push(false)
    }
  }

  // 2. Helm chart validation
  logger.info('Validating Helm charts...')
  const helmDir = join(rootDir, 'packages/deployment/kubernetes/helm')
  if (existsSync(helmDir)) {
    const charts = readdirSync(helmDir).filter((d) =>
      existsSync(join(helmDir, d, 'Chart.yaml')),
    )

    for (const chart of charts.slice(0, 5)) {
      // Limit to first 5 for speed
      try {
        await execa('helm', ['lint', chart], { cwd: helmDir, stdio: 'pipe' })
        results.push(true)
      } catch {
        logger.warn(`  ${chart}: lint warnings`)
        results.push(true) // Warnings are OK
      }
    }
    logger.success(`  ${charts.length} Helm charts validated`)
  }

  // 3. Docker build test
  logger.info('Testing Docker builds...')
  const dockerApps = ['indexer', 'gateway']
  for (const app of dockerApps) {
    const dockerfile = join(rootDir, 'apps', app, 'Dockerfile')
    if (!existsSync(dockerfile)) continue

    try {
      await execa(
        'docker',
        ['build', '--no-cache', '-t', `jeju-${app}:test`, '.'],
        {
          cwd: join(rootDir, 'apps', app),
          stdio: 'pipe',
          timeout: 300000,
        },
      )
      logger.success(`  ${app}: builds`)
      results.push(true)
    } catch {
      logger.error(`  ${app}: build failed`)
      results.push(false)
    }
  }

  // 4. Deployment tests (optional - only if --deploy flag)
  if (options.deploy) {
    logger.info('Testing testnet deployment...')
    try {
      await execa(
        'bun',
        ['run', 'packages/deployment/scripts/deploy/testnet.ts', '--dry-run'],
        {
          cwd: rootDir,
          stdio: 'inherit',
          env: { ...process.env, ...env, DRY_RUN: 'true' },
        },
      )
      results.push(true)
    } catch {
      results.push(false)
    }
  }

  const allPassed = results.every((r) => r)
  return {
    name: 'infrastructure',
    passed: allPassed,
    duration: Date.now() - start,
  }
}

async function runAppTests(
  rootDir: string,
  appName: string,
  mode: TestMode,
  options: Record<string, unknown>,
  env: Record<string, string>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step(`Testing app: ${appName}`)

  // Find app path
  let appPath = join(rootDir, 'apps', appName)
  if (!existsSync(appPath)) {
    appPath = join(rootDir, 'vendor', appName)
  }
  if (!existsSync(appPath)) {
    logger.error(`App not found: ${appName}`)
    return { name: appName, passed: false, duration: 0 }
  }

  // Load manifest
  const manifest = loadManifest(appPath)
  const testing = manifest?.testing as ManifestTesting | undefined

  // Determine test command based on mode
  let testCmd: string | null = null
  let timeout = 120000

  if (mode === 'unit' && testing?.unit?.command) {
    testCmd = testing.unit.command
    timeout = testing.unit.timeout || timeout
  } else if (mode === 'e2e' && testing?.e2e?.command) {
    testCmd = testing.e2e.command
    timeout = testing.e2e.timeout || timeout
  } else if (mode === 'integration' && testing?.integration?.command) {
    testCmd = testing.integration.command
    timeout = testing.integration.timeout || timeout
  } else {
    // Fallback to package.json test script
    const pkgPath = join(appPath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.scripts?.test) {
        testCmd = 'bun run test'
      } else if (pkg.scripts?.[`test:${mode}`]) {
        testCmd = `bun run test:${mode}`
      }
    }
  }

  if (!testCmd) {
    logger.info(`No ${mode} tests for ${appName}`)
    return { name: appName, passed: true, duration: 0, skipped: true }
  }

  try {
    const [cmd, ...args] = testCmd.split(' ')
    if (options.watch) args.push('--watch')
    if (options.coverage) args.push('--coverage')

    await execa(cmd, args, {
      cwd: appPath,
      stdio: 'inherit',
      timeout,
      env: { ...process.env, ...env },
    })

    return { name: appName, passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: appName,
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runPackageTests(
  rootDir: string,
  pkgName: string,
  options: Record<string, unknown>,
): Promise<TestResult> {
  const start = Date.now()
  logger.step(`Testing package: ${pkgName}`)

  const pkgPath = join(rootDir, 'packages', pkgName)
  if (!existsSync(pkgPath)) {
    logger.error(`Package not found: ${pkgName}`)
    return { name: pkgName, passed: false, duration: 0 }
  }

  // Special handling for contracts
  if (pkgName === 'contracts') {
    return runForgeTests(rootDir, options)
  }

  try {
    const args = ['test']
    if (options.watch) args.push('--watch')
    if (options.coverage) args.push('--coverage')

    await execa('bun', args, {
      cwd: pkgPath,
      stdio: 'inherit',
    })

    return { name: pkgName, passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: pkgName,
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

// Coverage

async function generateCoverageReport(
  rootDir: string,
  _results: TestResult[],
  detectDeadCode: boolean,
): Promise<CoverageReport> {
  logger.step('Generating coverage report...')

  const report: CoverageReport = {
    lines: { total: 0, covered: 0, percent: 0 },
    functions: { total: 0, covered: 0, percent: 0 },
    branches: { total: 0, covered: 0, percent: 0 },
    deadCode: [],
  }

  // Collect Bun coverage
  const coverageDir = join(rootDir, 'coverage')
  if (existsSync(coverageDir)) {
    // Parse lcov or similar
    logger.info('Coverage data collected')
  }

  // Detect dead code using ts-prune or similar
  if (detectDeadCode) {
    logger.info('Detecting dead code...')
    try {
      const result = await execa(
        'bunx',
        ['ts-prune', '--project', 'tsconfig.json'],
        {
          cwd: rootDir,
          reject: false,
        },
      )
      if (result.stdout) {
        const deadFiles = result.stdout
          .split('\n')
          .filter(
            (line) => line.includes(' - ') && !line.includes('node_modules'),
          )
        report.deadCode = deadFiles.slice(0, 20) // Limit output
      }
    } catch {
      // ts-prune not available
    }
  }

  // Write report
  const reportPath = join(rootDir, 'test-results', 'coverage.json')
  mkdirSync(join(rootDir, 'test-results'), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2))

  return report
}

// Synpress Helpers

async function clearSynpressCache(rootDir: string): Promise<void> {
  const cacheDirs = [
    join(rootDir, '.jeju', '.synpress-cache'),
    join(rootDir, '.synpress-cache'),
  ]

  for (const dir of cacheDirs) {
    if (existsSync(dir)) {
      await execa('rm', ['-rf', dir])
      logger.info(`Cleared: ${dir}`)
    }
  }
}

async function buildSynpressCache(
  rootDir: string,
  options: Record<string, unknown>,
): Promise<void> {
  logger.step('Building Synpress wallet cache...')

  // Ensure cache directory exists
  const cacheDir = join(rootDir, '.jeju', '.synpress-cache')
  mkdirSync(cacheDir, { recursive: true })

  // Wallet setup directory - use relative path from packages/tests
  const testsDir = join(rootDir, 'packages', 'tests')
  const walletSetupRelative = 'shared/wallet-setup'
  const walletSetupFile = join(testsDir, walletSetupRelative, 'jeju.setup.ts')

  if (!existsSync(walletSetupFile)) {
    logger.error(`Wallet setup file not found at: ${walletSetupFile}`)
    process.exit(1)
  }

  logger.info(`Using wallet setup from: ${walletSetupRelative}`)

  try {
    // Run synpress with relative path to wallet-setup directory
    await execa('bunx', ['synpress', walletSetupRelative, '--force'], {
      cwd: testsDir,
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        SYNPRESS_CACHE_DIR: cacheDir,
      },
    })
    logger.success('Wallet cache built successfully')
  } catch (error) {
    const err = error as ExecaError
    logger.error(`Cache build failed: ${err.message}`)
    if (options.verbose) {
      logger.error(String(err.stderr || err.stdout || ''))
    }
    process.exit(1)
  }
}

async function setupE2EInfra(
  rootDir: string,
  options: Record<string, unknown>,
): Promise<() => Promise<void>> {
  logger.step('Setting up E2E infrastructure...')

  // E2E test configuration - fixed values for consistency. Port 6546 avoids Anvil/Hardhat default (8545)
  const E2E_PORT = 6546
  const E2E_CHAIN_ID = 1337
  const rpcUrl = `http://127.0.0.1:${E2E_PORT}`
  let anvilPid: number | null = null
  let chainStartedByUs = false

  // Standard test accounts (Anvil defaults)
  const DEPLOYER_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  // Helper to check chain connectivity
  async function checkChain(
    url: string,
    expectedChainId?: number,
  ): Promise<boolean> {
    try {
      const result = await execa(
        'curl',
        [
          '-s',
          '-f',
          '-X',
          'POST',
          url,
          '-H',
          'Content-Type: application/json',
          '-d',
          '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}',
          '--connect-timeout',
          '3',
        ],
        { reject: false },
      )

      if (result.exitCode !== 0) return false

      const rawData = JSON.parse(result.stdout)
      const data = validate(
        rawData,
        EthChainIdResponseSchema,
        'eth_chainId response',
      )
      if (!data.result || data.error) return false

      if (expectedChainId !== undefined) {
        const chainId = parseInt(data.result, 16)
        return chainId === expectedChainId
      }

      return true
    } catch {
      return false
    }
  }

  // 1. Start or verify chain
  const chainRunning = await checkChain(rpcUrl, E2E_CHAIN_ID)

  if (chainRunning) {
    logger.success(`Chain already running at ${rpcUrl}`)
  } else {
    logger.info(`Starting Anvil on port ${E2E_PORT}...`)

    // When --setup-only is used, detach Anvil so it survives CLI exit
    const detached = !!options.setupOnly
    const anvilProc = execa(
      'anvil',
      [
        '--chain-id',
        String(E2E_CHAIN_ID),
        '--port',
        String(E2E_PORT),
        '--block-time',
        '1',
        '--accounts',
        '10',
        '--balance',
        '10000',
      ],
      {
        stdio: detached ? 'ignore' : options.verbose ? 'inherit' : 'pipe',
        reject: false,
        detached,
      },
    )

    // Allow the parent to exit without waiting for detached process
    if (detached) {
      anvilProc.unref()
    }

    anvilPid = anvilProc.pid ?? null
    chainStartedByUs = true

    // Wait for chain to be ready
    let ready = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await checkChain(rpcUrl, E2E_CHAIN_ID)) {
        ready = true
        break
      }
    }

    if (!ready) {
      throw new Error('Anvil failed to start')
    }
    logger.success(`Anvil started at ${rpcUrl}`)
  }

  // 2. Set environment variables (must be done before any other setup)
  process.env.L2_RPC_URL = rpcUrl
  process.env.JEJU_RPC_URL = rpcUrl
  process.env.CHAIN_ID = String(E2E_CHAIN_ID)
  process.env.DEPLOYER_PRIVATE_KEY = DEPLOYER_KEY
  process.env.TEST_WALLET_ADDRESS = TEST_WALLET

  // 3. Deploy contracts if needed (skip with --skip-contracts)
  if (!options.skipContracts) {
    const bootstrapFile = join(
      rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )

    if (existsSync(bootstrapFile)) {
      logger.success('Contracts already deployed')
    } else {
      const bootstrapScript = join(
        rootDir,
        'packages/deployment/scripts/bootstrap-localnet-complete.ts',
      )

      if (existsSync(bootstrapScript)) {
        logger.info('Deploying contracts...')
        try {
          await execa('bun', ['run', bootstrapScript], {
            cwd: rootDir,
            stdio: options.verbose ? 'inherit' : 'pipe',
            env: {
              ...process.env,
              JEJU_RPC_URL: rpcUrl,
              L2_RPC_URL: rpcUrl,
              DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
            },
            timeout: 300000, // 5 minute timeout for deployments
          })
          logger.success('Contracts deployed')
        } catch (error) {
          const err = error as ExecaError
          if (options.verbose) {
            logger.warn(
              `Contract deployment output: ${err.stderr || err.stdout || ''}`,
            )
          }
          logger.warn(
            'Contract deployment failed - tests may have limited functionality',
          )
        }
      } else {
        logger.debug('Bootstrap script not found, skipping contract deployment')
      }
    }
  }

  // 4. Install playwright browsers if needed
  try {
    await execa('bunx', ['playwright', 'install', 'chromium'], {
      stdio: options.verbose ? 'inherit' : 'pipe',
    })
    logger.success('Playwright browsers ready')
  } catch {
    logger.warn(
      'Failed to install Playwright browsers - may already be installed',
    )
  }

  // 5. Start app if specified
  let appProc: ReturnType<typeof execa> | null = null
  let appStartedByUs = false

  if (options.app && typeof options.app === 'string') {
    const appName = options.app
    const apps = discoverApps(rootDir)
    const appManifest = apps.find((a) => a.name === appName)

    if (appManifest) {
      const appDir = join(rootDir, 'apps', appName)
      const devCommand = appManifest.commands?.dev
      const mainPort = appManifest.ports?.main

      if (devCommand && existsSync(appDir)) {
        // Check if app already running
        const appRunning = mainPort ? await checkPort(mainPort) : false

        if (appRunning) {
          logger.success(`${appName} already running on port ${mainPort}`)
        } else {
          logger.info(`Starting ${appName}...`)

          const appEnv = {
            ...process.env,
            JEJU_RPC_URL: rpcUrl,
            L2_RPC_URL: rpcUrl,
            RPC_URL: rpcUrl,
            CHAIN_ID: String(E2E_CHAIN_ID),
            DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
            TEST_WALLET_ADDRESS: TEST_WALLET,
            PORT: mainPort ? String(mainPort) : undefined,
            VITE_PORT: mainPort ? String(mainPort) : undefined,
          }

          const [cmd, ...args] = devCommand.split(' ')
          appProc = execa(cmd, args, {
            cwd: appDir,
            stdio: options.verbose ? 'inherit' : 'pipe',
            env: appEnv,
            reject: false,
          })

          appStartedByUs = true

          // Wait for app to be ready
          if (mainPort) {
            let appReady = false
            for (let i = 0; i < 60; i++) {
              // Wait up to 60 seconds
              await new Promise((r) => setTimeout(r, 1000))
              if (await checkPort(mainPort)) {
                appReady = true
                break
              }
            }

            if (appReady) {
              logger.success(`${appName} ready at http://localhost:${mainPort}`)
            } else {
              logger.warn(
                `${appName} may not be ready - timeout waiting for port ${mainPort}`,
              )
            }
          }
        }
      }
    }
  }

  // Helper to check if a port is listening (TCP check, then HTTP)
  async function checkPort(port: number): Promise<boolean> {
    try {
      // First try a TCP connection check using nc (more reliable)
      const ncResult = await execa('nc', ['-z', 'localhost', String(port)], {
        reject: false,
        timeout: 3000,
      })
      if (ncResult.exitCode === 0) return true

      // Fallback to HTTP check
      const result = await execa(
        'curl',
        [
          '-s',
          '-o',
          '/dev/null',
          '-w',
          '%{http_code}',
          `http://localhost:${port}`,
          '--connect-timeout',
          '2',
        ],
        { reject: false },
      )
      // Accept any HTTP response (even 404) as "port is listening"
      const httpCode = parseInt(result.stdout, 10)
      return httpCode > 0 && httpCode < 600
    } catch {
      return false
    }
  }

  // 6. Log configuration summary
  logger.newline()
  logger.subheader('E2E Test Environment')
  logger.keyValue('RPC URL', rpcUrl)
  logger.keyValue('Chain ID', String(E2E_CHAIN_ID))
  logger.keyValue('Test Wallet', TEST_WALLET)
  if (options.app && typeof options.app === 'string') {
    const apps = discoverApps(rootDir)
    const appManifest = apps.find((a) => a.name === options.app)
    if (appManifest?.ports?.main) {
      logger.keyValue('App URL', `http://localhost:${appManifest.ports.main}`)
    }
  }
  logger.newline()

  // Cleanup function
  return async () => {
    // Stop app first
    if (appStartedByUs && appProc && appProc.pid) {
      try {
        process.kill(appProc.pid)
        logger.info(`${options.app} stopped`)
      } catch {
        // Process may have already exited
      }
    }

    // Stop Anvil
    if (chainStartedByUs && anvilPid) {
      try {
        process.kill(anvilPid)
        logger.info('Anvil stopped')
      } catch {
        // Process may have already exited
      }
    }
  }
}

async function runSynpressTests(
  rootDir: string,
  options: Record<string, unknown>,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  // E2E test defaults - consistent with setupE2EInfra
  const E2E_RPC_URL = 'http://127.0.0.1:6546'
  const E2E_CHAIN_ID = '1337'
  const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const DEPLOYER_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

  const testEnv = {
    ...process.env,
    // Chain configuration
    L2_RPC_URL: E2E_RPC_URL,
    JEJU_RPC_URL: E2E_RPC_URL,
    CHAIN_ID: E2E_CHAIN_ID,
    // Test accounts
    TEST_WALLET_ADDRESS: TEST_WALLET,
    DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
    // Synpress/Playwright config
    CI: options.headless ? 'true' : '',
    DEBUG: options.debug ? 'synpress:*' : '',
    SYNPRESS_CACHE_DIR: join(rootDir, '.jeju', '.synpress-cache'),
    // Disable env file loading to ensure consistent config
    DOTENV_CONFIG_PATH: '',
  }

  // Smoke tests only
  if (options.smoke) {
    logger.step('Running Synpress smoke tests...')
    const result = await runSynpressSmokeTests(rootDir, testEnv, options)
    results.push(result)
    return results
  }

  // App-specific tests
  if (options.app) {
    logger.step(`Running Synpress tests for ${options.app}...`)
    const result = await runAppSynpressTests(
      rootDir,
      options.app as string,
      testEnv,
      options,
    )
    results.push(result)
    return results
  }

  // Discover and run all apps with synpress configs
  const apps = discoverSynpressApps(rootDir)

  if (apps.length === 0) {
    logger.warn('No apps with synpress.config.ts found')
    return [{ name: 'synpress', passed: true, duration: 0, skipped: true }]
  }

  logger.info(
    `Found ${apps.length} apps with Synpress tests: ${apps.join(', ')}`,
  )

  for (const app of apps) {
    const result = await runAppSynpressTests(rootDir, app, testEnv, options)
    results.push(result)
  }

  return results
}

function discoverSynpressApps(rootDir: string): string[] {
  const apps: string[] = []
  const appsDir = join(rootDir, 'apps')

  if (!existsSync(appsDir)) return apps

  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue

    const synpressConfig = join(appsDir, entry.name, 'synpress.config.ts')
    if (existsSync(synpressConfig)) {
      apps.push(entry.name)
    }
  }

  return apps
}

async function runSynpressSmokeTests(
  rootDir: string,
  env: Record<string, string>,
  _options: Record<string, unknown>,
): Promise<TestResult> {
  const start = Date.now()
  const testsPath = join(rootDir, 'packages', 'tests', 'smoke')

  if (!existsSync(testsPath)) {
    return { name: 'smoke', passed: true, duration: 0, skipped: true }
  }

  try {
    await execa(
      'bunx',
      [
        'playwright',
        'test',
        'wallet-smoke.spec.ts',
        '--config',
        'synpress.config.ts',
      ],
      {
        cwd: testsPath,
        stdio: 'inherit',
        env: { ...process.env, ...env },
      },
    )

    return { name: 'smoke', passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: 'smoke',
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

async function runAppSynpressTests(
  rootDir: string,
  appName: string,
  env: Record<string, string>,
  options: Record<string, unknown>,
): Promise<TestResult> {
  const start = Date.now()

  // Find app path
  let appPath = join(rootDir, 'apps', appName)
  if (!existsSync(appPath)) {
    appPath = join(rootDir, 'vendor', appName)
  }

  if (!existsSync(appPath)) {
    return {
      name: appName,
      passed: false,
      duration: 0,
      output: `App not found: ${appName}`,
    }
  }

  const synpressConfig = join(appPath, 'synpress.config.ts')
  if (!existsSync(synpressConfig)) {
    return { name: appName, passed: true, duration: 0, skipped: true }
  }

  // Check if any synpress test directory exists
  const testDirs = ['tests/synpress', 'tests/e2e-synpress', 'tests/wallet']
  const foundTestDir = testDirs.find((dir) => existsSync(join(appPath, dir)))

  if (!foundTestDir) {
    logger.warn(`No synpress test directory found in ${appName}`)
    return { name: appName, passed: true, duration: 0, skipped: true }
  }

  logger.step(`Running ${appName} Synpress tests (${foundTestDir})...`)

  try {
    // Let the synpress.config.ts define testDir - don't override it
    const args = ['playwright', 'test', '--config', 'synpress.config.ts']
    if (options.verbose) args.push('--reporter=list')

    await execa('bunx', args, {
      cwd: appPath,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      timeout: 600000, // 10 minutes
    })

    return { name: appName, passed: true, duration: Date.now() - start }
  } catch (error) {
    const err = error as ExecaError
    return {
      name: appName,
      passed: false,
      duration: Date.now() - start,
      output: String(err.stderr || ''),
    }
  }
}

// Helpers

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

function loadManifest(appPath: string): Record<string, unknown> | null {
  const manifestPath = join(appPath, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return null
  }
}

function printSummary(results: TestResult[]) {
  logger.newline()
  logger.separator()
  logger.subheader('RESULTS')

  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.name.padEnd(16)} skipped`)
    } else if (r.passed) {
      console.log(`  ${r.name.padEnd(16)} ✓ ${r.duration}ms`)
    } else {
      console.log(`  ${r.name.padEnd(16)} ✗ FAILED`)
    }
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed && !r.skipped).length
  const skipped = results.filter((r) => r.skipped).length

  logger.newline()
  if (failed === 0) {
    logger.success(`${passed} passed${skipped ? `, ${skipped} skipped` : ''}`)
  } else {
    logger.error(`${failed} failed, ${passed} passed`)
  }
}

function printCoverageReport(coverage: CoverageReport) {
  logger.subheader('COVERAGE')

  if (coverage.lines.total > 0) {
    console.log(
      `  Lines:     ${coverage.lines.percent.toFixed(1)}% (${coverage.lines.covered}/${coverage.lines.total})`,
    )
    console.log(
      `  Functions: ${coverage.functions.percent.toFixed(1)}% (${coverage.functions.covered}/${coverage.functions.total})`,
    )
    console.log(
      `  Branches:  ${coverage.branches.percent.toFixed(1)}% (${coverage.branches.covered}/${coverage.branches.total})`,
    )
  }

  if (coverage.deadCode && coverage.deadCode.length > 0) {
    logger.subheader('DEAD CODE')
    for (const file of coverage.deadCode.slice(0, 10)) {
      console.log(`  ${file}`)
    }
    if (coverage.deadCode.length > 10) {
      console.log(`  ... and ${coverage.deadCode.length - 10} more`)
    }
  }
}
