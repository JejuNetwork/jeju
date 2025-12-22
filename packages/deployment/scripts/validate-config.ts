#!/usr/bin/env bun
/**
 * Validate all configuration files
 * Uses Zod schemas for type-safe validation instead of manual checks
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  BrandingConfigValidationSchema,
  ChainConfigValidationSchema,
  ContractsConfigValidationSchema,
  EILConfigValidationSchema,
  expectJson,
  ServicesConfigValidationSchema,
  TokensConfigValidationSchema,
} from '../schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const CONFIG_DIR = join(ROOT, 'packages/config')

interface ValidationResult {
  name: string
  passed: boolean
  error?: string
}

const results: ValidationResult[] = []

/**
 * Generic JSON validation - just checks if file is valid JSON
 */
function validateJson(file: string, name: string): boolean {
  const path = join(CONFIG_DIR, file)

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: `File not found: ${file}` })
    return false
  }

  const content = readFileSync(path, 'utf8')
  try {
    expectJson(content, z.unknown(), name)
    results.push({ name, passed: true })
    return true
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
    return false
  }
}

/**
 * Validate chain config with Zod schema
 */
function validateChainConfig(network: string): void {
  const path = join(CONFIG_DIR, 'chain', `${network}.json`)
  const name = `Chain config (${network})`

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  try {
    expectJson(content, ChainConfigValidationSchema, name)
    results.push({ name, passed: true })
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
  }
}

/**
 * Validate contracts config with Zod schema
 */
function validateContractsConfig(): void {
  const path = join(CONFIG_DIR, 'contracts.json')
  const name = 'Contracts config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  try {
    expectJson(content, ContractsConfigValidationSchema, name)
    results.push({ name, passed: true })
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
  }
}

/**
 * Validate services config with Zod schema
 */
function validateServicesConfig(): void {
  const path = join(CONFIG_DIR, 'services.json')
  const name = 'Services config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  try {
    expectJson(content, ServicesConfigValidationSchema, name)
    results.push({ name, passed: true })
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
  }
}

/**
 * Validate tokens config with Zod schema
 */
function validateTokensConfig(): void {
  const path = join(CONFIG_DIR, 'tokens.json')
  const name = 'Tokens config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  try {
    const config = expectJson(content, TokensConfigValidationSchema, name)

    // Check core tokens exist (tokens is an object keyed by symbol)
    const coreTokens = ['JEJU', 'WETH', 'USDC']
    for (const token of coreTokens) {
      if (!config.tokens?.[token]) {
        console.warn(`  ⚠️  Token ${token} not found in tokens config`)
      }
    }

    results.push({ name, passed: true })
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
  }
}

/**
 * Validate EIL config with Zod schema
 */
function validateEILConfig(): void {
  const path = join(CONFIG_DIR, 'eil.json')
  const name = 'EIL config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  try {
    expectJson(content, EILConfigValidationSchema, name)
    results.push({ name, passed: true })
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
  }
}

/**
 * Validate ports config (TypeScript file, just check it exists)
 */
function validatePortsConfig(): void {
  const path = join(CONFIG_DIR, 'ports.ts')
  const name = 'Ports config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  // Just verify the file exists and can be read
  readFileSync(path, 'utf8')
  results.push({ name, passed: true })
}

/**
 * Validate branding config with Zod schema
 */
function validateBrandingConfig(): void {
  const path = join(CONFIG_DIR, 'branding.json')
  const name = 'Branding config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  try {
    expectJson(content, BrandingConfigValidationSchema, name)
    results.push({ name, passed: true })
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message })
  }
}

async function main() {
  console.log('🔍 Validating configuration files...\n')

  // Validate JSON files
  validateJson('infrastructure.json', 'Infrastructure JSON')

  // Validate chain configs
  validateChainConfig('localnet')
  validateChainConfig('testnet')
  validateChainConfig('mainnet')

  // Validate major configs
  validateContractsConfig()
  validateServicesConfig()
  validateTokensConfig()
  validateEILConfig()
  validatePortsConfig()
  validateBrandingConfig()

  // Additional JSON files
  validateJson('federation.json', 'Federation config')
  validateJson('vendor-apps.json', 'Vendor apps config')

  // Print results
  console.log('━'.repeat(60))

  let allPassed = true
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    const msg = result.error ? `: ${result.error}` : ''
    console.log(`${icon} ${result.name}${msg}`)
    if (!result.passed) allPassed = false
  }

  console.log('━'.repeat(60))

  if (allPassed) {
    console.log('\n✅ All configuration validation passed\n')
  } else {
    console.log('\n❌ Configuration validation failed\n')
    process.exit(1)
  }
}

main()
