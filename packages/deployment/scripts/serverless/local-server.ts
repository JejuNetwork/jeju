#!/usr/bin/env bun

/**
 * Local Serverless Development Server
 *
 * Runs all serverless workers locally through DWS.
 * This is the proper way to run workers locally - using the actual DWS infrastructure.
 *
 * Architecture:
 * 1. Start DWS server if not running
 * 2. Build each worker
 * 3. Deploy workers to local DWS
 * 4. Workers are available at DWS endpoints
 *
 * Usage:
 *   bun run dev                    # Start all workers via DWS
 *   bun run dev --app bazaar       # Start specific app
 *   bun run dev --dws-port 4030    # Custom DWS port
 */

import { existsSync, readFileSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { discoverAllApps } from '../shared/discover-apps'
import {
  parseServerlessConfig,
  type ServerlessAppConfig,
  validateServerlessConfig,
} from './types'
import { WorkerBuilder } from './worker-builder'

// Types

interface DeployedWorker {
  name: string
  functionId: string
  appPath: string
  config: ServerlessAppConfig
  endpoint: string
  httpEndpoint: string
}

interface LocalServerConfig {
  dwsPort: number
  dwsHost: string
  hotReload: boolean
  apps?: string[]
}

// DWS Client

class DWSClient {
  private endpoint: string
  private deployerAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // Default anvil account

  constructor(host: string, port: number) {
    this.endpoint = `http://${host}:${port}`
  }

  async health(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null)
    return response?.ok ?? false
  }

  async deployWorker(
    name: string,
    code: Buffer,
    config: {
      runtime?: string
      memory?: number
      timeout?: number
      handler?: string
      env?: Record<string, string>
    } = {},
  ): Promise<{ functionId: string }> {
    // Map workerd runtime to DWS supported runtimes (bun, node, deno)
    let runtime = config.runtime || 'bun'
    if (runtime === 'workerd') {
      runtime = 'bun' // DWS uses bun for local dev
    }

    const response = await fetch(`${this.endpoint}/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.deployerAddress,
      },
      body: JSON.stringify({
        name,
        code: code.toString('base64'),
        runtime,
        handler: config.handler || 'default',
        memory: config.memory || 256,
        timeout: config.timeout || 30000,
        env: config.env || {},
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to deploy worker: ${error}`)
    }

    return response.json()
  }

  async listWorkers(): Promise<
    Array<{ id: string; name: string; status: string }>
  > {
    const response = await fetch(`${this.endpoint}/workers`, {
      headers: { 'x-jeju-address': this.deployerAddress },
    })

    if (!response.ok) {
      return []
    }

    const data = await response.json()
    return data.functions || []
  }

  async deleteWorker(functionId: string): Promise<void> {
    await fetch(`${this.endpoint}/workers/${functionId}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': this.deployerAddress },
    })
  }

  getInvokeEndpoint(functionId: string): string {
    return `${this.endpoint}/workers/${functionId}/invoke`
  }

  getHttpEndpoint(functionId: string): string {
    return `${this.endpoint}/workers/${functionId}/http`
  }
}

// Local Server Manager

class LocalServerManager {
  private rootDir: string
  private config: LocalServerConfig
  private dws: DWSClient
  private workerBuilder: WorkerBuilder
  private deployedWorkers = new Map<string, DeployedWorker>()
  private dwsProcess: ReturnType<typeof Bun.spawn> | null = null
  private watchers: Array<ReturnType<typeof watch>> = []

  constructor(rootDir: string, config: LocalServerConfig) {
    this.rootDir = rootDir
    this.config = config
    this.dws = new DWSClient(config.dwsHost, config.dwsPort)
    this.workerBuilder = new WorkerBuilder(rootDir)
  }

  async start(): Promise<void> {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           🚀 JEJU SERVERLESS LOCAL DEVELOPMENT                        ║
╚═══════════════════════════════════════════════════════════════════════╝
`)

    // Step 1: Ensure DWS is running
    await this.ensureDWSRunning()

    // Step 2: Discover apps
    const apps = this.discoverApps()
    console.log(`\nFound ${apps.length} serverless app(s) with workers\n`)

    if (apps.length === 0) {
      console.log('No serverless apps with workers found.')
      console.log(
        "Add a worker configuration to your app's jeju-manifest.json:",
      )
      console.log(`
  "decentralization": {
    "worker": {
      "name": "my-api",
      "entrypoint": "api/worker.ts"
    }
  }
`)
      return
    }

    // Step 3: Build and deploy each worker
    for (const { path, config } of apps) {
      await this.deployWorker(path, config)
    }

    // Step 4: Set up hot reload if enabled
    if (this.config.hotReload) {
      this.setupHotReload()
    }

    // Step 5: Print status
    this.printStatus()

    // Keep process alive
    console.log('\nPress Ctrl+C to stop all workers.\n')
  }

  private async ensureDWSRunning(): Promise<void> {
    console.log(
      `Checking DWS at ${this.config.dwsHost}:${this.config.dwsPort}...`,
    )

    const healthy = await this.dws.health()
    if (healthy) {
      console.log('   ✅ DWS is running')
      return
    }

    console.log('   ⏳ Starting DWS...')

    // Start DWS server
    const dwsPath = join(this.rootDir, 'apps', 'dws')
    if (!existsSync(join(dwsPath, 'package.json'))) {
      throw new Error(`DWS not found at ${dwsPath}`)
    }

    this.dwsProcess = Bun.spawn(['bun', 'run', 'dev'], {
      cwd: dwsPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: String(this.config.dwsPort),
        DWS_PORT: String(this.config.dwsPort),
      },
    })

    // Wait for DWS to be ready
    const maxWait = 30000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const ready = await this.dws.health()
      if (ready) {
        console.log('   ✅ DWS started')
        return
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    throw new Error('DWS failed to start within 30 seconds')
  }

  private discoverApps(): Array<{ path: string; config: ServerlessAppConfig }> {
    const allApps = discoverAllApps(this.rootDir)
    const serverlessApps: Array<{ path: string; config: ServerlessAppConfig }> =
      []

    for (const app of allApps) {
      // Filter by target apps if specified
      if (this.config.apps?.length && !this.config.apps.includes(app.name)) {
        continue
      }

      const config = parseServerlessConfig(
        app.manifest as Record<string, unknown>,
      )
      if (!config || !config.worker) {
        continue
      }

      const validation = validateServerlessConfig(config)
      if (!validation.valid) {
        console.warn(`   ⚠️  ${app.name}: ${validation.errors.join(', ')}`)
        continue
      }

      serverlessApps.push({ path: app.path, config })
    }

    return serverlessApps
  }

  private async deployWorker(
    appPath: string,
    config: ServerlessAppConfig,
  ): Promise<void> {
    if (!config.worker) return

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Deploying: ${config.name}`)
    console.log(`${'─'.repeat(60)}`)

    // Build the worker
    console.log('   Building...')
    const buildOutput = await this.workerBuilder.build(appPath, config.worker)
    console.log(`   Built: ${(buildOutput.size / 1024).toFixed(1)}KB`)

    // Read the built code
    const code = readFileSync(buildOutput.bundlePath)

    // Check if worker already exists and delete it
    const existing = await this.dws.listWorkers()
    const existingWorker = existing.find((w) => w.name === config.name)
    if (existingWorker) {
      console.log('   Removing old version...')
      await this.dws.deleteWorker(existingWorker.id)
    }

    // Deploy to DWS
    console.log('   Deploying to DWS...')
    const result = await this.dws.deployWorker(config.name, code, {
      runtime: config.worker.runtime || 'bun',
      memory: config.worker.memoryMb,
      timeout: config.worker.timeoutMs,
      handler: 'default',
      env: {
        NETWORK: 'localnet',
        TEE_MODE: 'simulated',
      },
    })

    const deployed: DeployedWorker = {
      name: config.name,
      functionId: result.functionId,
      appPath,
      config,
      endpoint: this.dws.getInvokeEndpoint(result.functionId),
      httpEndpoint: this.dws.getHttpEndpoint(result.functionId),
    }

    this.deployedWorkers.set(config.name, deployed)
    console.log(`   ✅ Deployed: ${deployed.httpEndpoint}`)
  }

  private setupHotReload(): void {
    console.log('\n🔄 Hot reload enabled. Watching for changes...')

    for (const [name, worker] of this.deployedWorkers) {
      const watchDir = join(worker.appPath, 'api')
      if (!existsSync(watchDir)) continue

      const watcher = watch(
        watchDir,
        { recursive: true },
        async (_eventType, filename) => {
          if (!filename) return
          if (!filename.endsWith('.ts') && !filename.endsWith('.js')) return

          console.log(`\n♻️  ${name}: ${filename} changed`)

          // Redeploy
          await this.deployWorker(worker.appPath, worker.config)
        },
      )

      this.watchers.push(watcher)
    }
  }

  private printStatus(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                       WORKERS READY                                   ║
╚═══════════════════════════════════════════════════════════════════════╝

DWS Endpoint: http://${this.config.dwsHost}:${this.config.dwsPort}

Workers:
`)

    for (const [name, worker] of this.deployedWorkers) {
      console.log(`  ✅ ${name}`)
      console.log(`     HTTP:   ${worker.httpEndpoint}`)
      console.log(`     Invoke: ${worker.endpoint}`)
      console.log(`     JNS:    ${worker.config.jnsName}`)
      console.log('')
    }
  }

  async stop(): Promise<void> {
    console.log('\nStopping...')

    // Stop watchers
    for (const watcher of this.watchers) {
      watcher.close()
    }

    // Delete deployed workers
    for (const [name, worker] of this.deployedWorkers) {
      console.log(`  Removing ${name}...`)
      await this.dws.deleteWorker(worker.functionId).catch(() => {})
    }

    // Stop DWS if we started it
    if (this.dwsProcess) {
      console.log('  Stopping DWS...')
      this.dwsProcess.kill()
    }

    console.log('Done.')
  }
}

