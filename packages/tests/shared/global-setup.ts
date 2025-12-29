/**
 * Global setup for Playwright/Synpress tests
 *
 * This runs once before all tests:
 * 1. Checks if localnet is running
 * 2. Waits for chain to be ready
 * 3. Sets up test environment
 *
 * NOTE: When run via `jeju test`, environment variables are automatically
 * provided by the CLI orchestrator. Tests should use:
 * - process.env.L2_RPC_URL or process.env.JEJU_RPC_URL
 * - process.env.CHAIN_ID
 * - Other service URLs from CLI orchestrator
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getChainId as getConfigChainId,
  getL2RpcUrl as getConfigL2RpcUrl,
  getRpcUrl as getConfigRpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import type { FullConfig } from '@playwright/test'

const DEFAULT_RPC = `http://${getLocalhostHost()}:6546`
const DEFAULT_CHAIN_ID = 31337

/** JSON-RPC response with result */
interface JsonRpcResponse {
  result: string
  error?: { code: number; message: string }
}

interface SetupOptions {
  rpcUrl?: string
  chainId?: number
  skipLock?: boolean
  skipPreflight?: boolean
  skipWarmup?: boolean
  force?: boolean
  apps?: string[]
}

/**
 * Setup test environment with options
 * Returns a cleanup function
 */
export async function setupTestEnvironment(
  options: SetupOptions = {},
): Promise<() => void> {
  const {
    rpcUrl = (typeof process !== 'undefined'
      ? process.env.L2_RPC_URL
      : undefined) ??
      (typeof process !== 'undefined' ? process.env.JEJU_RPC_URL : undefined) ??
      getConfigL2RpcUrl() ??
      getConfigRpcUrl() ??
      DEFAULT_RPC,
    chainId = parseInt(
      (typeof process !== 'undefined' ? process.env.CHAIN_ID : undefined) ??
        String(getConfigChainId() ?? DEFAULT_CHAIN_ID),
      10,
    ),
    skipLock = false,
    skipPreflight = false,
    skipWarmup: _skipWarmup = false,
    force = false,
    apps = [],
  } = options

  // Set environment variables
  process.env.L2_RPC_URL = rpcUrl
  process.env.JEJU_RPC_URL = rpcUrl
  process.env.CHAIN_ID = String(chainId)

  if (skipLock) process.env.SKIP_TEST_LOCK = 'true'
  if (force) process.env.FORCE_TESTS = 'true'
  if (apps.length > 0) process.env.WARMUP_APPS = apps.join(',')

  // Run preflight checks unless skipped
  if (!skipPreflight && process.env.SKIP_PREFLIGHT !== 'true') {
    const maxAttempts = 30
    let chainReady = false

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1,
          }),
        })

        if (response.ok) {
          const data: JsonRpcResponse = await response.json()
          const remoteChainId = parseInt(data.result, 16)
          if (remoteChainId === chainId) {
            chainReady = true
            break
          }
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 2000))
    }

    if (!chainReady) {
      throw new Error('Chain not ready')
    }
  }

  // Return cleanup function
  return () => {
    // Cleanup is idempotent
  }
}

const JEJU_RPC =
  (typeof process !== 'undefined' ? process.env.JEJU_RPC_URL : undefined) ??
  (typeof process !== 'undefined' ? process.env.L2_RPC_URL : undefined) ??
  getConfigL2RpcUrl() ??
  getConfigRpcUrl() ??
  DEFAULT_RPC
const CHAIN_ID = parseInt(
  (typeof process !== 'undefined' ? process.env.CHAIN_ID : undefined) ??
    String(getConfigChainId() ?? DEFAULT_CHAIN_ID),
  10,
)

async function globalSetup(_config: FullConfig) {
  console.log('\n🔧 Global Setup Starting...\n')

  // 1. Check if chain is running
  console.log(`Checking chain at ${JEJU_RPC}...`)

  let chainReady = false
  const maxAttempts = 30

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(JEJU_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
      })

      if (response.ok) {
        const data: JsonRpcResponse = await response.json()
        const remoteChainId = parseInt(data.result, 16)

        if (remoteChainId === CHAIN_ID) {
          chainReady = true
          console.log(`✅ Chain ready (ID: ${remoteChainId})`)
          break
        } else {
          console.log(
            `⚠️  Chain ID mismatch: expected ${CHAIN_ID}, got ${remoteChainId}`,
          )
        }
      }
    } catch {
      if (i === 0) {
        console.log('   Waiting for chain...')
      }
    }

    await new Promise((r) => setTimeout(r, 2000))
  }

  if (!chainReady) {
    console.error('\n❌ Chain not ready after 60 seconds')
    console.error('   Start localnet with: jeju up\n')
    throw new Error('Chain not ready')
  }

  // 2. Get block number
  const blockResponse = await fetch(JEJU_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }),
  })

  const blockData: JsonRpcResponse = await blockResponse.json()
  const blockNumber = parseInt(blockData.result, 16)
  console.log(`   Block: ${blockNumber}`)

  // 3. Create output directory
  const outputDir = join(process.cwd(), 'test-results')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // 4. Write test environment info
  const envInfo = {
    rpcUrl: JEJU_RPC,
    chainId: CHAIN_ID,
    startTime: new Date().toISOString(),
    ci: !!process.env.CI,
  }

  writeFileSync(
    join(outputDir, 'test-env.json'),
    JSON.stringify(envInfo, null, 2),
  )

  console.log('\n✅ Global Setup Complete\n')
}

export default globalSetup
