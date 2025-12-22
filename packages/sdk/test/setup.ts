/**
 * Test Setup - Auto-starts services for integration tests
 *
 * This setup automatically starts localnet and required services
 * before tests run, and cleans up afterward.
 *
 * Usage:
 *   bun test --preload ./test/setup.ts
 *   OR: import './setup' in test files
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getL1RpcUrl,
  getL2RpcUrl,
  INFRA_PORTS,
} from '@jejunetwork/config/ports'
import { execa, type ResultPromise } from 'execa'
import type { Hex } from 'viem'
import { RPCGetCodeResponseSchema } from '../src/shared/schemas'

// Configuration
const TEST_LOCK_FILE = '/tmp/jeju-test-services.lock'
const STARTUP_TIMEOUT = 60000
const DEPLOYER_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Service URLs - using centralized port configuration
export const TEST_RPC_URL = process.env.TEST_RPC_URL || getL2RpcUrl()
export const TEST_L1_RPC_URL = process.env.TEST_L1_RPC_URL || getL1RpcUrl()
export const TEST_STORAGE_URL =
  process.env.TEST_STORAGE_URL || getCoreAppUrl('IPFS')
export const TEST_COMPUTE_URL =
  process.env.TEST_COMPUTE_URL || getCoreAppUrl('COMPUTE')
export const TEST_GATEWAY_URL =
  process.env.TEST_GATEWAY_URL || getCoreAppUrl('NODE_EXPLORER_UI')
export const TEST_PRIVATE_KEY = DEPLOYER_KEY

// Track processes we start
let startedProcesses: ResultPromise[] = []
let servicesStarted = false
let rootDir: string | null = null

/**
 * Find the monorepo root
 */
function findRoot(): string {
  if (rootDir) return rootDir

  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      rootDir = dir
      return dir
    }
    dir = resolve(dir, '..')
  }
  return process.cwd()
}

/**
 * Check if a service is healthy
 */
async function isServiceHealthy(url: string, isRpc = false): Promise<boolean> {
  try {
    if (isRpc) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          id: 1,
        }),
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    }

    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Wait for a service to become healthy
 */
async function waitForService(
  name: string,
  url: string,
  isRpc = false,
  timeout = 30000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await isServiceHealthy(url, isRpc)) {
      console.log(`✓ ${name} ready`)
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`${name} did not start within ${timeout}ms`)
}

/**
 * Check if another test process is managing services
 */
function isLocked(): boolean {
  if (!existsSync(TEST_LOCK_FILE)) return false

  try {
    const lockData = JSON.parse(readFileSync(TEST_LOCK_FILE, 'utf-8'))
    const age = Date.now() - lockData.timestamp
    // Lock expires after 5 minutes
    return age < 300000
  } catch {
    return false
  }
}

/**
 * Acquire lock for service management
 */
function acquireLock(): boolean {
  if (isLocked()) return false

  writeFileSync(
    TEST_LOCK_FILE,
    JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(),
    }),
  )
  return true
}

/**
 * Release lock
 */
