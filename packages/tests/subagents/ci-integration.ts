#!/usr/bin/env bun
/**
 * CI Integration Subagent
 *
 * Validates and generates CI configuration for testing:
 * - GitHub Actions workflows
 * - Test matrix configuration
 * - Service dependencies
 * - Parallel test execution
 *
 * Usage:
 *   bun run packages/tests/subagents/ci-integration.ts
 *   jeju test ci-setup --validate
 *   jeju test ci-setup --generate
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

interface CIConfig {
  name: string
  on: Record<string, unknown>
  jobs: Record<string, CIJob>
}

interface CIJob {
  name: string
  'runs-on': string
  services?: Record<string, CIService>
  steps: CIStep[]
}

interface CIService {
  image: string
  ports?: string[]
  env?: Record<string, string>
  options?: string
}

interface CIStep {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, string>
  env?: Record<string, string>
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  suggestions: string[]
}

interface AppTestConfig {
  name: string
  type: 'unit' | 'integration' | 'e2e' | 'synpress'
  requiresChain: boolean
  requiresServices: string[]
  timeout: number
}

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

function discoverAppTests(rootDir: string): AppTestConfig[] {
  const configs: AppTestConfig[] = []
  const appsDir = join(rootDir, 'apps')

  if (!existsSync(appsDir)) return configs

  const apps = readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)

  for (const app of apps) {
    const appPath = join(appsDir, app)
    const manifestPath = join(appPath, 'jeju-manifest.json')

    if (!existsSync(join(appPath, 'package.json'))) continue

    // Check for test directories
    const hasUnitTests = existsSync(join(appPath, 'tests', 'unit'))
    const hasIntegrationTests = existsSync(
      join(appPath, 'tests', 'integration'),
    )
    const hasE2ETests = existsSync(join(appPath, 'tests', 'e2e'))
    const hasSynpressTests =
      existsSync(join(appPath, 'tests', 'synpress')) ||
      existsSync(join(appPath, 'tests', 'wallet'))

    // Load manifest for requirements
    let requiresChain = false
    let requiresServices: string[] = []
    let timeout = 60000

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const testing = manifest.testing as
        | {
            services?: string[]
            e2e?: { requiresChain?: boolean; timeout?: number }
          }
        | undefined

      requiresChain = testing?.e2e?.requiresChain ?? false
      requiresServices = testing?.services ?? []
      timeout = testing?.e2e?.timeout ?? 60000
    }

    if (hasUnitTests) {
      configs.push({
        name: app,
        type: 'unit',
        requiresChain: false,
        requiresServices: [],
        timeout: 30000,
      })
    }

    if (hasIntegrationTests) {
      configs.push({
        name: app,
        type: 'integration',
        requiresChain: true,
        requiresServices: ['postgres', 'redis'],
        timeout: 120000,
      })
    }

    if (hasE2ETests) {
      configs.push({
        name: app,
        type: 'e2e',
        requiresChain,
        requiresServices,
        timeout,
      })
    }

    if (hasSynpressTests) {
      configs.push({
        name: app,
        type: 'synpress',
        requiresChain: true,
        requiresServices,
        timeout: 180000,
      })
    }
  }

  return configs
}

function validateCIConfig(rootDir: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  }

  const workflowsDir = join(rootDir, '.github', 'workflows')

  if (!existsSync(workflowsDir)) {
    result.errors.push('No .github/workflows directory found')
    result.valid = false
    return result
  }

  const workflows = readdirSync(workflowsDir).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
  )

  if (workflows.length === 0) {
    result.errors.push('No workflow files found')
    result.valid = false
    return result
  }

  // Find test workflow
  const testWorkflow = workflows.find(
    (w) => w.includes('test') || w.includes('ci'),
  )

  if (!testWorkflow) {
    result.warnings.push('No dedicated test workflow found')
    result.suggestions.push(
      'Create a test.yml workflow for comprehensive testing',
    )
  } else {
    const workflowPath = join(workflowsDir, testWorkflow)
    const content = readFileSync(workflowPath, 'utf-8')
    const config = parseYaml(content) as CIConfig

    // Check for required jobs
    const jobs = Object.keys(config.jobs ?? {})

    if (!jobs.some((j) => j.includes('unit'))) {
      result.warnings.push('No unit test job found')
    }

    if (!jobs.some((j) => j.includes('integration'))) {
      result.warnings.push('No integration test job found')
    }

    if (!jobs.some((j) => j.includes('e2e'))) {
      result.warnings.push('No E2E test job found')
    }

    // Check for services
    for (const [jobName, job] of Object.entries(config.jobs ?? {})) {
      if (
        (jobName.includes('integration') || jobName.includes('e2e')) &&
        !job.services
      ) {
        result.suggestions.push(
          `Job '${jobName}' might need services (postgres, redis, anvil)`,
        )
      }
    }

    // Check for anvil/chain
    const hasChain = content.includes('anvil') || content.includes('foundry')
    if (!hasChain) {
      result.suggestions.push('Consider adding Anvil for blockchain testing')
    }

    // Check for proper caching
    if (!content.includes('cache')) {
      result.suggestions.push('Add dependency caching for faster CI runs')
    }

    // Check for parallel execution
    if (!content.includes('matrix')) {
      result.suggestions.push(
        'Consider using matrix strategy for parallel test execution',
      )
    }
  }

  return result
}

function generateCIWorkflow(rootDir: string): string {
  const appTests = discoverAppTests(rootDir)

  // Group tests by type
  const unitTests = appTests.filter((t) => t.type === 'unit')
  const integrationTests = appTests.filter((t) => t.type === 'integration')
  const e2eTests = appTests.filter((t) => t.type === 'e2e')
  const synpressTests = appTests.filter((t) => t.type === 'synpress')

  const workflow: CIConfig = {
    name: 'Test Suite',
    on: {
      push: { branches: ['main', 'develop'] },
      pull_request: { branches: ['main', 'develop'] },
    },
    jobs: {},
  }

  // Unit tests job
  if (unitTests.length > 0) {
    workflow.jobs.unit = {
      name: 'Unit Tests',
      'runs-on': 'ubuntu-latest',
      steps: [
        { uses: 'actions/checkout@v4' },
        {
          name: 'Setup Bun',
          uses: 'oven-sh/setup-bun@v1',
          with: { 'bun-version': 'latest' },
        },
        {
          name: 'Install Dependencies',
          run: 'bun install --frozen-lockfile',
        },
        {
          name: 'Run Unit Tests',
          run: 'jeju test --mode unit',
        },
      ],
    }
  }

  // Integration tests job
  if (integrationTests.length > 0) {
    workflow.jobs.integration = {
      name: 'Integration Tests',
      'runs-on': 'ubuntu-latest',
      services: {
        postgres: {
          image: 'postgres:15',
          env: {
            POSTGRES_USER: 'test',
            POSTGRES_PASSWORD: 'test',
            POSTGRES_DB: 'test',
          },
          ports: ['5432:5432'],
          options:
            '--health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5',
        },
        redis: {
          image: 'redis:7-alpine',
          ports: ['6379:6379'],
          options:
            '--health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5',
        },
      },
      steps: [
        { uses: 'actions/checkout@v4' },
        {
          name: 'Setup Bun',
          uses: 'oven-sh/setup-bun@v1',
          with: { 'bun-version': 'latest' },
        },
        {
          name: 'Install Foundry',
          uses: 'foundry-rs/foundry-toolchain@v1',
        },
        {
          name: 'Install Dependencies',
          run: 'bun install --frozen-lockfile',
        },
        {
          name: 'Start Localnet',
          run: 'anvil --chain-id 1337 --port 6546 --block-time 1 &',
        },
        {
          name: 'Wait for Services',
          run: 'sleep 5',
        },
        {
          name: 'Run Integration Tests',
          run: 'jeju test --mode integration',
          env: {
            L2_RPC_URL: 'http://127.0.0.1:6546',
            DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
            REDIS_URL: 'redis://localhost:6379',
          },
        },
      ],
    }
  }

  // E2E tests job
  if (e2eTests.length > 0 || synpressTests.length > 0) {
    workflow.jobs.e2e = {
      name: 'E2E Tests',
      'runs-on': 'ubuntu-latest',
      services: {
        postgres: {
          image: 'postgres:15',
          env: {
            POSTGRES_USER: 'test',
            POSTGRES_PASSWORD: 'test',
            POSTGRES_DB: 'test',
          },
          ports: ['5432:5432'],
        },
        redis: {
          image: 'redis:7-alpine',
          ports: ['6379:6379'],
        },
      },
      steps: [
        { uses: 'actions/checkout@v4' },
        {
          name: 'Setup Bun',
          uses: 'oven-sh/setup-bun@v1',
          with: { 'bun-version': 'latest' },
        },
        {
          name: 'Install Foundry',
          uses: 'foundry-rs/foundry-toolchain@v1',
        },
        {
          name: 'Install Dependencies',
          run: 'bun install --frozen-lockfile',
        },
        {
          name: 'Install Playwright Browsers',
          run: 'bunx playwright install chromium --with-deps',
        },
        {
          name: 'Start Localnet',
          run: 'anvil --chain-id 1337 --port 6546 --block-time 1 &',
        },
        {
          name: 'Deploy Contracts',
          run: 'jeju deploy localnet',
          env: {
            L2_RPC_URL: 'http://127.0.0.1:6546',
          },
        },
        {
          name: 'Run E2E Tests',
          run: 'jeju test e2e --headless',
          env: {
            L2_RPC_URL: 'http://127.0.0.1:6546',
            CI: 'true',
          },
        },
        {
          name: 'Upload Test Results',
          uses: 'actions/upload-artifact@v4',
          with: {
            name: 'playwright-report',
            path: 'test-results/',
          },
        },
      ],
    }
  }

  // Contract tests job
  workflow.jobs.contracts = {
    name: 'Contract Tests',
    'runs-on': 'ubuntu-latest',
    steps: [
      { uses: 'actions/checkout@v4', with: { submodules: 'recursive' } },
      {
        name: 'Install Foundry',
        uses: 'foundry-rs/foundry-toolchain@v1',
      },
      {
        name: 'Run Forge Tests',
        run: 'cd packages/contracts && forge test -vvv',
      },
    ],
  }

  return stringifyYaml(workflow, { indent: 2 })
}

async function main(): Promise<void> {
  const rootDir = findMonorepoRoot()
  const args = process.argv.slice(2)

  const shouldValidate = args.includes('--validate')
  const shouldGenerate = args.includes('--generate')

  if (shouldValidate) {
    console.log('🔍 Validating CI configuration...\n')

    const result = validateCIConfig(rootDir)

    if (result.errors.length > 0) {
      console.log('❌ Errors:')
      for (const error of result.errors) {
        console.log(`  • ${error}`)
      }
    }

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:')
      for (const warning of result.warnings) {
        console.log(`  • ${warning}`)
      }
    }

    if (result.suggestions.length > 0) {
      console.log('\n💡 Suggestions:')
      for (const suggestion of result.suggestions) {
        console.log(`  • ${suggestion}`)
      }
    }

    if (result.valid && result.warnings.length === 0) {
      console.log('✅ CI configuration is valid')
    }
  }

  if (shouldGenerate) {
    console.log('🔧 Generating CI workflow...\n')

    const workflow = generateCIWorkflow(rootDir)
    const outputPath = join(rootDir, '.github', 'workflows', 'test.yml')

    mkdirSync(join(rootDir, '.github', 'workflows'), { recursive: true })
    writeFileSync(outputPath, workflow)

    console.log(`✅ Generated: ${outputPath}`)
    console.log('\nWorkflow preview:')
    console.log('='.repeat(60))
    console.log(workflow)
  }

  if (!shouldValidate && !shouldGenerate) {
    console.log('Usage:')
    console.log('  jeju test ci-setup --validate   Validate existing CI config')
    console.log('  jeju test ci-setup --generate   Generate new CI config')
  }
}

main().catch((error) => {
  console.error('CI integration failed:', error)
  process.exit(1)
})
