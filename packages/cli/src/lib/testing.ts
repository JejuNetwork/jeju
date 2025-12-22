/**
 * Test orchestration utilities
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import type {
  AppManifest,
  AppTestConfig,
  TestPhase,
  TestResult,
} from '../types'
import { checkRpcHealth } from './chain'
import { logger } from './logger'

/**
 * Generates a playwright or synpress config file from manifest settings.
 * Allows apps to skip having config files if they follow standard conventions.
 */
export function generateConfigFromManifest(
  appName: string,
  appDir: string,
  manifest: AppManifest,
  type: 'playwright' | 'synpress',
): string | null {
  const testing = manifest.testing as AppTestConfig | undefined
  if (!testing?.e2e) return null

  const port = manifest.ports?.main ?? manifest.ports?.frontend ?? 3000
  const testDir = type === 'synpress' ? './tests/synpress' : './tests/e2e'
  const timeout = testing.e2e.timeout ?? 120000

  const configContent =
    type === 'synpress'
      ? generateSynpressConfig(appName, port, testDir, timeout, manifest)
      : generatePlaywrightConfig(appName, port, testDir, timeout, manifest)

  // Write to .jeju directory (ephemeral)
  const jejuDir = join(appDir, '.jeju')
  mkdirSync(jejuDir, { recursive: true })

  const configPath = join(jejuDir, `${type}.config.generated.ts`)
  writeFileSync(configPath, configContent)

  return configPath
}

function generateSynpressConfig(
  appName: string,
  port: number,
  testDir: string,
  timeout: number,
  manifest: AppManifest,
): string {
  const devCommand = manifest.commands?.dev ?? 'bun run dev'

  return `/**
 * Auto-generated Synpress config for ${appName}
 * Generated from jeju-manifest.json
 */
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests'

const PORT = parseInt(process.env.PORT || '${port}', 10)

export default createSynpressConfig({
  appName: '${appName}',
  port: PORT,
  testDir: '${testDir}',
  timeout: ${timeout},
  overrides: {
    webServer: {
      command: '${devCommand}',
      url: \`http://localhost:\${PORT}\`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
`
}

function generatePlaywrightConfig(
  appName: string,
  port: number,
  testDir: string,
  timeout: number,
  manifest: AppManifest,
): string {
  const devCommand = manifest.commands?.dev ?? 'bun run dev'

  return `/**
 * Auto-generated Playwright config for ${appName}
 * Generated from jeju-manifest.json
 */
import { createAppConfig } from '@jejunetwork/tests'

const PORT = parseInt(process.env.PORT || '${port}', 10)

export default createAppConfig({
  name: '${appName}',
  port: PORT,
  testDir: '${testDir}',
  timeout: ${timeout},
  webServer: {
    command: '${devCommand}',
    timeout: 120000,
  },
})
`
}

/**
 * Gets the appropriate test config file for an app.
 * Returns the app's config if it exists, otherwise generates one from manifest.
 */
export function getTestConfig(
  appName: string,
  appDir: string,
  manifest: AppManifest,
  type: 'playwright' | 'synpress',
): { configPath: string; generated: boolean } | null {
  const configFileName =
    type === 'synpress' ? 'synpress.config.ts' : 'playwright.config.ts'
  const existingConfig = join(appDir, configFileName)

  // Use existing config if available
  if (existsSync(existingConfig)) {
    return { configPath: existingConfig, generated: false }
  }

  // Generate from manifest
  const generatedPath = generateConfigFromManifest(
    appName,
    appDir,
    manifest,
    type,
  )
  if (generatedPath) {
    return { configPath: generatedPath, generated: true }
  }

  return null
}

export interface TestOptions {
  phase?: string
  app?: string
  ci?: boolean
  coverage?: boolean
  watch?: boolean
  verbose?: boolean
}

