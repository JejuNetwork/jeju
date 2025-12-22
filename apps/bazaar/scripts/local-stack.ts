/**
 * Bazaar Local Development Stack
 *
 * Starts a REAL local development environment with:
 * 1. Local Ethereum devnet (anvil)
 * 2. DWS server with REAL workerd runtime (TEE in simulated mode)
 * 3. Bazaar worker deployed to workerd
 * 4. Frontend serving from static files
 *
 * This is NOT a mock - workerd actually runs your worker code in V8 isolates.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Subprocess, spawn } from 'bun'
import { DWSFunctionDeployResponseSchema } from '../schemas/api'

// ============================================================================
// Configuration
// ============================================================================

interface LocalStackConfig {
  devnetPort: number
  dwsPort: number
  frontendPort: number
  dataDir: string
  verbose: boolean
  skipDevnet: boolean
}

const DEFAULT_CONFIG: LocalStackConfig = {
  devnetPort: 8545,
  dwsPort: 4030,
  frontendPort: 4006,
  dataDir: './.local-stack',
  verbose: process.env.VERBOSE === 'true',
  skipDevnet: process.env.SKIP_DEVNET === 'true',
}

// ============================================================================
// Process Management
// ============================================================================

interface ManagedProcess {
  name: string
  proc: Subprocess
  ready: boolean
  port: number
}

const processes: ManagedProcess[] = []

async function waitForPort(
  port: number,
  path: string = '/health',
  timeout: number = 60000,
): Promise<boolean> {
  const start = Date.now()
  console.log(`   Waiting for port ${port}${path}...`)

  while (Date.now() - start < timeout) {
    const response = await fetch(`http://localhost:${port}${path}`)
      .then((r) => {
        if (r.ok) return r
        return null
      })
      .catch(() => null)

    if (response) {
      console.log(`   ✓ Port ${port} ready`)
      return true
    }
    await Bun.sleep(1000)
  }

  console.log(`   ✗ Port ${port} timeout after ${timeout}ms`)
  return false
}

async function startProcess(
  name: string,
  command: string[],
  port: number,
  config: LocalStackConfig,
  env: Record<string, string> = {},
  healthPath: string = '/health',
): Promise<ManagedProcess> {
  console.log(`\n🚀 Starting ${name}...`)
  console.log(`   Command: ${command.join(' ')}`)

  const proc = spawn(command, {
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
    env: {
      ...process.env,
      ...env,
    },
  })

  // Log stdout/stderr if not verbose (capture for debugging)
  if (!config.verbose) {
    ;(async () => {
      const reader = proc.stdout.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = new TextDecoder().decode(value)
        if (text.includes('error') || text.includes('Error')) {
          console.log(`   [${name}] ${text.trim()}`)
        }
      }
    })()
  }

  const managed: ManagedProcess = {
    name,
    proc,
    ready: false,
    port,
  }

  processes.push(managed)

  // Wait for process to be ready
  const ready = await waitForPort(port, healthPath)
  managed.ready = ready

  if (ready) {
    console.log(`✅ ${name} ready on port ${port}`)
  } else {
    console.error(`❌ ${name} failed to start on port ${port}`)
  }

  return managed
}

async function stopAll(): Promise<void> {
  console.log('\n🛑 Stopping all processes...')

  for (const managed of processes.reverse()) {
    console.log(`   Stopping ${managed.name}...`)
    managed.proc.kill()
  }

  processes.length = 0
  console.log('✅ All processes stopped')
}

// ============================================================================
// Service Starters
// ============================================================================

async function startDevnet(config: LocalStackConfig): Promise<boolean> {
  if (config.skipDevnet) {
    console.log('\n⏭️  Skipping devnet (SKIP_DEVNET=true)')
    return true
  }

  // Check if anvil is available
  const anvilCheck = spawn(['which', 'anvil'], { stdout: 'pipe' })
  await anvilCheck.exited

  if (anvilCheck.exitCode !== 0) {
    console.log('\n⚠️ Anvil not found - install foundry to enable local devnet')
    console.log('   Continuing without local devnet...')
    return true
  }

  const managed = await startProcess(
    'Devnet (Anvil)',
    [
      'anvil',
      '--port',
      config.devnetPort.toString(),
      '--block-time',
      '1',
      '--chain-id',
      '31337',
    ],
    config.devnetPort,
    config,
    {},
    '', // anvil doesn't have /health, just check port
  )

  // For anvil, just check if we can connect
  if (!managed.ready) {
    // Try a simple JSON-RPC call
    const response = await fetch(`http://localhost:${config.devnetPort}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    }).catch(() => null)

    managed.ready = response?.ok ?? false
  }

  return managed.ready
}

async function startDWS(config: LocalStackConfig): Promise<boolean> {
  const dwsDir = join(process.cwd(), '..', 'dws')

  if (!existsSync(dwsDir)) {
    console.error('\n❌ DWS not found at', dwsDir)
    return false
  }

  const managed = await startProcess(
    'DWS Server (with workerd)',
    ['bun', 'run', 'start'],
    config.dwsPort,
    config,
    {
      DWS_PORT: config.dwsPort.toString(),
      RPC_URL: `http://localhost:${config.devnetPort}`,
      NETWORK: 'localnet',
      TEE_MODE: 'simulated',
      STORAGE_BACKEND: 'local',
      STORAGE_LOCAL_PATH: join(config.dataDir, 'storage'),
      WORKERD_LOG_LEVEL: config.verbose ? 'debug' : 'info',
    },
    '/health',
  )

  return managed.ready
}

// ============================================================================
// Deploy Bazaar Worker to DWS
// ============================================================================

async function deployBazaarWorker(
  config: LocalStackConfig,
): Promise<string | null> {
  console.log('\n📦 Building and deploying Bazaar worker to DWS workerd...')

  // Build worker
  const buildResult = await Bun.build({
    entrypoints: ['./api/worker.ts'],
    outdir: join(config.dataDir, 'worker'),
    target: 'bun',
    minify: false,
  })

  if (!buildResult.success) {
    console.error('❌ Worker build failed')
    for (const log of buildResult.logs) {
      console.error(log)
    }
    return null
  }

  // Read built worker code
  const workerPath = join(config.dataDir, 'worker', 'worker.js')
  const workerCode = await readFile(workerPath, 'utf-8')
  console.log(`   Built worker: ${workerCode.length} bytes`)

  // Deploy to DWS
  console.log(`   Deploying to DWS at http://localhost:${config.dwsPort}...`)

  const deployResponse = await fetch(
    `http://localhost:${config.dwsPort}/workers`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: 'bazaar-api',
        runtime: 'bun',
        handler: 'default',
        code: Buffer.from(workerCode).toString('base64'),
        memory: 256,
        timeout: 30000,
        env: {
          NETWORK: 'localnet',
          TEE_MODE: 'simulated',
          TEE_PLATFORM: 'local',
          TEE_REGION: 'local',
          RPC_URL: `http://localhost:${config.devnetPort}`,
          DWS_URL: `http://localhost:${config.dwsPort}`,
        },
      }),
    },
  ).catch((e) => {
    console.error('   Deploy request failed:', e.message)
    return null
  })

  if (!deployResponse?.ok) {
    const error = await deployResponse?.text().catch(() => 'Unknown error')
    console.error(`   ❌ Deploy failed: ${error}`)
    return null
  }

  const rawJson: unknown = await deployResponse.json()
  const parsed = DWSFunctionDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    console.error(`   ❌ Invalid deploy response: ${parsed.error.message}`)
    return null
  }
  const result = parsed.data
  console.log(`   ✅ Worker deployed: ${result.functionId}`)

  // Test the deployed worker
  console.log('   Testing deployed worker...')
  const testResponse = await fetch(
    `http://localhost:${config.dwsPort}/workers/${result.functionId}/invoke`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'http',
        httpEvent: {
          method: 'GET',
          path: '/health',
          headers: {},
          body: null,
        },
      }),
    },
  ).catch(() => null)

  if (testResponse?.ok) {
    const testResult = await testResponse.json()
    console.log('   ✅ Worker test passed:', JSON.stringify(testResult))
    return result.functionId
  } else {
    console.log('   ⚠️ Worker test failed, but deployment succeeded')
    return result.functionId
  }
}

// ============================================================================
// Start Frontend
// ============================================================================

async function startFrontend(
  config: LocalStackConfig,
  workerId: string | null,
): Promise<boolean> {
  // Build frontend first
  console.log('\n📦 Building frontend...')
  const buildProc = spawn(['bun', 'run', 'scripts/build.ts'], {
    stdout: config.verbose ? 'inherit' : 'pipe',
    stderr: config.verbose ? 'inherit' : 'pipe',
  })
  await buildProc.exited

  if (buildProc.exitCode !== 0) {
    console.error('❌ Frontend build failed')
    return false
  }

  // Start serve script pointing to DWS worker
  const apiUrl = workerId
    ? `http://localhost:${config.dwsPort}/workers/${workerId}/invoke`
    : `http://localhost:${config.dwsPort}`

  const managed = await startProcess(
    'Bazaar Frontend',
    ['bun', 'run', 'scripts/serve.ts'],
    config.frontendPort,
    config,
    {
      PORT: config.frontendPort.toString(),
      API_URL: apiUrl,
    },
    '/',
  )

  return managed.ready
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('═'.repeat(60))
  console.log('🏗️  Bazaar Local Development Stack')
  console.log('   Real DWS + Real Workerd + Simulated TEE')
  console.log('═'.repeat(60))

  const config: LocalStackConfig = {
    ...DEFAULT_CONFIG,
    devnetPort: Number(process.env.DEVNET_PORT) || DEFAULT_CONFIG.devnetPort,
    dwsPort: Number(process.env.DWS_PORT) || DEFAULT_CONFIG.dwsPort,
    frontendPort: Number(process.env.PORT) || DEFAULT_CONFIG.frontendPort,
    dataDir: process.env.DATA_DIR || DEFAULT_CONFIG.dataDir,
    verbose: process.env.VERBOSE === 'true',
    skipDevnet: process.env.SKIP_DEVNET === 'true',
  }

  // Create data directory
  await mkdir(config.dataDir, { recursive: true })

  // Handle shutdown
  const shutdown = async () => {
    await stopAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Start services in order
  console.log('\n📋 Starting services...')

  // 1. Devnet
  const devnetOk = await startDevnet(config)
  if (!devnetOk && !config.skipDevnet) {
    console.error('❌ Devnet failed to start')
    await stopAll()
    process.exit(1)
  }

  // 2. DWS (with workerd)
  const dwsOk = await startDWS(config)
  if (!dwsOk) {
    console.error('❌ DWS failed to start')
    await stopAll()
    process.exit(1)
  }

  // 3. Deploy Bazaar worker to DWS
  const workerId = await deployBazaarWorker(config)

  // 4. Start frontend
  const frontendOk = await startFrontend(config, workerId)
  if (!frontendOk) {
    console.error('❌ Frontend failed to start')
    await stopAll()
    process.exit(1)
  }

  // Print summary
  console.log(`\n${'═'.repeat(60)}`)
  console.log('✅ Local stack ready!')
  console.log('═'.repeat(60))
  console.log('\n📍 Services:')
  if (!config.skipDevnet) {
    console.log(`   Devnet:     http://localhost:${config.devnetPort}`)
  }
  console.log(`   DWS:        http://localhost:${config.dwsPort}`)
  console.log(`   DWS Health: http://localhost:${config.dwsPort}/health`)
  if (workerId) {
    console.log(
      `   Worker:     http://localhost:${config.dwsPort}/workers/${workerId}`,
    )
  }
  console.log(`   Frontend:   http://localhost:${config.frontendPort}`)
  console.log('\n📝 Notes:')
  console.log('   - TEE is in SIMULATED mode (same config as testnet)')
  console.log('   - Worker runs in REAL workerd V8 isolates')
  console.log('   - All API calls go through DWS worker runtime')
  console.log('\nPress Ctrl+C to stop all services')

  // Keep process alive
  await new Promise(() => {})
}

// Run if main module
const isMain = typeof Bun !== 'undefined' && import.meta.path === Bun.main
if (isMain) {
  main().catch((error) => {
    console.error('Failed to start local stack:', error)
    process.exit(1)
  })
}

export { main as startLocalStack, stopAll, type LocalStackConfig }
