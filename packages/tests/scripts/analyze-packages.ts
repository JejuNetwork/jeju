#!/usr/bin/env bun
/**
 * Package Analysis Script
 *
 * Analyzes each package in the monorepo for:
 * 1. Business logic and complicated code that needs tests
 * 2. Utils that should be consolidated to shared package
 * 3. Current test coverage
 * 4. Missing integration tests
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

interface FileAnalysis {
  path: string
  lines: number
  hasTests: boolean
  complexity: 'low' | 'medium' | 'high'
  category: 'business-logic' | 'utils' | 'types' | 'config' | 'other'
  shouldBeShared: boolean
  existingTestPath: string | null
}

interface PackageAnalysis {
  name: string
  path: string
  files: FileAnalysis[]
  hasTests: boolean
  testFiles: string[]
  coverage: {
    testedFiles: number
    untestedFiles: number
    percent: number
  }
  recommendations: string[]
  utilsToConsolidate: string[]
}

const _PACKAGES_DIR = join(import.meta.dir, '../../..')
const SHARED_UTILS = [
  'logger',
  'retry',
  'format',
  'validation',
  'schemas',
  'types',
  'constants',
]

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

function getAllTsFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.turbo' ||
        entry.name === 'coverage'
      ) {
        continue
      }
      getAllTsFiles(fullPath, files)
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(fullPath)
    }
  }

  return files
}

function analyzeComplexity(content: string): 'low' | 'medium' | 'high' {
  const lines = content.split('\n').length

  // Count complexity indicators
  let score = 0

  // Async operations
  score += (content.match(/async\s+function|async\s*\(/g) || []).length * 2

  // Control flow complexity
  score += (content.match(/if\s*\(|switch\s*\(|for\s*\(|while\s*\(/g) || [])
    .length

  // Error handling
  score += (content.match(/try\s*{|catch\s*\(/g) || []).length

  // Callbacks and promises
  score += (content.match(/\.then\(|\.catch\(|Promise\./g) || []).length

  // External API calls
  score +=
    (content.match(/fetch\(|axios\.|createPublicClient|ethers\./g) || [])
      .length * 3

  // Crypto operations
  score +=
    (content.match(/sign|encrypt|decrypt|hash|verify/gi) || []).length * 2

  // Contract interactions
  score +=
    (content.match(/writeContract|readContract|simulateContract/g) || [])
      .length * 3

  if (score > 30 || lines > 300) return 'high'
  if (score > 15 || lines > 150) return 'medium'
  return 'low'
}

function categorizeFile(
  filePath: string,
  content: string,
): FileAnalysis['category'] {
  const name = filePath.toLowerCase()

  if (name.includes('/types') || name.endsWith('types.ts')) return 'types'
  if (name.includes('/config') || name.includes('config.ts')) return 'config'
  if (name.includes('/utils') || name.includes('helpers')) return 'utils'

  // Check content for business logic indicators
  const hasBusinessLogic =
    content.includes('async function') ||
    content.includes('export async') ||
    content.includes('class ') ||
    content.includes('execute') ||
    content.includes('process') ||
    content.includes('validate')

  if (hasBusinessLogic) return 'business-logic'

  return 'other'
}

function shouldBeInShared(filePath: string, content: string): boolean {
  const name = filePath.toLowerCase()

  // Check if file contains generic utilities
  for (const util of SHARED_UTILS) {
    if (name.includes(util) && !filePath.includes('packages/shared')) {
      // Check if it's truly generic
      const hasPackageSpecificLogic =
        content.includes('@jejunetwork/') ||
        (content.includes('import {') && content.includes("from '."))

      if (!hasPackageSpecificLogic) {
        return true
      }
    }
  }

  return false
}

function findTestFile(srcPath: string): string | null {
  const baseName = srcPath.replace(/\.tsx?$/, '')

  const testPatterns = [
    `${baseName}.test.ts`,
    `${baseName}.test.tsx`,
    `${baseName}.spec.ts`,
    `${baseName}.spec.tsx`,
    srcPath.replace('/src/', '/tests/').replace(/\.tsx?$/, '.test.ts'),
    srcPath.replace('/src/', '/__tests__/').replace(/\.tsx?$/, '.test.ts'),
  ]

  for (const pattern of testPatterns) {
    if (existsSync(pattern)) {
      return pattern
    }
  }

  return null
}

function analyzePackage(packagePath: string): PackageAnalysis | null {
  const packageJsonPath = join(packagePath, 'package.json')
  if (!existsSync(packageJsonPath)) return null

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const srcDir = join(packagePath, 'src')

  if (!existsSync(srcDir)) {
    return null
  }

  const allFiles = getAllTsFiles(srcDir)
  const testFiles = allFiles.filter(
    (f) =>
      f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'),
  )

  const srcFiles = allFiles.filter(
    (f) =>
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('__tests__'),
  )

  const fileAnalyses: FileAnalysis[] = []
  const utilsToConsolidate: string[] = []

  for (const file of srcFiles) {
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n').length
    const complexity = analyzeComplexity(content)
    const category = categorizeFile(file, content)
    const shouldBeShared = shouldBeInShared(file, content)
    const existingTestPath = findTestFile(file)

    if (shouldBeShared) {
      utilsToConsolidate.push(relative(packagePath, file))
    }

    fileAnalyses.push({
      path: relative(packagePath, file),
      lines,
      hasTests: !!existingTestPath,
      complexity,
      category,
      shouldBeShared,
      existingTestPath,
    })
  }

  const testedFiles = fileAnalyses.filter((f) => f.hasTests).length
  const untestedFiles = fileAnalyses.filter((f) => !f.hasTests).length

  // Generate recommendations
  const recommendations: string[] = []

  const untestedHighComplexity = fileAnalyses.filter(
    (f) => !f.hasTests && f.complexity === 'high',
  )
  const untestedBusinessLogic = fileAnalyses.filter(
    (f) => !f.hasTests && f.category === 'business-logic',
  )

  if (untestedHighComplexity.length > 0) {
    recommendations.push(
      `Priority: Add tests for ${untestedHighComplexity.length} high-complexity files: ${untestedHighComplexity.map((f) => f.path).join(', ')}`,
    )
  }

  if (untestedBusinessLogic.length > 0) {
    recommendations.push(
      `Add integration tests for ${untestedBusinessLogic.length} business logic files`,
    )
  }

  if (utilsToConsolidate.length > 0) {
    recommendations.push(
      `Consider moving ${utilsToConsolidate.length} utils to @jejunetwork/shared`,
    )
  }

  if (testFiles.length === 0) {
    recommendations.push('No test files found - add test infrastructure')
  }

  return {
    name: packageJson.name || packagePath.split('/').pop(),
    path: packagePath,
    files: fileAnalyses,
    hasTests: testFiles.length > 0,
    testFiles: testFiles.map((f) => relative(packagePath, f)),
    coverage: {
      testedFiles,
      untestedFiles,
      percent:
        srcFiles.length > 0
          ? Math.round((testedFiles / srcFiles.length) * 100)
          : 0,
    },
    recommendations,
    utilsToConsolidate,
  }
}

async function main() {
  const rootDir = findMonorepoRoot()
  const packagesDir = join(rootDir, 'packages')

  console.log('Analyzing packages...\n')

  const packages = readdirSync(packagesDir).filter((p) => {
    const pkgPath = join(packagesDir, p)
    return (
      statSync(pkgPath).isDirectory() &&
      existsSync(join(pkgPath, 'package.json'))
    )
  })

  const analyses: PackageAnalysis[] = []

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg)
    const analysis = analyzePackage(pkgPath)
    if (analysis) {
      analyses.push(analysis)
    }
  }

  // Sort by coverage (lowest first)
  analyses.sort((a, b) => a.coverage.percent - b.coverage.percent)

  // Output summary
  console.log('='.repeat(80))
  console.log('PACKAGE ANALYSIS SUMMARY')
  console.log('='.repeat(80))
  console.log('')

  for (const analysis of analyses) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`📦 ${analysis.name}`)
    console.log(`${'─'.repeat(60)}`)
    console.log(
      `Coverage: ${analysis.coverage.percent}% (${analysis.coverage.testedFiles}/${analysis.coverage.testedFiles + analysis.coverage.untestedFiles} files)`,
    )
    console.log(`Test files: ${analysis.testFiles.length}`)

    if (analysis.recommendations.length > 0) {
      console.log('\nRecommendations:')
      for (const rec of analysis.recommendations) {
        console.log(`  • ${rec}`)
      }
    }

    // List high-complexity untested files
    const highPriority = analysis.files.filter(
      (f) =>
        !f.hasTests &&
        (f.complexity === 'high' || f.category === 'business-logic'),
    )
    if (highPriority.length > 0) {
      console.log('\nHigh-priority files needing tests:')
      for (const file of highPriority.slice(0, 5)) {
        console.log(
          `  - ${file.path} (${file.complexity} complexity, ${file.category})`,
        )
      }
      if (highPriority.length > 5) {
        console.log(`  ... and ${highPriority.length - 5} more`)
      }
    }
  }

  // Write JSON report
  const reportPath = join(rootDir, 'test-results', 'package-analysis.json')
  await Bun.write(reportPath, JSON.stringify(analyses, null, 2))
  console.log(`\n\nDetailed report written to: ${reportPath}`)

  // Summary stats
  const totalFiles = analyses.reduce((sum, a) => sum + a.files.length, 0)
  const testedFiles = analyses.reduce(
    (sum, a) => sum + a.coverage.testedFiles,
    0,
  )
  const overallCoverage = Math.round((testedFiles / totalFiles) * 100)

  console.log(`\n${'='.repeat(80)}`)
  console.log('OVERALL STATS')
  console.log('='.repeat(80))
  console.log(`Total packages analyzed: ${analyses.length}`)
  console.log(`Total source files: ${totalFiles}`)
  console.log(`Files with tests: ${testedFiles}`)
  console.log(`Overall coverage: ${overallCoverage}%`)
}

main().catch(console.error)
