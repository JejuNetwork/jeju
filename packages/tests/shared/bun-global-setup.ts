/**
 * Bun Global Test Setup
 *
 * Uses `jeju dev --minimal` to start all infrastructure.
 * The jeju CLI handles:
 * - Localnet (L1 + L2)
 * - Docker services (SQLit, IPFS)
 * - Contract bootstrap
 *
 * CRITICAL: This setup REQUIRES contracts to be deployed.
 * Tests will NOT skip if contracts are missing - they will FAIL HARD.
 *
 * Usage in bunfig.toml:
 *   preload = ["@jejunetwork/tests/bun-global-setup"]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getDWSComputeUrl,
  getDWSUrl,
  getIpfsApiUrl,
  getLocalhostHost,
  getServiceUrl,
  getSQLitBlockProducerUrl,
  getStorageApiEndpoint,
  INFRA_PORTS,
  TEST_ACCOUNTS,
} from '@jejunetwork/config'
import type { Subprocess } from 'bun'
import { execa } from 'execa'
import type { InfraStatus } from './schemas'
import {
  checkContractsDeployed,
  findJejuWorkspaceRoot,
  isRpcAvailable,
  isServiceAvailable,
} from './utils'

// Well-known dev deployer private key (Anvil default)
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Infrastructure state
let jejuDevProcess: Subprocess | null = null
let setupComplete = false
let isExternalInfra = false

// Default ports - use standard Jeju ports
const L1_PORT = INFRA_PORTS.L1_RPC.get()
const L2_PORT = INFRA_PORTS.L2_RPC.get()

// Docker service ports
const DOCKER_SERVICES = {
  sqlit: {
    port: INFRA_PORTS.SQLit.get(),
    healthPath: '/v1/status',
    name: 'SQLit',
  },
  ipfs: {
    port: CORE_PORTS.IPFS_API.DEFAULT,
    healthPath: '/api/v0/id',
    name: 'IPFS',
  },
} as const

// Environment URLs - use network-aware config for localnet
const DWS_URL = getDWSUrl('localnet')

async function checkDockerService(
  port: number,
  healthPath: string,
): Promise<boolean> {
  const host = getLocalhostHost()
  const url = `http://${host}:${port}${healthPath}`
  return isServiceAvailable(url, 3000)
}

async function checkDockerServices(): Promise<{ [key: string]: boolean }> {
  const results: { [key: string]: boolean } = {}

  await Promise.all(
    Object.entries(DOCKER_SERVICES).map(async ([key, config]) => {
      results[key] = await checkDockerService(config.port, config.healthPath)
    }),
  )

  return results
}

async function checkInfrastructure(): Promise<InfraStatus> {
  const host = getLocalhostHost()
  const l1RpcUrl = `http://${host}:${L1_PORT}`
  const l2RpcUrl = `http://${host}:${L2_PORT}`

  const [_l1Rpc, l2Rpc, dws, docker] = await Promise.all([
    isRpcAvailable(l1RpcUrl),
    isRpcAvailable(l2RpcUrl),
    isServiceAvailable(`${DWS_URL}/health`, 2000),
    checkDockerServices(),
  ])

  // L2 is required, L1 is optional
  const rpc = l2Rpc

  return { rpc, dws, docker, rpcUrl: l2RpcUrl, dwsUrl: DWS_URL }
}

async function startJejuDev(rootDir: string): Promise<boolean> {
  console.log('🚀 Starting jeju dev --minimal...')

  // Find the CLI
  const cliPath = join(rootDir, 'packages', 'cli', 'src', 'index.ts')
  if (!existsSync(cliPath)) {
    console.error('❌ Jeju CLI not found at:', cliPath)
    return false
  }

  // Start jeju dev --minimal (localnet + infrastructure, no apps)
  // Use detached mode so it survives the test process
  jejuDevProcess = Bun.spawn(['bun', 'run', cliPath, 'dev', '--minimal'], {
    cwd: rootDir,
    stdout: 'pipe', // Don't inherit to avoid cluttering test output
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0', // Disable colors in piped output
    },
  })

  // Wait for infrastructure to be ready
  const host = getLocalhostHost()
  const l2RpcUrl = `http://${host}:${L2_PORT}`

  console.log(`  Waiting for localnet on ${l2RpcUrl}...`)

  for (let i = 0; i < 120; i++) {
    if (await isRpcAvailable(l2RpcUrl)) {
      console.log('  ✅ Localnet ready')

      // Wait for contracts to be deployed (jeju dev should handle this)
      console.log('  Waiting for contracts...')
      for (let j = 0; j < 60; j++) {
        if (await checkContractsDeployed(l2RpcUrl)) {
          console.log('  ✅ Contracts deployed')
          return true
        }
        await Bun.sleep(1000)
      }
      console.log('  ⚠️  Contracts not deployed after 60s, will deploy now...')

      // Deploy contracts ourselves if jeju dev didn't do it
      const deployed = await deployContractsIfNeeded(rootDir, l2RpcUrl)
      if (deployed) {
        console.log('  ✅ Contracts deployed')
        return true
      }

      console.error('❌ Failed to deploy contracts')
      return false
    }
    await Bun.sleep(1000)
  }

  console.error('❌ Localnet failed to start within 120 seconds')
  console.error('   Try running manually: bun run jeju dev --minimal')
  return false
}

async function stopProcess(proc: Subprocess | null): Promise<void> {
  if (!proc) return

  try {
    proc.kill('SIGTERM')
    await proc.exited
  } catch {
    // Process may already be dead
  }
}

/**
 * Verify contracts are deployed ON-CHAIN, not just that the file exists.
 * This catches cases where chain was reset but deployment file still exists.
 */
