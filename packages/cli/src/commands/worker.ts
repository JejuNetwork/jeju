/**
 * Jeju Worker Command - Wrangler-like worker management
 *
 * Provides Cloudflare Workers-style commands:
 * - jeju worker dev - Run locally with hot reload
 * - jeju worker deploy - Deploy to DWS
 * - jeju worker list - List deployed workers
 * - jeju worker logs - Stream logs
 * - jeju worker tail - Tail logs in real-time
 * - jeju worker delete - Remove worker
 * - jeju worker rollback - Roll back to previous version
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { Command } from 'commander'
import type { Address } from 'viem'
import { logger } from '../lib/logger'
import type { AppManifest, NetworkType } from '../types'
import { requireLogin } from './login'

// Worker configuration from jeju-manifest.json
interface WorkerConfig {
  name: string
  main: string // Entry point
  compatibilityDate?: string
  routes?: string[]
  crons?: Array<{ schedule: string; handler: string }>
  vars?: Record<string, string>
  kvNamespaces?: Array<{ binding: string; id: string }>
  durableObjects?: Array<{ name: string; className: string }>
  memory?: number // MB
  timeout?: number // ms
}

interface DeployedWorker {
  workerId: string
  name: string
  status: 'active' | 'inactive' | 'error'
  version: number
  codeCid: string
  createdAt: number
  updatedAt: number
  routes: string[]
  metrics?: {
    invocations: number
    errors: number
    avgLatencyMs: number
  }
}

interface WorkerLog {
  timestamp: number
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  workerId: string
  invocationId?: string
}

/**
 * Get DWS URL for network
 */
function getDWSUrlForNetwork(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return process.env.MAINNET_DWS_URL ?? 'https://dws.jejunetwork.org'
    case 'testnet':
      return (
        process.env.TESTNET_DWS_URL ?? 'https://dws.testnet.jejunetwork.org'
      )
    default:
      return (
        process.env.DWS_URL ??
        getDWSUrl() ??
        `http://${getLocalhostHost()}:4020`
      )
  }
}

/**
 * Load worker config from jeju-manifest.json or wrangler.toml
 */
function loadWorkerConfig(dir: string): WorkerConfig {
  // Try jeju-manifest.json first
  const manifestPath = join(dir, 'jeju-manifest.json')
  if (existsSync(manifestPath)) {
    const manifest: AppManifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    )

    const backend = manifest.architecture?.backend
    const entry =
      typeof backend === 'object' && backend.outputDir
        ? `${backend.outputDir}/worker.ts`
        : 'api/worker.ts'

    return {
      name: manifest.name,
      main: entry,
      routes: [`/${manifest.name}/*`],
      memory: 128,
      timeout: 30000,
      vars: {},
    }
  }

  // Try wrangler.toml for Cloudflare compatibility
  const wranglerPath = join(dir, 'wrangler.toml')
  if (existsSync(wranglerPath)) {
    const wranglerContent = readFileSync(wranglerPath, 'utf-8')
    // Simple TOML parsing for common fields
    const name = wranglerContent.match(/name\s*=\s*"([^"]+)"/)?.[1] ?? 'worker'
    const main =
      wranglerContent.match(/main\s*=\s*"([^"]+)"/)?.[1] ?? 'src/index.ts'
    const compatibilityDate = wranglerContent.match(
      /compatibility_date\s*=\s*"([^"]+)"/,
    )?.[1]

    return {
      name,
      main,
      compatibilityDate,
      routes: [],
      memory: 128,
      timeout: 30000,
    }
  }

  // Default config
  return {
    name: 'worker',
    main: 'api/worker.ts',
    routes: ['/api/*'],
    memory: 128,
    timeout: 30000,
  }
}

/**
 * Build worker bundle
 */
async function buildWorker(dir: string, config: WorkerConfig): Promise<string> {
  const entryPath = join(dir, config.main)
  if (!existsSync(entryPath)) {
    throw new Error(`Worker entry point not found: ${entryPath}`)
  }

  const outDir = join(dir, 'dist/worker')

  // Use Bun to bundle
  const result = Bun.spawnSync(
    [
      'bun',
      'build',
      entryPath,
      '--outdir',
      outDir,
      '--target',
      'bun',
      '--minify',
    ],
    {
      cwd: dir,
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  )

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr)
    throw new Error(`Build failed: ${stderr}`)
  }

  return outDir
}

