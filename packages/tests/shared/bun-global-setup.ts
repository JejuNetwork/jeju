/**
 * Bun Global Test Setup
 *
 * Handles test infrastructure setup for bun test runs.
 * Works in two modes:
 * 1. Standalone: Starts localnet + DWS services
 * 2. Managed: Detects existing infrastructure from `jeju test`
 *
 * REQUIRED INFRASTRUCTURE:
 * - Docker services (CQL, IPFS, Cache, DA)
 * - Localnet (Anvil)
 * - DWS server
 *
 * No fallbacks - all infrastructure must be running.
 *
 * Usage in bunfig.toml:
 *   preload = ["@jejunetwork/tests/bun-global-setup"]
 *
 * Or programmatically:
 *   import { bunSetup, bunTeardown } from '@jejunetwork/tests';
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getCQLBlockProducerUrl,
  getIpfsApiUrl,
  INFRA_PORTS,
} from '@jejunetwork/config'
import type { Subprocess } from 'bun'
import type { InfraStatus } from './schemas'
import {
  checkContractsDeployed,
  findJejuWorkspaceRoot,
  getRpcUrl,
  isRpcAvailable,
  isServiceAvailable,
} from './utils'

// Infrastructure state
let localnetProcess: Subprocess | null = null
let dwsProcess: Subprocess | null = null
let setupComplete = false
let isExternalInfra = false

// Default ports
const LOCALNET_PORT = 9545
const DWS_PORT = 4030

// Docker service ports
const DOCKER_SERVICES = {
  cql: {
    port: INFRA_PORTS.CQL.get(),
    healthPath: '/health',
    name: 'CovenantSQL',
  },
  ipfs: {
    port: CORE_PORTS.IPFS_API.DEFAULT,
    healthPath: '/api/v0/id',
    name: 'IPFS',
  },
  cache: { port: 4115, healthPath: '/health', name: 'Cache Service' },
  da: { port: 4010, healthPath: '/health', name: 'DA Server' },
} as const

// Environment URLs
const RPC_URL = getRpcUrl()
const DWS_URL = process.env.DWS_URL ?? `http://127.0.0.1:${DWS_PORT}`

async function checkDockerService(
  port: number,
  healthPath: string,
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}${healthPath}`
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
  const [rpc, dws, docker] = await Promise.all([
    isRpcAvailable(RPC_URL),
    isServiceAvailable(`${DWS_URL}/health`),
    checkDockerServices(),
  ])

  return { rpc, dws, docker, rpcUrl: RPC_URL, dwsUrl: DWS_URL }
}

async function startLocalnet(rootDir: string): Promise<void> {
  console.log('Starting localnet...')

  // Check if anvil is available
  const anvil = Bun.which('anvil')
  if (!anvil) {
    throw new Error(
      'Anvil not found. Install foundry: curl -L https://foundry.paradigm.xyz | bash',
    )
  }

  localnetProcess = Bun.spawn(
    [anvil, '--port', String(LOCALNET_PORT), '--chain-id', '31337'],
    {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  // Wait for localnet to be ready
  for (let i = 0; i < 30; i++) {
    if (await isRpcAvailable(`http://127.0.0.1:${LOCALNET_PORT}`)) {
      console.log('Localnet ready')
      return
    }
    await Bun.sleep(1000)
  }

  throw new Error('Localnet failed to start')
}

async function startDws(rootDir: string): Promise<void> {
  console.log('Starting DWS...')

  const dwsPath = join(rootDir, 'apps', 'dws')
  if (!existsSync(dwsPath)) {
    throw new Error('DWS app not found')
  }

  dwsProcess = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: dwsPath,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
    },
  })

  // Wait for DWS to be ready
  for (let i = 0; i < 30; i++) {
    if (await isServiceAvailable(`http://127.0.0.1:${DWS_PORT}/health`)) {
      console.log('DWS ready')
      return
    }
    await Bun.sleep(1000)
  }

  throw new Error('DWS failed to start')
}

async function bootstrapContracts(rootDir: string): Promise<boolean> {
  const rpcUrl = `http://127.0.0.1:${LOCALNET_PORT}`

  // Check if contracts are already deployed
  if (await checkContractsDeployed(rpcUrl)) {
    console.log('Contracts already deployed')
    return true
  }

  console.log('Bootstrapping contracts...')

  const bootstrapScript = join(rootDir, 'scripts', 'bootstrap-localnet.ts')
  if (!existsSync(bootstrapScript)) {
    console.warn('Bootstrap script not found, skipping contract deployment')
    return false
  }

  const proc = Bun.spawn(['bun', 'run', bootstrapScript], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      L2_RPC_URL: rpcUrl,
      JEJU_RPC_URL: rpcUrl,
    },
  })

  const exitCode = await proc.exited
  if (exitCode === 0) {
    console.log('Contracts bootstrapped')
    return true
  }

  console.warn('Bootstrap failed, continuing without contracts')
  return false
}

async function stopProcess(proc: Subprocess | null): Promise<void> {
  if (!proc) return

  try {
    proc.kill()
    await proc.exited
  } catch {
    // Process may already be dead
  }
}

async function startDockerServices(rootDir: string): Promise<boolean> {
  console.log('Starting Docker services...')

  const proc = Bun.spawn(
    [
      'docker',
      'compose',
      'up',
      '-d',
      'cql',
      'ipfs',
      'cache-service',
      'da-server',
    ],
    {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    return false
  }

  // Wait for services to be healthy
  for (let attempt = 0; attempt < 30; attempt++) {
    const results = await checkDockerServices()
    if (Object.values(results).every(Boolean)) {
      return true
    }
    await Bun.sleep(1000)
  }

  return false
}

/**
 * Setup test infrastructure
 * Call this in beforeAll or as a preload
 */
