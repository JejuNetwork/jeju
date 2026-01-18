/**
 * Autocrat Test Setup
 *
 * App-specific test setup that runs AFTER the shared infrastructure setup.
 * The shared setup (@jejunetwork/tests/bun-global-setup) handles:
 * - Starting jeju dev --minimal if needed
 * - Verifying localnet (L1/L2) is running
 * - Setting environment variables for RPC, DWS, etc.
 *
 * This file adds Autocrat-specific setup:
 * - Contract address loading
 * - API server startup (if needed)
 */

import { afterAll } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getL2RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'

const API_PORT = parseInt(process.env.API_PORT || '4040', 10)

// Track managed processes for cleanup
const managedProcesses: ChildProcess[] = []

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
  chainId: number
  chainRunning: boolean
  apiRunning: boolean
  contractsDeployed: boolean
  contracts: ContractAddresses
}

export interface ContractAddresses {
  identityRegistry: string
  reputationRegistry: string
  validationRegistry: string
  banManager: string
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

// ============================================================================
// API Server
// ============================================================================

export async function checkApi(url: string, timeout = 3000): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeout),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function startApiServer(
  port: number = API_PORT,
): Promise<boolean> {
  const apiUrl = `http://${getLocalhostHost()}:${port}`
  const isRunning = await checkApi(apiUrl)
  if (isRunning) {
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
    if (check) {
      console.log(`✅ API server started on port ${port}`)
      return true
    }
  }

  console.error('❌ Failed to start API server')
  return false
}

export function stopManagedProcesses(): void {
  for (const proc of managedProcesses) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM')
    }
  }
  managedProcesses.length = 0
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Get the test environment after shared setup has run.
 * Contract addresses and environment variables are set by the shared setup.
 */
export async function getTestEnv(): Promise<TestEnv> {
  const rpcUrl = getL2RpcUrl()
  const apiUrl = `http://${getLocalhostHost()}:${API_PORT}`

  // Check if chain is running (should be after shared setup)
  let chainRunning = false
  let chainId = 0
  try {
    const client = createPublicClient({
      chain: localhost,
      transport: http(rpcUrl),
    })
    chainId = await client.getChainId()
    chainRunning = true
  } catch {
    // Chain not running - shared setup should have handled this
  }

  // Check API
  const apiRunning = await checkApi(apiUrl)

  // Load contracts
  const contracts = loadContractAddresses() || {
    identityRegistry: '',
    reputationRegistry: '',
    validationRegistry: '',
    banManager: '',
  }

  const contractsDeployed = contracts.identityRegistry
    ? await verifyContractsDeployed(rpcUrl, contracts)
    : false

  // Set contract addresses in environment
  if (contractsDeployed) {
    process.env.IDENTITY_REGISTRY_ADDRESS = contracts.identityRegistry
    process.env.REPUTATION_REGISTRY_ADDRESS = contracts.reputationRegistry
    process.env.VALIDATION_REGISTRY_ADDRESS = contracts.validationRegistry
    process.env.BAN_MANAGER_ADDRESS = contracts.banManager
  }

  return {
    rpcUrl,
    apiUrl,
    chainId,
    chainRunning,
    apiRunning,
    contractsDeployed,
    contracts,
  }
}

/**
 * Ensure services are available for integration tests.
 * The chain should already be running from the shared setup.
 */
export async function ensureServices(
  options: { api?: boolean; chain?: boolean } = {},
): Promise<TestEnv> {
  const { api = false } = options

  console.log('\n🔧 Autocrat test setup...')

  // Get current environment state
  const env = await getTestEnv()

  // Verify chain is running (shared setup should have handled this)
  if (!env.chainRunning) {
    throw new Error(
      'Localnet not running. The shared test setup should have started it.\n' +
        'Run: bun run jeju dev --minimal',
    )
  }

  // Start API if requested
  if (api && !env.apiRunning) {
    await startApiServer()
    env.apiRunning = true
  }

  // Print status
  console.log('\n📋 Autocrat Test Environment:')
  console.log(
    `   Chain:     ${env.rpcUrl} ${env.chainRunning ? '✅' : '❌'}${env.chainId ? ` (chainId: ${env.chainId})` : ''}`,
  )
  console.log(
    `   Contracts: ${env.contractsDeployed ? '✅ deployed' : '❌ not deployed'}`,
  )
  console.log(`   API:       ${env.apiUrl} ${env.apiRunning ? '✅' : '❌'}`)
  console.log('')

  // Contracts MUST be deployed
  if (!env.contractsDeployed) {
    throw new Error('Contracts not deployed. Run: bun run jeju dev')
  }

  return env
}

export function createTestClient(rpcUrl: string = getL2RpcUrl()) {
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
