#!/usr/bin/env bun
/**
 * Test Analysis Subagent
 *
 * Analyzes all apps and packages for:
 * - Test coverage gaps
 * - Mock usage that should be replaced with real services
 * - Missing E2E tests for pages and flows
 * - CLI integration completeness
 * - CI configuration issues
 *
 * Usage:
 *   bun run packages/tests/subagents/index.ts
 *   jeju test analyze
 *   jeju test analyze --app gateway
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AnalysisResult,
  AnalysisSummary,
  AppTestingInfo,
  MockInfo,
  Recommendation,
  SubagentConfig,
  TestFileInfo,
  TestIssue,
} from './types'

const MOCK_PATTERNS = [
  /jest\.mock\(/g,
  /vi\.mock\(/g,
  /vitest\.mock\(/g,
  /sinon\.stub\(/g,
  /sinon\.fake\(/g,
  /createMock\(/g,
  /mockImplementation\(/g,
  /\.mockReturnValue\(/g,
  /\.mockResolvedValue\(/g,
  /__mocks__/g,
] as const

const REAL_CHAIN_PATTERNS = [
  /JEJU_RPC_URL/,
  /L2_RPC_URL/,
  /localnet/i,
  /anvil/i,
  /http:\/\/127\.0\.0\.1/,
  /http:\/\/localhost/,
  /createPublicClient/,
  /createWalletClient/,
] as const

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

function discoverDirectories(basePath: string): string[] {
  if (!existsSync(basePath)) return []

  return readdirSync(basePath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
}

function findTestFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        findTestFiles(fullPath, files)
      }
    } else if (
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.spec.ts') ||
      entry.name.endsWith('.test.tsx') ||
      entry.name.endsWith('.spec.tsx')
    ) {
      files.push(fullPath)
    }
  }

  return files
}

function analyzeTestFile(filePath: string): TestFileInfo {
  const content = readFileSync(filePath, 'utf-8')
  const relativePath = filePath.replace(findMonorepoRoot(), '')

  // Determine test type
  let type: TestFileInfo['type'] = 'unit'
  if (filePath.includes('/e2e/') || filePath.includes('.e2e.')) {
    type = 'e2e'
  } else if (
    filePath.includes('/integration/') ||
    filePath.includes('.integration.')
  ) {
    type = 'integration'
  } else if (filePath.includes('/synpress/') || filePath.includes('synpress')) {
    type = 'synpress'
  } else if (
    filePath.includes('playwright') ||
    content.includes('@playwright/test')
  ) {
    type = 'playwright'
  }

  // Count tests
  const testMatches = content.match(/(?:it|test)\s*\(/g)
  const testCount = testMatches?.length ?? 0

  // Check for mocks
  const hasMocks = MOCK_PATTERNS.some((pattern) => pattern.test(content))

  // Check for real chain usage
  const hasRealChain = REAL_CHAIN_PATTERNS.some((pattern) =>
    pattern.test(content),
  )

  // Check if skipped
  const isSkipped =
    /\.skip\s*\(/.test(content) || /describe\.skip/.test(content)

  return {
    path: relativePath,
    type,
    testCount,
    hasMocks,
    hasRealChain,
    isSkipped,
  }
}

function findMocksInFile(filePath: string): MockInfo[] {
  const mocks: MockInfo[] = []
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    for (const pattern of MOCK_PATTERNS) {
      if (pattern.test(line)) {
        const type = pattern.source.includes('jest')
          ? 'jest.mock'
          : pattern.source.includes('vi')
            ? 'vitest.mock'
            : pattern.source.includes('sinon')
              ? 'stub'
              : 'manual'

        // Extract mock target
        const targetMatch = line.match(/mock\(['"]([^'"]+)['"]/i)
        const target = targetMatch?.[1] ?? 'unknown'

        // Determine if replaceable
        const canBeReplaced =
          !target.includes('fs') &&
          !target.includes('child_process') &&
          !target.includes('net') &&
          !target.includes('crypto') &&
          !target.startsWith('.')

        mocks.push({
          file: filePath,
          line: index + 1,
          type: type as MockInfo['type'],
          target,
          canBeReplaced,
          replacement: canBeReplaced
            ? 'Use real service against localnet'
            : undefined,
        })
        break
      }
    }
  })

  return mocks
}

function analyzeApp(appPath: string, name: string): AppTestingInfo {
  const manifestPath = join(appPath, 'jeju-manifest.json')
  const testDirs: string[] = []
  const issues: TestIssue[] = []

  // Check for test directories
  const possibleTestDirs = ['tests', 'test', '__tests__', 'src/__tests__']
  for (const dir of possibleTestDirs) {
    const fullPath = join(appPath, dir)
    if (existsSync(fullPath)) {
      testDirs.push(dir)
    }
  }

  // Find all test files
  const testFiles = findTestFiles(appPath).map(analyzeTestFile)

  // Find all mocks
  const mocks: MockInfo[] = []
  for (const file of findTestFiles(appPath)) {
    mocks.push(...findMocksInFile(file))
  }

  // Check for configs
  const hasPlaywrightConfig = existsSync(join(appPath, 'playwright.config.ts'))
  const hasSynpressConfig = existsSync(join(appPath, 'synpress.config.ts'))

  // Categorize tests
  const hasUnitTests = testFiles.some((f) => f.type === 'unit')
  const hasIntegrationTests = testFiles.some((f) => f.type === 'integration')
  const hasE2ETests = testFiles.some(
    (f) => f.type === 'e2e' || f.type === 'playwright',
  )
  const hasSynpressTests = testFiles.some((f) => f.type === 'synpress')

  // Generate issues
  if (!hasUnitTests) {
    issues.push({
      severity: 'warning',
      type: 'missing_tests',
      message: 'No unit tests found',
      suggestion: 'Add unit tests for business logic',
    })
  }

  if (!hasE2ETests && !hasSynpressTests) {
    issues.push({
      severity: 'warning',
      type: 'missing_tests',
      message: 'No E2E or Synpress tests found',
      suggestion:
        'Add E2E tests using Playwright or Synpress for wallet interactions',
    })
  }

  const mocksWithReplacement = mocks.filter((m) => m.canBeReplaced)
  if (mocksWithReplacement.length > 0) {
    issues.push({
      severity: 'info',
      type: 'mock_usage',
      message: `${mocksWithReplacement.length} mocks could be replaced with real services`,
      suggestion:
        'Replace mocks with real localnet services for better test fidelity',
    })
  }

  const testsWithoutChain = testFiles.filter(
    (f) => f.type !== 'unit' && !f.hasRealChain,
  )
  if (testsWithoutChain.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'no_chain',
      message: `${testsWithoutChain.length} integration/E2E tests don't use real chain`,
      suggestion: 'Connect tests to localnet for realistic testing',
    })
  }

  if (!hasSynpressConfig && hasE2ETests) {
    issues.push({
      severity: 'info',
      type: 'config_missing',
      message: 'Has E2E tests but no synpress.config.ts',
      suggestion: 'Add synpress.config.ts for wallet integration testing',
    })
  }

  return {
    name,
    path: appPath,
    manifestPath,
    hasUnitTests,
    hasIntegrationTests,
    hasE2ETests,
    hasSynpressTests,
    hasPlaywrightConfig,
    hasSynpressConfig,
    testDirectories: testDirs,
    testFiles,
    mocks,
    coverage: { lines: 0, functions: 0, branches: 0, hasReport: false },
    issues,
  }
}

function generateRecommendations(
  apps: AppTestingInfo[],
  packages: AppTestingInfo[],
): Recommendation[] {
  const recommendations: Recommendation[] = []
  const all = [...apps, ...packages]

  // Check for apps without E2E tests
  const appsWithoutE2E = apps.filter(
    (a) => !a.hasE2ETests && !a.hasSynpressTests,
  )
  if (appsWithoutE2E.length > 0) {
    recommendations.push({
      priority: 'critical',
      category: 'e2e',
      title: 'Add E2E tests to apps without them',
      description: `${appsWithoutE2E.length} apps have no E2E tests. These are critical for validating user flows.`,
      affectedApps: appsWithoutE2E.map((a) => a.name),
      effort: 'large',
      steps: [
        'Create synpress.config.ts using @jejunetwork/tests base config',
        'Create tests/synpress directory',
        'Add basic.setup.ts for wallet initialization',
        'Create tests for all user-facing pages and flows',
        'Connect all tests to localnet (no mocks)',
      ],
    })
  }

  // Check for excessive mock usage
  const appsWithManyMocks = all.filter(
    (a) => a.mocks.filter((m) => m.canBeReplaced).length > 5,
  )
  if (appsWithManyMocks.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'mocks',
      title: 'Replace mocks with real services',
      description:
        'Several apps use excessive mocking. Replace with real localnet services.',
      affectedApps: appsWithManyMocks.map((a) => a.name),
      effort: 'medium',
      steps: [
        'Identify mocks that can be replaced',
        'Ensure localnet is started before tests',
        'Use @jejunetwork/tests utilities for chain interaction',
        'Remove mocks and connect to real services',
        'Validate tests pass against localnet',
      ],
    })
  }

  // Check for missing integration tests
  const packagesWithoutIntegration = packages.filter(
    (p) => !p.hasIntegrationTests,
  )
  if (packagesWithoutIntegration.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'coverage',
      title: 'Add integration tests to packages',
      description:
        'Core packages need integration tests to validate cross-component behavior.',
      affectedApps: packagesWithoutIntegration.map((p) => p.name),
      effort: 'medium',
      steps: [
        'Identify key integration points',
        'Create tests that exercise real service interactions',
        'Use docker-compose.test.yml for service dependencies',
        'Validate against real databases and services',
      ],
    })
  }

  return recommendations
}

function generateSummary(
  apps: AppTestingInfo[],
  packages: AppTestingInfo[],
): AnalysisSummary {
  const all = [...apps, ...packages]
  const allTestFiles = all.flatMap((a) => a.testFiles)
  const allMocks = all.flatMap((a) => a.mocks)
  const allIssues = all.flatMap((a) => a.issues)

  const issuesByType: Record<string, number> = {}
  for (const issue of allIssues) {
    issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1
  }

  return {
    totalApps: apps.length,
    totalPackages: packages.length,
    appsWithTests: apps.filter((a) => a.testFiles.length > 0).length,
    packagesWithTests: packages.filter((p) => p.testFiles.length > 0).length,
    totalTestFiles: allTestFiles.length,
    totalMocks: allMocks.length,
    mocksReplaceable: allMocks.filter((m) => m.canBeReplaced).length,
    totalIssues: allIssues.length,
    issuesByType,
    coverageAverage: 0,
  }
}

async function runAnalysis(config: SubagentConfig): Promise<AnalysisResult> {
  const rootDir = config.rootDir

  console.log('🔍 Analyzing test coverage across all apps and packages...\n')

  // Discover apps
  const appsDir = join(rootDir, 'apps')
  const appNames = config.targetApp
    ? [config.targetApp]
    : discoverDirectories(appsDir)

  console.log(`📱 Found ${appNames.length} apps to analyze`)

  const apps = appNames
    .filter((name) => existsSync(join(appsDir, name, 'package.json')))
    .map((name) => {
      console.log(`  Analyzing ${name}...`)
      return analyzeApp(join(appsDir, name), name)
    })

  // Discover packages
  const packagesDir = join(rootDir, 'packages')
  const packageNames = discoverDirectories(packagesDir)

  console.log(`\n📦 Found ${packageNames.length} packages to analyze`)

  const packages = packageNames
    .filter((name) => existsSync(join(packagesDir, name, 'package.json')))
    .map((name) => {
      console.log(`  Analyzing ${name}...`)
      return analyzeApp(join(packagesDir, name), name)
    })

  // Generate recommendations
  const recommendations = generateRecommendations(apps, packages)

  // Generate summary
  const summary = generateSummary(apps, packages)

  const result: AnalysisResult = {
    timestamp: new Date().toISOString(),
    apps,
    packages,
    summary,
    recommendations,
  }

  // Print results
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 ANALYSIS SUMMARY')
  console.log('='.repeat(60))
  console.log(
    `\nApps: ${summary.appsWithTests}/${summary.totalApps} with tests`,
  )
  console.log(
    `Packages: ${summary.packagesWithTests}/${summary.totalPackages} with tests`,
  )
  console.log(`Total test files: ${summary.totalTestFiles}`)
  console.log(
    `Total mocks: ${summary.totalMocks} (${summary.mocksReplaceable} replaceable)`,
  )
  console.log(`Total issues: ${summary.totalIssues}`)

  if (Object.keys(summary.issuesByType).length > 0) {
    console.log('\nIssues by type:')
    for (const [type, count] of Object.entries(summary.issuesByType)) {
      console.log(`  ${type}: ${count}`)
    }
  }

  if (recommendations.length > 0) {
    console.log(`\n${'='.repeat(60)}`)
    console.log('📋 RECOMMENDATIONS')
    console.log('='.repeat(60))

    for (const rec of recommendations) {
      const priorityIcon =
        rec.priority === 'critical'
          ? '🔴'
          : rec.priority === 'high'
            ? '🟠'
            : rec.priority === 'medium'
              ? '🟡'
              : '🟢'

      console.log(
        `\n${priorityIcon} [${rec.priority.toUpperCase()}] ${rec.title}`,
      )
      console.log(`   ${rec.description}`)
      console.log(`   Affected: ${rec.affectedApps.join(', ')}`)
      console.log(`   Effort: ${rec.effort}`)
      console.log('   Steps:')
      for (const step of rec.steps) {
        console.log(`     • ${step}`)
      }
    }
  }

  // Print apps without tests
  const appsWithoutAnyTests = apps.filter((a) => a.testFiles.length === 0)
  if (appsWithoutAnyTests.length > 0) {
    console.log(`\n${'='.repeat(60)}`)
    console.log('⚠️  APPS WITHOUT ANY TESTS')
    console.log('='.repeat(60))
    for (const app of appsWithoutAnyTests) {
      console.log(`  • ${app.name}`)
    }
  }

  // Print mock analysis
  const appsWithMocks = [...apps, ...packages].filter((a) => a.mocks.length > 0)
  if (appsWithMocks.length > 0 && config.verbose) {
    console.log(`\n${'='.repeat(60)}`)
    console.log('🎭 MOCK ANALYSIS')
    console.log('='.repeat(60))
    for (const app of appsWithMocks) {
      const replaceableMocks = app.mocks.filter((m) => m.canBeReplaced)
      if (replaceableMocks.length > 0) {
        console.log(
          `\n${app.name}: ${replaceableMocks.length} replaceable mocks`,
        )
        for (const mock of replaceableMocks.slice(0, 5)) {
          console.log(`  • ${mock.target} (${mock.file}:${mock.line})`)
        }
        if (replaceableMocks.length > 5) {
          console.log(`  ... and ${replaceableMocks.length - 5} more`)
        }
      }
    }
  }

  return result
}

// Main execution
const config: SubagentConfig = {
  rootDir: findMonorepoRoot(),
  targetApp: process.env.TARGET_APP || undefined,
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  fix: process.argv.includes('--fix'),
  dryRun: process.argv.includes('--dry-run'),
}

runAnalysis(config)
  .then(() => {
    console.log('\n✅ Analysis complete')
  })
  .catch((error) => {
    console.error('Analysis failed:', error)
    process.exit(1)
  })

