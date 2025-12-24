/**
 * TEE Worker Runner
 *
 * Runs on each TEE node to execute workloads.
 * Handles:
 * - Receiving deployment requests from coordinator
 * - Pulling code from IPFS
 * - Secure secret injection within TEE
 * - Running workerd/bun workers
 * - TEE attestation generation
 * - Health reporting
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Address, type Hex, keccak256, toBytes } from 'viem'
import type { BackendManager } from '../../storage/backends'
import type { AttestationQuoteResponse } from '../../types'
import { getRegion } from './regions'
import type { TEESecretManager } from './secrets'
import type {
  NetworkEnvironment,
  RegionId,
  TEEAttestation,
  TEEPlatform,
  WorkloadConfig,
  WorkloadInstance,
  WorkloadResources,
  WorkloadRuntime,
} from './types'

// Configuration

export interface RunnerConfig {
  /** Node's region */
  region: RegionId
  /** Node's HTTP endpoint (public-facing) */
  endpoint: string
  /** TEE platform */
  teePlatform: TEEPlatform
  /** Work directory for code */
  workDir: string
  /** Path to workerd binary */
  workerdPath?: string
  /** Network environment */
  environment: NetworkEnvironment
  /** RPC URL for on-chain operations */
  rpcUrl: string
  /** Identity registry address */
  registryAddress: Address
  /** Private key for signing */
  privateKey: `0x${string}`
  /** TEE attestation endpoint (for real TEE) */
  teeAttestationEndpoint?: string
  /** Max concurrent workloads */
  maxWorkloads: number
  /** Max memory per workload (MB) */
  maxMemoryPerWorkload: number
}

const DEFAULT_CONFIG: Partial<RunnerConfig> = {
  workDir: '/tmp/tee-worker',
  maxWorkloads: 50,
  maxMemoryPerWorkload: 512,
}

// Running Workload

interface RunningWorkload {
  config: WorkloadConfig
  instance: WorkloadInstance
  process?: { kill: () => void; exited: Promise<number> }
  port: number
  secretValues: Record<string, string>
  attestation?: TEEAttestation
}

// TEE Worker Runner

export class TEEWorkerRunner {
  private config: RunnerConfig
  private backendManager: BackendManager
  private secretManager: TEESecretManager

  // Running workloads
  private workloads = new Map<string, RunningWorkload>()
  private usedPorts = new Set<number>()
  private nextPort = 20000

  // Node identity
  private agentId: bigint | null = null

  constructor(
    config: RunnerConfig,
    backendManager: BackendManager,
    secretManager: TEESecretManager,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RunnerConfig
    this.backendManager = backendManager
    this.secretManager = secretManager
  }

  // Lifecycle

  async initialize(): Promise<void> {
    // Create work directory
    await mkdir(this.config.workDir, { recursive: true })

    // Verify region is valid for environment
    const region = getRegion(this.config.region)

    if (!region && this.config.region !== 'local') {
      console.warn(
        `[TEERunner] Region ${this.config.region} not in known regions, treating as custom`,
      )
    }

    // Generate initial attestation
    const attestation = await this.generateAttestation('init')
    console.log(
      `[TEERunner] Initialized in ${this.config.region} with ${this.config.teePlatform} TEE`,
    )
    console.log(
      `[TEERunner] Attestation: ${attestation.simulated ? 'SIMULATED' : 'REAL'}`,
    )
  }

  async shutdown(): Promise<void> {
    // Stop all workloads
    for (const [workloadId, workload] of this.workloads) {
      console.log(`[TEERunner] Stopping workload ${workloadId}`)
      workload.process?.kill()
    }
    this.workloads.clear()
    console.log('[TEERunner] Shutdown complete')
  }

  setAgentId(agentId: bigint): void {
    this.agentId = agentId
  }

  // Workload Deployment