function releaseLock(): void {
  try {
    if (existsSync(TEST_LOCK_FILE)) {
      const lockData = JSON.parse(readFileSync(TEST_LOCK_FILE, 'utf-8'))
      if (lockData.pid === process.pid) {
        unlinkSync(TEST_LOCK_FILE)
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Start localnet using Anvil
 */
async function startLocalnet(): Promise<void> {
  const root = findRoot()
  const l2Port = INFRA_PORTS.L2_RPC.DEFAULT.toString()
  console.log(`Starting Anvil localnet on port ${l2Port}...`)

  // Add common foundry paths to PATH
  const homeDir = process.env.HOME || `/home/${process.env.USER}`
  const foundryBin = join(homeDir, '.foundry/bin')
  const path = `${foundryBin}:${process.env.PATH}`

  // Start L2 Anvil using centralized port configuration
  const proc = execa(
    'anvil',
    [
      '--port',
      l2Port,
      '--chain-id',
      '1337',
      '--accounts',
      '10',
      '--balance',
      '10000',
      '--silent',
    ],
    {
      cwd: root,
      stdio: 'pipe',
      detached: true,
      env: { ...process.env, PATH: path },
    },
  )
  startedProcesses.push(proc)

  await waitForService('Chain', TEST_RPC_URL, true, STARTUP_TIMEOUT)
}

/**
 * Deploy contracts to localnet
 */
async function deployContracts(): Promise<void> {
  const root = findRoot()
  const contractsDir = join(root, 'packages/contracts')

  if (!existsSync(join(contractsDir, 'foundry.toml'))) {
    console.log('No contracts to deploy')
    return
  }

  console.log('Deploying contracts...')

  try {
    await execa(
      'forge',
      [
        'script',
        'deploy/Deploy.s.sol:DeployAll',
        '--rpc-url',
        TEST_RPC_URL,
        '--private-key',
        DEPLOYER_KEY,
        '--broadcast',
      ],
      {
        cwd: contractsDir,
        stdio: 'pipe',
      },
    )
    console.log('✓ Contracts deployed')
  } catch {
    console.log('⚠ Contract deployment failed (may already be deployed)')
  }
}

/**
 * Start app services (storage, compute, gateway)
 *
 * NOTE: Services should be started externally via `bun run dev` or docker-compose.
 * This function will skip starting services by default to avoid complex startup issues.
 */
async function startServices(): Promise<void> {
  // Skip service startup - services should be started externally
  // Use `bun run dev` or docker-compose to start services
  console.log(
    '⚠ Service auto-start disabled. Start services manually with: jeju dev',
  )
  console.log('   Or run: bun run dev in apps/gateway, apps/dws')

  // Skip service startup in CI or when SKIP_SERVICES is set (default behavior)
  if (!process.env.START_SERVICES) {
    console.log('⚠ Set START_SERVICES=1 to attempt service startup')
    return
  }

  const root = findRoot()

  // Services with their package.json locations and start commands
  const services = [
    {
      name: 'Gateway',
      dir: 'apps/gateway',
      port: CORE_PORTS.NODE_EXPLORER_UI.DEFAULT,
      cmd: 'bun run dev:a2a',
    },
    {
      name: 'DWS',
      dir: 'apps/dws',
      port: CORE_PORTS.COMPUTE.DEFAULT,
      cmd: 'bun run dev:server',
    },
  ]

  for (const svc of services) {
    const svcDir = join(root, svc.dir)
    const pkgJson = join(svcDir, 'package.json')

    if (!existsSync(pkgJson)) {
      console.log(`⚠ ${svc.name} package.json not found at ${svcDir}`)
      continue
    }

    console.log(`Starting ${svc.name}...`)

    try {
      const [cmd, ...args] = svc.cmd.split(' ')
      const proc = execa(cmd, args, {
        cwd: svcDir,
        stdio: 'pipe',
        detached: true,
        env: {
          ...process.env,
          PORT: String(svc.port),
          RPC_URL: TEST_RPC_URL,
          CHAIN_ID: '1337',
        },
      })
      startedProcesses.push(proc)
    } catch {
      console.log(`⚠ Failed to start ${svc.name}`)
    }
  }

  // Wait for services with short timeout (10s each)
  await Promise.all([
    waitForService('Storage', TEST_STORAGE_URL, false, 10000).catch(() =>
      console.log('⚠ Storage not available'),
    ),
    waitForService('Compute', TEST_COMPUTE_URL, false, 10000).catch(() =>
      console.log('⚠ Compute not available'),
    ),
    waitForService('Gateway', TEST_GATEWAY_URL, false, 10000).catch(() =>
      console.log('⚠ Gateway not available'),
    ),
  ])
}

/**
 * Stop all started services
 */
async function stopServices(): Promise<void> {
  console.log('Stopping test services...')

  for (const proc of startedProcesses) {
    try {
      proc.kill('SIGTERM')
    } catch {
      // Ignore
    }
  }

  startedProcesses = []
  releaseLock()
}

/**
 * Check if contracts are deployed by checking if compute registry exists
 */
async function checkContractsDeployed(): Promise<boolean> {
  // Try to call a simple read function on a known contract address
  // If it fails, contracts aren't deployed
  try {
    const response = await fetch(TEST_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: ['0x5FbDB2315678afecb367f032d93F642f64180aa3', 'latest'], // Common first deploy address
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    const rawData: unknown = await response.json()
    const result = RPCGetCodeResponseSchema.parse(rawData)
    // If there's code at this address, contracts might be deployed
    return (
      result.result !== '0x' &&
      result.result !== undefined &&
      result.result.length > 2
    )
  } catch {
    return false
  }
}

/**
 * Initialize test environment
 * Call this in beforeAll() or at start of tests
 */
export async function setupTestEnvironment(): Promise<{
  rpcUrl: string
  storageUrl: string
  computeUrl: string
  gatewayUrl: string
  privateKey: Hex
  chainRunning: boolean
  contractsDeployed: boolean
  servicesRunning: boolean
}> {
  // Check if services are already running
  const chainRunning = await isServiceHealthy(TEST_RPC_URL, true)
  const storageRunning = await isServiceHealthy(TEST_STORAGE_URL)
  const computeRunning = await isServiceHealthy(TEST_COMPUTE_URL)
  const gatewayRunning = await isServiceHealthy(TEST_GATEWAY_URL)

  if (chainRunning && storageRunning && computeRunning && gatewayRunning) {
    console.log('All services already running')
    return {
      rpcUrl: TEST_RPC_URL,
      storageUrl: TEST_STORAGE_URL,
      computeUrl: TEST_COMPUTE_URL,
      gatewayUrl: TEST_GATEWAY_URL,
      privateKey: TEST_PRIVATE_KEY,
      chainRunning: true,
      contractsDeployed: true,
      servicesRunning: true,
    }
  }

  // Try to acquire lock and start services
  if (!servicesStarted && acquireLock()) {
    try {
      if (!chainRunning) {
        await startLocalnet()
        await deployContracts()
      }

      if (!storageRunning || !computeRunning || !gatewayRunning) {
        await startServices()
      }

      servicesStarted = true

      // Register cleanup
      process.on('exit', stopServices)
      process.on('SIGINT', async () => {
        await stopServices()
        process.exit(130)
      })
      process.on('SIGTERM', async () => {
        await stopServices()
        process.exit(143)
      })
    } catch (error) {
      console.error('Failed to start services:', error)
      releaseLock()
    }
  }

  // Final status check
  const finalChainStatus = await isServiceHealthy(TEST_RPC_URL, true)
  const contractsDeployed = finalChainStatus && (await checkContractsDeployed())
  const finalServicesStatus =
    (await isServiceHealthy(TEST_STORAGE_URL)) &&
    (await isServiceHealthy(TEST_COMPUTE_URL)) &&
    (await isServiceHealthy(TEST_GATEWAY_URL))

  if (finalChainStatus && !contractsDeployed) {
    console.log('⚠ Chain running but contracts not deployed')
  }

  return {
    rpcUrl: TEST_RPC_URL,
    storageUrl: TEST_STORAGE_URL,
    computeUrl: TEST_COMPUTE_URL,
    gatewayUrl: TEST_GATEWAY_URL,
    privateKey: TEST_PRIVATE_KEY,
    chainRunning: finalChainStatus,
    contractsDeployed,
    servicesRunning: finalServicesStatus,
  }
}

/**
 * Cleanup test environment
 * Call this in afterAll()
 */
export async function teardownTestEnvironment(): Promise<void> {
  await stopServices()
}

// Export for easy testing
export { isServiceHealthy, waitForService, stopServices }
