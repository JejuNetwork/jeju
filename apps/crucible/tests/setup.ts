import { afterAll, beforeAll } from 'bun:test'
import { getServicesConfig } from '@jejunetwork/config'

interface TestEnv {
  dwsUrl: string
  rpcUrl: string
  storageUrl: string
  computeUrl: string
}

// Check if DWS is available
async function checkDWS(): Promise<boolean> {
  const dwsUrl = getServicesConfig().dws.api
  const result = await fetch(`${dwsUrl}/health`, {
    signal: AbortSignal.timeout(2000),
  })
  return result.ok
}

// Check if RPC is available
async function checkRPC(): Promise<boolean> {
  const rpcUrl = getServicesConfig().rpc.l2
  const result = await fetch(rpcUrl, {
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
  return result.ok
}

/**
 * Get infrastructure status
 */
export async function getStatus(): Promise<{ dws: boolean; rpc: boolean }> {
  const [dws, rpc] = await Promise.all([
    checkDWS().catch(() => false),
    checkRPC().catch(() => false),
  ])
  return { dws, rpc }
}

/**
 * Check if infrastructure is ready
 */
export async function isReady(): Promise<boolean> {
  const status = await getStatus()
  return status.dws && status.rpc
}

/**
 * Wait for infrastructure to be healthy
 */
async function waitForInfra(_maxAttempts = 5): Promise<boolean> {
  const status = await getStatus()

  if (!status.rpc) {
    console.warn('RPC not available - chain-dependent tests will fail')
  }

  if (!status.dws) {
    console.warn('DWS not available - storage/compute tests will fail')
  }

  return status.rpc && status.dws
}

/**
 * Get test environment using config (handles env var overrides internally)
 */
export function getTestEnv(): TestEnv {
  const servicesConfig = getServicesConfig()

  return {
    dwsUrl: servicesConfig.dws.api,
    rpcUrl: servicesConfig.rpc.l2,
    storageUrl: servicesConfig.storage.api,
    computeUrl: servicesConfig.compute.marketplace,
  }
}

/**
 * Setup hook - call in describe block or beforeAll
 */
export async function setup(): Promise<void> {
  // Verify infrastructure is healthy
  const ready = await waitForInfra(5)
  if (!ready) {
    console.warn('Infrastructure not fully available - tests may be skipped')
  }

  // Set environment variables for Crucible
  const env = getTestEnv()
  process.env.DWS_URL = env.dwsUrl
  process.env.STORAGE_API_URL = env.storageUrl
  process.env.COMPUTE_MARKETPLACE_URL = env.computeUrl
}

/**
 * Teardown hook - call in afterAll
 */
export async function teardown(): Promise<void> {
  // Nothing to tear down - infrastructure is managed externally
}

// Auto-setup when file is imported in test context
if (process.env.BUN_TEST === 'true') {
  beforeAll(setup)
  afterAll(teardown)
}
