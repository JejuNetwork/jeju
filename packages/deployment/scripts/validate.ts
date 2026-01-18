#!/usr/bin/env bun

/**
 * Validate deployment configurations for decentralized deployment
 *
 * Validates:
 * - Contract ABIs exist
 * - App manifests are valid
 * - DWS bootstrap script exists
 * - IPFS connectivity (optional)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../..')
const APPS_DIR = join(ROOT, 'apps')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')

interface ValidationResult {
  name: string
  passed: boolean
  message?: string
}

const results: ValidationResult[] = []

function validateContracts(): void {
  const abisDir = join(CONTRACTS_DIR, 'abis')

  if (!existsSync(abisDir)) {
    results.push({
      name: 'Contract ABIs',
      passed: false,
      message: 'ABIs directory not found',
    })
    return
  }

  const requiredAbis = [
    'StorageManager.json',
    'WorkerRegistry.json',
    'JNSRegistry.json',
    'JNSResolver.json',
  ]

  const missingAbis = requiredAbis.filter(
    (abi) => !existsSync(join(abisDir, abi)),
  )

  if (missingAbis.length > 0) {
    results.push({
      name: 'Contract ABIs',
      passed: false,
      message: `Missing: ${missingAbis.join(', ')}`,
    })
  } else {
    results.push({ name: 'Contract ABIs', passed: true })
  }
}

function validateAppManifests(): void {
  const appDirs = readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  let validCount = 0
  let invalidCount = 0
  const invalid: string[] = []

  for (const appName of appDirs) {
    const manifestPath = join(APPS_DIR, appName, 'jeju-manifest.json')

    if (!existsSync(manifestPath)) continue

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (
        manifest.name &&
        (manifest.decentralization || manifest.architecture)
      ) {
        validCount++
      } else {
        invalidCount++
        invalid.push(appName)
      }
    } catch {
      invalidCount++
      invalid.push(appName)
    }
  }

  if (invalidCount > 0) {
    results.push({
      name: 'App Manifests',
      passed: false,
      message: `Invalid: ${invalid.join(', ')}`,
    })
  } else {
    results.push({
      name: 'App Manifests',
      passed: true,
      message: `${validCount} valid manifests`,
    })
  }
}

function validateDWSBootstrap(): void {
  const bootstrapPath = join(
    ROOT,
    'packages/deployment/scripts/deploy/dws-bootstrap.ts',
  )

  if (existsSync(bootstrapPath)) {
    results.push({ name: 'DWS Bootstrap Script', passed: true })
  } else {
    results.push({
      name: 'DWS Bootstrap Script',
      passed: false,
      message: 'dws-bootstrap.ts not found',
    })
  }
}

function validateKurtosis(): void {
  const kurtosisFile = join(ROOT, 'packages/deployment/kurtosis/main.star')

  if (existsSync(kurtosisFile)) {
    results.push({ name: 'Kurtosis (local testing)', passed: true })
  } else {
    results.push({
      name: 'Kurtosis',
      passed: false,
      message: 'main.star not found (optional)',
    })
  }
}

async function main(): Promise<void> {
  console.log('🔍 Validating decentralized deployment configurations...\n')

  validateContracts()
  validateAppManifests()
  validateDWSBootstrap()
  validateKurtosis()

  console.log('━'.repeat(50))

  let allPassed = true
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    console.log(
      `${icon} ${result.name}${result.message ? `: ${result.message}` : ''}`,
    )
    if (!result.passed) allPassed = false
  }

  console.log('━'.repeat(50))

  if (allPassed) {
    console.log('\n✅ All validations passed\n')
  } else {
    console.log('\n❌ Some validations failed\n')
    process.exit(1)
  }
}

main()