const TEST_PHASES: TestPhase[] = [
  {
    name: 'preflight',
    description: 'Chain connectivity and health checks',
    command: 'bun run packages/tests/shared/preflight.ts',
    timeout: 30000,
    required: true,
  },
  {
    name: 'contracts',
    description: 'Solidity smart contract tests',
    command: 'forge test -vv',
    cwd: 'packages/contracts',
    timeout: 120000,
    required: true,
  },
  {
    name: 'unit',
    description: 'TypeScript unit tests',
    command: 'bun test packages/deployment/scripts/shared/',
    timeout: 60000,
    required: false,
  },
  {
    name: 'packages',
    description: 'Package tests (config, types)',
    command: 'bun test packages/config/',
    timeout: 30000,
    required: false,
  },
  {
    name: 'integration',
    description: 'Cross-service integration tests',
    command: 'bun test packages/tests/integration/',
    timeout: 180000,
    required: false,
  },
  {
    name: 'e2e',
    description: 'Playwright E2E tests',
    command: 'bunx playwright test',
    timeout: 300000,
    required: false,
  },
  {
    name: 'wallet',
    description: 'Synpress wallet tests',
    command: 'bunx playwright test --config synpress.config.ts',
    timeout: 600000,
    required: false,
  },
]

export function getTestPhases(options: TestOptions): TestPhase[] {
  if (options.phase) {
    const phase = TEST_PHASES.find((p) => p.name === options.phase)
    if (!phase) {
      throw new Error(
        `Unknown test phase: ${options.phase}. Available: ${TEST_PHASES.map((p) => p.name).join(', ')}`,
      )
    }
    return [phase]
  }

  // By default, run preflight + contracts + unit
  // Skip wallet tests unless explicitly requested
  return TEST_PHASES.filter((p) => p.name !== 'wallet' && p.name !== 'e2e')
}

export async function runPreflightChecks(
  _rootDir: string,
  rpcUrl: string,
): Promise<TestResult> {
  const startTime = Date.now()

  logger.step('Running preflight checks...')

  // Check RPC connectivity
  const rpcHealthy = await checkRpcHealth(rpcUrl, 5000)
  if (!rpcHealthy) {
    return {
      name: 'preflight',
      passed: false,
      duration: Date.now() - startTime,
      output: `RPC not responding: ${rpcUrl}`,
    }
  }

  logger.success('Chain is healthy')

  return {
    name: 'preflight',
    passed: true,
    duration: Date.now() - startTime,
  }
}

export async function runTestPhase(
  phase: TestPhase,
  rootDir: string,
  options: TestOptions,
): Promise<TestResult> {
  const startTime = Date.now()
  const cwd = phase.cwd ? join(rootDir, phase.cwd) : rootDir

  logger.step(`Running ${phase.name}: ${phase.description}`)
  logger.debug(`Command: ${phase.command}`)
  logger.debug(`Directory: ${cwd}`)

  // Check if required files exist
  if (!existsSync(cwd)) {
    logger.warn(`Directory not found: ${cwd}`)
    return {
      name: phase.name,
      passed: true,
      duration: Date.now() - startTime,
      skipped: true,
      output: 'Skipped (directory not found)',
    }
  }

  try {
    const result = await execa('sh', ['-c', phase.command], {
      cwd,
      timeout: phase.timeout,
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        CI: options.ci ? 'true' : undefined,
      },
    })

    const duration = Date.now() - startTime
    logger.success(`${phase.name} passed (${(duration / 1000).toFixed(2)}s)`)

    return {
      name: phase.name,
      passed: true,
      duration,
      output: result.stdout,
    }
  } catch (error) {
    const duration = Date.now() - startTime
    const err = error as { stdout?: string; stderr?: string; message?: string }

    if (phase.required) {
      logger.error(`${phase.name} failed (required)`)
    } else {
      logger.warn(`${phase.name} failed (optional)`)
    }

    return {
      name: phase.name,
      passed: false,
      duration,
      output: err.stderr || err.stdout || err.message || 'Unknown error',
    }
  }
}

