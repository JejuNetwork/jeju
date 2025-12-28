/**
 * Autocrat Test Setup
 *
 * Provides infrastructure management for integration tests.
 * Automatically starts Jeju dev environment when needed.
 *
 * Usage:
 * - Unit tests: no setup needed
 * - Integration tests: call ensureServices() in beforeAll
 * - E2E tests: handled by playwright/synpress configs
 */

import { afterAll } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getL2RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'

// Default ports - Kurtosis L2 where contracts are deployed
const _L2_RPC_PORT = 6546
const API_PORT = parseInt(process.env.API_PORT || '8010', 10)
const DWS_PORT = parseInt(process.env.DWS_PORT || '4030', 10)

// Service URLs - use config functions for consistency
const RPC_URL =
  process.env.RPC_URL ||
  process.env.L2_RPC_URL ||
  process.env.JEJU_RPC_URL ||
  getL2RpcUrl()
const API_URL =
  process.env.API_URL || `http://${getLocalhostHost()}:${API_PORT}`
const DWS_URL = process.env.DWS_URL || getDWSUrl()

// Track managed processes for cleanup
const managedProcesses: ChildProcess[] = []
let jejuDevProcess: ChildProcess | null = null

// Find workspace root
function findWorkspaceRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
      if (pkg.name === 'jeju' || pkg.workspaces) {
        return dir
      }
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

const WORKSPACE_ROOT = findWorkspaceRoot()
const CONTRACTS_DEPLOYMENT_FILE = join(
  WORKSPACE_ROOT,
  'packages/contracts/deployments/localnet-complete.json',
)

export interface TestEnv {
  rpcUrl: string
  apiUrl: string
  dwsUrl: string
  chainId: number
  chainRunning: boolean
  apiRunning: boolean
  dwsRunning: boolean
  contractsDeployed: boolean
  contracts: ContractAddresses
}

export interface ContractAddresses {
  identityRegistry: string
  reputationRegistry: string
  validationRegistry: string
  banManager: string
}

interface ServiceStatus {
  available: boolean
  chainId?: number
  error?: string
}

// ============================================================================
// Service Health Checks
// ============================================================================

export async function checkChain(
  url: string = RPC_URL,
): Promise<ServiceStatus> {
  try {
    const client = createPublicClient({
      chain: localhost,
      transport: http(url),
    })
    const chainId = await client.getChainId()
    return { available: true, chainId }
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : 'Chain unavailable',
    }
  }
}

export async function checkApi(
  url: string = API_URL,
  timeout = 3000,
): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeout),
    })
    return { available: response.ok }
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : 'API unavailable',
    }
  }
}

export async function checkDws(
  url: string = DWS_URL,
  timeout = 3000,
): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeout),
    })
    return { available: response.ok }
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : 'DWS unavailable',
    }
  }
}

// ============================================================================
// Contract Management
// ============================================================================

function loadContractAddresses(): ContractAddresses | null {
  if (!existsSync(CONTRACTS_DEPLOYMENT_FILE)) {
    return null
  }

  const deployment = JSON.parse(
    readFileSync(CONTRACTS_DEPLOYMENT_FILE, 'utf-8'),
  )
  const contracts = deployment.contracts || deployment

  return {
    identityRegistry: contracts.identityRegistry || '',
    reputationRegistry: contracts.reputationRegistry || '',
    validationRegistry: contracts.validationRegistry || '',
    banManager: contracts.banManager || '',
  }
}

async function verifyContractsDeployed(
  rpcUrl: string,
  addresses: ContractAddresses,
): Promise<boolean> {
  if (!addresses.identityRegistry) return false

  try {
    const client = createPublicClient({
      chain: localhost,
      transport: http(rpcUrl),
    })

    const code = await client.getCode({
      address: addresses.identityRegistry as `0x${string}`,
    })

    return code !== undefined && code !== '0x'
  } catch {
    return false
  }
}

async function ensureContracts(
  rpcUrl: string,
): Promise<ContractAddresses | null> {
  const existing = loadContractAddresses()

  if (existing?.identityRegistry) {
    const verified = await verifyContractsDeployed(rpcUrl, existing)
    if (verified) {
      console.log('✅ Contracts verified on chain')
      return existing
    }
  }

  // Contracts not deployed - return null so tests can skip gracefully
  console.log('⚠️  Contracts not deployed - some tests will be skipped')
  console.log('   Run: jeju dev --bootstrap')
  return null
}