// CLI Entry Point

// Find the repo root by looking for packages/deployment
function findRepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'packages', 'deployment')) &&
      existsSync(join(dir, 'apps'))
    ) {
      return dir
    }
    dir = dirname(dir)
  }
  // Fallback: if we're in packages/deployment, go up two levels
  const scriptDir = dirname(dirname(dirname(import.meta.dir)))
  if (existsSync(join(scriptDir, 'apps'))) {
    return scriptDir
  }
  return process.cwd()
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dws-port': { type: 'string', default: '4030' },
      'dws-host': { type: 'string', default: 'localhost' },
      app: { type: 'string' },
      'no-hot-reload': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Jeju Local Serverless Server

Usage:
  bun run dev [options]

Options:
  --dws-port <number>  DWS port (default: 4030)
  --dws-host <string>  DWS host (default: localhost)
  --app <name>         Only run specific app
  --no-hot-reload      Disable hot reload
  -h, --help           Show this help

Examples:
  bun run dev                       # Start all workers via DWS
  bun run dev --app bazaar          # Start bazaar only
  bun run dev --dws-port 5000       # Use custom DWS port
`)
    process.exit(0)
  }

  const rootDir = findRepoRoot()
  console.log(`Repo root: ${rootDir}`)

  const config: LocalServerConfig = {
    dwsPort: parseInt(values['dws-port'] || '4030', 10),
    dwsHost: values['dws-host'] || 'localhost',
    hotReload: !values['no-hot-reload'],
    apps: values.app ? [values.app] : undefined,
  }

  const server = new LocalServerManager(rootDir, config)

  // Handle shutdown
  process.on('SIGINT', async () => {
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await server.stop()
    process.exit(0)
  })

  await server.start()

  // Keep alive
  await new Promise(() => {})
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
