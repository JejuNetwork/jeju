/**
 * Workerd Executor
 * Manages workerd processes and worker execution with V8 isolate-level isolation
 *
 * Requires workerd binary - auto-installed via postinstall script
 */

// Workerd-compatible: Uses DWS exec API for file operations, Fetch API for port checking
import { getLocalhostHost } from '@jejunetwork/config'
import type { BackendManager } from '../../storage/backends'
import { generateWorkerConfig, wrapHandlerAsWorker } from './config-generator'
import type {
  IWorkerdExecutor,
  WorkerdConfig,
  WorkerdEvent,
  WorkerdEventHandler,
  WorkerdInstance,
  WorkerdInvocation,
  WorkerdMetrics,
  WorkerdPoolMetrics,
  WorkerdProcess,
  WorkerdRequest,
  WorkerdResponse,
  WorkerdWorkerDefinition,
} from './types'
import { getDefaultWorkerdConfig } from './types'

export class WorkerdExecutor implements IWorkerdExecutor {
  private config: WorkerdConfig
  private backend: BackendManager
  private processes = new Map<string, WorkerdProcess>()
  private workers = new Map<string, WorkerdWorkerDefinition>()
  private instances = new Map<string, WorkerdInstance>()
  private workerToProcess = new Map<string, string>()
  private invocations = new Map<string, WorkerdInvocation>()
  private metrics = new Map<string, number[]>()
  private errorMetrics = new Map<string, number>()
  private requestTimestamps = new Map<string, number[]>()
  private eventHandlers: WorkerdEventHandler[] = []
  private usedPorts = new Set<number>()
  private initialized = false
  private workerdPath: string | null = null

  constructor(backend: BackendManager, config: Partial<WorkerdConfig> = {}) {
    this.backend = backend
    // Merge injected global config with provided config
    const defaultConfig = getDefaultWorkerdConfig()
    this.config = { ...defaultConfig, ...config }
  }

