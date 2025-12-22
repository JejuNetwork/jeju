#!/usr/bin/env bun
/**
 * Coverage Report Generator
 *
 * Generates unified coverage reports for all packages.
 * Outputs JSON for CI integration - no blocking windows.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'

interface PackageCoverage {
  name: string
  lines: { total: number; covered: number; percent: number }
  functions: { total: number; covered: number; percent: number }
  branches: { total: number; covered: number; percent: number }
  files: FileCoverage[]
}

interface FileCoverage {
  path: string
  lines: { total: number; covered: number; percent: number }
  functions: { total: number; covered: number; percent: number }
  branches: { total: number; covered: number; percent: number }
}

interface CoverageReport {
  timestamp: string
  packages: PackageCoverage[]
  summary: {
    totalPackages: number
    totalFiles: number
    lines: { total: number; covered: number; percent: number }
    functions: { total: number; covered: number; percent: number }
    branches: { total: number; covered: number; percent: number }
  }
}

function findMonorepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

async function runPackageTests(
  packagePath: string,
  packageName: string,
): Promise<PackageCoverage | null> {
  const srcDir = join(packagePath, 'src')
  if (!existsSync(srcDir)) return null

  console.log(`\nRunning tests for ${packageName}...`)

  // Check for test files
  const hasTests =
    existsSync(join(packagePath, 'src')) &&
    readdirSync(packagePath, { recursive: true }).some(
      (f) =>
        typeof f === 'string' &&
        (f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')),
    )

  if (!hasTests) {
    console.log(`  No tests found for ${packageName}`)
    return null
  }

  const coverageDir = join(packagePath, 'coverage')
  mkdirSync(coverageDir, { recursive: true })

  try {
    // Run bun test with coverage
    await execa('bun', ['test', '--coverage', '--coverage-reporter=lcov'], {
      cwd: packagePath,
      stdio: 'pipe',
      env: {
        ...process.env,
        BUN_COVERAGE_DIR: coverageDir,
      },
      timeout: 120000,
    })
  } catch (error) {
    // Tests may fail but still generate coverage
    console.log(`  Tests completed (some may have failed)`)
  }

  // Parse coverage if available
  const lcovPath = join(coverageDir, 'lcov.info')
  if (existsSync(lcovPath)) {
    return parseLcov(lcovPath, packageName)
  }

  return {
    name: packageName,
    lines: { total: 0, covered: 0, percent: 0 },
    functions: { total: 0, covered: 0, percent: 0 },
    branches: { total: 0, covered: 0, percent: 0 },
    files: [],
  }
}

function parseLcov(lcovPath: string, packageName: string): PackageCoverage {
  const content = readFileSync(lcovPath, 'utf-8')
  const files: FileCoverage[] = []

  let currentFile: FileCoverage | null = null
  let totalLines = 0
  let coveredLines = 0
  let totalFunctions = 0
  let coveredFunctions = 0
  let totalBranches = 0
  let coveredBranches = 0

  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      if (currentFile) {
        files.push(currentFile)
      }
      currentFile = {
        path: line.substring(3),
        lines: { total: 0, covered: 0, percent: 0 },
        functions: { total: 0, covered: 0, percent: 0 },
        branches: { total: 0, covered: 0, percent: 0 },
      }
    } else if (line.startsWith('LF:') && currentFile) {
      currentFile.lines.total = parseInt(line.substring(3), 10)
      totalLines += currentFile.lines.total
    } else if (line.startsWith('LH:') && currentFile) {
      currentFile.lines.covered = parseInt(line.substring(3), 10)
      coveredLines += currentFile.lines.covered
      currentFile.lines.percent =
        currentFile.lines.total > 0
          ? Math.round((currentFile.lines.covered / currentFile.lines.total) * 100)
          : 0
    } else if (line.startsWith('FNF:') && currentFile) {
      currentFile.functions.total = parseInt(line.substring(4), 10)
      totalFunctions += currentFile.functions.total
    } else if (line.startsWith('FNH:') && currentFile) {
      currentFile.functions.covered = parseInt(line.substring(4), 10)
      coveredFunctions += currentFile.functions.covered
      currentFile.functions.percent =
        currentFile.functions.total > 0
          ? Math.round((currentFile.functions.covered / currentFile.functions.total) * 100)
          : 0
    } else if (line.startsWith('BRF:') && currentFile) {
      currentFile.branches.total = parseInt(line.substring(4), 10)
      totalBranches += currentFile.branches.total
    } else if (line.startsWith('BRH:') && currentFile) {
      currentFile.branches.covered = parseInt(line.substring(4), 10)
      coveredBranches += currentFile.branches.covered
      currentFile.branches.percent =
        currentFile.branches.total > 0
          ? Math.round((currentFile.branches.covered / currentFile.branches.total) * 100)
          : 0
    } else if (line === 'end_of_record' && currentFile) {
      files.push(currentFile)
      currentFile = null
    }
  }

  return {
    name: packageName,
    lines: {
      total: totalLines,
      covered: coveredLines,
      percent: totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0,
    },
    functions: {
      total: totalFunctions,
      covered: coveredFunctions,
      percent:
        totalFunctions > 0 ? Math.round((coveredFunctions / totalFunctions) * 100) : 0,
    },
    branches: {
      total: totalBranches,
      covered: coveredBranches,
      percent:
        totalBranches > 0 ? Math.round((coveredBranches / totalBranches) * 100) : 0,
    },
    files,
  }
}

async function main() {
  const rootDir = findMonorepoRoot()
  const packagesDir = join(rootDir, 'packages')
  const resultsDir = join(rootDir, 'test-results')

  mkdirSync(resultsDir, { recursive: true })

  console.log('Generating coverage reports...\n')

  const packages = readdirSync(packagesDir).filter((p) => {
    const pkgPath = join(packagesDir, p)
    return (
      statSync(pkgPath).isDirectory() && existsSync(join(pkgPath, 'package.json'))
    )
  })

  const coverages: PackageCoverage[] = []

  for (const pkg of packages) {
    // Skip the tests package itself
    if (pkg === 'tests') continue

    const pkgPath = join(packagesDir, pkg)
    const pkgJson = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf-8'))
    const coverage = await runPackageTests(pkgPath, pkgJson.name || pkg)
    if (coverage) {
      coverages.push(coverage)
    }
  }

  // Calculate summary
  let totalLines = 0
  let coveredLines = 0
  let totalFunctions = 0
  let coveredFunctions = 0
  let totalBranches = 0
  let coveredBranches = 0
  let totalFiles = 0

  for (const pkg of coverages) {
    totalLines += pkg.lines.total
    coveredLines += pkg.lines.covered
    totalFunctions += pkg.functions.total
    coveredFunctions += pkg.functions.covered
    totalBranches += pkg.branches.total
    coveredBranches += pkg.branches.covered
    totalFiles += pkg.files.length
  }

  const report: CoverageReport = {
    timestamp: new Date().toISOString(),
    packages: coverages,
    summary: {
      totalPackages: coverages.length,
      totalFiles,
      lines: {
        total: totalLines,
        covered: coveredLines,
        percent: totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0,
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        percent:
          totalFunctions > 0 ? Math.round((coveredFunctions / totalFunctions) * 100) : 0,
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        percent:
          totalBranches > 0 ? Math.round((coveredBranches / totalBranches) * 100) : 0,
      },
    },
  }

  // Write JSON report
  const reportPath = join(resultsDir, 'coverage.json')
  await Bun.write(reportPath, JSON.stringify(report, null, 2))

  // Print summary
  console.log('\n' + '='.repeat(80))
  console.log('COVERAGE SUMMARY')
  console.log('='.repeat(80))
  console.log(`Packages: ${report.summary.totalPackages}`)
  console.log(`Files: ${report.summary.totalFiles}`)
  console.log(`Lines: ${report.summary.lines.percent}% (${report.summary.lines.covered}/${report.summary.lines.total})`)
  console.log(`Functions: ${report.summary.functions.percent}% (${report.summary.functions.covered}/${report.summary.functions.total})`)
  console.log(`Branches: ${report.summary.branches.percent}% (${report.summary.branches.covered}/${report.summary.branches.total})`)
  console.log('')
  console.log(`Report written to: ${reportPath}`)

  // Print per-package breakdown
  console.log('\nPer-package coverage:')
  for (const pkg of coverages.sort((a, b) => a.lines.percent - b.lines.percent)) {
    const bar = '█'.repeat(Math.floor(pkg.lines.percent / 5)) + '░'.repeat(20 - Math.floor(pkg.lines.percent / 5))
    console.log(`  ${pkg.name.padEnd(30)} ${bar} ${pkg.lines.percent}%`)
  }
}

main().catch(console.error)