async function verifyContractsOnChain(
  rootDir: string,
  rpcUrl: string,
): Promise<{ verified: boolean; error?: string }> {
  const bootstrapFile = join(
    rootDir,
    'packages/contracts/deployments/localnet-complete.json',
  )

  // Check 1: Bootstrap file must exist
  if (!existsSync(bootstrapFile)) {
    return {
      verified: false,
      error: `Bootstrap file not found: ${bootstrapFile}`,
    }
  }

  // Check 2: Bootstrap file must have valid contracts
  const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
  const contracts = data?.contracts
  if (
    !contracts ||
    !contracts.jnsRegistry ||
    contracts.jnsRegistry === ZERO_ADDRESS
  ) {
    return {
      verified: false,
      error: 'JNS Registry not found in bootstrap file',
    }
  }

  // Check 3: Verify contract is actually deployed on-chain
  const contractAddress = contracts.jnsRegistry as string
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [contractAddress, 'latest'],
        id: 1,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return {
        verified: false,
        error: `RPC request failed: ${response.status}`,
      }
    }

    const result = await response.json()
    const code = result.result as string

    if (!code || code === '0x' || code.length < 4) {
      return {
        verified: false,
        error: `JNS Registry at ${contractAddress} has no code on-chain (chain may have been reset)`,
      }
    }

    return { verified: true }
  } catch (error) {
    return {
      verified: false,
      error: `Failed to verify contract: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Deploy contracts if they aren't already deployed ON-CHAIN
 */
async function deployContractsIfNeeded(
  rootDir: string,
  rpcUrl: string,
): Promise<boolean> {
  // Check if already deployed ON-CHAIN (not just file exists)
  const verification = await verifyContractsOnChain(rootDir, rpcUrl)
  if (verification.verified) {
    return true
  }
  console.log(`  Contracts need deployment: ${verification.error}`)

  const bootstrapScript = join(
    rootDir,
    'packages/deployment/scripts/bootstrap-localnet-complete.ts',
  )

  // Run bootstrap script
  if (!existsSync(bootstrapScript)) {
    console.error(`Bootstrap script not found: ${bootstrapScript}`)
    return false
  }

  try {
    console.log('  Running bootstrap script...')
    await execa('bun', ['run', bootstrapScript], {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        JEJU_RPC_URL: rpcUrl,
        L2_RPC_URL: rpcUrl,
        DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
      },
      timeout: 900000, // 15 minute timeout (full bootstrap can be slow on CI)
    })

    // Verify deployment ON-CHAIN
    const postDeployVerification = await verifyContractsOnChain(rootDir, rpcUrl)
    if (!postDeployVerification.verified) {
      console.error(
        '  Contract deployment verification failed:',
        postDeployVerification.error,
      )
      return false
    }
    return true
  } catch (error) {
    console.error('Contract deployment failed:', error)
    return false
  }
}

/**
 * Wait for contracts to be deployed ON-CHAIN, or deploy them
 * This performs actual on-chain verification, not just file checks.
 */
async function ensureContractsDeployed(
  rootDir: string,
  rpcUrl: string,
): Promise<boolean> {
  // First check if already deployed ON-CHAIN
  const initialCheck = await verifyContractsOnChain(rootDir, rpcUrl)
  if (initialCheck.verified) {
    return true
  }

  // Wait a bit for jeju dev to deploy them
  console.log('Waiting for contracts to be deployed on-chain...')
  for (let i = 0; i < 30; i++) {
    const check = await verifyContractsOnChain(rootDir, rpcUrl)
    if (check.verified) {
      return true
    }
    await Bun.sleep(1000)
  }

  // Deploy ourselves if still not deployed
  console.log('Contracts not deployed on-chain, deploying now...')
  const deployed = await deployContractsIfNeeded(rootDir, rpcUrl)

  if (!deployed) {
    // Final verification to provide clear error
    const finalCheck = await verifyContractsOnChain(rootDir, rpcUrl)
    console.error('  Final verification:', finalCheck.error)
  }

  return deployed
}

/**
 * Setup test infrastructure
 * Uses jeju CLI to start everything
 */
export async function setup(): Promise<void> {
  if (setupComplete) return

  console.log(
    '\n╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    Jeju Test Setup                           ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝\n',
  )

  const rootDir = findJejuWorkspaceRoot()
  console.log(`Monorepo root: ${rootDir}`)

  // Check if infrastructure already running
  let status = await checkInfrastructure()

  if (status.rpc) {
    console.log('✅ Localnet already running (from jeju dev)')
    isExternalInfra = true
  } else {
    console.log('⚠️  Localnet not running')
    console.log('')
    console.log('Please start infrastructure first:')
    console.log('  bun run jeju dev --minimal')
    console.log('')
    console.log('Or use the jeju CLI to run tests:')
    console.log('  bun run jeju test --mode integration')
    console.log('')

    // Try to start jeju dev --minimal in the background
    console.log('Attempting to start jeju dev --minimal...')
    const started = await startJejuDev(rootDir)
    if (!started) {
      console.error('')
      console.error(
        '╔══════════════════════════════════════════════════════════════╗',
      )
      console.error(
        '║  ❌ TESTS CANNOT RUN: Jeju CLI infrastructure required       ║',
      )
      console.error(
        '╠══════════════════════════════════════════════════════════════╣',
      )
      console.error(
        '║  Please start the infrastructure first:                      ║',
      )
      console.error(
        '║                                                              ║',
      )
      console.error(
        '║    bun run jeju dev --minimal                                ║',
      )
      console.error(
        '║                                                              ║',
      )
      console.error(
        '║  Or run tests through the CLI:                               ║',
      )
      console.error(
        '║                                                              ║',
      )
      console.error(
        '║    bun run jeju test --mode integration                      ║',
      )
      console.error(
        '╚══════════════════════════════════════════════════════════════╝',
      )
      console.error('')
      throw new Error(
        'Jeju CLI infrastructure required. Run: bun run jeju dev --minimal',
      )
    }
  }

  // Re-check and set environment variables
  status = await checkInfrastructure()

  // Final check - infrastructure MUST be running
  if (!status.rpc) {
    console.error('')
    console.error(
      '╔══════════════════════════════════════════════════════════════╗',
    )
    console.error(
      '║  ❌ TESTS CANNOT RUN: Localnet RPC not available             ║',
    )
    console.error(
      '╠══════════════════════════════════════════════════════════════╣',
    )
    console.error(
      '║  The Jeju CLI infrastructure is required to run tests.       ║',
    )
    console.error(
      '║                                                              ║',
    )
    console.error(
      '║  Start with: bun run jeju dev --minimal                      ║',
    )
    console.error(
      '╚══════════════════════════════════════════════════════════════╝',
    )
    console.error('')
    throw new Error(
      'Localnet RPC not available. Run: bun run jeju dev --minimal',
    )
  }

  // Contracts MUST be deployed - enforce this
  const contractsReady = await ensureContractsDeployed(rootDir, status.rpcUrl)
  if (!contractsReady) {
    console.error('')
    console.error(
      '╔══════════════════════════════════════════════════════════════╗',
    )
    console.error(
      '║  ❌ TESTS CANNOT RUN: Contracts not deployed                 ║',
    )
    console.error(
      '╠══════════════════════════════════════════════════════════════╣',
    )
    console.error(
      '║  Contracts are required for tests to run.                    ║',
    )
    console.error(
      '║                                                              ║',
    )
    console.error(
      '║  Start with: bun run jeju dev                                ║',
    )
    console.error(
      '║  Or deploy:  bun run packages/deployment/scripts/bootstrap-localnet-complete.ts ║',
    )
    console.error(
      '╚══════════════════════════════════════════════════════════════╝',
    )
    console.error('')
    throw new Error('Contracts not deployed. Run: bun run jeju dev')
  }
  console.log('✅ Contracts deployed and verified')

  setEnvVars(status)

  // Create test output directory
  const outputDir = join(process.cwd(), 'test-results')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Write setup info
  writeFileSync(
    join(outputDir, 'setup.json'),
    JSON.stringify(
      {
        rpcUrl: status.rpcUrl,
        dwsUrl: status.dwsUrl,
        docker: status.docker,
        startTime: new Date().toISOString(),
        external: isExternalInfra,
      },
      null,
      2,
    ),
  )

  setupComplete = true
  console.log('\n=== Setup Complete ===\n')
}

function setEnvVars(status: InfraStatus): void {
  const host = getLocalhostHost()

  // Set RPC URLs for child processes
  process.env.L1_RPC_URL = `http://${host}:${L1_PORT}`
  process.env.L2_RPC_URL = status.rpcUrl
  process.env.JEJU_RPC_URL = status.rpcUrl
  process.env.JEJU_L1_RPC_URL = `http://${host}:${L1_PORT}`
  process.env.DWS_URL = status.dwsUrl

  // Standard localnet test wallet (Anvil default)
  process.env.DEPLOYER_PRIVATE_KEY = TEST_ACCOUNTS.DEPLOYER.privateKey
  process.env.TEST_WALLET_ADDRESS = TEST_ACCOUNTS.DEPLOYER.address

  // Use config helpers for service URLs
  process.env.STORAGE_API_URL =
    getStorageApiEndpoint() || `${status.dwsUrl}/storage`
  process.env.COMPUTE_MARKETPLACE_URL =
    getDWSComputeUrl() ||
    getServiceUrl('compute', 'marketplace') ||
    `${status.dwsUrl}/compute`
  process.env.IPFS_GATEWAY =
    getServiceUrl('storage', 'ipfsGateway') || `${status.dwsUrl}/cdn`
  process.env.CDN_URL = `${status.dwsUrl}/cdn`

  // Docker service URLs - use config helpers
  const sqlitUrl = getSQLitBlockProducerUrl()
  process.env.SQLIT_URL = sqlitUrl
  process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT = sqlitUrl
  process.env.IPFS_API_URL = getIpfsApiUrl() || `http://${host}:5001`
}

/**
 * Teardown test infrastructure
 */
export async function teardown(): Promise<void> {
  if (!setupComplete) return

  // Don't stop externally managed infrastructure
  if (isExternalInfra) {
    console.log('Skipping teardown (external infrastructure)')
    return
  }

  console.log('\n=== Test Teardown ===\n')

  // Stop jeju dev process (it will clean up its children)
  await stopProcess(jejuDevProcess)
  jejuDevProcess = null

  setupComplete = false
  console.log('Teardown complete')
}

/**
 * Get current infrastructure status
 */
export async function getStatus(): Promise<InfraStatus> {
  return checkInfrastructure()
}

/**
 * Check if setup has been run
 */
export function isReady(): boolean {
  return setupComplete
}

// Handle process exit
process.on('beforeExit', async () => {
  await teardown()
})

process.on('SIGINT', async () => {
  await teardown()
  process.exit(130)
})

process.on('SIGTERM', async () => {
  await teardown()
  process.exit(143)
})

// Auto-run setup when imported as preload
// Always run setup - the bunfig.toml preload ensures this only runs for tests
await setup()

export default { setup, teardown, getStatus, isReady }
