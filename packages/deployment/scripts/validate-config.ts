#!/usr/bin/env bun
/**
 * Validate all configuration files
 * Used by CI to ensure configs are valid before deployment
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function validateJson(file: string, name: string): boolean {
  const path = join(CONFIG_DIR, file)

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: `File not found: ${file}` })
    return false
  }

  const content = readFileSync(path, 'utf8')
  JSON.parse(content)
  results.push({ name, passed: true })
  return true
}

function validateChainConfig(network: string): void {
  const path = join(CONFIG_DIR, 'chain', `${network}.json`)
  const name = `Chain config (${network})`

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  const config = JSON.parse(content)

  // Required fields
  const requiredFields = ['chainId', 'name', 'rpcUrl', 'l1ChainId']
  const missing = requiredFields.filter((f) => !(f in config))

  if (missing.length > 0) {
    results.push({
      name,
      passed: false,
      error: `Missing fields: ${missing.join(', ')}`,
    })
    return
  }

  // Validate chainId is a number
  if (typeof config.chainId !== 'number') {
    results.push({ name, passed: false, error: 'chainId must be a number' })
    return
  }

  // Validate RPC URL format
  if (!config.rpcUrl.startsWith('http')) {
    results.push({ name, passed: false, error: 'rpcUrl must start with http' })
    return
  }

  results.push({ name, passed: true })
}

function validateContractsConfig(): void {
  const path = join(CONFIG_DIR, 'contracts.json')
  const name = 'Contracts config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  const config = JSON.parse(content)

  // Check version exists
  if (!config.version) {
    results.push({ name, passed: false, error: 'Missing version field' })
    return
  }

  // Check network configs exist
  const networks = ['localnet', 'testnet', 'mainnet']
  for (const network of networks) {
    if (!config[network]) {
      results.push({ name, passed: false, error: `Missing ${network} config` })
      return
    }

    // Check chainId
    if (typeof config[network].chainId !== 'number') {
      results.push({
        name,
        passed: false,
        error: `${network}.chainId must be a number`,
      })
      return
    }
  }

  results.push({ name, passed: true })
}

function validateServicesConfig(): void {
  const path = join(CONFIG_DIR, 'services.json')
  const name = 'Services config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  const config = JSON.parse(content)

  const networks = ['localnet', 'testnet', 'mainnet']
  for (const network of networks) {
    if (!config[network]) {
      results.push({
        name,
        passed: false,
        error: `Missing ${network} services`,
      })
      return
    }

    // Check essential services
    if (!config[network].rpc) {
      results.push({ name, passed: false, error: `Missing ${network}.rpc` })
      return
    }
  }

  results.push({ name, passed: true })
}

function validateTokensConfig(): void {
  const path = join(CONFIG_DIR, 'tokens.json')
  const name = 'Tokens config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  const config = JSON.parse(content)

  // Check core tokens exist (tokens is an object keyed by symbol)
  const coreTokens = ['JEJU', 'WETH', 'USDC']
  for (const token of coreTokens) {
    if (!config.tokens?.[token]) {
      // Just warn, don't fail - some tokens may be chain-specific
      console.warn(`  ⚠️  Token ${token} not found in tokens config`)
    }
  }

  // Validate version exists
  if (!config.version) {
    results.push({ name, passed: false, error: 'Missing version field' })
    return
  }

  results.push({ name, passed: true })
}

function validateEILConfig(): void {
  const path = join(CONFIG_DIR, 'eil.json')
  const name = 'EIL config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  const config = JSON.parse(content)

  // Validate structure
  const networks = ['testnet', 'mainnet']
  for (const network of networks) {
    if (!config[network]?.chains) {
      results.push({ name, passed: false, error: `Missing ${network}.chains` })
      return
    }
  }

  results.push({ name, passed: true })
}

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

function validateBrandingConfig(): void {
  const path = join(CONFIG_DIR, 'branding.json')
  const name = 'Branding config'

  if (!existsSync(path)) {
    results.push({ name, passed: false, error: 'File not found' })
    return
  }

  const content = readFileSync(path, 'utf8')
  const config = JSON.parse(content)

  // Check essential fields - name is under network.name
  if (!config.network?.name) {
    results.push({ name, passed: false, error: 'Missing network.name field' })
    return
  }

  if (!config.version) {
    results.push({ name, passed: false, error: 'Missing version field' })
    return
  }

  results.push({ name, passed: true })
}

async function main() {
  console.log('🔍 Validating configuration files...\n')

  // Validate JSON files
  validateJson('chains.json', 'Chains JSON')

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