  /**
   * Find workerd binary path
   * Checks: env var, node_modules/.bin, system paths
   * Workerd-compatible: Uses DWS exec API for file checks
   */
  private async findWorkerdBinary(): Promise<string> {
    // DWS exec API for file operations
    interface ExecResult {
      exitCode: number
      stdout: string
      stderr: string
    }

    const execUrl = this.config.execUrl ?? `http://${getLocalhostHost()}:4020/exec`

    async function fileExists(path: string): Promise<boolean> {
      const result = await fetch(execUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: ['test', '-f', path] }),
      })
      if (!result.ok) return false
      const execResult = (await result.json()) as ExecResult
      return execResult.exitCode === 0
    }

    async function readTextFile(path: string): Promise<string> {
      const result = await fetch(execUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: ['cat', path] }),
      })
      if (!result.ok) throw new Error(`Failed to read ${path}`)
      const execResult = (await result.json()) as ExecResult
      if (execResult.exitCode !== 0) throw new Error(`Failed to read ${path}`)
      return execResult.stdout.trim()
    }

    // 1. Check env var
    if (this.config.binaryPath && (await fileExists(this.config.binaryPath))) {
      return this.config.binaryPath
    }

    // 2. Check path file from install script
    const pathFile = '/node_modules/.workerd-path' // Absolute path in workerd
    if (await fileExists(pathFile)) {
      const savedPath = await readTextFile(pathFile)
      if (savedPath && (await fileExists(savedPath))) {
        return savedPath
      }
    }

    // 3. Check node_modules/.bin
    const isWindows = process.platform === 'win32'
    const binaryName = isWindows ? 'workerd.exe' : 'workerd'
    const localBin = `/node_modules/.bin/${binaryName}` // Absolute path
    if (await fileExists(localBin)) {
      return localBin
    }

    // 4. Check system paths
    const systemPaths = isWindows
      ? ['C:\\Program Files\\workerd\\workerd.exe']
      : [
          '/usr/local/bin/workerd',
          '/usr/bin/workerd',
          `${process.env.HOME || ''}/.local/bin/workerd`,
        ]

    for (const p of systemPaths) {
      if (await fileExists(p)) {
        return p
      }
    }

    throw new Error(
      'workerd binary not found. Run "bun install" to auto-install or set WORKERD_PATH environment variable. ' +
        'Manual install: https://github.com/cloudflare/workerd/releases',
    )
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create work directory via DWS exec API (workerd-compatible)
    const execUrl = this.config.execUrl ?? `http://${getLocalhostHost()}:4020/exec`
    const mkdirResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: ['mkdir', '-p', this.config.workDir] }),
    })
    if (!mkdirResult.ok) {
      throw new Error(`Failed to create work directory: ${mkdirResult.status}`)
    }

    // Find and verify workerd binary
    this.workerdPath = await this.findWorkerdBinary()

    // Verify binary works via DWS exec API
    const verifyResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: [this.workerdPath, '--version'] }),
    })
    if (!verifyResult.ok) {
      throw new Error(`Failed to verify workerd binary: ${verifyResult.status}`)
    }
    const verifyExec = (await verifyResult.json()) as {
      exitCode: number
      stderr: string
    }
    if (verifyExec.exitCode !== 0) {
      throw new Error(
        `workerd binary at ${this.workerdPath} is not working. Exit code: ${verifyExec.exitCode}`,
      )
    }

    this.initialized = true

    // Cleanup interval
    setInterval(() => this.cleanup(), 30000)
  }

  async deployWorker(worker: WorkerdWorkerDefinition): Promise<void> {
    await this.initialize()

    worker.status = 'deploying'
    this.workers.set(worker.id, worker)

    // Download code from IPFS
    const codeDir = `${this.config.workDir}/${worker.id}`
    const execUrl = this.config.execUrl ?? `http://${getLocalhostHost()}:4020/exec`

    // Create directory via DWS exec API
    const mkdirResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: ['mkdir', '-p', codeDir] }),
    })
    if (!mkdirResult.ok) {
      throw new Error(`Failed to create code directory: ${mkdirResult.status}`)
    }

    // Fetch and extract worker code
    const result = await this.backend.download(worker.codeCid)

    // Handle different code formats
    if (this.isGzip(result.content)) {
      await this.extractTarball(result.content, codeDir)
    } else {
      // Single file, write as main module via DWS exec API
      const mainFile = worker.mainModule ?? 'worker.js'
      let code = Buffer.from(result.content).toString('utf-8')

      // Wrap if needed
      code = wrapHandlerAsWorker(code, 'handler')

      // Write file via DWS exec API
      const writeResult = await fetch(execUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: ['sh', '-c', `cat > "${codeDir}/${mainFile}"`],
          stdin: code,
        }),
      })
      if (!writeResult.ok) {
        throw new Error(`Failed to write worker file: ${writeResult.status}`)
      }

      // Update modules list
      worker.modules = [
        {
          name: mainFile,
          type: 'esModule',
          content: code,
        },
      ]
    }

    // Deploy with workerd
    await this.deployWithWorkerd(worker, codeDir)

    worker.status = 'active'
    worker.updatedAt = Date.now()

    this.emit({
      type: 'worker:deployed',
      workerId: worker.id,
      version: worker.version,
    })
  }

  private async deployWithWorkerd(
    worker: WorkerdWorkerDefinition,
    codeDir: string,
  ): Promise<void> {
    const port = await this.allocatePort()
    const configPath = `${codeDir}/config.capnp`

    // Generate workerd config
    const configContent = generateWorkerConfig(worker, port)
    const execUrl = this.config.execUrl ?? `http://${getLocalhostHost()}:4020/exec`

    // Write config file via DWS exec API
    const writeConfigResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: ['sh', '-c', `cat > "${configPath}"`],
        stdin: configContent,
      }),
    })
    if (!writeConfigResult.ok) {
      throw new Error(
        `Failed to write workerd config: ${writeConfigResult.status}`,
      )
    }

    // Start workerd process via DWS exec API
    if (!this.workerdPath) {
      throw new Error('Workerd not initialized. Call initialize() first.')
    }

    // SECURITY: Only pass minimal required environment variables to workers
    // Do NOT spread process.env - that would leak server secrets
    const spawnResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: [this.workerdPath, 'serve', configPath, '--verbose'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          WORKERD_LOG_LEVEL: 'info',
        },
        background: true,
        cwd: codeDir,
      }),
    })
    if (!spawnResult.ok) {
      throw new Error(`Failed to spawn workerd process: ${spawnResult.status}`)
    }
    const spawnData = (await spawnResult.json()) as {
      pid: number
      exitCode?: number
    }

    // Create process tracking object (workerd-compatible - no actual process object)
    const processId = crypto.randomUUID()
    const workerdProcess: WorkerdProcess = {
      id: processId,
      pid: spawnData.pid,
      port,
      status: 'starting',
      workers: new Set([worker.id]),
      startedAt: Date.now(),
      lastRequestAt: Date.now(),
      requestCount: 0,
      errorCount: 0,
      process: {
        kill: () => {
          // Kill process via DWS exec API (fire and forget)
          fetch(execUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: ['kill', String(spawnData.pid)] }),
          }).catch(() => {
            // Ignore errors
          })
        },
        exited: Promise.resolve(0), // DWS exec API handles process lifecycle
      },
    }

    this.processes.set(processId, workerdProcess)
    this.workerToProcess.set(worker.id, processId)

    // Create instance
    const instance: WorkerdInstance = {
      workerId: worker.id,
      processId,
      port,
      status: 'starting',
      activeRequests: 0,
      totalRequests: 0,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      memoryUsedMb: 0,
      cpuTimeMs: 0,
    }
    this.instances.set(worker.id, instance)

    // Wait for ready (no early exit detection needed - DWS exec API handles process lifecycle)
    const ready = await this.waitForReady(port)

    if (ready) {
      workerdProcess.status = 'ready'
      instance.status = 'ready'
      this.emit({ type: 'process:started', processId, port })
    } else {
      workerdProcess.status = 'error'
      instance.status = 'error'
      worker.status = 'error'
      worker.error =
        'Failed to start workerd process: timeout waiting for ready'
      console.error(`[WorkerdExecutor] Failed to start: timeout`)
      throw new Error(`Workerd process failed to start: timeout`)
    }

    // Note: Process exit handling is done via DWS exec API monitoring
    // The exec API will notify us if the process exits
  }

  async undeployWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId)
    if (!worker) return

    const processId = this.workerToProcess.get(workerId)
    if (processId) {
      const proc = this.processes.get(processId)
      if (proc) {
        proc.process.kill()
        this.releasePort(proc.port)
        this.processes.delete(processId)
      }
      this.workerToProcess.delete(workerId)
    }

    this.instances.delete(workerId)
    this.workers.delete(workerId)
    this.metrics.delete(workerId)

    this.emit({ type: 'worker:undeployed', workerId })
  }

  async invoke(
    workerId: string,
    request: WorkerdRequest,
  ): Promise<WorkerdResponse> {
    const worker = this.workers.get(workerId)
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`)
    }

    const instance = this.instances.get(workerId)
    if (!instance || instance.status !== 'ready') {
      throw new Error(`Worker ${workerId} is not ready`)
    }

    const invocationId = crypto.randomUUID()
    const invocation: WorkerdInvocation = {
      id: invocationId,
      workerId,
      request,
      startedAt: Date.now(),
      status: 'running',
      logs: [],
    }

    this.invocations.set(invocationId, invocation)
    this.emit({ type: 'invocation:started', invocationId, workerId })

    instance.activeRequests++
    instance.status = 'busy'

    const timeout = worker.timeoutMs || this.config.requestTimeoutMs
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const host = getLocalhostHost()
      const url = `http://${host}:${instance.port}${request.url}`

      const bodyToSend = request.body
        ? typeof request.body === 'string'
          ? request.body
          : new TextDecoder().decode(request.body)
        : undefined

      const response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        body: bodyToSend,
        signal: controller.signal,
      })

      const body = await response.text()

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      invocation.response = {
        status: response.status,
        headers: responseHeaders,
        body,
      }
      invocation.status = 'success'
      invocation.completedAt = Date.now()
      invocation.durationMs = invocation.completedAt - invocation.startedAt

      this.recordMetric(workerId, invocation.durationMs)
      this.emit({
        type: 'invocation:completed',
        invocationId,
        durationMs: invocation.durationMs,
      })

      return invocation.response
    } catch (error) {
      invocation.status =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'timeout'
          : 'error'
      invocation.error = error instanceof Error ? error.message : String(error)
      invocation.completedAt = Date.now()
      invocation.durationMs = invocation.completedAt - invocation.startedAt

      this.emit({
        type: 'invocation:error',
        invocationId,
        error: invocation.error,
      })

      throw error
    } finally {
      clearTimeout(timeoutId)
      instance.activeRequests--
      instance.totalRequests++
      instance.lastUsedAt = Date.now()
      instance.status = instance.activeRequests > 0 ? 'busy' : 'ready'

      const proc = this.processes.get(instance.processId)
      if (proc) {
        proc.requestCount++
        proc.lastRequestAt = Date.now()
      }
    }
  }

  async invokeHTTP(
    workerId: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<WorkerdResponse> {
    return this.invoke(workerId, {
      method,
      url: path,
      headers,
      body,
    })
  }

  // Port Management

  private async isPortAvailable(port: number): Promise<boolean> {
    // Workerd-compatible: Use fetch to check if port is available
    // Try to connect to the port - if it fails, port is available
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 100)
      const host = getLocalhostHost()
      await fetch(`http://${host}:${port}`, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      // If we get a response (even 404), port is in use
      return false
    } catch {
      // Connection failed - port is likely available
      // Double-check by trying to bind via DWS exec API if available
      return true
    }
  }

  private async allocatePort(): Promise<number> {
    const { min, max } = this.config.portRange

    for (let attempt = 0; attempt < 100; attempt++) {
      const port = min + Math.floor(Math.random() * (max - min))
      if (!this.usedPorts.has(port) && (await this.isPortAvailable(port))) {
        this.usedPorts.add(port)
        return port
      }
    }

    throw new Error('No available ports in configured range')
  }

  private releasePort(port: number): void {
    this.usedPorts.delete(port)
  }

  private async waitForReady(
    port: number,
    timeoutMs = 30000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const response = await fetch(`http://localhost:${port}/health`)
      const healthy = response.ok || response.status === 404 // 404 is ok, means server is up

      if (healthy) return true
      await new Promise((r) => setTimeout(r, 200))
    }

    return false
  }

  private async cleanup(): Promise<void> {
    const now = Date.now()

    for (const [workerId, instance] of this.instances) {
      const worker = this.workers.get(workerId)
      if (!worker) continue

      // Check for idle timeout
      if (
        instance.status === 'ready' &&
        instance.activeRequests === 0 &&
        now - instance.lastUsedAt > this.config.idleTimeoutMs
      ) {
        await this.undeployWorker(workerId)
      }
    }

    // Clean up old invocations
    const invocationCutoff = now - 3600000 // 1 hour
    for (const [id, inv] of this.invocations) {
      if (inv.completedAt && inv.completedAt < invocationCutoff) {
        this.invocations.delete(id)
      }
    }
  }

  private isGzip(data: Buffer): boolean {
    return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
  }

  private async extractTarball(data: Buffer, destDir: string): Promise<void> {
    const tarPath = `${destDir}/code.tar.gz`
    const execUrl = this.config.execUrl ?? `http://${getLocalhostHost()}:4020/exec`

    // Write tarball via DWS exec API
    const writeResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: ['sh', '-c', `cat > "${tarPath}"`],
        stdin: Buffer.from(data).toString('base64'),
      }),
    })
    if (!writeResult.ok) {
      throw new Error(`Failed to write tarball: ${writeResult.status}`)
    }

    // Extract via DWS exec API
    const extractResult = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: ['tar', '-xzf', tarPath, '-C', destDir],
        cwd: destDir,
      }),
    })
    if (!extractResult.ok) {
      throw new Error(`Failed to extract tarball: ${extractResult.status}`)
    }
    const extractData = (await extractResult.json()) as { exitCode: number }
    if (extractData.exitCode !== 0) {
      throw new Error(
        `tar extraction failed with exit code ${extractData.exitCode}`,
      )
    }
  }

  private recordMetric(
    workerId: string,
    durationMs: number,
    isError = false,
  ): void {
    const durations = this.metrics.get(workerId) ?? []
    durations.push(durationMs)
    if (durations.length > 1000) {
      durations.shift()
    }
    this.metrics.set(workerId, durations)

    // Track errors
    if (isError) {
      const errors = this.errorMetrics.get(workerId) ?? 0
      this.errorMetrics.set(workerId, errors + 1)
    }

    // Track request timestamps for RPS calculation
    const timestamps = this.requestTimestamps.get(workerId) ?? []
    timestamps.push(Date.now())
    // Keep timestamps from last minute only
    const oneMinuteAgo = Date.now() - 60000
    const recentTimestamps = timestamps.filter((t) => t > oneMinuteAgo)
    this.requestTimestamps.set(workerId, recentTimestamps)
  }

  on(handler: WorkerdEventHandler): void {
    this.eventHandlers.push(handler)
  }

  off(handler: WorkerdEventHandler): void {
    const idx = this.eventHandlers.indexOf(handler)
    if (idx >= 0) {
      this.eventHandlers.splice(idx, 1)
    }
  }

  private emit(event: WorkerdEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  getWorker(workerId: string): WorkerdWorkerDefinition | null {
    return this.workers.get(workerId) || null
  }

  listWorkers(): WorkerdWorkerDefinition[] {
    return Array.from(this.workers.values())
  }

  getInstance(
    workerId: string,
  ): (Pick<WorkerdInstance, 'status' | 'port'> & { endpoint: string }) | null {
    const instance = this.instances.get(workerId)
    if (!instance) return null
    return {
      status: instance.status,
      port: instance.port,
      endpoint: `http://localhost:${instance.port}`,
    }
  }

  getInvocation(invocationId: string): WorkerdInvocation | null {
    return this.invocations.get(invocationId) || null
  }

  getMetrics(workerId: string): WorkerdMetrics {
    const durations = this.metrics.get(workerId) ?? []
    const sorted = [...durations].sort((a, b) => a - b)
    const instance = this.instances.get(workerId)
    const errors = this.errorMetrics.get(workerId) ?? 0

    return {
      workerId,
      invocations: durations.length,
      errors,
      avgDurationMs:
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
      p50DurationMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95DurationMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99DurationMs: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      avgCpuTimeMs: 0,
      coldStarts: 0,
      warmStarts: durations.length,
      wallTimeMs: instance ? Date.now() - instance.startedAt : 0,
      cpuTimeMs: instance?.cpuTimeMs ?? 0,
      memoryUsedMb: instance?.memoryUsedMb ?? 0,
    }
  }

  getPoolMetrics(): WorkerdPoolMetrics {
    let activeProcesses = 0
    let activeWorkers = 0
    let pendingRequests = 0
    let totalRequests = 0
    let totalErrors = 0
    let totalLatency = 0
    let latencyCount = 0

    for (const proc of this.processes.values()) {
      if (proc.status === 'ready' || proc.status === 'busy') {
        activeProcesses++
      }
      totalRequests += proc.requestCount
    }

    for (const instance of this.instances.values()) {
      if (instance.status === 'ready' || instance.status === 'busy') {
        activeWorkers++
      }
      pendingRequests += instance.activeRequests
    }

    // Calculate RPS from recent timestamps and aggregate metrics
    const oneMinuteAgo = Date.now() - 60000
    let recentRequestCount = 0
    for (const [workerId, timestamps] of this.requestTimestamps) {
      recentRequestCount += timestamps.filter((t) => t > oneMinuteAgo).length
      totalErrors += this.errorMetrics.get(workerId) ?? 0
      const durations = this.metrics.get(workerId) ?? []
      if (durations.length > 0) {
        totalLatency += durations.reduce((a, b) => a + b, 0)
        latencyCount += durations.length
      }
    }

    const requestsPerSecond = recentRequestCount / 60
    const avgLatencyMs = latencyCount > 0 ? totalLatency / latencyCount : 0
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0

    return {
      totalProcesses: this.processes.size,
      activeProcesses,
      totalWorkers: this.workers.size,
      activeWorkers,
      pendingRequests,
      requestsPerSecond,
      avgLatencyMs,
      errorRate,
    }
  }

  getStats() {
    return {
      totalWorkers: this.workers.size,
      activeWorkers: Array.from(this.instances.values()).filter(
        (i) => i.status === 'ready' || i.status === 'busy',
      ).length,
      totalProcesses: this.processes.size,
      activeProcesses: Array.from(this.processes.values()).filter(
        (p) => p.status === 'ready' || p.status === 'busy',
      ).length,
      pendingInvocations: Array.from(this.instances.values()).reduce(
        (sum, i) => sum + i.activeRequests,
        0,
      ),
    }
  }
}
