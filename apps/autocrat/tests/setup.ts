/**
 * Autocrat Test Setup
 *
 * Provides infrastructure management for integration tests.
 * Services are automatically started when required.
 *
 * Usage:
 * - Unit tests: no setup needed
 * - Integration tests: call ensureServices() in beforeAll
 * - E2E tests: handled by playwright/synpress configs
 */

import { afterAll, beforeAll } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'

// Default ports
const ANVIL_PORT = parseInt(process.env.ANVIL_PORT || '8545', 10)
const API_PORT = parseInt(process.env.API_PORT || '8010', 10)
const DWS_PORT = parseInt(process.env.DWS_PORT || '4030', 10)

// Service URLs
const RPC_URL = process.env.RPC_URL || `http://127.0.0.1:${ANVIL_PORT}`
const API_URL = process.env.API_URL || `http://127.0.0.1:${API_PORT}`
const DWS_URL = process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`

// Track managed processes for cleanup
const managedProcesses: ChildProcess[] = []

export interface TestEnv {
  rpcUrl: string
  apiUrl: string
  dwsUrl: string
  chainId: number
  anvilRunning: boolean
  apiRunning: boolean
  dwsRunning: boolean
}

interface ServiceStatus {
  available: boolean
  chainId?: number
  error?: string
}

// ============================================================================
// Service Health Checks
// ============================================================================

export async function checkChain(url: string = RPC_URL): Promise<ServiceStatus> {
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
// Service Starters
// ============================================================================

export async function startAnvil(port: number = ANVIL_PORT): Promise<boolean> {
  const status = await checkChain(`http://127.0.0.1:${port}`)
  if (status.available) {
    console.log(`✅ Anvil already running (chainId: ${status.chainId})`)
    return true
  }

  console.log(`🚀 Starting Anvil on port ${port}...`)

  const anvil = spawn(
    'anvil',
    ['--port', port.toString(), '--chain-id', '31337'],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: false },
  )
  managedProcesses.push(anvil)

  for (let i = 0; i < 30; i++) {
    await Bun.sleep(200)
    const check = await checkChain(`http://127.0.0.1:${port}`)
    if (check.available) {
      console.log(`✅ Anvil started (chainId: ${check.chainId})`)
      return true
    }
  }

  console.error('❌ Failed to start Anvil')
  return false
}

export async function startApiServer(
  port: number = API_PORT,
): Promise<boolean> {
  const status = await checkApi(`http://127.0.0.1:${port}`)
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
    const check = await checkApi(`http://127.0.0.1:${port}`)
    if (check.available) {
      console.log(`✅ API server started on port ${port}`)
      return true
    }
  }

  console.error('❌ Failed to start API server')
  return false
}

export async function startDws(port: number = DWS_PORT): Promise<boolean> {
  const status = await checkDws(`http://127.0.0.1:${port}`)
  if (status.available) {
    console.log(`✅ DWS already running on port ${port}`)
    return true
  }

  console.log(`🚀 Starting DWS on port ${port}...`)

  // DWS is started from apps/dws
  const dws = spawn('bun', ['run', 'dev'], {
    cwd: `${process.cwd()}/../dws`,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: port.toString() },
    detached: false,
  })
  managedProcesses.push(dws)

  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    const check = await checkDws(`http://127.0.0.1:${port}`)
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
}

// ============================================================================
// Service Ensurers (auto-start if needed)
// ============================================================================

export async function ensureChain(): Promise<string> {
  const status = await checkChain()
  if (status.available) return RPC_URL

  const started = await startAnvil()
  if (!started) {
    throw new Error(
      `Failed to start Anvil. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup`,
    )
  }
  return RPC_URL
}

export async function ensureApi(): Promise<string> {
  const status = await checkApi()
  if (status.available) return API_URL

  const started = await startApiServer()
  if (!started) {
    throw new Error(`Failed to start API server`)
  }
  return API_URL
}

export async function ensureDws(): Promise<string> {
  const status = await checkDws()
  if (status.available) return DWS_URL

  const started = await startDws()
  if (!started) {
    throw new Error(`Failed to start DWS`)
  }
  return DWS_URL
}

/**
 * Ensure all integration test services are running.
 * Call this in beforeAll for integration tests.
 */
export async function ensureServices(
  options: { chain?: boolean; api?: boolean; dws?: boolean } = {},
): Promise<TestEnv> {
  const { chain = true, api = false, dws = false } = options

  console.log('\n🔧 Setting up test services...')

  if (chain) await ensureChain()
  if (api) await ensureApi()
  if (dws) await ensureDws()

  const env = await getTestEnv()
  printEnvStatus(env)
  return env
}

// ============================================================================
// Environment Info
// ============================================================================

export async function getTestEnv(): Promise<TestEnv> {
  const [chainStatus, apiStatus, dwsStatus] = await Promise.all([
    checkChain(),
    checkApi(),
    checkDws(),
  ])

  return {
    rpcUrl: RPC_URL,
    apiUrl: API_URL,
    dwsUrl: DWS_URL,
    chainId: chainStatus.chainId ?? 0,
    anvilRunning: chainStatus.available,
    apiRunning: apiStatus.available,
    dwsRunning: dwsStatus.available,
  }
}

function printEnvStatus(env: TestEnv): void {
  console.log('\n📋 Test Environment:')
  console.log(
    `   Chain: ${env.rpcUrl} ${env.anvilRunning ? '✅' : '❌'}${env.chainId ? ` (chainId: ${env.chainId})` : ''}`,
  )
  console.log(`   API:   ${env.apiUrl} ${env.apiRunning ? '✅' : '❌'}`)
  console.log(`   DWS:   ${env.dwsUrl} ${env.dwsRunning ? '✅' : '❌'}`)
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
