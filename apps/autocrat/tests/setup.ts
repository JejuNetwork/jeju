/**
 * Autocrat Test Setup
 *
 * Provides infrastructure management for tests:
 * - Anvil/chain management
 * - API server management
 * - Service health checks
 * - Environment configuration
 *
 * Tests should import the utilities they need:
 * - Unit tests: no setup needed
 * - Integration tests: use requireChain() or requireApi()
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

// Track managed processes
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

/**
 * Check if Anvil/chain is running and get chain ID
 */
export async function checkChain(
  url: string = RPC_URL,
  _timeout = 3000,
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

/**
 * Check if API server is healthy
 */
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

/**
 * Check if DWS service is healthy
 */
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

/**
 * Check if DWS compute is actually functional (can run inference)
 */
export async function checkDwsCompute(
  url: string = DWS_URL,
  timeout = 10000,
): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'default',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(timeout),
    })
    // Even a 4xx/5xx shows compute endpoint is reachable
    // but we want 2xx to confirm it's working
    return { available: response.ok }
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : 'DWS compute unavailable',
    }
  }
}

/**
 * Start Anvil if not already running
 */
export async function startAnvil(port: number = ANVIL_PORT): Promise<boolean> {
  // Check if already running
  const status = await checkChain(`http://127.0.0.1:${port}`)
  if (status.available) {
    console.log(
      `✅ Anvil already running on port ${port} (chainId: ${status.chainId})`,
    )
    return true
  }

  console.log(`🚀 Starting Anvil on port ${port}...`)

  const anvil = spawn(
    'anvil',
    ['--port', port.toString(), '--chain-id', '31337'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    },
  )

  managedProcesses.push(anvil)

  // Wait for Anvil to be ready
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(200)
    const check = await checkChain(`http://127.0.0.1:${port}`)
    if (check.available) {
      console.log(`✅ Anvil started (chainId: ${check.chainId})`)
      return true
    }
  }

  console.error('❌ Failed to start Anvil within timeout')
  return false
}

/**
 * Start API server if not already running
 */
export async function startApiServer(
  port: number = API_PORT,
): Promise<boolean> {
  // Check if already running
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

  // Wait for server to be ready
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    const check = await checkApi(`http://127.0.0.1:${port}`)
    if (check.available) {
      console.log(`✅ API server started on port ${port}`)
      return true
    }
  }

  console.error('❌ Failed to start API server within timeout')
  return false
}

/**
 * Stop all managed processes
 */
export function stopManagedProcesses(): void {
  for (const proc of managedProcesses) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM')
    }
  }
  managedProcesses.length = 0
}

/**
 * Get current test environment status
 */
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

/**
 * Require chain to be available - starts Anvil if AUTO_START_SERVICES=true
 * Returns the RPC URL or throws if unavailable
 */
export async function requireChain(): Promise<string> {
  const status = await checkChain()

  if (status.available) {
    return RPC_URL
  }

  if (process.env.AUTO_START_SERVICES === 'true') {
    const started = await startAnvil()
    if (started) return RPC_URL
  }

  throw new Error(
    `Chain not available at ${RPC_URL}. ` +
      'Start Anvil with: anvil --port 8545 --chain-id 31337\n' +
      'Or set AUTO_START_SERVICES=true to auto-start',
  )
}

/**
 * Require API to be available - starts server if AUTO_START_SERVICES=true
 * Returns the API URL or throws if unavailable
 */
export async function requireApi(): Promise<string> {
  const status = await checkApi()

  if (status.available) {
    return API_URL
  }

  if (process.env.AUTO_START_SERVICES === 'true') {
    const started = await startApiServer()
    if (started) return API_URL
  }

  throw new Error(
    `API not available at ${API_URL}. ` +
      'Start the server with: bun run dev:api\n' +
      'Or set AUTO_START_SERVICES=true to auto-start',
  )
}

/**
 * Skip test if chain is not available
 */
export async function skipIfNoChain(): Promise<boolean> {
  const status = await checkChain()
  if (!status.available) {
    console.log('⏭️  Skipping: Chain not available')
    return true
  }
  return false
}

/**
 * Skip test if API is not available
 */
export async function skipIfNoApi(): Promise<boolean> {
  const status = await checkApi()
  if (!status.available) {
    console.log('⏭️  Skipping: API not available')
    return true
  }
  return false
}

/**
 * Create a public client for testing
 */
export function createTestClient(rpcUrl: string = RPC_URL) {
  return createPublicClient({
    chain: localhost,
    transport: http(rpcUrl),
  })
}

/**
 * Print test environment status
 */
export async function printTestEnv(): Promise<void> {
  const env = await getTestEnv()
  console.log('\n📋 Test Environment:')
  console.log(
    `   RPC: ${env.rpcUrl} ${env.anvilRunning ? '✅' : '❌'}${env.chainId ? ` (chainId: ${env.chainId})` : ''}`,
  )
  console.log(`   API: ${env.apiUrl} ${env.apiRunning ? '✅' : '❌'}`)
  console.log(`   DWS: ${env.dwsUrl} ${env.dwsRunning ? '✅' : '❌'}`)
  console.log('')
}

// Global cleanup on process exit
process.on('exit', stopManagedProcesses)
process.on('SIGINT', () => {
  stopManagedProcesses()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopManagedProcesses()
  process.exit(0)
})

// Auto-setup when imported in test context (print environment)
if (process.env.BUN_TEST === 'true') {
  beforeAll(async () => {
    await printTestEnv()
  })

  afterAll(() => {
    stopManagedProcesses()
  })
}
