/**
 * DWS Integration Test Setup
 *
 * Automatically starts required infrastructure before tests run:
 * - SQLit adapter (for state persistence)
 * - DWS server (for API endpoints)
 *
 * Cleans up after tests complete.
 */

import { join } from 'node:path'
import type { Subprocess } from 'bun'

// Test infrastructure configuration
const SQLIT_PORT = 18546
const DWS_PORT = 14660
const STARTUP_TIMEOUT_MS = 60000 // 60 seconds
const HEALTH_CHECK_INTERVAL_MS = 1000

// Dev private key for local testing (anvil account 0)
const DEV_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Track spawned processes
let sqlitProcess: Subprocess | null = null
let dwsProcess: Subprocess | null = null
let isSetup = false

/**
 * Wait for a service to be healthy
 */
async function waitForHealth(
  url: string,
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        return true
      }
    } catch {
      // Service not ready yet
    }
    await new Promise((resolve) =>
      setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS),
    )
  }

  return false
}

/**
 * Start SQLit adapter for testing
 */
async function startSQLit(): Promise<Subprocess> {
  const rootDir = join(import.meta.dir, '../../../..')
  const sqlitAdapterDir = join(rootDir, 'packages/sqlit/adapter')

  console.log('[Test Setup] Starting SQLit adapter...')

  // Find bun executable
  const bunPath = Bun.which('bun') ?? process.execPath

  const proc = Bun.spawn({
    cmd: [bunPath, 'run', 'server.ts'],
    cwd: sqlitAdapterDir,
    env: {
      ...process.env,
      SQLIT_PRIVATE_KEY: DEV_PRIVATE_KEY,
      PORT: String(SQLIT_PORT), // SQLit adapter uses PORT env var
      NODE_ENV: 'test',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for SQLit to be healthy
  const healthy = await waitForHealth(
    `http://127.0.0.1:${SQLIT_PORT}/v1/status`,
  )
  if (!healthy) {
    proc.kill()
    throw new Error('SQLit adapter failed to start within timeout')
  }

  console.log(`[Test Setup] SQLit adapter started on port ${SQLIT_PORT}`)
  return proc
}

/**
 * Start DWS server for testing
 */
async function startDWS(): Promise<Subprocess> {
  const rootDir = join(import.meta.dir, '../../../..')
  const dwsDir = join(rootDir, 'apps/dws')

  console.log('[Test Setup] Starting DWS server...')

  // Find bun executable
  const bunPath = Bun.which('bun') ?? process.execPath

  const proc = Bun.spawn({
    cmd: [bunPath, 'run', 'api/server/index.ts'],
    cwd: dwsDir,
    env: {
      ...process.env,
      SQLIT_PRIVATE_KEY: DEV_PRIVATE_KEY,
      SQLIT_BLOCK_PRODUCER_URL: `http://127.0.0.1:${SQLIT_PORT}`,
      SQLIT_MINER_URL: `http://127.0.0.1:${SQLIT_PORT}`,
      DWS_PORT: String(DWS_PORT),
      NETWORK: 'localnet',
      NODE_ENV: 'test',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for DWS to be healthy
  const healthy = await waitForHealth(`http://127.0.0.1:${DWS_PORT}/health`)
  if (!healthy) {
    proc.kill()
    throw new Error('DWS server failed to start within timeout')
  }

  console.log(`[Test Setup] DWS server started on port ${DWS_PORT}`)
  return proc
}

/**
 * Setup test infrastructure
 * Call this in beforeAll()
 */
export async function setupTestInfrastructure(): Promise<{
  dwsUrl: string
  sqlitUrl: string
}> {
  if (isSetup) {
    return {
      dwsUrl: `http://127.0.0.1:${DWS_PORT}`,
      sqlitUrl: `http://127.0.0.1:${SQLIT_PORT}`,
    }
  }

  console.log('[Test Setup] Initializing test infrastructure...')

  // Check if services are already running (from another test run or manual start)
  const sqlitAlreadyRunning = await waitForHealth(
    `http://127.0.0.1:${SQLIT_PORT}/v1/status`,
    1000,
  )
  const dwsAlreadyRunning = await waitForHealth(
    `http://127.0.0.1:${DWS_PORT}/health`,
    1000,
  )

  if (!sqlitAlreadyRunning) {
    sqlitProcess = await startSQLit()
  } else {
    console.log('[Test Setup] SQLit already running, using existing instance')
  }

  if (!dwsAlreadyRunning) {
    dwsProcess = await startDWS()
  } else {
    console.log('[Test Setup] DWS already running, using existing instance')
  }

  isSetup = true

  return {
    dwsUrl: `http://127.0.0.1:${DWS_PORT}`,
    sqlitUrl: `http://127.0.0.1:${SQLIT_PORT}`,
  }
}

/**
 * Teardown test infrastructure
 * Call this in afterAll()
 */
export async function teardownTestInfrastructure(): Promise<void> {
  console.log('[Test Setup] Tearing down test infrastructure...')

  if (dwsProcess) {
    dwsProcess.kill()
    dwsProcess = null
    console.log('[Test Setup] DWS server stopped')
  }

  if (sqlitProcess) {
    sqlitProcess.kill()
    sqlitProcess = null
    console.log('[Test Setup] SQLit adapter stopped')
  }

  isSetup = false
}

/**
 * Get DWS URL for tests
 */
export function getDWSUrl(): string {
  return `http://127.0.0.1:${DWS_PORT}`
}

/**
 * Get SQLit URL for tests
 */
export function getSQLitUrl(): string {
  return `http://127.0.0.1:${SQLIT_PORT}`
}

// Export ports for tests that need them
export const TEST_PORTS = {
  sqlit: SQLIT_PORT,
  dws: DWS_PORT,
}
