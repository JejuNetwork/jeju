/**
 * Shared Infrastructure Checks for Tests
 *
 * FAIL-FAST DESIGN:
 * - Tests MUST NOT skip due to missing infrastructure - they should FAIL
 * - If INFRA_READY=true is set, infrastructure is assumed available
 * - If running through jeju CLI, infrastructure is verified before tests
 * - If running directly with bun test, bun-global-setup ensures infra is ready
 *
 * Usage:
 *   import { requireInfra, requireContracts, checkInfrastructure } from '@jejunetwork/tests/infra-check'
 *
 *   // In beforeAll - throw if infrastructure missing (RECOMMENDED)
 *   beforeAll(async () => {
 *     await requireInfra()
 *     await requireContracts()
 *   })
 *
 *   // Check infrastructure status (for reporting)
 *   const status = await checkInfrastructure()
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
async function checkSQLit(): Promise<boolean> {
  return checkEndpoint(`http://127.0.0.1:${INFRA_PORTS.SQLit.get()}/health`)
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
  sqlit: boolean
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
      sqlit: true,
      anvil: true,
      dws: true,
      ipfs: true,
      docker: true,
      checked: true,
    }
    return infraStatus
  }

  // Check services in parallel
  const [sqlit, anvil, dws, ipfs, docker] = await Promise.all([
    envBool('SQLIT_AVAILABLE') || checkSQLit(),
    envBool('ANVIL_AVAILABLE') || checkAnvil(),
    envBool('DWS_AVAILABLE') || checkDWS(),
    envBool('IPFS_AVAILABLE') || checkIPFS(),
    envBool('DOCKER_AVAILABLE') || checkDocker(),
  ])

  infraStatus = { sqlit, anvil, dws, ipfs, docker, checked: true }
  return infraStatus
}

/**
 * Wait for infrastructure to be ready
 */
export async function waitForInfra(
  services: ('sqlit' | 'anvil' | 'dws' | 'ipfs' | 'docker')[] = [
    'sqlit',
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
  services: ('sqlit' | 'anvil' | 'dws' | 'ipfs' | 'docker')[] = [
    'sqlit',
    'anvil',
  ],
): Promise<void> {
  const status = await checkInfrastructure()

  const missing = services.filter((s) => !status?.[s])
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Required infrastructure not available: ${missing.join(', ')}.\n\n` +
        `Tests CANNOT run without infrastructure. Start with:\n` +
        `  bun run jeju dev --minimal\n\n` +
        `Or run tests through the CLI:\n` +
        `  bun run jeju test --mode integration`,
    )
  }
}

// Re-export requireContracts from contracts-required module
// This is the canonical source for contract verification
import { requireContracts as _requireContracts } from './contracts-required'

/**
 * Verify contracts are deployed on-chain - REQUIRED for integration/e2e tests
 * Throws if contracts are not deployed.
 *
 * This is a re-export from @jejunetwork/tests/contracts-required
 */
export async function requireContractsFromInfra(): Promise<void> {
  // Check env var first (set by test orchestrator after verification)
  if (envBool('CONTRACTS_VERIFIED') || envBool('CONTRACTS_DEPLOYED')) {
    return
  }

  // Use the canonical requireContracts function
  await _requireContracts()
}

/**
 * Require chain AND contracts for integration/e2e tests
 * This is the recommended function to use in beforeAll for chain-dependent tests
 */
export async function requireChainAndContracts(): Promise<void> {
  await requireInfra(['anvil'])
  await requireContractsFromInfra()
}

// Synchronous skip conditions for describe.skipIf
// DEPRECATED: Prefer using requireChainAndContracts() in beforeAll
// These check environment variables only (fast)
const sqlitEnv = envBool('SQLIT_AVAILABLE') || envBool('INFRA_READY')
const anvilEnv = envBool('ANVIL_AVAILABLE') || envBool('INFRA_READY')
const contractsEnv =
  envBool('CONTRACTS_VERIFIED') || envBool('CONTRACTS_DEPLOYED')
const dwsEnv = envBool('DWS_AVAILABLE')
const ipfsEnv = envBool('IPFS_AVAILABLE')
const dockerEnv = envBool('DOCKER_AVAILABLE')
const infraReadyEnv = envBool('INFRA_READY')

/**
 * Skip conditions for tests
 * DEPRECATED: Use requireChainAndContracts() in beforeAll instead
 *
 * Skip conditions should only be used for truly optional tests
 * (e.g., cross-chain tests that need Solana)
 */
export const SKIP = {
  // Service unavailable conditions
  SQLit: !sqlitEnv,
  ANVIL: !anvilEnv,
  CONTRACTS: !contractsEnv && !infraReadyEnv,
  DWS: !dwsEnv,
  IPFS: !ipfsEnv,
  DOCKER: !dockerEnv,

  // Composite conditions
  NO_CHAIN: !anvilEnv,
  NO_CHAIN_OR_CONTRACTS: !anvilEnv || (!contractsEnv && !infraReadyEnv),
  NO_INFRA: !sqlitEnv || !anvilEnv,
  NO_STORAGE: !sqlitEnv || !ipfsEnv,
  NO_DISTRIBUTED: !sqlitEnv || !ipfsEnv,
  NO_DWS: !dwsEnv,
  NO_FULL: !sqlitEnv || !anvilEnv || !dwsEnv,

  // Set by CI to skip long-running tests
  CI_ONLY: envBool('CI'),
} as const

/**
 * Status for logging
 */
export const INFRA_STATUS = {
  sqlit: sqlitEnv,
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
  console.log(`SQLit: ${INFRA_STATUS.sqlit ? '✓' : '✗'}`)
  console.log(`Anvil: ${INFRA_STATUS.anvil ? '✓' : '✗'}`)
  console.log(`DWS: ${INFRA_STATUS.dws ? '✓' : '✗'}`)
  console.log(`IPFS: ${INFRA_STATUS.ipfs ? '✓' : '✗'}`)
  console.log(`Docker: ${INFRA_STATUS.docker ? '✓' : '✗'}`)
  console.log('=============================\n')
}
