#!/usr/bin/env bun
/**
 * Unified Test Runner
 * 
 * Runs all package tests and generates a summary report.
 * Outputs results to JSON for CI integration.
 */

import { $ } from 'bun'

interface PackageResult {
  name: string
  passed: number
  failed: number
  skipped: number
  duration: number
  status: 'pass' | 'fail' | 'error'
  error?: string
}

interface TestSummary {
  timestamp: string
  totalPackages: number
  passedPackages: number
  failedPackages: number
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  totalDuration: number
  packages: PackageResult[]
}

const PACKAGES = [
  'a2a',
  'bots', 
  'bridge',
  'cli',
  'config',
  'db',
  'eliza-plugin',
  'farcaster',
  'kms',
  'mcp',
  'messaging',
  'oauth3',
  'sdk',
  'shared',
  'training',
  'types',
  'ui',
]

async function runPackageTests(packageName: string): Promise<PackageResult> {
  const startTime = Date.now()
  const packagePath = `${import.meta.dir}/../../${packageName}`
  
  const result: PackageResult = {
    name: packageName,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    status: 'pass'
  }
  
  try {
    const proc = Bun.spawn(['bun', 'test'], {
      cwd: packagePath,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    
    result.duration = Date.now() - startTime
    
    // Parse bun test output - look for final summary line
    const output = stdout + stderr
    const passMatch = output.match(/\s(\d+) pass/)
    const failMatch = output.match(/\s(\d+) fail/)
    const skipMatch = output.match(/\s(\d+) skip/)
    
    result.passed = passMatch ? parseInt(passMatch[1]) : 0
    result.failed = failMatch ? parseInt(failMatch[1]) : 0
    result.skipped = skipMatch ? parseInt(skipMatch[1]) : 0
    result.status = exitCode === 0 ? 'pass' : 'fail'
    
    if (exitCode !== 0 && result.failed === 0) {
      // Error during test run (not test failure)
      result.status = 'error'
      result.error = stderr.slice(0, 500)
    }
    
  } catch (error) {
    result.duration = Date.now() - startTime
    result.status = 'error'
    result.error = error instanceof Error ? error.message : String(error)
  }
  
  return result
}

async function main() {
  console.log('Running tests for all packages...\n')
  
  const results: PackageResult[] = []
  
  for (const pkg of PACKAGES) {
    process.stdout.write(`Testing @jejunetwork/${pkg}... `)
    const result = await runPackageTests(pkg)
    results.push(result)
    
    const statusSymbol = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '!'
    console.log(`${statusSymbol} ${result.passed} passed, ${result.failed} failed (${result.duration}ms)`)
  }
  
  // Calculate summary
  const summary: TestSummary = {
    timestamp: new Date().toISOString(),
    totalPackages: results.length,
    passedPackages: results.filter(r => r.status === 'pass').length,
    failedPackages: results.filter(r => r.status !== 'pass').length,
    totalTests: results.reduce((sum, r) => sum + r.passed + r.failed + r.skipped, 0),
    passedTests: results.reduce((sum, r) => sum + r.passed, 0),
    failedTests: results.reduce((sum, r) => sum + r.failed, 0),
    skippedTests: results.reduce((sum, r) => sum + r.skipped, 0),
    totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
    packages: results,
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('TEST SUMMARY')
  console.log('='.repeat(60))
  console.log(`Packages: ${summary.passedPackages}/${summary.totalPackages} passed`)
  console.log(`Tests: ${summary.passedTests}/${summary.totalTests} passed, ${summary.failedTests} failed, ${summary.skippedTests} skipped`)
  console.log(`Duration: ${(summary.totalDuration / 1000).toFixed(1)}s`)
  
  if (summary.failedPackages > 0) {
    console.log('\nFailed packages:')
    for (const pkg of results.filter(r => r.status !== 'pass')) {
      console.log(`  - ${pkg.name}: ${pkg.failed} failed tests`)
      if (pkg.error) {
        console.log(`    Error: ${pkg.error.slice(0, 200)}`)
      }
    }
  }
  
  // Write JSON report
  const reportPath = `${import.meta.dir}/../coverage/test-summary.json`
  await Bun.write(reportPath, JSON.stringify(summary, null, 2))
  console.log(`\nReport written to: ${reportPath}`)
  
  // Exit with failure if any tests failed
  process.exit(summary.failedTests > 0 ? 1 : 0)
}

main()

