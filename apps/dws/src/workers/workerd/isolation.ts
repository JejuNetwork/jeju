/**
 * Worker Isolation Modes
 *
 * DWS supports two isolation modes for workers:
 *
 * 1. SHARED - Multiple workers share a workerd process
 *    - More efficient resource usage
 *    - Faster cold starts (reuse existing process)
 *    - Good for trusted workers, development
 *    - Default mode
 *
 * 2. DEDICATED - Each worker gets its own workerd process
 *    - Complete isolation between workers
 *    - Can run in TEE with individual attestation
 *    - Required for sensitive workloads
 *    - Higher resource overhead
 *
 * TEE Integration:
 * - Both modes can run inside a TEE
 * - DEDICATED mode allows per-worker attestation
 * - SHARED mode uses a single attestation for the process
 */

import type { Hex } from 'viem'
import type { WorkerdWorkerDefinition } from './types'

// ============================================================================
// Types
// ============================================================================

export type IsolationMode = 'shared' | 'dedicated'

export interface IsolationConfig {
  mode: IsolationMode
  tee?: TEEConfig
  resources?: ResourceLimits
  networking?: NetworkConfig
}

export interface TEEConfig {
  enabled: boolean
  platform: 'intel_tdx' | 'amd_sev' | 'simulator' | 'none'
  attestationRequired: boolean
  expectedMeasurement?: Hex
  dstackEndpoint?: string
}

export interface ResourceLimits {
  maxWorkers: number // Max workers per process (shared mode)
  cpuLimit: number // CPU limit in millicores
  memoryLimit: number // Memory limit in MB
  maxConcurrent: number // Max concurrent requests per worker
  requestTimeout: number // Request timeout in ms
}

export interface NetworkConfig {
  allowExternalFetch: boolean
  allowedHosts: string[]
  denyHosts: string[]
  maxConnections: number
}

export const DEFAULT_ISOLATION_CONFIG: IsolationConfig = {
  mode: 'shared',
  tee: {
    enabled: false,
    platform: 'none',
    attestationRequired: false,
  },
  resources: {
    maxWorkers: 100,
    cpuLimit: 1000, // 1 CPU
    memoryLimit: 512, // 512 MB
    maxConcurrent: 50,
    requestTimeout: 30000, // 30 seconds
  },
  networking: {
    allowExternalFetch: true,
    allowedHosts: ['*'],
    denyHosts: [],
    maxConnections: 100,
  },
}

export const DEDICATED_ISOLATION_CONFIG: IsolationConfig = {
  mode: 'dedicated',
  tee: {
    enabled: true,
    platform: 'intel_tdx',
    attestationRequired: true,
  },
  resources: {
    maxWorkers: 1,
    cpuLimit: 2000, // 2 CPUs
    memoryLimit: 1024, // 1 GB
    maxConcurrent: 100,
    requestTimeout: 60000, // 60 seconds
  },
  networking: {
    allowExternalFetch: false,
    allowedHosts: [],
    denyHosts: ['*'],
    maxConnections: 10,
  },
}

// ============================================================================
// Isolation Manager
// ============================================================================

export class WorkerIsolationManager {
  private sharedProcesses = new Map<string, SharedProcess>()
  private dedicatedProcesses = new Map<string, DedicatedProcess>()
  private defaultConfig: IsolationConfig

  constructor(config: IsolationConfig = DEFAULT_ISOLATION_CONFIG) {
    this.defaultConfig = config
  }

  /**
   * Get or create an isolation context for a worker
   */
  async getIsolationContext(
    worker: WorkerdWorkerDefinition,
    config?: Partial<IsolationConfig>,
  ): Promise<IsolationContext> {
    const mergedConfig = { ...this.defaultConfig, ...config }

    if (mergedConfig.mode === 'dedicated') {
      return this.createDedicatedContext(worker, mergedConfig)
    }

    return this.getSharedContext(worker, mergedConfig)
  }

  /**
   * Create a dedicated process for a single worker
   */
  private async createDedicatedContext(
    worker: WorkerdWorkerDefinition,
    config: IsolationConfig,
  ): Promise<IsolationContext> {
    const processId = `dedicated-${worker.id}-${Date.now()}`

    const process: DedicatedProcess = {
      id: processId,
      workerId: worker.id,
      status: 'starting',
      config,
      port: await this.allocatePort(),
      attestation: null,
    }

    // If TEE is enabled, get attestation
    if (config.tee?.enabled && config.tee.platform !== 'none') {
      process.attestation = await this.getTEEAttestation(worker, config.tee)
    }

    this.dedicatedProcesses.set(worker.id, process)
    process.status = 'running'

    return {
      mode: 'dedicated',
      processId,
      workerId: worker.id,
      port: process.port,
      attestation: process.attestation,
      config,
    }
  }