  async deploy(params: {
    workloadId: string
    name: string
    codeCid: string
    codeHash: Hex
    runtime: WorkloadRuntime
    entrypoint: string
    env: Record<string, string>
    secretNames: string[]
    resources: WorkloadResources
    teeRequirements: WorkloadConfig['teeRequirements']
    owner: Address
  }): Promise<{ instanceId: string; attestation?: TEEAttestation }> {
    console.log(`[TEERunner] Deploying ${params.name} (${params.workloadId})`)

    // Check capacity
    if (this.workloads.size >= this.config.maxWorkloads) {
      throw new Error('Node at capacity')
    }

    // Check resource requirements
    if (params.resources.memoryMb > this.config.maxMemoryPerWorkload) {
      throw new Error(
        `Memory requirement ${params.resources.memoryMb}MB exceeds max ${this.config.maxMemoryPerWorkload}MB`,
      )
    }

    // Pull code from IPFS
    const codeDir = join(this.config.workDir, params.workloadId)
    await mkdir(codeDir, { recursive: true })

    const codeResult = await this.backendManager.download(params.codeCid)

    // Verify code hash
    const hash = keccak256(codeResult.content) as Hex
    if (hash !== params.codeHash) {
      throw new Error('Code hash mismatch - code may have been tampered with')
    }

    // Write code to disk
    const mainFile = `${params.entrypoint.split('.')[0]}.js`
    let code = Buffer.from(codeResult.content).toString('utf-8')

    // Wrap code for workerd if needed
    if (params.runtime === 'workerd') {
      code = this.wrapForWorkerd(code, params.entrypoint)
    }

    await Bun.write(join(codeDir, mainFile), code)

    // Fetch secrets within TEE
    const secretValues: Record<string, string> = {}
    if (params.secretNames.length > 0) {
      for (const secretName of params.secretNames) {
        const value = await this.secretManager.getSecret(
          params.owner,
          secretName,
        )
        if (value) {
          secretValues[secretName] = value
        }
      }
    }

    // Generate attestation for this deployment
    const attestation = params.teeRequirements.attestationRequired
      ? await this.generateAttestation(params.workloadId)
      : undefined

    // Verify expected measurement if provided
    if (
      attestation &&
      params.teeRequirements.expectedMeasurement &&
      attestation.measurement !== params.teeRequirements.expectedMeasurement
    ) {
      throw new Error('TEE measurement does not match expected value')
    }

    // Allocate port
    const port = this.allocatePort()

    // Start the worker
    const process = await this.startWorker({
      workloadId: params.workloadId,
      codeDir,
      mainFile,
      runtime: params.runtime,
      env: { ...params.env, ...secretValues },
      port,
      resources: params.resources,
    })

    // Create instance
    const instanceId = `${params.workloadId}-${Date.now()}`
    const instance: WorkloadInstance = {
      id: instanceId,
      nodeAgentId: this.agentId ?? 0n,
      nodeEndpoint: this.config.endpoint,
      region: this.config.region,
      status: 'warm',
      startedAt: Date.now(),
      lastRequestAt: Date.now(),
      activeRequests: 0,
      totalRequests: 0,
      errors: 0,
      attestation,
    }

    // Track workload
    const workloadConfig: WorkloadConfig = {
      id: params.workloadId,
      name: params.name,
      owner: params.owner,
      codeCid: params.codeCid,
      codeHash: params.codeHash,
      runtime: params.runtime,
      entrypoint: params.entrypoint,
      env: params.env,
      secretNames: params.secretNames,
      resources: params.resources,
      scaling: {
        minInstances: 1,
        maxInstances: 1,
        targetConcurrency: params.resources.maxConcurrency,
        scaleToZero: false,
        cooldownMs: 60000,
      },
      teeRequirements: params.teeRequirements,
      regionPreferences: {
        preferred: [this.config.region],
        excluded: [],
        preferredZones: [],
        allowFallback: true,
      },
    }

    this.workloads.set(params.workloadId, {
      config: workloadConfig,
      instance,
      process,
      port,
      secretValues,
      attestation,
    })

    // Handle process exit
    process.exited.then((exitCode) => {
      console.log(
        `[TEERunner] Workload ${params.workloadId} exited with code ${exitCode}`,
      )
      const workload = this.workloads.get(params.workloadId)
      if (workload) {
        workload.instance.status = 'stopped'
        this.releasePort(workload.port)
      }
    })

    // Wait for worker to be ready
    await this.waitForReady(port)

    console.log(`[TEERunner] Deployed ${params.name} on port ${port}`)

    return { instanceId, attestation }
  }