// ============================================================================
// Jeju Dev Environment
// ============================================================================

async function startJejuDev(): Promise<boolean> {
  console.log('🚀 Starting Jeju dev environment...')
  console.log('   This may take a minute on first run...')

  jejuDevProcess = spawn('jeju', ['dev', '--minimal'], {
    cwd: WORKSPACE_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  // Capture output for debugging
  jejuDevProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line.includes('READY') || line.includes('✅') || line.includes('❌')) {
      console.log(`   ${line}`)
    }
  })

  jejuDevProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line.includes('error') || line.includes('Error')) {
      console.error(`   ${line}`)
    }
  })

  // Wait for L2 to be ready (up to 2 minutes)
  const l2Url = getL2RpcUrl()
  for (let i = 0; i < 120; i++) {
    await Bun.sleep(1000)
    const status = await checkChain(l2Url)
    if (status.available) {
      console.log(`✅ Jeju L2 ready (chainId: ${status.chainId})`)

      // Wait a bit more for contracts to be bootstrapped
      await Bun.sleep(5000)

      // Verify contracts are deployed
      const contracts = loadContractAddresses()
      if (contracts?.identityRegistry) {
        const verified = await verifyContractsDeployed(l2Url, contracts)
        if (verified) {
          console.log('✅ Contracts bootstrapped')
          return true
        }
      }

      // Contracts not ready yet, wait more
      console.log('   Waiting for contract bootstrap...')
      for (let j = 0; j < 60; j++) {
        await Bun.sleep(1000)
        const c = loadContractAddresses()
        if (c?.identityRegistry) {
          const v = await verifyContractsDeployed(l2Url, c)
          if (v) {
            console.log('✅ Contracts bootstrapped')
            return true
          }
        }
      }

      console.error('❌ Contracts did not deploy within timeout')
      return false
    }
  }

  console.error('❌ Jeju dev environment failed to start within 2 minutes')
  return false
}

// ============================================================================
// Service Starters
// ============================================================================

export async function startApiServer(
  port: number = API_PORT,
): Promise<boolean> {
  const apiUrl = `http://${getLocalhostHost()}:${port}`
  const status = await checkApi(apiUrl)
  if (status.available) {
    console.log(`✅ API server already running on port ${port}`)
    return true
  }

  console.log(`🚀 Starting API server on port ${port}...`)

  const server = spawn('bun', ['run', 'dev:api'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: port.toString() },
    detached: false,
  })
  managedProcesses.push(server)

  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    const check = await checkApi(apiUrl)
    if (check.available) {
      console.log(`✅ API server started on port ${port}`)
      return true
    }
  }

  console.error('❌ Failed to start API server')
  return false
}

export async function startDws(port: number = DWS_PORT): Promise<boolean> {
  const host = getLocalhostHost()
  const status = await checkDws(`http://${host}:${port}`)
  if (status.available) {
    console.log(`✅ DWS already running on port ${port}`)
    return true
  }

  console.log(`🚀 Starting DWS on port ${port}...`)

  const dws = spawn('bun', ['run', 'dev'], {
    cwd: join(WORKSPACE_ROOT, 'apps/dws'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: port.toString() },
    detached: false,
  })
  managedProcesses.push(dws)

  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    const check = await checkDws(`http://${host}:${port}`)
    if (check.available) {
      console.log(`✅ DWS started on port ${port}`)
      return true
    }
  }

  console.error('❌ Failed to start DWS')
  return false
}

export function stopManagedProcesses(): void {
  for (const proc of managedProcesses) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM')
    }
  }
  managedProcesses.length = 0

  // Don't kill jeju dev - let it run for subsequent tests
  // It will be cleaned up when the parent process exits
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Ensure all required integration test services are running.
 * Automatically starts Jeju dev environment if not running.
 */