  /**
   * Get a shared process context
   */
  private async getSharedContext(
    worker: WorkerdWorkerDefinition,
    config: IsolationConfig,
  ): Promise<IsolationContext> {
    const maxWorkers =
      config.resources?.maxWorkers ??
      DEFAULT_ISOLATION_CONFIG.resources?.maxWorkers ??
      100

    // Find a shared process with capacity
    for (const [id, process] of this.sharedProcesses) {
      if (process.workers.size < maxWorkers && process.status === 'running') {
        process.workers.add(worker.id)
        return {
          mode: 'shared',
          processId: id,
          workerId: worker.id,
          port: process.port,
          attestation: process.attestation,
          config,
        }
      }
    }

    // Create new shared process
    const processId = `shared-${Date.now()}`
    const port = await this.allocatePort()

    let attestation: TEEAttestation | null = null
    if (config.tee?.enabled && config.tee.platform !== 'none') {
      attestation = await this.getTEEAttestation(null, config.tee)
    }

    const process: SharedProcess = {
      id: processId,
      workers: new Set([worker.id]),
      status: 'running',
      config,
      port,
      attestation,
    }

    this.sharedProcesses.set(processId, process)

    return {
      mode: 'shared',
      processId,
      workerId: worker.id,
      port,
      attestation,
      config,
    }
  }

  /**
   * Release a worker from its isolation context
   */
  async releaseWorker(workerId: string): Promise<void> {
    // Check dedicated processes
    const dedicated = this.dedicatedProcesses.get(workerId)
    if (dedicated) {
      dedicated.status = 'stopped'
      this.dedicatedProcesses.delete(workerId)
      return
    }

    // Check shared processes
    for (const [id, process] of this.sharedProcesses) {
      if (process.workers.has(workerId)) {
        process.workers.delete(workerId)

        // Clean up empty shared processes
        if (process.workers.size === 0) {
          process.status = 'stopped'
          this.sharedProcesses.delete(id)
        }
        return
      }
    }
  }

  /**
   * Get TEE attestation for a process
   */
  private async getTEEAttestation(
    worker: WorkerdWorkerDefinition | null,
    teeConfig: TEEConfig,
  ): Promise<TEEAttestation> {
    const endpoint = teeConfig.dstackEndpoint ?? process.env.DSTACK_ENDPOINT

    if (!endpoint || teeConfig.platform === 'simulator') {
      // Return mock attestation for simulator
      return {
        quote: `0x${'00'.repeat(256)}` as Hex,
        measurement: `0x${'00'.repeat(32)}` as Hex,
        platform: 'simulator',
        timestamp: Date.now(),
        isSimulated: true,
      }
    }

    // Get real attestation from dstack
    const reportData = worker
      ? `worker:${worker.id}:${worker.name}`
      : `shared:${Date.now()}`

    const response = await fetch(
      `${endpoint}/GetQuote?report_data=0x${Buffer.from(reportData).toString('hex')}`,
    )

    if (!response.ok) {
      throw new Error(`Failed to get TEE attestation: ${response.status}`)
    }

    const data = (await response.json()) as { quote: string; event_log: string }

    return {
      quote: data.quote as Hex,
      measurement: this.extractMeasurement(data.quote),
      platform: teeConfig.platform,
      timestamp: Date.now(),
      isSimulated: false,
    }
  }

  private extractMeasurement(quote: string): Hex {
    // Extract MRENCLAVE/MRTD from quote
    // This is a simplified extraction - real implementation would parse the quote structure
    if (quote.length >= 196) {
      return quote.slice(128, 196) as Hex
    }
    return `0x${'00'.repeat(32)}` as Hex
  }

  private portCounter = 9000
  private async allocatePort(): Promise<number> {
    return this.portCounter++
  }

  /**
   * Get stats about isolation contexts
   */
  getStats(): IsolationStats {
    let totalSharedWorkers = 0
    for (const process of this.sharedProcesses.values()) {
      totalSharedWorkers += process.workers.size
    }

    return {
      sharedProcesses: this.sharedProcesses.size,
      dedicatedProcesses: this.dedicatedProcesses.size,
      totalWorkersInShared: totalSharedWorkers,
      teeEnabled:
        Array.from(this.sharedProcesses.values()).filter(
          (p) => p.attestation && !p.attestation.isSimulated,
        ).length +
        Array.from(this.dedicatedProcesses.values()).filter(
          (p) => p.attestation && !p.attestation.isSimulated,
        ).length,
    }
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface SharedProcess {
  id: string
  workers: Set<string>
  status: 'starting' | 'running' | 'stopped'
  config: IsolationConfig
  port: number
  attestation: TEEAttestation | null
}

interface DedicatedProcess {
  id: string
  workerId: string
  status: 'starting' | 'running' | 'stopped'
  config: IsolationConfig
  port: number
  attestation: TEEAttestation | null
}

export interface IsolationContext {
  mode: IsolationMode
  processId: string
  workerId: string
  port: number
  attestation: TEEAttestation | null
  config: IsolationConfig
}

export interface TEEAttestation {
  quote: Hex
  measurement: Hex
  platform: string
  timestamp: number
  isSimulated: boolean
}

export interface IsolationStats {
  sharedProcesses: number
  dedicatedProcesses: number
  totalWorkersInShared: number
  teeEnabled: number
}

// ============================================================================
// Factory
// ============================================================================

let defaultManager: WorkerIsolationManager | null = null

export function getIsolationManager(
  config?: IsolationConfig,
): WorkerIsolationManager {
  if (!defaultManager) {
    defaultManager = new WorkerIsolationManager(config)
  }
  return defaultManager
}

export function createIsolationManager(
  config: IsolationConfig,
): WorkerIsolationManager {
  return new WorkerIsolationManager(config)
}