/**
 * Upload worker code to IPFS
 */
async function uploadWorkerCode(
  buildDir: string,
  network: NetworkType,
  authToken: string,
): Promise<string> {
  const dwsUrl = getDWSUrlForNetwork(network)

  // Read the built worker file
  const workerFile = join(buildDir, 'worker.js')
  if (!existsSync(workerFile)) {
    throw new Error(`Built worker not found at ${workerFile}`)
  }

  const code = readFileSync(workerFile)

  // Upload to DWS storage
  const formData = new FormData()
  formData.append('file', new Blob([code]), 'worker.js')

  const response = await fetch(`${dwsUrl}/storage/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`)
  }

  const result = await response.json()
  return result.cid
}

/**
 * Deploy worker to DWS
 */
async function deployWorkerToDWS(
  config: WorkerConfig,
  codeCid: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<DeployedWorker> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/workers/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
    body: JSON.stringify({
      name: config.name,
      codeCid,
      routes: config.routes,
      memory: config.memory,
      timeout: config.timeout,
      vars: config.vars,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy failed: ${error}`)
  }

  return response.json()
}

/**
 * List deployed workers
 */
async function listWorkers(
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<DeployedWorker[]> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/workers/list`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  return data.workers ?? []
}

/**
 * Get worker details
 */
async function getWorker(
  workerId: string,
  network: NetworkType,
  authToken: string,
): Promise<DeployedWorker | null> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/workers/${workerId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

/**
 * Delete worker
 */
async function deleteWorker(
  workerId: string,
  network: NetworkType,
  authToken: string,
): Promise<void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/workers/${workerId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Delete failed: ${error}`)
  }
}

/**
 * Stream worker logs
 */
async function streamLogs(
  workerId: string,
  network: NetworkType,
  authToken: string,
  onLog: (log: WorkerLog) => void,
): Promise<() => void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/workers/${workerId}/logs/stream`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'text/event-stream',
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to stream logs: ${response.statusText}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let cancelled = false

  const readLoop = async () => {
    while (!cancelled) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value)
      const lines = text.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          onLog(data as WorkerLog)
        }
      }
    }
  }

  readLoop().catch(console.error)

  return () => {
    cancelled = true
    reader.cancel()
  }
}

// Main worker command
export const workerCommand = new Command('worker')
  .description('Manage DWS workers (wrangler-compatible)')
  .alias('workers')

// Dev - run locally with hot reload
workerCommand
  .command('dev')
  .description('Run worker locally with hot reload')
  .option('-p, --port <port>', 'Port to run on', '8787')
  .option('-l, --local', 'Run in local-only mode (no network)')
  .option('--live-reload', 'Enable live reload in browser')
  .action(async (options) => {
    const cwd = process.cwd()
    const config = loadWorkerConfig(cwd)

    logger.header('JEJU WORKER DEV')
    logger.info(`Worker: ${config.name}`)
    logger.info(`Entry: ${config.main}`)

    const port = parseInt(options.port, 10)
    const host = getLocalhostHost()
    const entryPath = join(cwd, config.main)

    if (!existsSync(entryPath)) {
      logger.error(`Entry point not found: ${entryPath}`)
      return
    }

    logger.step(`Starting dev server on http://${host}:${port}...`)

    // Build environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(port),
      NODE_ENV: 'development',
      JEJU_NETWORK: 'localnet',
      ...(config.vars ?? {}),
    }

    // Start Bun server
    const proc = Bun.spawn(['bun', 'run', '--hot', entryPath], {
      cwd,
      env,
      stdout: 'inherit',
      stderr: 'inherit',
    })

    logger.success(`Worker running at http://${host}:${port}`)
    logger.info('Press Ctrl+C to stop')

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.newline()
      logger.info('Shutting down...')
      proc.kill()
      process.exit(0)
    })

    // Wait for process
    await proc.exited
  })