export async function ensureServices(
  options: { chain?: boolean; api?: boolean; dws?: boolean } = {},
): Promise<TestEnv> {
  const { chain = true, api = false, dws = false } = options

  console.log('\n🔧 Setting up test services...')

  let contracts: ContractAddresses = {
    identityRegistry: '',
    reputationRegistry: '',
    validationRegistry: '',
    banManager: '',
  }

  const rpcUrl = getL2RpcUrl()

  if (chain) {
    await ensureChain()
    const deployedContracts = await ensureContracts(rpcUrl)

    if (deployedContracts) {
      contracts = deployedContracts
      // Set environment variables for contract addresses
      process.env.RPC_URL = rpcUrl
      process.env.L2_RPC_URL = rpcUrl
      process.env.JEJU_RPC_URL = rpcUrl
      process.env.IDENTITY_REGISTRY_ADDRESS = contracts.identityRegistry
      process.env.REPUTATION_REGISTRY_ADDRESS = contracts.reputationRegistry
      process.env.VALIDATION_REGISTRY_ADDRESS = contracts.validationRegistry
      process.env.BAN_MANAGER_ADDRESS = contracts.banManager
    } else {
      // Just set RPC URL for chain access without contracts
      process.env.RPC_URL = rpcUrl
      process.env.L2_RPC_URL = rpcUrl
      process.env.JEJU_RPC_URL = rpcUrl
    }
  }

  if (api) await ensureApi()
  if (dws) await ensureDws()

  const env = await getTestEnv()
  env.rpcUrl = rpcUrl
  env.contracts = contracts
  env.contractsDeployed = !!contracts.identityRegistry

  printEnvStatus(env)
  return env
}

async function ensureChain(): Promise<string> {
  const l2Url = getL2RpcUrl()
  const status = await checkChain(l2Url)

  if (status.available) {
    console.log(`✅ Jeju L2 running (chainId: ${status.chainId})`)
    return l2Url
  }

  // Start jeju dev
  const started = await startJejuDev()
  if (!started) {
    throw new Error(
      'Failed to start Jeju dev environment.\n' +
        'Make sure you have:\n' +
        '  1. Docker running\n' +
        '  2. Kurtosis installed: brew install kurtosis-tech/tap/kurtosis-cli\n' +
        '  3. Run manually: jeju dev',
    )
  }

  return l2Url
}

async function ensureApi(): Promise<string> {
  const status = await checkApi()
  if (status.available) return API_URL

  const started = await startApiServer()
  if (!started) {
    throw new Error('Failed to start API server')
  }
  return API_URL
}

async function ensureDws(): Promise<string> {
  const status = await checkDws()
  if (status.available) return DWS_URL

  const started = await startDws()
  if (!started) {
    throw new Error('Failed to start DWS')
  }
  return DWS_URL
}

// ============================================================================
// Environment Info
// ============================================================================

export async function getTestEnv(): Promise<TestEnv> {
  const rpcUrl = getL2RpcUrl()
  const [chainStatus, apiStatus, dwsStatus] = await Promise.all([
    checkChain(rpcUrl),
    checkApi(),
    checkDws(),
  ])

  const contracts = loadContractAddresses() || {
    identityRegistry: '',
    reputationRegistry: '',
    validationRegistry: '',
    banManager: '',
  }

  return {
    rpcUrl,
    apiUrl: API_URL,
    dwsUrl: DWS_URL,
    chainId: chainStatus.chainId ?? 0,
    chainRunning: chainStatus.available,
    apiRunning: apiStatus.available,
    dwsRunning: dwsStatus.available,
    contractsDeployed: !!contracts.identityRegistry,
    contracts,
  }
}

function printEnvStatus(env: TestEnv): void {
  console.log('\n📋 Test Environment:')
  console.log(
    `   Chain:     ${env.rpcUrl} ${env.chainRunning ? '✅' : '❌'}${env.chainId ? ` (chainId: ${env.chainId})` : ''}`,
  )
  console.log(
    `   Contracts: ${env.contractsDeployed ? '✅ deployed' : '❌ not deployed'}`,
  )
  console.log(`   API:       ${env.apiUrl} ${env.apiRunning ? '✅' : '❌'}`)
  console.log(`   DWS:       ${env.dwsUrl} ${env.dwsRunning ? '✅' : '❌'}`)
  console.log('')
}

export function createTestClient(rpcUrl: string = RPC_URL) {
  return createPublicClient({
    chain: localhost,
    transport: http(rpcUrl),
  })
}

// ============================================================================
// Cleanup
// ============================================================================

process.on('exit', stopManagedProcesses)
process.on('SIGINT', () => {
  stopManagedProcesses()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopManagedProcesses()
  process.exit(0)
})

// Auto-cleanup when imported in test context
if (process.env.BUN_TEST === 'true') {
  afterAll(() => {
    stopManagedProcesses()
  })
}
