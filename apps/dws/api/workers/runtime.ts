/**
 * Worker Runtime
 * Process-isolated worker execution
 */

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

export class WorkerRuntime {
  private backend: BackendManager
  private functions = new Map<string, WorkerFunction>()
  private instances = new Map<string, WorkerInstance[]>()
  private invocations = new Map<string, WorkerInvocation>()
  private pendingQueue = new Map<string, InvokeParams[]>()
  private config: WorkerPoolConfig
  private codeCache = new Map<string, string>() // cid -> local path
  private metrics = new Map<string, number[]>() // functionId -> durations

  constructor(backend: BackendManager, config: Partial<WorkerPoolConfig> = {}) {
    this.backend = backend
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }

    // Cleanup interval
    setInterval(() => this.cleanup(), 30000)
  }

  async deployFunction(fn: WorkerFunction): Promise<void> {
    // Download and cache the code
    const codePath = await this.downloadCode(fn.codeCid)
    this.codeCache.set(fn.codeCid, codePath)

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
      const url = `http://localhost:${instance.port}${event.path}`
      const queryString = new URLSearchParams(event.query || {}).toString()
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

    // Find a ready instance
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
      const instance = await this.createInstance(fn)
      if (instance) {
        instances.push(instance)
        this.instances.set(fn.id, instances)
        return instance
      }
    }

    return null
  }

  private async createInstance(
    fn: WorkerFunction,
  ): Promise<WorkerInstance | null> {
    const port = 20000 + Math.floor(Math.random() * 10000)
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

    // Get code path
    const codePath = this.codeCache.get(fn.codeCid)
    if (!codePath) {
      console.error(`[WorkerRuntime] Code not cached for ${fn.id}`)
      return null
    }

    try {
      // Get bun path from current process or fallback to common locations
      const bunPath = process.execPath || '/usr/local/bin/bun'

      // Spawn isolated process
      const proc = Bun.spawn([bunPath, 'run', codePath], {
        env: {
          ...fn.env,
          PORT: String(port),
          FUNCTION_ID: fn.id,
          INSTANCE_ID: id,
          FUNCTION_MEMORY: String(fn.memory),
          FUNCTION_TIMEOUT: String(fn.timeout),
        },
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: codePath.replace(/\/[^/]+$/, ''),
      })

      instance.process = proc

      // Capture stderr for debugging
      proc.stderr
        .pipeTo(
          new WritableStream({
            write(chunk) {
              const text = new TextDecoder().decode(chunk)
              if (text.trim()) {
                console.log(`[WorkerRuntime] ${fn.name} stderr: ${text.trim()}`)
              }
            },
          }),
        )
        .catch(() => {})

      // Wait for ready
      const ready = await this.waitForReady(instance)
      instance.status = ready ? 'ready' : 'stopped'

      if (!ready) {
        console.log(
          `[WorkerRuntime] Worker ${fn.name} did not become ready on port ${port}`,
        )
        proc.kill()
        return null
      }

      console.log(`[WorkerRuntime] Created instance ${id} for ${fn.name}`)
      return instance
    } catch (error) {
      console.error(`[WorkerRuntime] Failed to create instance:`, error)
      return null
    }
  }

  private async waitForReady(
    instance: WorkerInstance,
    timeoutMs = 30000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const response = await fetch(`http://localhost:${instance.port}/health`, {
        signal: AbortSignal.timeout(2000),
      }).catch(() => null)

      if (response?.ok) return true
      await new Promise((r) => setTimeout(r, 500))
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
      const response = await fetch(`http://localhost:${instance.port}/invoke`, {
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

    // Wait for active invocations to complete
    const deadline = Date.now() + 30000
    while (instance.activeInvocations > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000))
    }

    if (instance.process) {
      ;(instance.process as { kill: () => void }).kill()
    }

    instance.status = 'stopped'
    console.log(`[WorkerRuntime] Stopped instance ${instance.id}`)
  }

  private async downloadCode(cid: string): Promise<string> {
    // Check cache first
    const cached = this.codeCache.get(cid)
    if (cached) {
      return cached
    }

    // Download from storage
    const result = await this.backend.download(cid)

    // Extract to temp directory
    const tempDir = `/tmp/dws-workers/${cid}`

    // Check if it's a gzip/tarball (magic bytes 0x1f 0x8b)
    if (result.content[0] === 0x1f && result.content[1] === 0x8b) {
      // Write tarball and extract using tar command
      const tarPath = `${tempDir}.tar.gz`
      await Bun.write(tarPath, result.content)

      // Extract tarball using Bun.spawn
      const proc = Bun.spawn(['tar', '-xzf', tarPath, '-C', tempDir], {
        cwd: '/tmp',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      await proc.exited

      // Look for entry point
      const files = ['index.js', 'main.js', 'handler.js', 'worker.js']
      for (const file of files) {
        const path = `${tempDir}/${file}`
        if (await Bun.file(path).exists()) {
          this.codeCache.set(cid, path)
          return path
        }
      }

      // Default to index.js
      this.codeCache.set(cid, `${tempDir}/index.js`)
      return `${tempDir}/index.js`
    }

    // Not a tarball, assume it's raw JS
    await Bun.write(`${tempDir}/index.js`, result.content)
    this.codeCache.set(cid, `${tempDir}/index.js`)
    return `${tempDir}/index.js`
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

      // Find idle instances past timeout
      const toRemove: WorkerInstance[] = []

      for (const instance of instances) {
        if (
          instance.status === 'ready' &&
          instance.activeInvocations === 0 &&
          now - instance.lastUsedAt > this.config.idleTimeout
        ) {
          // Keep at least one warm instance if function is active
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
      pendingInvocations: Array.from(this.pendingQueue.values()).reduce(
        (sum, q) => sum + q.length,
        0,
      ),
    }
  }

  /**
   * Get logs for a function from recent invocations
   */
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

    // Sort by timestamp descending and limit
    return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
  }

  /**
   * Get invocation by ID
   */
  getInvocation(invocationId: string): WorkerInvocation | null {
    return this.invocations.get(invocationId) ?? null
  }
}

// Default pool config export
export { DEFAULT_POOL_CONFIG }