// Deploy worker
workerCommand
  .command('deploy')
  .description('Deploy worker to DWS')
  .option('--name <name>', 'Worker name (overrides config)')
  .option('--env <env>', 'Environment: production, preview', 'production')
  .option('--dry-run', 'Build and validate without deploying')
  .action(async (options) => {
    const credentials = requireLogin()
    const cwd = process.cwd()
    const config = loadWorkerConfig(cwd)

    if (options.name) {
      config.name = options.name
    }

    logger.header('JEJU WORKER DEPLOY')
    logger.info(`Worker: ${config.name}`)
    logger.info(`Network: ${credentials.network}`)

    // Build
    logger.step('Building worker...')
    const buildDir = await buildWorker(cwd, config)
    logger.success('Build complete')

    if (options.dryRun) {
      logger.info('Dry run - skipping deployment')
      return
    }

    // Upload
    logger.step('Uploading to IPFS...')
    const codeCid = await uploadWorkerCode(
      buildDir,
      credentials.network as NetworkType,
      credentials.authToken,
    )
    logger.success(`Uploaded: ${codeCid}`)

    // Deploy
    logger.step('Deploying to DWS...')
    const worker = await deployWorkerToDWS(
      config,
      codeCid,
      credentials.network as NetworkType,
      credentials.authToken,
      credentials.address as Address,
    )

    logger.success('Deployed.')
    logger.newline()
    logger.keyValue('Worker ID', worker.workerId)
    logger.keyValue('Name', worker.name)
    logger.keyValue('Version', String(worker.version))
    logger.keyValue('Status', worker.status)

    if (worker.routes.length > 0) {
      logger.keyValue('Routes', worker.routes.join(', '))
    }

    logger.newline()
    logger.info(`View logs: jeju worker logs ${worker.workerId}`)
    logger.info(`Tail logs: jeju worker tail ${worker.workerId}`)
  })

// List workers
workerCommand
  .command('list')
  .description('List deployed workers')
  .alias('ls')
  .action(async () => {
    const credentials = requireLogin()

    logger.header('JEJU WORKERS')

    const workers = await listWorkers(
      credentials.network as NetworkType,
      credentials.authToken,
      credentials.address as Address,
    )

    if (workers.length === 0) {
      logger.info('No workers deployed')
      logger.info('Run `jeju worker deploy` to deploy your first worker')
      return
    }

    console.log('')
    console.log(
      `${'  NAME'.padEnd(25) + 'STATUS'.padEnd(12) + 'VERSION'.padEnd(10)}UPDATED`,
    )
    console.log(`  ${'-'.repeat(60)}`)

    for (const worker of workers) {
      const name = worker.name.padEnd(23)
      const status =
        worker.status === 'active'
          ? '✓ active'.padEnd(10)
          : worker.status === 'error'
            ? '✗ error'.padEnd(10)
            : '○ inactive'.padEnd(10)
      const version = `v${worker.version}`.padEnd(8)
      const updated = new Date(worker.updatedAt).toLocaleDateString()

      console.log(`  ${name} ${status} ${version} ${updated}`)
    }

    logger.newline()
  })

// Get worker info
workerCommand
  .command('info <worker>')
  .description('Get detailed worker information')
  .action(async (workerId) => {
    const credentials = requireLogin()

    const worker = await getWorker(
      workerId,
      credentials.network as NetworkType,
      credentials.authToken,
    )

    if (!worker) {
      logger.error(`Worker not found: ${workerId}`)
      return
    }

    logger.header('WORKER INFO')
    logger.keyValue('ID', worker.workerId)
    logger.keyValue('Name', worker.name)
    logger.keyValue('Status', worker.status)
    logger.keyValue('Version', String(worker.version))
    logger.keyValue('Code CID', worker.codeCid)
    logger.keyValue('Created', new Date(worker.createdAt).toLocaleString())
    logger.keyValue('Updated', new Date(worker.updatedAt).toLocaleString())

    if (worker.routes.length > 0) {
      logger.newline()
      logger.info('Routes:')
      for (const route of worker.routes) {
        console.log(`  - ${route}`)
      }
    }

    if (worker.metrics) {
      logger.newline()
      logger.info('Metrics (24h):')
      logger.keyValue('  Invocations', String(worker.metrics.invocations))
      logger.keyValue('  Errors', String(worker.metrics.errors))
      logger.keyValue('  Avg Latency', `${worker.metrics.avgLatencyMs}ms`)
    }
  })