export async function setup(): Promise<void> {
  if (setupComplete) return

  console.log(
    '\n╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                       Test Setup                             ║',
  )
  console.log(
    '║  All infrastructure required - no fallbacks.                 ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝\n',
  )

  const rootDir = findJejuWorkspaceRoot()
  console.log(`Monorepo root: ${rootDir}`)

  // Check if infrastructure already running (from jeju test or manual start)
  let status = await checkInfrastructure()

  // Check Docker services first
  const dockerMissing = Object.entries(status.docker)
    .filter(([, running]) => !running)
    .map(
      ([key]) =>
        DOCKER_SERVICES[key as keyof typeof DOCKER_SERVICES]?.name ?? key,
    )

  if (dockerMissing.length > 0) {
    console.log('Missing Docker services:', dockerMissing.join(', '))

    // Try to start Docker services
    if (!(await startDockerServices(rootDir))) {
      console.error(
        '❌ Failed to start Docker services. Run: docker compose up -d',
      )
      throw new Error('Docker services not available')
    }

    // Re-check
    status = await checkInfrastructure()
    const stillMissing = Object.entries(status.docker)
      .filter(([, running]) => !running)
      .map(
        ([key]) =>
          DOCKER_SERVICES[key as keyof typeof DOCKER_SERVICES]?.name ?? key,
      )

    if (stillMissing.length > 0) {
      console.error(
        '❌ Docker services still not healthy:',
        stillMissing.join(', '),
      )
      throw new Error('Docker services not available')
    }
  }

  for (const [key, running] of Object.entries(status.docker)) {
    const name =
      DOCKER_SERVICES[key as keyof typeof DOCKER_SERVICES]?.name ?? key
    console.log(`  ${running ? '✅' : '❌'} ${name}`)
  }

  // Check/start localnet
  if (!status.rpc) {
    await startLocalnet(rootDir)
  } else {
    console.log('✅ RPC already running')
  }

  // Bootstrap contracts by default in dev (set BOOTSTRAP_CONTRACTS=false to skip)
  const shouldBootstrap = process.env.BOOTSTRAP_CONTRACTS !== 'false'
  if (shouldBootstrap) {
    await bootstrapContracts(rootDir)
  }

  // Check/start DWS
  if (!status.dws) {
    await startDws(rootDir)
  } else {
    console.log('✅ DWS already running')
  }

  // Set environment variables
  const newStatus = await checkInfrastructure()
  setEnvVars(newStatus)

  // Mark as external if everything was already running
  isExternalInfra =
    status.rpc && status.dws && Object.values(status.docker).every(Boolean)

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
        rpcUrl: newStatus.rpcUrl,
        dwsUrl: newStatus.dwsUrl,
        docker: newStatus.docker,
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
  process.env.L2_RPC_URL = status.rpcUrl
  process.env.JEJU_RPC_URL = status.rpcUrl
  process.env.DWS_URL = status.dwsUrl
  process.env.STORAGE_API_URL = `${status.dwsUrl}/storage`
  process.env.COMPUTE_MARKETPLACE_URL = `${status.dwsUrl}/compute`
  process.env.IPFS_GATEWAY = `${status.dwsUrl}/cdn`
  process.env.CDN_URL = `${status.dwsUrl}/cdn`

  // Docker service URLs
  process.env.CQL_URL = getCQLBlockProducerUrl()
  process.env.CQL_BLOCK_PRODUCER_ENDPOINT = getCQLBlockProducerUrl()
  process.env.IPFS_API_URL = getIpfsApiUrl()
  process.env.DA_URL = 'http://127.0.0.1:4010'
  process.env.CACHE_URL = 'http://127.0.0.1:4115'
}

/**
 * Teardown test infrastructure
 * Call this in afterAll
 */
export async function teardown(): Promise<void> {
  if (!setupComplete) return

  // Don't stop externally managed infrastructure
  if (isExternalInfra) {
    console.log('Skipping teardown (external infrastructure)')
    return
  }

  console.log('\n=== Test Teardown ===\n')

  await stopProcess(dwsProcess)
  dwsProcess = null

  await stopProcess(localnetProcess)
  localnetProcess = null

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
if (process.env.BUN_TEST === 'true' || process.argv.includes('test')) {
  setup().catch(console.error)
}

export default { setup, teardown, getStatus, isReady }
