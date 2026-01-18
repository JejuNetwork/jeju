/**
 * Crucible Test Setup
 *
 * App-specific test setup that runs AFTER the shared infrastructure setup.
 * The shared setup (@jejunetwork/tests/bun-global-setup) handles:
 * - Starting jeju dev --minimal if needed
 * - Verifying localnet (L1/L2) is running
 * - Setting environment variables for RPC, DWS, etc.
 *
 * This file adds Crucible-specific environment setup.
 */

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
  try {
    const result = await fetch(`${dwsUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return result.ok
  } catch {
    return false
  }
}

// Check if RPC is available
async function checkRPC(): Promise<boolean> {
  const rpcUrl = getServicesConfig().rpc.l2
  try {
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
  } catch {
    return false
  }
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
 * Setup hook - verifies infrastructure is available
 */
export async function setup(): Promise<void> {
  console.log('\n[Crucible Setup] Verifying test infrastructure...')

  // Verify infrastructure is healthy (should be from shared setup)
  const status = await getStatus()

  if (!status.rpc) {
    throw new Error(
      'Localnet RPC not available. The shared test setup should have started it.\n' +
        'Run: bun run jeju dev --minimal',
    )
  }

  if (!status.dws) {
    console.warn(
      '[Crucible Setup] DWS not available - storage/compute tests will fail',
    )
  }

  // Set environment variables for Crucible
  const env = getTestEnv()
  process.env.DWS_URL = env.dwsUrl
  process.env.STORAGE_API_URL = env.storageUrl
  process.env.COMPUTE_MARKETPLACE_URL = env.computeUrl

  console.log('[Crucible Setup] Environment:')
  console.log(`   RPC: ${env.rpcUrl} ${status.rpc ? '✅' : '❌'}`)
  console.log(`   DWS: ${env.dwsUrl} ${status.dws ? '✅' : '❌'}`)
  console.log('')
}

/**
 * Teardown hook - nothing to tear down, infrastructure is managed externally
 */
export async function teardown(): Promise<void> {
  // Nothing to tear down - infrastructure is managed by shared setup
}

// Auto-setup when file is imported in test context
if (process.env.BUN_TEST === 'true') {
  beforeAll(setup)
  afterAll(teardown)
}