  private wrapForWorkerd(code: string, entrypoint: string): string {
    // Check if code already exports default with fetch handler
    if (code.includes('export default') && code.includes('fetch')) {
      return code
    }

    // Wrap handler function to export default with fetch
    const handlerName = entrypoint.split('.').pop() ?? 'handler'

    return `
${code}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Parse body
    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = await request.json();
      } catch {
        body = await request.text();
      }
    }

    // Build event
    const event = {
      method,
      path,
      headers: Object.fromEntries(request.headers.entries()),
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    };

    // Call handler
    const result = await ${handlerName}(event, { env });

    // Return response
    if (result instanceof Response) {
      return result;
    }

    return new Response(JSON.stringify(result), {
      status: result?.statusCode ?? 200,
      headers: {
        'Content-Type': 'application/json',
        ...(result?.headers ?? {}),
      },
    });
  }
};
`
  }

  private async startWorker(params: {
    workloadId: string
    codeDir: string
    mainFile: string
    runtime: WorkloadRuntime
    env: Record<string, string>
    port: number
    resources: WorkloadResources
  }): Promise<{ kill: () => void; exited: Promise<number> }> {
    const { runtime, codeDir, mainFile, env, port } = params

    if (runtime === 'workerd') {
      return this.startWorkerdWorker(params)
    }

    // Default to bun runtime
    const proc = Bun.spawn(['bun', 'run', mainFile], {
      cwd: codeDir,
      env: {
        ...process.env,
        ...env,
        PORT: String(port),
        NODE_ENV: 'production',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    return {
      kill: () => proc.kill(),
      exited: proc.exited,
    }
  }

  private async startWorkerdWorker(params: {
    workloadId: string
    codeDir: string
    mainFile: string
    env: Record<string, string>
    port: number
    resources: WorkloadResources
  }): Promise<{ kill: () => void; exited: Promise<number> }> {
    const { workloadId, codeDir, mainFile, env, port, resources } = params

    // Generate workerd config
    const configContent = this.generateWorkerdConfig({
      name: workloadId,
      mainModule: mainFile,
      port,
      env,
      memoryMb: resources.memoryMb,
      cpuTimeMs: resources.cpuMillis,
    })

    const configPath = join(codeDir, 'config.capnp')
    await Bun.write(configPath, configContent)

    // Find workerd binary
    const workerdPath = this.config.workerdPath ?? (await this.findWorkerd())

    const proc = Bun.spawn([workerdPath, 'serve', configPath, '--verbose'], {
      cwd: codeDir,
      env: {
        ...process.env,
        WORKERD_LOG_LEVEL: 'info',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    return {
      kill: () => proc.kill(),
      exited: proc.exited,
    }
  }

  private generateWorkerdConfig(params: {
    name: string
    mainModule: string
    port: number
    env: Record<string, string>
    memoryMb: number
    cpuTimeMs: number
  }): string {
    const { mainModule, port, env } = params

    const bindings = Object.entries(env)
      .map(([key, value]) => `      (name = "${key}", text = "${value}")`)
      .join(',\n')

    return `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .mainWorker),
  ],
  sockets = [
    (name = "http", address = "*:${port}", http = (), service = "main"),
  ],
);

const mainWorker :Workerd.Worker = (
  modules = [
    (name = "${mainModule}", esModule = embed "${mainModule}"),
  ],
  bindings = [
${bindings}
  ],
  compatibilityDate = "${new Date().toISOString().split('T')[0]}",
);
`
  }

  private async findWorkerd(): Promise<string> {
    // Check common locations
    const paths = [
      process.env.WORKERD_PATH,
      join(process.cwd(), 'node_modules', '.bin', 'workerd'),
      '/usr/local/bin/workerd',
      '/usr/bin/workerd',
    ].filter(Boolean) as string[]

    for (const p of paths) {
      if (existsSync(p)) return p
    }

    throw new Error('workerd binary not found')
  }

  private allocatePort(): number {
    while (this.usedPorts.has(this.nextPort)) {
      this.nextPort++
    }
    const port = this.nextPort++
    this.usedPorts.add(port)
    return port
  }

  private releasePort(port: number): void {
    this.usedPorts.delete(port)
  }

  private async waitForReady(port: number, timeoutMs = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const response = await fetch(`http://localhost:${port}/health`)
      if (response.ok || response.status === 404) return
      await new Promise((r) => setTimeout(r, 200))
    }

    throw new Error('Worker failed to become ready')
  }

  // Workload Invocation

  async invoke(workloadId: string, request: Request): Promise<Response> {
    const workload = this.workloads.get(workloadId)
    if (!workload) {
      return new Response(JSON.stringify({ error: 'Workload not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (
      workload.instance.status !== 'warm' &&
      workload.instance.status !== 'busy'
    ) {
      return new Response(JSON.stringify({ error: 'Workload not ready' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    workload.instance.activeRequests++
    workload.instance.status = 'busy'

    try {
      const url = new URL(request.url)
      const response = await fetch(
        `http://localhost:${workload.port}${url.pathname}${url.search}`,
        {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: AbortSignal.timeout(workload.config.resources.timeoutMs),
        },
      )

      workload.instance.totalRequests++
      workload.instance.lastRequestAt = Date.now()

      return response
    } catch (err) {
      workload.instance.errors++

      return new Response(
        JSON.stringify({
          error: 'Invocation failed',
          message: err instanceof Error ? err.message : String(err),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    } finally {
      workload.instance.activeRequests--
      workload.instance.status =
        workload.instance.activeRequests > 0 ? 'busy' : 'warm'
    }
  }

  // Workload Management

  async stop(workloadId: string): Promise<void> {
    const workload = this.workloads.get(workloadId)
    if (!workload) return

    workload.instance.status = 'draining'

    // Wait for active requests to complete (max 30s)
    const deadline = Date.now() + 30000
    while (workload.instance.activeRequests > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }

    workload.process?.kill()
    workload.instance.status = 'stopped'
    this.releasePort(workload.port)
    this.workloads.delete(workloadId)

    console.log(`[TEERunner] Stopped workload ${workloadId}`)
  }

  getWorkload(workloadId: string): RunningWorkload | undefined {
    return this.workloads.get(workloadId)
  }

  listWorkloads(): {
    id: string
    name: string
    status: string
    region: string
  }[] {
    return Array.from(this.workloads.values()).map((w) => ({
      id: w.config.id,
      name: w.config.name,
      status: w.instance.status,
      region: w.instance.region,
    }))
  }

  // TEE Attestation

  async generateAttestation(reportData: string): Promise<TEEAttestation> {
    const timestamp = Date.now()

    if (
      this.config.teePlatform === 'simulator' ||
      this.config.environment === 'localnet'
    ) {
      // Simulated attestation for development
      const measurement = keccak256(
        toBytes(`${this.config.region}:${timestamp}`),
      )

      return {
        quote: `0x${'00'.repeat(256)}` as Hex,
        measurement,
        reportData: keccak256(toBytes(reportData)),
        timestamp,
        platform: 'simulator',
        simulated: true,
      }
    }

    // Real TEE attestation
    const endpoint =
      this.config.teeAttestationEndpoint ?? process.env.DSTACK_ENDPOINT

    if (!endpoint) {
      throw new Error('TEE attestation endpoint not configured')
    }

    const response = await fetch(
      `${endpoint}/GetQuote?report_data=0x${Buffer.from(reportData).toString('hex')}`,
    )

    if (!response.ok) {
      throw new Error(`TEE attestation failed: ${response.status}`)
    }

    const data = (await response.json()) as AttestationQuoteResponse

    // Extract measurement from quote (simplified)
    const quote = data.quote as Hex
    const measurement =
      quote.length >= 196
        ? (quote.slice(128, 196) as Hex)
        : keccak256(toBytes(quote))

    return {
      quote,
      measurement,
      reportData: keccak256(toBytes(reportData)),
      timestamp,
      platform: this.config.teePlatform,
      simulated: false,
    }
  }

  async refreshAttestation(workloadId: string): Promise<TEEAttestation | null> {
    const workload = this.workloads.get(workloadId)
    if (!workload) return null

    const attestation = await this.generateAttestation(workloadId)
    workload.attestation = attestation
    workload.instance.attestation = attestation

    return attestation
  }

  // Health

  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy'
    region: string
    teePlatform: string
    workloads: number
    capacity: number
    attestation: { simulated: boolean; timestamp?: number }
  } {
    const workloadCount = this.workloads.size

    return {
      status: workloadCount < this.config.maxWorkloads ? 'healthy' : 'degraded',
      region: this.config.region,
      teePlatform: this.config.teePlatform,
      workloads: workloadCount,
      capacity: this.config.maxWorkloads - workloadCount,
      attestation: {
        simulated:
          this.config.teePlatform === 'simulator' ||
          this.config.environment === 'localnet',
        timestamp: Date.now(),
      },
    }
  }

  getResources(): {
    availableCpuMillis: number
    availableMemoryMb: number
    gpuAvailable: boolean
  } {
    // Calculate available resources based on running workloads
    let usedMemory = 0
    let usedCpu = 0

    for (const workload of this.workloads.values()) {
      usedMemory += workload.config.resources.memoryMb
      usedCpu += workload.config.resources.cpuMillis
    }

    // Check for GPU availability via environment or capability detection
    const gpuAvailable =
      process.env.GPU_AVAILABLE === 'true' ||
      process.env.NVIDIA_VISIBLE_DEVICES !== undefined

    return {
      availableCpuMillis: Math.max(0, 4000 - usedCpu),
      availableMemoryMb: Math.max(
        0,
        this.config.maxWorkloads * this.config.maxMemoryPerWorkload -
          usedMemory,
      ),
      gpuAvailable,
    }
  }
}

// Factory

export function createRunner(
  config: Partial<RunnerConfig> & {
    region: RegionId
    endpoint: string
    privateKey: `0x${string}`
  },
  backendManager: BackendManager,
  secretManager: TEESecretManager,
): TEEWorkerRunner {
  const environment = (process.env.NETWORK as NetworkEnvironment) ?? 'localnet'
  const rpcUrl =
    config.rpcUrl ??
    process.env.RPC_URL ??
    (environment === 'localnet' ? 'http://localhost:6546' : undefined)

  if (!rpcUrl) {
    throw new Error('RPC_URL required')
  }

  const fullConfig: RunnerConfig = {
    region: config.region,
    endpoint: config.endpoint,
    teePlatform: config.teePlatform ?? 'simulator',
    workDir: config.workDir ?? '/tmp/tee-worker',
    workerdPath: config.workerdPath,
    environment,
    rpcUrl,
    registryAddress:
      config.registryAddress ??
      (process.env.IDENTITY_REGISTRY_ADDRESS as Address) ??
      '0x0000000000000000000000000000000000000000',
    privateKey: config.privateKey,
    teeAttestationEndpoint: config.teeAttestationEndpoint,
    maxWorkloads: config.maxWorkloads ?? 50,
    maxMemoryPerWorkload: config.maxMemoryPerWorkload ?? 512,
  }

  return new TEEWorkerRunner(fullConfig, backendManager, secretManager)
}
