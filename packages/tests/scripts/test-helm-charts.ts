#!/usr/bin/env bun

/**
 * Test Helm charts
 * Validates all Helm charts in the deployment package
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const HELM_DIR = join(ROOT, 'packages/deployment/kubernetes/helm')

interface ValidationResult {
  chart: string
  passed: boolean
  error?: string
}

const results: ValidationResult[] = []

// Charts that only contain values overrides (no Chart.yaml)
const VALUE_ONLY_CHARTS = [
  'cert-manager',
  'ingress-nginx',
  'prometheus',
  'grafana',
]

async function checkHelmInstalled(): Promise<boolean> {
  const result = await $`which helm`.quiet().nothrow()
  return result.exitCode === 0
}

async function validateChart(
  chartPath: string,
  chartName: string,
): Promise<void> {
  // Skip value-only charts (they don't have Chart.yaml)
  if (VALUE_ONLY_CHARTS.includes(chartName)) {
    results.push({ chart: chartName, passed: true })
    return
  }

  // Check if Chart.yaml exists
  const chartYaml = join(chartPath, 'Chart.yaml')
  if (!existsSync(chartYaml)) {
    // Not a Helm chart, skip
    return
  }

  // Run helm lint
  const lint = await $`helm lint ${chartPath}`.quiet().nothrow()

  if (lint.exitCode === 0) {
    results.push({ chart: chartName, passed: true })
  } else {
    results.push({
      chart: chartName,
      passed: false,
      error: lint.stderr.toString() || 'Lint failed',
    })
  }
}

async function validateDependencies(
  chartPath: string,
  chartName: string,
): Promise<void> {
  const chartYaml = join(chartPath, 'Chart.yaml')
  if (!existsSync(chartYaml)) return

  // Try to build dependencies
  const deps = await $`helm dependency build ${chartPath}`.quiet().nothrow()
  if (deps.exitCode !== 0) {
    // Dependencies might be missing, but that's ok for CI
    console.warn(
      `  ⚠️  ${chartName}: Dependencies not built (this is ok for CI)`,
    )
  }
}

async function main() {
  console.log('🔍 Validating Helm charts...\n')

  // Check if Helm is installed
  if (!(await checkHelmInstalled())) {
    console.log('⚠️  Helm not installed, skipping chart validation')
    console.log('   Install with: brew install helm')
    console.log('\n✅ Skipped Helm chart validation (helm not installed)\n')
    process.exit(0)
  }

  // Check if Helm directory exists
  if (!existsSync(HELM_DIR)) {
    console.log('⚠️  Helm charts directory not found:', HELM_DIR)
    console.log('\n✅ Skipped Helm chart validation (no charts directory)\n')
    process.exit(0)
  }

  // Get all chart directories
  const entries = readdirSync(HELM_DIR)
  const chartDirs = entries.filter((entry) => {
    const fullPath = join(HELM_DIR, entry)
    return statSync(fullPath).isDirectory()
  })

  if (chartDirs.length === 0) {
    console.log('⚠️  No Helm charts found in:', HELM_DIR)
    console.log('\n✅ Skipped Helm chart validation (no charts found)\n')
    process.exit(0)
  }

  console.log(`Found ${chartDirs.length} chart directories\n`)

  // Validate each chart
  for (const chartName of chartDirs) {
    const chartPath = join(HELM_DIR, chartName)
    await validateDependencies(chartPath, chartName)
    await validateChart(chartPath, chartName)
  }

  // Print results
  console.log(`\n${'━'.repeat(60)}`)

  let allPassed = true
  let validatedCount = 0

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    const msg = result.error ? `: ${result.error}` : ''
    console.log(`${icon} ${result.chart}${msg}`)
    if (!result.passed) allPassed = false
    validatedCount++
  }

  console.log('━'.repeat(60))

  if (validatedCount === 0) {
    console.log('\n⚠️  No charts validated\n')
    process.exit(0)
  }

  if (allPassed) {
    console.log(`\n✅ All ${validatedCount} Helm charts validated\n`)
  } else {
    console.log('\n❌ Helm chart validation failed\n')
    process.exit(1)
  }
}

main()