export async function runAppTests(
  appName: string,
  rootDir: string,
  options: TestOptions,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  // Find app directory
  const appPaths = [
    join(rootDir, 'apps', appName),
    join(rootDir, 'vendor', appName),
  ]

  let appDir: string | null = null
  for (const path of appPaths) {
    if (existsSync(path)) {
      appDir = path
      break
    }
  }

  if (!appDir) {
    throw new Error(`App not found: ${appName}`)
  }

  // Check for package.json
  const pkgPath = join(appDir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found in ${appDir}`)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    scripts?: Record<string, string>
  }

  // Load manifest for config generation
  const manifestPath = join(appDir, 'jeju-manifest.json')
  const manifest: AppManifest | null = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppManifest)
    : null

  // Run unit tests if available
  if (pkg.scripts?.test) {
    const phase: TestPhase = {
      name: `${appName}-unit`,
      description: `Unit tests for ${appName}`,
      command: 'bun run test',
      cwd: appDir,
      timeout: 120000,
    }
    results.push(await runTestPhase(phase, rootDir, options))
  }

  // Run playwright tests (from config file or generated from manifest)
  const playwrightConfig = manifest
    ? getTestConfig(appName, appDir, manifest, 'playwright')
    : existsSync(join(appDir, 'playwright.config.ts'))
      ? { configPath: join(appDir, 'playwright.config.ts'), generated: false }
      : null

  if (playwrightConfig) {
    const configArg = playwrightConfig.generated
      ? `--config ${playwrightConfig.configPath}`
      : ''
    const phase: TestPhase = {
      name: `${appName}-e2e`,
      description: `E2E tests for ${appName}${playwrightConfig.generated ? ' (manifest-based)' : ''}`,
      command: `bunx playwright test ${configArg}`.trim(),
      cwd: appDir,
      timeout: 300000,
    }
    results.push(await runTestPhase(phase, rootDir, options))
  }

  // Run synpress tests (from config file or generated from manifest)
  const synpressConfig = manifest
    ? getTestConfig(appName, appDir, manifest, 'synpress')
    : existsSync(join(appDir, 'synpress.config.ts'))
      ? { configPath: join(appDir, 'synpress.config.ts'), generated: false }
      : null

  if (synpressConfig) {
    const configPath = synpressConfig.generated
      ? synpressConfig.configPath
      : 'synpress.config.ts'
    const phase: TestPhase = {
      name: `${appName}-wallet`,
      description: `Wallet tests for ${appName}${synpressConfig.generated ? ' (manifest-based)' : ''}`,
      command: `bunx playwright test --config ${configPath}`,
      cwd: appDir,
      timeout: 600000,
    }
    results.push(await runTestPhase(phase, rootDir, options))
  }

  return results
}

export function discoverApps(
  rootDir: string,
  includeVendor = false,
): AppManifest[] {
  const apps: AppManifest[] = []

  // Only include 'apps' directory by default, vendor apps are optional
  const directories = includeVendor ? ['apps', 'vendor'] : ['apps']

  for (const dir of directories) {
    const baseDir = join(rootDir, dir)
    if (!existsSync(baseDir)) continue

    const entries = readdirSync(baseDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue

      const manifestPath = join(baseDir, entry.name, 'jeju-manifest.json')
      if (!existsSync(manifestPath)) continue

      const manifest = JSON.parse(
        readFileSync(manifestPath, 'utf-8'),
      ) as AppManifest
      // Store the actual directory name for path lookups
      manifest._folderName = entry.name
      apps.push(manifest)
    }
  }

  return apps
}

export function printTestSummary(results: TestResult[]): void {
  logger.newline()
  logger.separator()
  logger.subheader('Test Summary')

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)

  for (const result of results) {
    const icon = result.passed ? '✓' : '✗'
    const status = result.passed ? 'PASS' : 'FAIL'
    const time = `${(result.duration / 1000).toFixed(2)}s`
    logger.info(
      `  ${icon} ${result.name.padEnd(20)} ${status.padEnd(6)} ${time}`,
    )
  }

  logger.separator()
  logger.info(
    `  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`,
  )
  logger.info(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`)
  logger.separator()

  if (failed > 0) {
    logger.error(`${failed} test(s) failed`)
  } else {
    logger.success('All tests passed')
  }
}
