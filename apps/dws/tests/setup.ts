/**
 * DWS Test Setup
 *
 * Run tests with: `jeju test --target-app dws --mode integration`
 *
 * This setup:
 * - Checks if CQL, Anvil, and DWS are running
 * - Starts DWS if needed (for standalone test runs)
 * - Sets environment variables for tests
 */

import { afterAll, beforeAll } from 'bun:test'
import type { Subprocess } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getCQLBlockProducerUrl,
  getL2RpcUrl,
} from '@jejunetwork/config'

// Lazy-loaded app to prevent initialization when tests are skipped
let _app: Awaited<typeof import('../api/server')>['app'] | null = null
async function getApp() {
  if (!_app) {
    const mod = await import('../api/server')
    _app = mod.app
  }
  return _app
}

// Configuration from environment (set by jeju test orchestrator)
const CQL_URL = getCQLBlockProducerUrl()
const RPC_URL = getL2RpcUrl()
const DWS_PORT = CORE_PORTS.DWS_API.get()
const DWS_URL = process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`
const INFERENCE_URL =
  process.env.INFERENCE_URL || `http://127.0.0.1:${CORE_PORTS.DWS_INFERENCE.get()}`

// Infrastructure status
let infraReady = false
let cqlReady = false
let anvilReady = false
let dwsReady = false

// Process management for cleanup
let dwsProcess: Subprocess | null = null
let dwsStartedByUs = false

async function checkService(
  url: string,
  path = '/health',
  timeout = 2000,
): Promise<boolean> {
  try {
    const response = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(timeout),
    })
    return response.ok
  } catch {
    return false
  }
}

async function checkRpc(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Check if infrastructure is available
 */
export async function checkInfrastructure(): Promise<{
  cql: boolean
  anvil: boolean
  dws: boolean
  inference: boolean
  ready: boolean
}> {
  const [cql, anvil, dws, inference] = await Promise.all([
    checkService(CQL_URL, '/health'),
    checkRpc(RPC_URL),
    checkService(DWS_URL, '/health'),
    checkService(INFERENCE_URL, '/health', 1000),
  ])

  return {
    cql,
    anvil,
    dws,
    inference,
    ready: cql && anvil,
  }
}

/**
 * Start DWS server if not already running
 */
async function startDWS(): Promise<boolean> {
  // Check if already running
  if (await checkService(DWS_URL, '/health')) {
    console.log('[Test Setup] DWS already running')
    return true
  }

  console.log('[Test Setup] Starting DWS server...')

  // Find the DWS directory
  let dwsDir = join(import.meta.dir, '..')
  if (!existsSync(join(dwsDir, 'api/server/index.ts'))) {
    // Try monorepo root
    let dir = import.meta.dir
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
        dwsDir = join(dir, 'apps', 'dws')
        break
      }
      dir = join(dir, '..')
    }
  }

  const serverPath = join(dwsDir, 'api/server/index.ts')
  if (!existsSync(serverPath)) {
    console.error(`[Test Setup] DWS server not found at ${serverPath}`)
    return false
  }

  // Start DWS server
  dwsProcess = Bun.spawn(['bun', 'run', serverPath], {
    cwd: dwsDir,
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: RPC_URL,
      JEJU_RPC_URL: RPC_URL,
      CQL_URL: CQL_URL,
      NODE_ENV: 'test',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  dwsStartedByUs = true

  // Wait for DWS to be ready (up to 30 seconds)
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    if (await checkService(DWS_URL, '/health')) {
      console.log(`[Test Setup] DWS started on port ${DWS_PORT}`)
      return true
    }
  }

  console.error('[Test Setup] DWS failed to start within 30 seconds')
  return false
}

/**
 * Setup function - called before tests
 */
export async function setup(): Promise<void> {
  console.log('[Test Setup] Checking infrastructure...')

  // Check initial status
  let status = await checkInfrastructure()
  cqlReady = status.cql
  anvilReady = status.anvil
  dwsReady = status.dws

  console.log(`[Test Setup] CQL: ${cqlReady ? 'ready' : 'not available'}`)
  console.log(`[Test Setup] Anvil: ${anvilReady ? 'ready' : 'not available'}`)
  console.log(`[Test Setup] DWS: ${dwsReady ? 'ready' : 'not available'}`)

  // Try to start DWS if not running (and we have CQL + Anvil)
  if (!dwsReady && cqlReady && anvilReady) {
    dwsReady = await startDWS()
  }

  // Update status
  status = await checkInfrastructure()
  infraReady = status.cql && status.anvil
  dwsReady = status.dws

  if (!infraReady) {
    console.log('[Test Setup] WARNING: Infrastructure not ready.')
    console.log('[Test Setup] Some tests will be skipped.')
    console.log('[Test Setup] Run with: jeju test --target-app dws --mode integration')
  }

  // Set env vars for tests
  process.env.CQL_URL = CQL_URL
  process.env.L2_RPC_URL = RPC_URL
  process.env.JEJU_RPC_URL = RPC_URL
  process.env.DWS_URL = DWS_URL
  process.env.INFRA_READY = infraReady ? 'true' : 'false'
  process.env.DWS_AVAILABLE = dwsReady ? 'true' : 'false'
}

/**
 * Teardown function - called after tests
 */
export async function teardown(): Promise<void> {
  // Only stop DWS if we started it
  if (dwsStartedByUs && dwsProcess) {
    console.log('[Test Teardown] Stopping DWS server...')
    dwsProcess.kill()
    dwsProcess = null
    dwsStartedByUs = false
  }
}

/**
 * Check if infrastructure is ready (use in test.skipIf)
 */
export function isInfraReady(): boolean {
  return process.env.INFRA_READY === 'true' || infraReady
}

/**
 * Check if CQL is available
 */
export function isCqlReady(): boolean {
  return process.env.CQL_AVAILABLE === 'true' || cqlReady
}

/**
 * Check if Anvil is available
 */
export function isAnvilReady(): boolean {
  return process.env.ANVIL_AVAILABLE === 'true' || anvilReady
}

/**
 * Check if DWS server is available
 */
export function isDwsReady(): boolean {
  return process.env.DWS_AVAILABLE === 'true' || dwsReady
}

/**
 * Get test environment configuration
 */
export function getTestEnv(): {
  cqlUrl: string
  rpcUrl: string
  dwsUrl: string
  inferenceUrl: string
} {
  return {
    cqlUrl: CQL_URL,
    rpcUrl: RPC_URL,
    dwsUrl: DWS_URL,
    inferenceUrl: INFERENCE_URL,
  }
}

// Export URLs for direct usage
export { CQL_URL, RPC_URL, DWS_URL, INFERENCE_URL }

/**
 * Helper function to make requests to the DWS app.
 * Uses app.handle() for in-process testing (Elysia 1.x compatible)
 * or fetch() for E2E mode when DWS is running externally.
 */
export async function dwsRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const isE2EMode = process.env.E2E_MODE === 'true'
  const baseUrl = isE2EMode ? (process.env.DWS_URL ?? DWS_URL) : 'http://localhost'
  const url = `${baseUrl}${path}`

  const request = new Request(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (isE2EMode) {
    return fetch(request)
  }
  const app = await getApp()
  return app.handle(request)
}

// Get app instance for tests that need direct access (lazy-loaded)
export { getApp }

// Auto-setup when file is imported in test context
if (process.env.BUN_TEST === 'true') {
  beforeAll(setup)
  afterAll(teardown)
}
