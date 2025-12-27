/**
 * Shared Infrastructure Checks for Tests
 *
 * Provides consistent skip conditions for tests requiring infrastructure.
 * Tests should NEVER use mocks - they should skip if infrastructure is unavailable.
 *
 * Usage:
 *   import { SKIP, waitForInfra, requireInfra } from '@jejunetwork/tests/infra-check'
 *
 *   // Skip entire describe block if no infrastructure
 *   describe.skipIf(SKIP.NO_INFRA)('My Integration Tests', () => { ... })
 *
 *   // Skip individual test if specific service missing
 *   test.skipIf(SKIP.EQLite)('should query database', async () => { ... })
 *
 *   // Or throw if infrastructure is required
 *   beforeAll(async () => {
 *     await requireInfra()
 *   })
 */

import { CORE_PORTS, INFRA_PORTS } from '@jejunetwork/config/ports'

// Environment check helpers
function envBool(key: string): boolean {
  return process.env[key] === 'true'
}

async function checkEndpoint(url: string, timeout = 2000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
    })
    return response.ok
  } catch {
    return false
  }
}

// Check if services are actually running
async function checkEQLite(): Promise<boolean> {
  return checkEndpoint(`http://127.0.0.1:${INFRA_PORTS.EQLite.get()}/health`)
}

async function checkAnvil(): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${INFRA_PORTS.L2_RPC.get()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(2000),
      },
    )
    return response.ok
  } catch {
    return false
  }
}

async function checkDWS(): Promise<boolean> {
  return checkEndpoint(`http://127.0.0.1:${CORE_PORTS.DWS_API.get()}/health`)
}

async function checkIPFS(): Promise<boolean> {
  return checkEndpoint(
    `http://127.0.0.1:${CORE_PORTS.IPFS_API.get()}/api/v0/id`,
  )
}

async function checkDocker(): Promise<boolean> {
  try {
    const { execa } = await import('execa')
    await execa('docker', ['info'], { timeout: 2000 })
    return true
  } catch {
    return false
  }
}

// Cached status
let infraStatus: {
  eqlite: boolean
  anvil: boolean
  dws: boolean
  ipfs: boolean
  docker: boolean
  checked: boolean
} | null = null

/**
 * Check all infrastructure services and cache results
 */
export async function checkInfrastructure(): Promise<typeof infraStatus> {
  if (infraStatus?.checked) {
    return infraStatus
  }

  // Check if explicitly marked as ready
  const infraReady = envBool('INFRA_READY')
  if (infraReady) {
    infraStatus = {
      eqlite: true,
      anvil: true,
      dws: true,
      ipfs: true,
      docker: true,
      checked: true,
    }
    return infraStatus
  }

  // Check services in parallel
  const [eqlite, anvil, dws, ipfs, docker] = await Promise.all([
    envBool('EQLITE_AVAILABLE') || checkEQLite(),
    envBool('ANVIL_AVAILABLE') || checkAnvil(),
    envBool('DWS_AVAILABLE') || checkDWS(),
    envBool('IPFS_AVAILABLE') || checkIPFS(),
    envBool('DOCKER_AVAILABLE') || checkDocker(),
  ])

  infraStatus = { eqlite, anvil, dws, ipfs, docker, checked: true }
  return infraStatus
}

/**
 * Wait for infrastructure to be ready
 */
export async function waitForInfra(
  services: ('eqlite' | 'anvil' | 'dws' | 'ipfs' | 'docker')[] = [
    'eqlite',
    'anvil',
  ],
  timeout = 60000,
): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const status = await checkInfrastructure()

    const allReady = services.every((s) => status?.[s])
    if (allReady) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    // Reset cache for next check
    infraStatus = null
  }

  return false
}

/**
 * Throw if required infrastructure is not available
 */
export async function requireInfra(
  services: ('eqlite' | 'anvil' | 'dws' | 'ipfs' | 'docker')[] = [
    'eqlite',
    'anvil',
  ],
): Promise<void> {
  const status = await checkInfrastructure()

  const missing = services.filter((s) => !status?.[s])
  if (missing.length > 0) {
    throw new Error(
      `Required infrastructure not available: ${missing.join(', ')}. ` +
        `Run 'jeju start' or set INFRA_READY=true if services are running.`,
    )
  }
}

// Synchronous skip conditions for describe.skipIf
// These check environment variables only (fast)
const eqliteEnv = envBool('EQLITE_AVAILABLE') || envBool('INFRA_READY')
const anvilEnv = envBool('ANVIL_AVAILABLE') || envBool('INFRA_READY')
const dwsEnv = envBool('DWS_AVAILABLE')
const ipfsEnv = envBool('IPFS_AVAILABLE')
const dockerEnv = envBool('DOCKER_AVAILABLE')
const infraReadyEnv = envBool('INFRA_READY')

/**
 * Skip conditions for tests
 * Use with describe.skipIf() or test.skipIf()
 */
export const SKIP = {
  // Service unavailable conditions
  EQLite: !eqliteEnv,
  ANVIL: !anvilEnv,
  DWS: !dwsEnv,
  IPFS: !ipfsEnv,
  DOCKER: !dockerEnv,

  // Composite conditions
  NO_CHAIN: !anvilEnv,
  NO_INFRA: !eqliteEnv || !anvilEnv,
  NO_STORAGE: !eqliteEnv || !ipfsEnv,
  NO_DISTRIBUTED: !eqliteEnv || !ipfsEnv,
  NO_DWS: !dwsEnv,
  NO_FULL: !eqliteEnv || !anvilEnv || !dwsEnv,

  // Set by CI to skip long-running tests
  CI_ONLY: envBool('CI'),
} as const

/**
 * Status for logging
 */
export const INFRA_STATUS = {
  eqlite: eqliteEnv,
  anvil: anvilEnv,
  dws: dwsEnv,
  ipfs: ipfsEnv,
  docker: dockerEnv,
  infraReady: infraReadyEnv,
}

/**
 * Log infrastructure status at test startup
 */
export function logInfraStatus(): void {
  console.log('\n=== Infrastructure Status ===')
  console.log(`EQLite: ${INFRA_STATUS.eqlite ? '✓' : '✗'}`)
  console.log(`Anvil: ${INFRA_STATUS.anvil ? '✓' : '✗'}`)
  console.log(`DWS: ${INFRA_STATUS.dws ? '✓' : '✗'}`)
  console.log(`IPFS: ${INFRA_STATUS.ipfs ? '✓' : '✗'}`)
  console.log(`Docker: ${INFRA_STATUS.docker ? '✓' : '✗'}`)
  console.log('=============================\n')
}