// View logs
workerCommand
  .command('logs <worker>')
  .description('View worker logs')
  .option('--since <time>', 'Show logs since (e.g., 1h, 30m, 2d)', '1h')
  .option('--limit <n>', 'Maximum number of logs', '100')
  .action(async (workerId, options) => {
    const credentials = requireLogin()
    const dwsUrl = getDWSUrlForNetwork(credentials.network as NetworkType)

    const response = await fetch(
      `${dwsUrl}/workers/${workerId}/logs?since=${options.since}&limit=${options.limit}`,
      {
        headers: {
          Authorization: `Bearer ${credentials.authToken}`,
        },
      },
    )

    if (!response.ok) {
      logger.error('Failed to fetch logs')
      return
    }

    const data = await response.json()
    const logs: WorkerLog[] = data.logs ?? []

    if (logs.length === 0) {
      logger.info('No logs found')
      return
    }

    for (const log of logs) {
      const time = new Date(log.timestamp).toISOString()
      const level = log.level.toUpperCase().padEnd(5)
      const prefix =
        log.level === 'error' ? '✗' : log.level === 'warn' ? '!' : ' '

      console.log(`${prefix} [${time}] ${level} ${log.message}`)
    }
  })

// Tail logs in real-time
workerCommand
  .command('tail <worker>')
  .description('Tail worker logs in real-time')
  .action(async (workerId) => {
    const credentials = requireLogin()

    logger.info(`Tailing logs for ${workerId}...`)
    logger.info('Press Ctrl+C to stop\n')

    const cancel = await streamLogs(
      workerId,
      credentials.network as NetworkType,
      credentials.authToken,
      (log) => {
        const time = new Date(log.timestamp).toISOString()
        const level = log.level.toUpperCase().padEnd(5)
        const prefix =
          log.level === 'error' ? '✗' : log.level === 'warn' ? '!' : ' '

        console.log(`${prefix} [${time}] ${level} ${log.message}`)
      },
    )

    process.on('SIGINT', () => {
      cancel()
      logger.newline()
      logger.info('Stopped tailing logs')
      process.exit(0)
    })
  })

// Delete worker
workerCommand
  .command('delete <worker>')
  .description('Delete a deployed worker')
  .option('-f, --force', 'Skip confirmation')
  .action(async (workerId, options) => {
    const credentials = requireLogin()

    if (!options.force) {
      logger.warn(`This will permanently delete worker: ${workerId}`)
      logger.info('Run with --force to confirm')
      return
    }

    logger.step(`Deleting worker ${workerId}...`)

    await deleteWorker(
      workerId,
      credentials.network as NetworkType,
      credentials.authToken,
    )

    logger.success('Worker deleted')
  })

// Rollback to previous version
workerCommand
  .command('rollback <worker>')
  .description('Roll back to a previous version')
  .option('--version <n>', 'Specific version to roll back to')
  .action(async (workerId, options) => {
    const credentials = requireLogin()
    const dwsUrl = getDWSUrlForNetwork(credentials.network as NetworkType)

    const version = options.version ? parseInt(options.version, 10) : undefined

    logger.step(`Rolling back ${workerId}...`)

    const response = await fetch(`${dwsUrl}/workers/${workerId}/rollback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.authToken}`,
      },
      body: JSON.stringify({ version }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error(`Rollback failed: ${error}`)
      return
    }

    const result = await response.json()
    logger.success(`Rolled back to version ${result.version}`)
  })

// Publish (alias for deploy)
workerCommand
  .command('publish')
  .description('Publish worker (alias for deploy)')
  .action(async () => {
    // Re-use deploy command
    await workerCommand.commands
      .find((c) => c.name() === 'deploy')
      ?.parseAsync(['deploy'], { from: 'user' })
  })
