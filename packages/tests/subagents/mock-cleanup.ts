#!/usr/bin/env bun
/**
 * Mock Cleanup Subagent
 *
 * Identifies and removes unnecessary mocks, stubs, and abstractions.
 * Replaces them with real service connections to localnet.
 *
 * Usage:
 *   bun run packages/tests/subagents/mock-cleanup.ts
 *   jeju test cleanup-mocks --app gateway
 *   jeju test cleanup-mocks --dry-run
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface MockLocation {
  file: string
  line: number
  column: number
  type: 'jest' | 'vitest' | 'sinon' | 'manual' | 'stub'
  target: string
  fullMatch: string
  canReplace: boolean
  replacement?: string
  reason?: string
}

interface CleanupResult {
  file: string
  mocksFound: number
  mocksRemoved: number
  mocksKept: number
  changes: MockChange[]
}

interface MockChange {
  line: number
  before: string
  after: string
  reason: string
}

const MOCK_PATTERNS: Array<{
  pattern: RegExp
  type: MockLocation['type']
  extractor: (match: RegExpMatchArray) => string
}> = [
  {
    pattern: /jest\.mock\s*\(\s*['"]([^'"]+)['"]/g,
    type: 'jest',
    extractor: (m) => m[1],
  },
  {
    pattern: /vi\.mock\s*\(\s*['"]([^'"]+)['"]/g,
    type: 'vitest',
    extractor: (m) => m[1],
  },
  {
    pattern: /sinon\.stub\s*\(\s*(\w+)/g,
    type: 'sinon',
    extractor: (m) => m[1],
  },
  {
    pattern: /\.mockReturnValue\s*\(/g,
    type: 'manual',
    extractor: () => 'mockReturnValue',
  },
  {
    pattern: /\.mockResolvedValue\s*\(/g,
    type: 'manual',
    extractor: () => 'mockResolvedValue',
  },
  {
    pattern: /\.mockImplementation\s*\(/g,
    type: 'manual',
    extractor: () => 'mockImplementation',
  },
]

// Mocks that should NOT be removed (system-level)
const KEEP_MOCKS = [
  'fs',
  'fs/promises',
  'child_process',
  'net',
  'crypto',
  'timers',
  'process',
  '@/mocks/',
  '__mocks__/',
]

// Replacements for common mocks
const MOCK_REPLACEMENTS: Record<string, string> = {
  viem: `import { createPublicClient, http } from 'viem'
import { JEJU_RPC_URL } from '@jejunetwork/tests'

const client = createPublicClient({
  transport: http(JEJU_RPC_URL),
})`,
  ethers: `import { ethers } from 'ethers'
import { JEJU_RPC_URL } from '@jejunetwork/tests'

const provider = new ethers.JsonRpcProvider(JEJU_RPC_URL)`,
  wagmi: `// Use real wagmi with localnet configuration
import { JEJU_CHAIN } from '@jejunetwork/tests'
// Configure wagmi to use localnet`,
  fetch: `// Use real fetch - localnet services should be running
// Ensure docker-compose.test.yml services are started`,
  database: `// Use real database connection
import { createTestDatabase } from '@jejunetwork/tests'
const db = await createTestDatabase()`,
  redis: `// Use real Redis from docker-compose.test.yml
const redis = new Redis({ host: '127.0.0.1', port: 6379 })`,
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

function findMocksInFile(filePath: string): MockLocation[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const mocks: MockLocation[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    for (const { pattern, type, extractor } of MOCK_PATTERNS) {
      // Reset regex lastIndex
      pattern.lastIndex = 0

      let match: RegExpExecArray | null = pattern.exec(line)
      while (match !== null) {
        const target = extractor(match)
        const shouldKeep = KEEP_MOCKS.some((k) => target.includes(k))

        // Find replacement
        let replacement: string | undefined
        for (const [key, value] of Object.entries(MOCK_REPLACEMENTS)) {
          if (target.toLowerCase().includes(key.toLowerCase())) {
            replacement = value
            break
          }
        }

        mocks.push({
          file: filePath,
          line: i + 1,
          column: match.index,
          type,
          target,
          fullMatch: match[0],
          canReplace: !shouldKeep,
          replacement,
          reason: shouldKeep
            ? 'System-level mock (keep)'
            : 'Can be replaced with real service',
        })
        match = pattern.exec(line)
      }
    }
  }

  return mocks
}

function cleanupFile(
  filePath: string,
  mocks: MockLocation[],
  dryRun: boolean,
): CleanupResult {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const changes: MockChange[] = []

  const replaceable = mocks.filter((m) => m.canReplace)

  for (const mock of replaceable) {
    const lineIndex = mock.line - 1
    const originalLine = lines[lineIndex]

    if (mock.replacement) {
      // Add TODO comment instead of removing
      const commentedLine = `// TODO: Replace mock with real service:\n// ${mock.replacement.split('\n')[0]}\n${originalLine}`

      changes.push({
        line: mock.line,
        before: originalLine,
        after: commentedLine,
        reason: `Replace ${mock.target} mock with real service`,
      })

      if (!dryRun) {
        lines[lineIndex] = commentedLine
      }
    } else {
      // Just add a warning comment
      const warningLine = `// TODO: Review this mock - consider using real service\n${originalLine}`

      changes.push({
        line: mock.line,
        before: originalLine,
        after: warningLine,
        reason: `Review mock for ${mock.target}`,
      })

      if (!dryRun) {
        lines[lineIndex] = warningLine
      }
    }
  }

  if (!dryRun && changes.length > 0) {
    writeFileSync(filePath, lines.join('\n'))
  }

  return {
    file: filePath,
    mocksFound: mocks.length,
    mocksRemoved: 0,
    mocksKept: mocks.filter((m) => !m.canReplace).length,
    changes,
  }
}

async function runCleanup(config: {
  rootDir: string
  targetApp?: string
  dryRun: boolean
  apply: boolean
}): Promise<void> {
  const { rootDir, targetApp, dryRun } = config

  console.log('🧹 Mock Cleanup Analysis\n')
  console.log(dryRun ? '(DRY RUN - no changes will be made)\n' : '')

  // Find directories to scan
  const directories: string[] = []

  if (targetApp) {
    const appPath = join(rootDir, 'apps', targetApp)
    if (existsSync(appPath)) {
      directories.push(appPath)
    }
  } else {
    // Scan all apps and packages
    const appsDir = join(rootDir, 'apps')
    const packagesDir = join(rootDir, 'packages')

    if (existsSync(appsDir)) {
      directories.push(
        ...readdirSync(appsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => join(appsDir, d.name)),
      )
    }

    if (existsSync(packagesDir)) {
      directories.push(
        ...readdirSync(packagesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => join(packagesDir, d.name)),
      )
    }
  }

  let totalMocks = 0
  let totalReplaceable = 0
  let totalKept = 0
  const allResults: CleanupResult[] = []

  for (const dir of directories) {
    const testFiles = findTestFiles(dir)
    const dirName = dir.split('/').pop() || dir

    let dirMocks = 0

    for (const file of testFiles) {
      const mocks = findMocksInFile(file)

      if (mocks.length > 0) {
        dirMocks += mocks.length
        totalMocks += mocks.length
        totalReplaceable += mocks.filter((m) => m.canReplace).length
        totalKept += mocks.filter((m) => !m.canReplace).length

        if (config.apply || dryRun) {
          const result = cleanupFile(file, mocks, dryRun)
          if (result.changes.length > 0) {
            allResults.push(result)
          }
        }
      }
    }

    if (dirMocks > 0) {
      console.log(`📁 ${dirName}: ${dirMocks} mocks found`)
    }
  }

  // Print summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total mocks found: ${totalMocks}`)
  console.log(`Replaceable: ${totalReplaceable}`)
  console.log(`Keep (system-level): ${totalKept}`)

  if (allResults.length > 0) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📝 CHANGES${dryRun ? ' (DRY RUN)' : ''}`)
    console.log('='.repeat(60))

    for (const result of allResults) {
      const relativePath = result.file.replace(rootDir, '')
      console.log(`\n${relativePath}:`)

      for (const change of result.changes) {
        console.log(`  Line ${change.line}: ${change.reason}`)
        if (config.apply) {
          console.log(`    - ${change.before.trim().substring(0, 60)}...`)
          console.log(`    + TODO comment added`)
        }
      }
    }
  }

  // Print recommendations
  console.log(`\n${'='.repeat(60)}`)
  console.log('📋 NEXT STEPS')
  console.log('='.repeat(60))
  console.log(`
1. Review mocks marked with TODO comments
2. Ensure docker-compose.test.yml services are running for tests
3. Replace mocks with real service connections:
   - Use @jejunetwork/tests utilities for chain access
   - Use real database connections from docker-compose
   - Connect to real Redis, PostgreSQL, etc.
4. Run tests with: jeju test integration
5. Verify all tests pass against real services
`)

  console.log('\n✅ Mock cleanup analysis complete')
}

// Parse arguments
const args = process.argv.slice(2)
const appIndex = args.findIndex((a) => a.startsWith('--app='))
const targetApp = appIndex >= 0 ? args[appIndex].split('=')[1] : undefined

const config = {
  rootDir: findMonorepoRoot(),
  targetApp,
  dryRun: args.includes('--dry-run'),
  apply: args.includes('--apply'),
}

runCleanup(config).catch((error) => {
  console.error('Mock cleanup failed:', error)
  process.exit(1)
})
