#!/usr/bin/env bun

/**
 * Local Development Stack
 *
 * Starts all Jeju services locally with:
 * - SQLit (required for decentralized state persistence)
 * - Simulated TEE (exact same config as testnet, just simulated)
 * - All apps running through DWS workerd where possible
 * - Service discovery via local registry
 *
 * Usage:
 *   bun run scripts/local-stack.ts
 *   bun run scripts/local-stack.ts --apps autocrat,bazaar
 *   bun run scripts/local-stack.ts --verbose
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getContract, getLocalhostHost, getRpcUrl } from '@jejunetwork/config'
import { type Subprocess, spawn } from 'bun'
import { JEJU_APPS, type JejuAppName } from '../api/workers/app-sdk'
import { getRegionConfig } from '../api/workers/tee/regions'
import type { NetworkEnvironment } from '../api/workers/tee/types'

// SQLit configuration
const SQLIT_PORT = 8546
const SQLIT_DATA_DIR = join(process.cwd(), '.local-stack', 'sqlit')
let sqlitProcess: Subprocess | null = null

// Configuration

interface StackConfig {
  environment: NetworkEnvironment
  apps: JejuAppName[]
  verbose: boolean
  dataDir: string
  rpcUrl: string
  contracts: {
    identityRegistry: string
    serviceRegistry: string
    agentVault: string
    roomRegistry: string
    triggerRegistry: string
  }
}

const DEFAULT_APPS: JejuAppName[] = [
  'dws',
  'gateway',
  'indexer',
  'autocrat',
  'bazaar',
  'factory',
  'crucible',
  'vpn',
]

function parseArgs(): Partial<StackConfig> {
  const args = process.argv.slice(2)
  const config: Partial<StackConfig> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = args[i + 1]

    switch (arg) {
      case '--env':
      case '-e':
        config.environment = value as NetworkEnvironment
        i++
        break
      case '--apps':
      case '-a':
        config.apps = value.split(',') as JejuAppName[]
        i++
        break
      case '--verbose':
      case '-v':
        config.verbose = true
        break
      case '--rpc':
        config.rpcUrl = value
        i++
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return config
}

function printHelp(): void {
  console.log(`
Local Development Stack

Starts all Jeju services with simulated TEE, exactly matching testnet config.

Usage:
  bun run scripts/local-stack.ts [options]

Options:
  --env, -e <env>       Environment: localnet (default), testnet
  --apps, -a <apps>     Comma-separated list of apps to start (default: all)
  --verbose, -v         Show verbose output from all services
  --rpc <url>           RPC URL (default: from config)
  --help, -h            Show this help

Apps:
${Object.entries(JEJU_APPS)
  .map(
    ([name, config]) =>
      `  ${name.padEnd(15)} :${config.port} - ${config.description}`,
  )
  .join('\n')}

Examples:
  # Start all services
  bun run scripts/local-stack.ts

  # Start specific apps
  bun run scripts/local-stack.ts --apps autocrat,bazaar,dws

  # Verbose mode
  bun run scripts/local-stack.ts --verbose
`)
}

// SQLit Management

async function startSQLit(config: StackConfig): Promise<void> {
  console.log(`[Stack] Starting SQLit on port ${SQLIT_PORT}`)

  // Ensure data directory exists
  await mkdir(SQLIT_DATA_DIR, { recursive: true })

  // Check if adapter exists
  const adapterPath = join(process.cwd(), '..', '..', 'packages', 'sqlit', 'adapter')
  const serverPath = join(adapterPath, 'server.ts')

  if (!existsSync(serverPath)) {
    throw new Error(
      `SQLit adapter not found at ${serverPath}. ` +
        'Run: cd packages/sqlit/adapter && bun install',
    )
  }

  const host = getLocalhostHost()
  const env: Record<string, string> = {
    ...process.env,
    PORT: String(SQLIT_PORT),
    DATA_DIR: SQLIT_DATA_DIR,
  }

  sqlitProcess = spawn(['bun', 'run', 'server.ts'], {
    cwd: adapterPath,
    env,
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  })

  // Wait for SQLit to be ready
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const healthy = await fetch(`http://${host}:${SQLIT_PORT}/v1/status`)
      .then((r) => r.ok)
      .catch(() => false)
    if (healthy) {
      console.log(`[Stack] SQLit ready at http://${host}:${SQLIT_PORT}`)
      return
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  throw new Error(
    'SQLit did not start within timeout. Check logs for errors.',
  )
}

async function stopSQLit(): Promise<void> {
  if (sqlitProcess) {
    console.log('  Stopping SQLit...')
    sqlitProcess.kill()
    sqlitProcess = null
  }
}

// Service Management

interface RunningService {
  name: string
  port: number
  process: Subprocess
  startedAt: number
  ready: boolean
}

const services = new Map<string, RunningService>()

async function startService(
  name: JejuAppName,
  config: StackConfig,
): Promise<RunningService> {
  const appConfig = JEJU_APPS[name]
  if (!appConfig) {
    throw new Error(`Unknown app: ${name}`)
  }

  console.log(`[Stack] Starting ${name} on port ${appConfig.port}`)

  // Build environment
  const host = getLocalhostHost()
  const env: Record<string, string> = {
    ...process.env,
    PORT: String(appConfig.port),
    NETWORK: config.environment,
    RPC_URL: config.rpcUrl,
    DWS_URL: `http://${host}:${JEJU_APPS.dws.port}`,
    IDENTITY_REGISTRY_ADDRESS: config.contracts.identityRegistry,
    SERVICE_REGISTRY_ADDRESS: config.contracts.serviceRegistry,
    AGENT_VAULT_ADDRESS: config.contracts.agentVault,
    ROOM_REGISTRY_ADDRESS: config.contracts.roomRegistry,
    TRIGGER_REGISTRY_ADDRESS: config.contracts.triggerRegistry,
    // TEE simulation
    TEE_MODE: 'simulated',
    DSTACK_ENDPOINT: '',
    // Service URLs
    COMPUTE_MARKETPLACE_URL: `http://${host}:${JEJU_APPS.dws.port}`,
    STORAGE_API_URL: `http://${host}:${JEJU_APPS.dws.port}`,
    IPFS_GATEWAY: `http://${host}:${JEJU_APPS.dws.port}/ipfs`,
    INDEXER_GRAPHQL_URL: `http://${host}:${JEJU_APPS.indexer.port}/graphql`,
    GATEWAY_URL: `http://${host}:${JEJU_APPS.gateway.port}`,
    // Local development flags
    NODE_ENV: 'development',
    LOG_LEVEL: config.verbose ? 'debug' : 'info',
  }

  // Determine the start command based on app
  const appDir = join(process.cwd(), '..', name)
  let cmd: string[]

  switch (name) {
    case 'dws':
      cmd = ['bun', 'run', 'api/server/index.ts']
      break
    case 'indexer':
      cmd = ['bun', 'run', 'start']
      break
    case 'gateway':
      cmd = ['bun', 'run', 'src/rpc/server.ts']
      break
    case 'vpn':
      cmd = ['bun', 'run', 'api/index.ts']
      break
    default:
      cmd = ['bun', 'run', 'src/server.ts']
  }

  const proc = spawn(cmd, {
    cwd: appDir,
    env,
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  })

  const service: RunningService = {
    name,
    port: appConfig.port,
    process: proc,
    startedAt: Date.now(),
    ready: false,
  }

  services.set(name, service)

  // Wait for service to be ready
  await waitForService(service, 30000)

  return service
}

async function waitForService(
  service: RunningService,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const healthy = await checkHealth(service.port)
    if (healthy) {
      service.ready = true
      const host = getLocalhostHost()
      console.log(
        `[Stack] ${service.name} ready at http://${host}:${service.port}`,
      )
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(
    `[Stack] Warning: ${service.name} did not become ready (continuing)`,
  )
}

async function checkHealth(port: number): Promise<boolean> {
  const host = getLocalhostHost()
  return fetch(`http://${host}:${port}/health`)
    .then((r) => r.ok)
    .catch(() => false)
}

async function stopAllServices(): Promise<void> {
  console.log('\n[Stack] Stopping all services')

  for (const [name, service] of services) {
    console.log(`  Stopping ${name}...`)
    service.process.kill()
  }

  services.clear()

  // Stop SQLit last
  await stopSQLit()
}

// Stack Orchestration

async function startStack(config: StackConfig): Promise<void> {
  const regionConfig = getRegionConfig(config.environment)
  const host = getLocalhostHost()
  const sqlitUrl = `http://${host}:${SQLIT_PORT}`

  console.log('\n╔════════════════════════════════════════════════════════╗')
  console.log('║           JEJU LOCAL DEVELOPMENT STACK                 ║')
  console.log('╠════════════════════════════════════════════════════════╣')
  console.log(`║ Environment: ${config.environment.padEnd(42)}║`)
  console.log(`║ TEE Mode:    simulated (same config as testnet)       ║`)
  console.log(
    `║ Regions:     ${regionConfig.regions
      .map((r) => r.id)
      .join(', ')
      .padEnd(42)}║`,
  )
  console.log(`║ RPC:         ${config.rpcUrl.padEnd(42)}║`)
  console.log(`║ SQLit:       ${sqlitUrl.padEnd(42)}║`)
  console.log('╚════════════════════════════════════════════════════════╝\n')

  // Create data directory
  await mkdir(config.dataDir, { recursive: true })

  // 1. Start SQLit first - required for all apps
  console.log('[Stack] Phase 1: Starting SQLit (decentralized database)')
  await startSQLit(config)

  // Set SQLit URL for all services
  process.env.SQLIT_URL = sqlitUrl
  process.env.SQLIT_MINER_URL = sqlitUrl

  // 2. Start services in dependency order
  console.log('\n[Stack] Phase 2: Starting services')
  const startOrder: JejuAppName[] = []

  // Core infrastructure first
  if (config.apps.includes('dws')) startOrder.push('dws')
  if (config.apps.includes('indexer')) startOrder.push('indexer')
  if (config.apps.includes('gateway')) startOrder.push('gateway')

  // Then application services
  for (const app of config.apps) {
    if (!startOrder.includes(app)) {
      startOrder.push(app)
    }
  }

  for (const app of startOrder) {
    await startService(app, config)
  }

  console.log('\n╔════════════════════════════════════════════════════════╗')
  console.log('║              ALL SERVICES STARTED                       ║')
  console.log('╠════════════════════════════════════════════════════════╣')

  // Show SQLit status first
  console.log(`║ [OK] sqlit        http://${host}:${SQLIT_PORT}`.padEnd(57) + '║')

  for (const [name, service] of services) {
    const status = service.ready ? '[OK]' : '[--]'
    const url = `http://${host}:${service.port}`
    console.log(`║ ${status} ${name.padEnd(12)} ${url.padEnd(35)}║`)
  }

  console.log('╠════════════════════════════════════════════════════════╣')
  console.log('║ SQLit: Decentralized database persistence enabled      ║')
  console.log('║ Press Ctrl+C to stop all services                      ║')
  console.log('╚════════════════════════════════════════════════════════╝\n')
}

// Main

async function main(): Promise<void> {
  const args = parseArgs()

  const config: StackConfig = {
    environment: args.environment ?? 'localnet',
    apps: args.apps ?? DEFAULT_APPS,
    verbose: args.verbose ?? false,
    dataDir: join(process.cwd(), '.local-stack'),
    rpcUrl: args.rpcUrl ?? getRpcUrl('localnet'),
    // Contract addresses - zero means feature disabled until deployed
    contracts: {
      identityRegistry:
        process.env.IDENTITY_REGISTRY_ADDRESS ??
        getContract('registry', 'identity', 'localnet') ??
        '0x0000000000000000000000000000000000000000',
      serviceRegistry:
        process.env.SERVICE_REGISTRY_ADDRESS ??
        getContract('registry', 'service', 'localnet') ??
        '0x0000000000000000000000000000000000000000',
      agentVault:
        process.env.AGENT_VAULT_ADDRESS ??
        getContract('agents', 'agentVault', 'localnet') ??
        '0x0000000000000000000000000000000000000000',
      roomRegistry:
        process.env.ROOM_REGISTRY_ADDRESS ??
        getContract('agents', 'roomRegistry', 'localnet') ??
        '0x0000000000000000000000000000000000000000',
      triggerRegistry:
        process.env.TRIGGER_REGISTRY_ADDRESS ??
        getContract('agents', 'triggerRegistry', 'localnet') ??
        '0x0000000000000000000000000000000000000000',
    },
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    await stopAllServices()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await stopAllServices()
    process.exit(0)
  })

  await startStack(config)

  // Keep process running
  await new Promise(() => {})
}

main().catch((err) => {
  console.error('[Stack] Failed:', err.message)
  process.exit(1)
})
