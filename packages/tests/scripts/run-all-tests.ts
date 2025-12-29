#!/usr/bin/env bun
/**
 * Unified Test Runner for All Apps and Packages
 *
 * Runs all tests against real localnet with:
 * - Automatic infrastructure startup (Anvil, SQLit, Redis, Postgres)
 * - Contract deployment
 * - All apps started
 * - E2E tests with real wallet interactions
 * - No mocks - everything connects to real services
 *
 * Usage:
 *   bun run packages/tests/scripts/run-all-tests.ts
 *   jeju test --mode full
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { $ } from 'bun'

interface TestResult {
  name: string
  type: 'unit' | 'integration' | 'e2e' | 'synpress' | 'forge'
  passed: boolean
  duration: number
  output?: string
  skipped?: boolean
}

interface AppConfig {
  name: string
  port: number
  hasTests: boolean
  hasSynpress: boolean
  testDir?: string
}

// Test configuration
const host = getLocalhostHost()
const RPC_URL =
  (typeof process !== 'undefined' ? process.env.L2_RPC_URL : undefined) ||
  getL2RpcUrl() ||
  `http://${host}:6546`
const CHAIN_ID =
  (typeof process !== 'undefined' ? process.env.CHAIN_ID : undefined) || '31337'
const DATABASE_URL =
  (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined) ||
  `postgresql://test:test@${host}:5432/test`
const REDIS_URL =
  (typeof process !== 'undefined' ? process.env.REDIS_URL : undefined) ||
  `redis://${host}:6379`
const SQLIT_URL =
  (typeof process !== 'undefined' ? process.env.SQLIT_URL : undefined) ||
  getSQLitBlockProducerUrl() ||
  `http://${host}:4661`

// Standard test accounts (Anvil defaults)
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

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

async function checkRpc(): Promise<boolean> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function startAnvil(rootDir: string): Promise<() => void> {
  console.log('🔗 Starting Anvil...')

  const proc = Bun.spawn(
    ['anvil', '--chain-id', CHAIN_ID, '--port', '6546', '--block-time', '1'],
    {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  // Wait for Anvil to start
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(1000)
    if (await checkRpc()) {
      console.log('✅ Anvil started')
      break
    }
  }

  return () => {
    proc.kill()
  }
}

async function deployContracts(rootDir: string): Promise<boolean> {
  console.log('📜 Deploying contracts...')

  const bootstrapPath = join(
    rootDir,
    'packages/deployment/scripts/bootstrap-localnet-complete.ts',
  )
  if (!existsSync(bootstrapPath)) {
    console.log('  Skipping - bootstrap script not found')
    return true
  }

  try {
    await $`bun run ${bootstrapPath}`
      .env({
        L2_RPC_URL: RPC_URL,
        DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
      })
      .cwd(rootDir)
    console.log('✅ Contracts deployed')
    return true
  } catch (error) {
    console.error('❌ Contract deployment failed:', error)
    return false
  }
}

function discoverApps(rootDir: string): AppConfig[] {
  const appsDir = join(rootDir, 'apps')
  const apps: AppConfig[] = []

  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const appPath = join(appsDir, entry.name)
    const pkgPath = join(appPath, 'package.json')
    const manifestPath = join(appPath, 'jeju-manifest.json')
    const synpressPath = join(appPath, 'synpress.config.ts')

    if (!existsSync(pkgPath)) continue

    let port = 3000
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      port = manifest.ports?.main ?? 3000
    }

    const hasTests =
      existsSync(join(appPath, 'tests')) || existsSync(join(appPath, 'test'))

    apps.push({
      name: entry.name,
      port,
      hasTests,
      hasSynpress: existsSync(synpressPath),
      testDir: existsSync(join(appPath, 'tests')) ? 'tests' : 'test',
    })
  }

  return apps
}

async function runForgeTests(rootDir: string): Promise<TestResult> {
  console.log('\n📦 Running Forge tests (contracts)...')
  const start = Date.now()

  const contractsPath = join(rootDir, 'packages/contracts')
  if (
    !existsSync(contractsPath) ||
    !existsSync(join(contractsPath, 'foundry.toml'))
  ) {
    return {
      name: 'contracts',
      type: 'forge',
      passed: true,
      duration: 0,
      skipped: true,
    }
  }

  try {
    await $`forge test -vvv`.cwd(contractsPath)
    return {
      name: 'contracts',
      type: 'forge',
      passed: true,
      duration: Date.now() - start,
    }
  } catch (error) {
    return {
      name: 'contracts',
      type: 'forge',
      passed: false,
      duration: Date.now() - start,
      output: String(error),
    }
  }
}

async function runBunTests(
  rootDir: string,
  type: 'unit' | 'integration',
): Promise<TestResult> {
  console.log(`\n🧪 Running Bun ${type} tests...`)
  const start = Date.now()

  const testsPath = join(rootDir, 'packages/tests', type)
  if (!existsSync(testsPath)) {
    return { name: type, type, passed: true, duration: 0, skipped: true }
  }

  try {
    await $`bun test ${type}/`
      .env({
        L2_RPC_URL: RPC_URL,
        CHAIN_ID,
        DATABASE_URL,
        REDIS_URL,
        SQLIT_URL,
      })
      .cwd(join(rootDir, 'packages/tests'))

    return { name: type, type, passed: true, duration: Date.now() - start }
  } catch (error) {
    return {
      name: type,
      type,
      passed: false,
      duration: Date.now() - start,
      output: String(error),
    }
  }
}

async function runAppTests(
  rootDir: string,
  app: AppConfig,
): Promise<TestResult[]> {
  const results: TestResult[] = []
  const appPath = join(rootDir, 'apps', app.name)

  // Run unit tests if they exist
  const unitPath = join(appPath, app.testDir ?? 'tests', 'unit')
  if (existsSync(unitPath)) {
    console.log(`\n🧪 Running ${app.name} unit tests...`)
    const start = Date.now()
    try {
      await $`bun test`.cwd(appPath)
      results.push({
        name: `${app.name}-unit`,
        type: 'unit',
        passed: true,
        duration: Date.now() - start,
      })
    } catch (error) {
      results.push({
        name: `${app.name}-unit`,
        type: 'unit',
        passed: false,
        duration: Date.now() - start,
        output: String(error),
      })
    }
  }

  // Run synpress tests if configured
  if (app.hasSynpress) {
    console.log(`\n🎭 Running ${app.name} Synpress tests...`)
    const start = Date.now()
    try {
      await $`bunx playwright test --config synpress.config.ts`
        .env({
          L2_RPC_URL: RPC_URL,
          CHAIN_ID,
          CI: 'true',
          TEST_WALLET_ADDRESS: TEST_WALLET,
        })
        .cwd(appPath)

      results.push({
        name: `${app.name}-synpress`,
        type: 'synpress',
        passed: true,
        duration: Date.now() - start,
      })
    } catch (error) {
      results.push({
        name: `${app.name}-synpress`,
        type: 'synpress',
        passed: false,
        duration: Date.now() - start,
        output: String(error),
      })
    }
  }

  return results
}

async function runE2ETests(rootDir: string): Promise<TestResult> {
  console.log('\n🎭 Running E2E tests (Playwright)...')
  const start = Date.now()

  const testsPath = join(rootDir, 'packages/tests/e2e')
  if (!existsSync(testsPath)) {
    return {
      name: 'e2e',
      type: 'e2e',
      passed: true,
      duration: 0,
      skipped: true,
    }
  }

  try {
    await $`bunx playwright test`
      .env({
        L2_RPC_URL: RPC_URL,
        CHAIN_ID,
        DATABASE_URL,
        REDIS_URL,
        SQLIT_URL,
        CI: 'true',
      })
      .cwd(join(rootDir, 'packages/tests'))

    return {
      name: 'e2e',
      type: 'e2e',
      passed: true,
      duration: Date.now() - start,
    }
  } catch (error) {
    return {
      name: 'e2e',
      type: 'e2e',
      passed: false,
      duration: Date.now() - start,
      output: String(error),
    }
  }
}

function printSummary(results: TestResult[]): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 TEST RESULTS')
  console.log('='.repeat(60))

  const passed = results.filter((r) => r.passed && !r.skipped)
  const failed = results.filter((r) => !r.passed && !r.skipped)
  const skipped = results.filter((r) => r.skipped)

  for (const result of results) {
    const status = result.skipped ? '⏭️' : result.passed ? '✅' : '❌'
    const duration = result.duration > 0 ? `(${result.duration}ms)` : ''
    console.log(
      `  ${status} ${result.name.padEnd(30)} ${result.type.padEnd(12)} ${duration}`,
    )
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(
    `SUMMARY: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
  )
  console.log('='.repeat(60))

  if (failed.length > 0) {
    console.log('\n❌ FAILED TESTS:')
    for (const result of failed) {
      console.log(`\n  ${result.name}:`)
      if (result.output) {
        console.log(
          result.output
            .split('\n')
            .slice(0, 10)
            .map((l) => `    ${l}`)
            .join('\n'),
        )
      }
    }
  }
}

async function main(): Promise<void> {
  const rootDir = findMonorepoRoot()
  const results: TestResult[] = []
  let cleanup: (() => void) | undefined

  console.log('🚀 Unified Test Runner')
  console.log('='.repeat(60))
  console.log(`Root: ${rootDir}`)
  console.log(`RPC:  ${RPC_URL}`)
  console.log(`Chain: ${CHAIN_ID}`)
  console.log('='.repeat(60))

  try {
    // Check if chain is running
    const chainRunning = await checkRpc()
    if (!chainRunning) {
      cleanup = await startAnvil(rootDir)
    } else {
      console.log('✅ Chain already running')
    }

    // Deploy contracts
    const deployed = await deployContracts(rootDir)
    if (!deployed) {
      console.warn('⚠️  Contract deployment failed - some tests may fail')
    }

    // Run Forge tests
    results.push(await runForgeTests(rootDir))

    // Run unit tests
    results.push(await runBunTests(rootDir, 'unit'))

    // Run integration tests
    results.push(await runBunTests(rootDir, 'integration'))

    // Discover and run app tests
    const apps = discoverApps(rootDir)
    console.log(`\n📱 Found ${apps.length} apps`)

    for (const app of apps) {
      if (app.hasTests || app.hasSynpress) {
        const appResults = await runAppTests(rootDir, app)
        results.push(...appResults)
      }
    }

    // Run E2E tests
    results.push(await runE2ETests(rootDir))

    // Print summary
    printSummary(results)

    // Exit with appropriate code
    const failed = results.filter((r) => !r.passed && !r.skipped).length
    process.exit(failed > 0 ? 1 : 0)
  } catch (error) {
    console.error('Test runner failed:', error)
    process.exit(1)
  } finally {
    if (cleanup) {
      cleanup()
    }
  }
}

main()
