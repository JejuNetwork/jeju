/**
 * Worker Runtime
 * Production-ready process-isolated worker execution with Bun and workerd support
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import type { JSONValue } from '../shared/validation'
import type { BackendManager } from '../storage/backends'
import type {
  HTTPEvent,
  HTTPResponse,
  InvokeParams,
  InvokeResult,
  WorkerContext,
  WorkerFunction,
  WorkerInstance,
  WorkerInvocation,
  WorkerPoolConfig,
} from './types'
import { DEFAULT_POOL_CONFIG } from './types'

// Runtime mode: 'bun' for direct Bun process spawning, 'workerd' for workerd V8 isolates
type RuntimeMode = 'bun' | 'workerd'

// Worker bootstrap - just sets env and imports the main module
// Most worker code (like Factory) already starts its own server using PORT env var
function createWorkerBootstrap(port: number, _handler: string): string {
  // Bootstrap that handles both standalone servers and fetch-export workers
  return `
// DWS Worker Bootstrap - Starts worker on port ${port}
const PORT = ${port};

// Provide default environment for workers
// These are the standard environment variables expected by Jeju workers
// Note: Chain config should match packages/config/chain/*.json
const workerEnv = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: process.env.NODE_ENV || 'production',
  NETWORK: process.env.NETWORK || process.env.JEJU_NETWORK || 'testnet',
  JEJU_NETWORK: process.env.NETWORK || process.env.JEJU_NETWORK || 'testnet',
  TEE_MODE: process.env.TEE_MODE || 'simulated',
  TEE_PLATFORM: process.env.TEE_PLATFORM || 'dws',
  TEE_REGION: process.env.TEE_REGION || 'global',
  // Chain configuration - must match chain/*.json
  RPC_URL: process.env.RPC_URL || process.env.L2_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  L2_RPC_URL: process.env.L2_RPC_URL || process.env.RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  L1_RPC_URL: process.env.L1_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
  CHAIN_ID: process.env.CHAIN_ID || '420690',
  L1_CHAIN_ID: process.env.L1_CHAIN_ID || '11155111',
  // Service URLs
  DWS_URL: process.env.DWS_URL || 'https://dws.testnet.jejunetwork.org',
  GATEWAY_URL: process.env.GATEWAY_URL || 'https://gateway.testnet.jejunetwork.org',
  INDEXER_URL: process.env.INDEXER_URL || 'https://indexer.testnet.jejunetwork.org/graphql',
  KMS_URL: process.env.KMS_URL || 'https://kms.testnet.jejunetwork.org',
  OAUTH3_URL: process.env.OAUTH3_URL || 'https://oauth3.testnet.jejunetwork.org',
  // SQLit
  // SECURITY: In production, workers should use KMS for signing (SQLIT_KMS_KEY_ID)
  // Direct SQLIT_PRIVATE_KEY is for development only
  SQLIT_NODES: process.env.SQLIT_NODES || process.env.SQLIT_URL || '',
  SQLIT_URL: process.env.SQLIT_URL || process.env.SQLIT_NODES || '',
  SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID || '',
  SQLIT_KMS_KEY_ID: process.env.SQLIT_KMS_KEY_ID || '',
  SQLIT_PRIVATE_KEY: process.env.NODE_ENV === 'production' ? '' : (process.env.SQLIT_PRIVATE_KEY || ''),
  SQLIT_MINER_ENDPOINT: process.env.SQLIT_MINER_ENDPOINT || '',
};

// ExecutionContext stub for Cloudflare Workers compatibility
const execCtx = {
  waitUntil: (promise) => promise?.catch?.(() => {}),
  passThroughOnException: () => {}
};

async function startWorker() {
  console.log('[Bootstrap] Setting up environment...');
  
  // IMPORTANT: Set process.env BEFORE importing the module
  // Many libraries (like @jejunetwork/config, viem) read from process.env at import time
  for (const [key, value] of Object.entries(workerEnv)) {
    if (value !== undefined && value !== '') {
      process.env[key] = value;
    }
  }
  
  console.log('[Bootstrap] Loading worker module...');
  
  // Import the worker module (AFTER setting env vars)
  let mod;
  try {
    mod = await import('./main.js');
    console.log('[Bootstrap] Module loaded, exports:', Object.keys(mod));
  } catch (err) {
    console.error('[Bootstrap] Failed to import module:', err);
    throw err;
  }
  
  // Check if module exports a fetch handler (workerd/CF Workers style)
  const handler = mod.default?.fetch || mod.fetch || mod.default;
  
  if (typeof handler === 'function') {
    // Create a server wrapping the fetch handler
    console.log('[Bootstrap] Starting fetch-handler server on port ' + PORT);
    
    const server = Bun.serve({
      port: PORT,
      async fetch(request) {
        try {
          // Call the worker's fetch handler with proper env
          return await handler(request, workerEnv, execCtx);
        } catch (err) {
          console.error('[Worker Error]', err);
          return new Response(JSON.stringify({ 
            error: err.message,
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    });
    
    console.log('[Bootstrap] Server started on port ' + PORT);
  } else if (mod.default?.listen || mod.listen) {
    // Elysia/Express style - call listen
    console.log('[Bootstrap] Starting listener server on port ' + PORT);
    const app = mod.default || mod;
    app.listen(PORT);
  } else {
    // Module should have started its own server
    console.log('[Bootstrap] Module loaded, expecting self-starting server');
  }
}

startWorker().catch(err => {
  console.error('[Bootstrap] Failed to start worker:', err);
  process.exit(1);
});
`
}

export class WorkerRuntime {
  private backend: BackendManager
  private functions = new Map<string, WorkerFunction>()
  private instances = new Map<string, WorkerInstance[]>()
  private invocations = new Map<string, WorkerInvocation>()
  private pendingQueue = new Map<string, InvokeParams[]>()
  private config: WorkerPoolConfig
  private codeCache = new Map<string, string>() // cid -> local path
  private metrics = new Map<string, number[]>() // functionId -> durations
  private runtimeMode: RuntimeMode
  private workerdPath: string | null = null
  private usedPorts = new Set<number>()
  private initialized = false

  constructor(backend: BackendManager, config: Partial<WorkerPoolConfig> = {}) {
    this.backend = backend
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }

    // Always prefer Bun when available since we're running in Bun
    this.runtimeMode = 'bun'
    console.log(`[WorkerRuntime] Using runtime mode: ${this.runtimeMode}`)

    // Cleanup interval
    setInterval(() => this.cleanup(), 30000)

    // Initialize async
    this.initialize().catch((err) => {
      console.error('[WorkerRuntime] Initialization failed:', err)
    })
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return

    // Create base temp directory
    const baseDir = '/tmp/dws-workers'
    if (!existsSync(baseDir)) {
      await mkdir(baseDir, { recursive: true })
    }

    // Try to find workerd as fallback
    await this.initializeWorkerd()

    this.initialized = true
    console.log('[WorkerRuntime] Initialized successfully')
  }

  private async initializeWorkerd(): Promise<void> {
    const paths = [
      process.env.WORKERD_PATH,
      '/usr/local/bin/workerd',
      '/usr/bin/workerd',
      `${process.env.HOME}/.local/bin/workerd`,
      './node_modules/.bin/workerd',
      'node_modules/.bin/workerd',
    ].filter(Boolean) as string[]

    for (const p of paths) {
      try {
        if (existsSync(p)) {
          this.workerdPath = p
          console.log(`[WorkerRuntime] Found workerd at: ${this.workerdPath}`)
          return
        }
      } catch {
        // Continue to next path
      }
    }

    console.log('[WorkerRuntime] workerd binary not found (Bun mode only)')
  }

  async deployFunction(fn: WorkerFunction): Promise<void> {
    await this.initialize()

    // Pre-download and cache the code
    try {
      const codePath = await this.downloadCode(fn.codeCid, fn.handler)
      this.codeCache.set(fn.codeCid, codePath)
    } catch (err) {
      console.warn(
        `[WorkerRuntime] Failed to pre-cache code for ${fn.name}:`,
        err,
      )
    }

    this.functions.set(fn.id, fn)
    this.instances.set(fn.id, [])
    this.pendingQueue.set(fn.id, [])
    this.metrics.set(fn.id, [])

    console.log(`[WorkerRuntime] Deployed function: ${fn.name} (${fn.id})`)
  }

  async undeployFunction(functionId: string): Promise<void> {
    const instances = this.instances.get(functionId) ?? []

    // Stop all instances
    for (const instance of instances) {
      await this.stopInstance(instance)
    }

    this.functions.delete(functionId)
    this.instances.delete(functionId)
    this.pendingQueue.delete(functionId)
    this.metrics.delete(functionId)

    console.log(`[WorkerRuntime] Undeployed function: ${functionId}`)
  }

  async invoke(params: InvokeParams): Promise<InvokeResult> {
    const fn = this.functions.get(params.functionId)
    if (!fn) {
      throw new Error(`Function ${params.functionId} not found`)
    }

    const invocationId = crypto.randomUUID()
    const invocation: WorkerInvocation = {
      id: invocationId,
      functionId: params.functionId,
      type: params.type ?? 'sync',
      payload: params.payload ?? null,
      caller: '0x0000000000000000000000000000000000000000',
      startedAt: Date.now(),
      status: 'pending',
      logs: [],
    }

    this.invocations.set(invocationId, invocation)

    // Get or create an instance
    const instance = await this.acquireInstance(fn)
    if (!instance) {
      invocation.status = 'error'
      invocation.error = 'No available instances'
      invocation.completedAt = Date.now()
      return this.buildResult(invocation)
    }

    // Execute
    invocation.status = 'running'
    instance.activeInvocations++
    instance.status = 'busy'

    try {
      const result = await this.executeInInstance(
        instance,
        fn,
        invocation,
        params,
      )
      invocation.status = 'success'
      invocation.result = result as typeof invocation.result
    } catch (error) {
      invocation.status = 'error'
      invocation.error = error instanceof Error ? error.message : String(error)
      fn.errorCount++
    } finally {
      invocation.completedAt = Date.now()
      invocation.durationMs = invocation.completedAt - invocation.startedAt

      instance.activeInvocations--
      instance.lastUsedAt = Date.now()
      instance.totalInvocations++
      instance.status = instance.activeInvocations > 0 ? 'busy' : 'ready'

      // Update metrics
      this.recordDuration(params.functionId, invocation.durationMs)
      fn.invocationCount++
      fn.lastInvokedAt = Date.now()
    }

    return this.buildResult(invocation)
  }

  async invokeHTTP(
    functionId: string,
    event: HTTPEvent,
  ): Promise<HTTPResponse> {
    const fn = this.functions.get(functionId)
    if (!fn) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Function not found' }),
        headers: { 'Content-Type': 'application/json' },
      }
    }

    // Get an instance
    const instance = await this.acquireInstance(fn)
    if (!instance) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'No available instances' }),
        headers: { 'Content-Type': 'application/json' },
      }
    }

    try {
      // Forward the HTTP request directly to the worker
      const url = `http://127.0.0.1:${instance.port}${event.path}`
      const queryString = new URLSearchParams(event.query ?? {}).toString()
      const fullUrl = queryString ? `${url}?${queryString}` : url

      const response = await fetch(fullUrl, {
        method: event.method,
        headers: event.headers,
        body: event.body || undefined,
        signal: AbortSignal.timeout(fn.timeout),
      })

      const body = await response.text()
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      // Update metrics
      fn.invocationCount++
      fn.lastInvokedAt = Date.now()
      instance.lastUsedAt = Date.now()
      instance.totalInvocations++

      return {
        statusCode: response.status,
        headers: responseHeaders,
        body,
      }
    } catch (error) {
      fn.errorCount++
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    }
  }

  private async acquireInstance(
    fn: WorkerFunction,
  ): Promise<WorkerInstance | null> {
    const instances = this.instances.get(fn.id) ?? []

    // Find a ready instance with capacity
    const ready = instances.find(
      (i) =>
        i.status === 'ready' &&
        i.activeInvocations < this.config.maxConcurrentInvocations,
    )
    if (ready) return ready

    // Find a busy instance with capacity
    const available = instances.find(
      (i) =>
        i.status === 'busy' &&
        i.activeInvocations < this.config.maxConcurrentInvocations,
    )
    if (available) return available

    // Need to create new instance
    if (instances.length < this.config.maxWarmInstances) {
      console.log(`[WorkerRuntime] Creating new instance for ${fn.name}...`)
      const instance = await this.createInstance(fn)
      if (instance) {
        instances.push(instance)
        this.instances.set(fn.id, instances)
        return instance
      }
    }

    console.warn(
      `[WorkerRuntime] Cannot create instance for ${fn.name} - max instances reached`,
    )
    return null
  }

  private async createInstance(
    fn: WorkerFunction,
  ): Promise<WorkerInstance | null> {
    const port = await this.allocatePort()
    const id = crypto.randomUUID()

    const instance: WorkerInstance = {
      id,
      functionId: fn.id,
      version: fn.version,
      port,
      status: 'starting',
      activeInvocations: 0,
      totalInvocations: 0,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      memoryUsedMb: 0,
    }

    // Get code path - download on-demand if not cached
    let codePath = this.codeCache.get(fn.codeCid)
    if (!codePath) {
      console.log(`[WorkerRuntime] Downloading code for ${fn.name}...`)
      try {
        codePath = await this.downloadCode(fn.codeCid, fn.handler)
        this.codeCache.set(fn.codeCid, codePath)
      } catch (error) {
        console.error(`[WorkerRuntime] Failed to download code:`, error)
        this.releasePort(port)
        return null
      }
    }

    // Use Bun to spawn the worker
    return this.createBunInstance(fn, instance, codePath)
  }

  private async createBunInstance(
    fn: WorkerFunction,
    instance: WorkerInstance,
    codePath: string,
  ): Promise<WorkerInstance | null> {
    try {
      const codeDir = codePath.replace(/\/[^/]+$/, '')

      // Create bootstrap file that starts the server
      const bootstrapPath = `${codeDir}/bootstrap.js`
      const bootstrapCode = createWorkerBootstrap(instance.port, fn.handler)
      await Bun.write(bootstrapPath, bootstrapCode)

      // Get bun path
      const bunPath = process.execPath || '/usr/local/bin/bun'

      console.log(
        `[WorkerRuntime] Starting worker ${fn.name} on port ${instance.port}...`,
      )

      // Spawn the worker process
      const proc = Bun.spawn([bunPath, 'run', bootstrapPath], {
        env: {
          ...process.env,
          ...fn.env,
          PORT: String(instance.port),
          FUNCTION_ID: fn.id,
          INSTANCE_ID: instance.id,
          FUNCTION_MEMORY: String(fn.memory),
          FUNCTION_TIMEOUT: String(fn.timeout),
          NODE_ENV: process.env.NODE_ENV || 'production',
        },
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: codeDir,
      })

      instance.process = proc

      // Capture stdout for debugging
      proc.stdout
        .pipeTo(
          new WritableStream({
            write(chunk) {
              const text = new TextDecoder().decode(chunk)
              if (text.trim()) {
                console.log(`[Worker:${fn.name}] ${text.trim()}`)
              }
            },
          }),
        )
        .catch(() => {})

      // Capture stderr for debugging
      proc.stderr
        .pipeTo(
          new WritableStream({
            write(chunk) {
              const text = new TextDecoder().decode(chunk)
              if (text.trim()) {
                console.error(`[Worker:${fn.name}:err] ${text.trim()}`)
              }
            },
          }),
        )
        .catch(() => {})

      // Wait for the process to become ready
      const ready = await this.waitForReady(instance, 30000)
      instance.status = ready ? 'ready' : 'stopped'

      if (!ready) {
        console.error(
          `[WorkerRuntime] Worker ${fn.name} failed to start on port ${instance.port}`,
        )
        try {
          proc.kill()
        } catch {}
        this.releasePort(instance.port)
        return null
      }

      console.log(
        `[WorkerRuntime] Worker ${fn.name} ready on port ${instance.port}`,
      )
      return instance
    } catch (error) {
      console.error(`[WorkerRuntime] Failed to create instance:`, error)
      this.releasePort(instance.port)
      return null
    }
  }

  private async allocatePort(): Promise<number> {
    const min = 20000
    const max = 30000

    for (let attempt = 0; attempt < 100; attempt++) {
      const port = min + Math.floor(Math.random() * (max - min))
      if (!this.usedPorts.has(port)) {
        // Reserve the port FIRST to prevent race conditions
        this.usedPorts.add(port)

        // Check if port is actually available on the system
        try {
          const server = Bun.serve({
            port,
            fetch: () => new Response('test'),
          })
          server.stop()
          return port
        } catch {
          // Port in use by another process, release and try another
          this.usedPorts.delete(port)
        }
      }
    }

    throw new Error('No available ports in configured range')
  }

  private releasePort(port: number): void {
    this.usedPorts.delete(port)
  }

  private async waitForReady(
    instance: WorkerInstance,
    timeoutMs = 30000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    const checkInterval = 200

    while (Date.now() < deadline) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 2000)

        const response = await fetch(
          `http://127.0.0.1:${instance.port}/health`,
          {
            signal: controller.signal,
          },
        )

        clearTimeout(timeoutId)

        if (response.ok || response.status === 404) {
          // 404 is acceptable - server is up but no health route
          return true
        }
      } catch {
        // Connection refused or timeout - not ready yet
      }
      await new Promise((r) => setTimeout(r, checkInterval))
    }

    console.log(
      `[WorkerRuntime] Instance ${instance.id} failed to become ready within ${timeoutMs}ms`,
    )
    return false
  }

  private async executeInInstance(
    instance: WorkerInstance,
    fn: WorkerFunction,
    invocation: WorkerInvocation,
    params: InvokeParams,
  ): Promise<JSONValue> {
    const timeout = params.timeout ?? fn.timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(`http://127.0.0.1:${instance.port}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invocationId: invocation.id,
          handler: fn.handler,
          payload: params.payload,
          context: {
            functionId: fn.id,
            invocationId: invocation.id,
            memoryLimitMb: fn.memory,
            timeoutMs: timeout,
          } satisfies Partial<WorkerContext>,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(error)
      }

      const result = await response.json()

      // Capture logs
      if (result.logs) {
        invocation.logs = result.logs
      }
      if (result.memoryUsedMb) {
        invocation.memoryUsedMb = result.memoryUsedMb
        instance.memoryUsedMb = Math.max(
          instance.memoryUsedMb,
          result.memoryUsedMb,
        )
      }

      return result.result
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async stopInstance(instance: WorkerInstance): Promise<void> {
    instance.status = 'stopping'

    // Wait for active invocations to complete (with timeout)
    const deadline = Date.now() + 10000
    while (instance.activeInvocations > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
    }

    if (instance.process) {
      try {
        instance.process.kill()
      } catch {}
    }

    this.releasePort(instance.port)
    instance.status = 'stopped'
    console.log(`[WorkerRuntime] Stopped instance ${instance.id}`)
  }

  private async downloadCode(cid: string, handler: string): Promise<string> {
    // Check cache first
    const cached = this.codeCache.get(cid)
    if (cached && existsSync(cached)) {
      return cached
    }

    console.log(`[WorkerRuntime] Downloading code from storage: ${cid}`)

    // Download from storage
    const result = await this.backend.download(cid)

    // Create worker directory
    const tempDir = `/tmp/dws-workers/${cid}`
    await mkdir(tempDir, { recursive: true })

    // Check if it's a gzip/tarball (magic bytes 0x1f 0x8b)
    if (result.content[0] === 0x1f && result.content[1] === 0x8b) {
      // Write tarball and extract
      const tarPath = `${tempDir}/code.tar.gz`
      await Bun.write(tarPath, result.content)

      // Extract tarball
      const proc = Bun.spawn(['tar', '-xzf', tarPath, '-C', tempDir], {
        cwd: tempDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await proc.exited

      // Look for entry point based on handler
      const handlerFile = `${handler.split('.')[0]}.js`
      const candidates = [
        handlerFile,
        'index.js',
        'main.js',
        'server.js',
        'worker.js',
      ]

      for (const file of candidates) {
        const path = `${tempDir}/${file}`
        if (existsSync(path)) {
          // Copy to main.js for bootstrap
          await Bun.write(`${tempDir}/main.js`, await Bun.file(path).text())
          return `${tempDir}/main.js`
        }
      }

      throw new Error(
        `Entry point not found in tarball. Tried: ${candidates.join(', ')}`,
      )
    }

    // Raw JS file - write as main.js
    await Bun.write(`${tempDir}/main.js`, result.content)
    return `${tempDir}/main.js`
  }

  private buildResult(invocation: WorkerInvocation): InvokeResult {
    return {
      invocationId: invocation.id,
      status:
        invocation.status === 'success'
          ? 'success'
          : invocation.status === 'timeout'
            ? 'timeout'
            : 'error',
      result: invocation.result,
      error: invocation.error,
      durationMs: invocation.durationMs ?? 0,
      billedDurationMs:
        invocation.billedDurationMs ??
        Math.ceil((invocation.durationMs ?? 0) / 100) * 100,
      memoryUsedMb: invocation.memoryUsedMb ?? 0,
      logs: invocation.logs,
    }
  }

  private recordDuration(functionId: string, durationMs: number): void {
    const durations = this.metrics.get(functionId) ?? []
    durations.push(durationMs)

    // Keep last 1000 measurements
    if (durations.length > 1000) {
      durations.shift()
    }

    this.metrics.set(functionId, durations)

    // Update function average
    const fn = this.functions.get(functionId)
    if (fn) {
      fn.avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now()

    for (const [functionId, instances] of this.instances) {
      const fn = this.functions.get(functionId)
      if (!fn) continue

      const toRemove: WorkerInstance[] = []

      for (const instance of instances) {
        // Check for dead processes
        if (instance.process && instance.process.exitCode !== null) {
          console.log(
            `[WorkerRuntime] Instance ${instance.id} process exited, removing`,
          )
          toRemove.push(instance)
          continue
        }

        // Check for idle timeout
        if (
          instance.status === 'ready' &&
          instance.activeInvocations === 0 &&
          now - instance.lastUsedAt > this.config.idleTimeout
        ) {
          const warmCount = instances.filter(
            (i) => i.status === 'ready' || i.status === 'busy',
          ).length

          if (
            warmCount > 1 ||
            now - (fn.lastInvokedAt ?? 0) > this.config.idleTimeout
          ) {
            toRemove.push(instance)
          }
        }
      }

      for (const instance of toRemove) {
        await this.stopInstance(instance)
        const idx = instances.indexOf(instance)
        if (idx >= 0) instances.splice(idx, 1)
      }
    }
  }

  getFunction(functionId: string): WorkerFunction | null {
    return this.functions.get(functionId) ?? null
  }

  listFunctions(): WorkerFunction[] {
    return Array.from(this.functions.values())
  }

  getMetrics(functionId: string) {
    const durations = this.metrics.get(functionId) ?? []
    const sorted = [...durations].sort((a, b) => a - b)

    return {
      invocations: durations.length,
      avgDurationMs:
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
      p50DurationMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95DurationMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99DurationMs: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    }
  }

  getStats() {
    const totalFunctions = this.functions.size
    let totalInstances = 0
    let activeInstances = 0

    for (const instances of this.instances.values()) {
      totalInstances += instances.length
      activeInstances += instances.filter(
        (i) => i.status === 'ready' || i.status === 'busy',
      ).length
    }

    return {
      totalFunctions,
      totalInstances,
      activeInstances,
      runtimeMode: this.runtimeMode,
      workerdAvailable: this.workerdPath !== null,
      pendingInvocations: Array.from(this.pendingQueue.values()).reduce(
        (sum, q) => sum + q.length,
        0,
      ),
    }
  }

  getLogs(
    functionId: string,
    options: { limit?: number; since?: number } = {},
  ): Array<{
    invocationId: string
    timestamp: number
    logs: string[]
  }> {
    const limit = options.limit ?? 100
    const since = options.since ?? 0

    const logs: Array<{
      invocationId: string
      timestamp: number
      logs: string[]
    }> = []

    for (const [id, invocation] of this.invocations.entries()) {
      if (invocation.functionId !== functionId) continue
      if (invocation.startedAt < since) continue
      if (invocation.logs.length === 0) continue

      logs.push({
        invocationId: id,
        timestamp: invocation.startedAt,
        logs: invocation.logs,
      })
    }

    return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
  }

  getInvocation(invocationId: string): WorkerInvocation | null {
    return this.invocations.get(invocationId) ?? null
  }
}

// Default pool config export
export { DEFAULT_POOL_CONFIG }
