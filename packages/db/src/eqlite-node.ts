/**
 * EQLite Node Manager
 *
 * Manages EQLite node lifecycle for Jeju Network deployment.
 * Integrates with TEE attestation and DWS infrastructure.
 *
 * @example
 * ```typescript
 * import { EQLiteNodeManager, createEQLiteNode } from '@jejunetwork/db'
 *
 * // Create a miner node
 * const node = await createEQLiteNode({
 *   role: 'miner',
 *   dataDir: '/data/eqlite',
 *   blockProducers: ['http://bp-1:4661', 'http://bp-2:4661', 'http://bp-3:4661'],
 * })
 *
 * await node.start()
 * ```
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  getEQLiteBlockProducerUrl,
  getEQLiteUrl,
  getLocalhostHost,
  getNetworkName,
  INFRA_PORTS,
  isProductionEnv,
} from '@jejunetwork/config'

/** EQLite node roles aligned with Jeju staking */
export const EQLiteNodeRole = {
  BLOCK_PRODUCER: 'blockproducer',
  MINER: 'miner',
  ADAPTER: 'adapter',
  FULLNODE: 'fullnode',
} as const

export type EQLiteNodeRole =
  (typeof EQLiteNodeRole)[keyof typeof EQLiteNodeRole]

/** Node operational status */
export const EQLiteNodeStatus = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  SYNCING: 'syncing',
  ERROR: 'error',
} as const

export type EQLiteNodeStatus =
  (typeof EQLiteNodeStatus)[keyof typeof EQLiteNodeStatus]

/** TEE attestation information */
export interface TEEAttestation {
  /** Attestation type (intel_tdx, amd_sev, etc.) */
  platform: 'intel_tdx' | 'amd_sev' | 'simulated'
  /** Attestation report (base64 encoded) */
  report: string
  /** Timestamp of attestation */
  timestamp: number
  /** Signature from attestation service */
  signature: string
  /** Is this a simulated/dev attestation */
  simulated: boolean
}

/** EQLite node configuration */
export interface EQLiteNodeConfig {
  /** Node role */
  role: EQLiteNodeRole
  /** Data directory for node storage */
  dataDir: string
  /** Listen address (default: 0.0.0.0:4661) */
  listenAddr?: string
  /** RPC address for internal communication */
  rpcAddr?: string
  /** HTTP API address */
  httpAddr?: string
  /** Block producer endpoints (required for miners) */
  blockProducers?: string[]
  /** Node ID (auto-generated if not provided) */
  nodeId?: string
  /** Enable TEE mode */
  teeEnabled?: boolean
  /** TEE platform requirement */
  teePlatform?: 'intel_tdx' | 'amd_sev' | 'any'
  /** Enable metrics collection */
  metricsEnabled?: boolean
  /** Metrics port */
  metricsPort?: number
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

/** Runtime state of a EQLite node */
export interface EQLiteNodeState {
  /** Current status */
  status: EQLiteNodeStatus
  /** Node ID */
  nodeId: string
  /** Node role */
  role: EQLiteNodeRole
  /** Current block height */
  blockHeight: number
  /** Number of connected peers */
  peerCount: number
  /** Database count (for miners) */
  databaseCount: number
  /** TEE attestation (if running in TEE) */
  attestation?: TEEAttestation
  /** Last error message */
  lastError?: string
  /** Uptime in seconds */
  uptime: number
  /** Start time */
  startTime?: Date
}

/**
 * EQLite Node Manager
 *
 * Manages a single EQLite node instance with TEE support.
 */
export class EQLiteNodeManager {
  private config: EQLiteNodeConfig
  private state: EQLiteNodeState
  private process: { kill(): void } | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: EQLiteNodeConfig) {
    this.config = {
      ...config,
      listenAddr: config.listenAddr ?? '0.0.0.0:4661',
      rpcAddr: config.rpcAddr ?? '0.0.0.0:4662',
      httpAddr: config.httpAddr ?? '0.0.0.0:8546',
      nodeId: config.nodeId ?? this.generateNodeId(),
      metricsEnabled: config.metricsEnabled ?? true,
      metricsPort: config.metricsPort ?? 9100,
      logLevel: config.logLevel ?? 'info',
    }

    const nodeId = this.config.nodeId
    if (!nodeId) {
      throw new Error('Node ID must be provided or auto-generated')
    }

    this.state = {
      status: EQLiteNodeStatus.STOPPED,
      nodeId,
      role: this.config.role,
      blockHeight: 0,
      peerCount: 0,
      databaseCount: 0,
      uptime: 0,
    }

    // Ensure data directory exists
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true })
    }
  }

  /** Get current node state */
  getState(): EQLiteNodeState {
    return { ...this.state }
  }

  /** Get node configuration */
  getConfig(): EQLiteNodeConfig {
    return { ...this.config }
  }

  /** Check if node is running */
  isRunning(): boolean {
    return (
      this.state.status === EQLiteNodeStatus.RUNNING ||
      this.state.status === EQLiteNodeStatus.SYNCING
    )
  }

  /**
   * Start the EQLite node
   *
   * In production (TEE mode), this will:
   * 1. Verify TEE environment
   * 2. Generate attestation
   * 3. Start the node process
   * 4. Register with block producers
   *
   * In development, starts a local node process.
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      return
    }

    this.state.status = EQLiteNodeStatus.STARTING
    this.state.startTime = new Date()

    try {
      // Check TEE environment in production
      if (this.config.teeEnabled && isProductionEnv()) {
        this.state.attestation = await this.generateAttestation()
      }

      // Start the node based on environment
      if (this.isDockerEnvironment()) {
        await this.startDockerNode()
      } else {
        await this.startLocalNode()
      }

      // Start health monitoring
      this.startHealthCheck()

      this.state.status = EQLiteNodeStatus.RUNNING
    } catch (err) {
      this.state.status = EQLiteNodeStatus.ERROR
      this.state.lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  /**
   * Stop the EQLite node
   */
  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    if (this.process) {
      this.process.kill()
      this.process = null
    }

    this.state.status = EQLiteNodeStatus.STOPPED
    this.state.uptime = 0
  }

  /**
   * Get node health status
   */
  async getHealth(): Promise<{
    healthy: boolean
    details: Record<string, unknown>
  }> {
    const host = getLocalhostHost()
    const endpoint =
      getEQLiteUrl() ??
      `http://${host}:${this.config.httpAddr?.split(':')[1] ?? String(INFRA_PORTS.EQLite.get())}`

    try {
      const response = await fetch(`${endpoint}/v1/status`, {
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return { healthy: false, details: { error: `HTTP ${response.status}` } }
      }

      const data = (await response.json()) as Record<string, unknown>
      return {
        healthy: true,
        details: {
          ...data,
          role: this.config.role,
          nodeId: this.config.nodeId,
          teeEnabled: this.config.teeEnabled,
        },
      }
    } catch (err) {
      return {
        healthy: false,
        details: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  }

  // Private methods

  private generateNodeId(): string {
    // Generate a node ID compatible with EQLite format
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async generateAttestation(): Promise<TEEAttestation> {
    // In production, this would call the actual TEE attestation API
    // For now, return a simulated attestation
    const isDev = !isProductionEnv() || getNetworkName() === 'localnet'

    if (isDev) {
      return {
        platform: 'simulated',
        report: Buffer.from(
          JSON.stringify({ nodeId: this.config.nodeId, timestamp: Date.now() }),
        ).toString('base64'),
        timestamp: Date.now(),
        signature: 'simulated-signature',
        simulated: true,
      }
    }

    // Production TEE attestation would go here
    // This requires integration with dstack/phala attestation service
    throw new Error('Production TEE attestation not yet implemented')
  }

  private isDockerEnvironment(): boolean {
    return existsSync('/.dockerenv') || existsSync('/run/.containerenv')
  }

  private async startDockerNode(): Promise<void> {
    // In Docker, the node is started by the container entrypoint
    // We just need to verify it's running
    const health = await this.getHealth()
    if (!health.healthy) {
      throw new Error('EQLite node not responding in Docker environment')
    }
  }

  private async startLocalNode(): Promise<void> {
    const eqliteBinaryPath = this.getEQLiteBinaryPath()

    if (!existsSync(eqliteBinaryPath)) {
      // Fall back to connecting to an existing node
      const health = await this.getHealth()
      if (health.healthy) {
        return // Node already running externally
      }
      throw new Error(
        `EQLite binary not found at ${eqliteBinaryPath} and no running node detected`,
      )
    }

    // Build command line arguments (kept for future spawning implementation)
    // const args = this.buildCommandArgs()

    // Note: In a real implementation, we'd spawn the process here
    // For now, we assume the node is managed externally (Docker/systemd)
    throw new Error(
      'Local EQLite process spawning not implemented - use Docker or start manually',
    )
  }

  private getEQLiteBinaryPath(): string {
    const role = this.config.role
    const binary =
      role === EQLiteNodeRole.BLOCK_PRODUCER ? 'eqlited' : 'eqlite-minerd'

    // Check common locations
    const paths = [
      join(process.cwd(), 'packages/eqlite/bin', binary),
      `/usr/local/bin/${binary}`,
      `/usr/bin/${binary}`,
    ]

    for (const p of paths) {
      if (existsSync(p)) {
        return p
      }
    }

    // Return first path even if not found (for error message)
    const firstPath = paths[0]
    if (!firstPath) {
      throw new Error('No EQLite binary paths configured')
    }
    return firstPath
  }

  /**
   * Build command line arguments for the EQLite binary
   * Used when spawning local EQLite processes
   */
  buildCommandArgs(): string[] {
    const args = ['-config', join(this.config.dataDir, 'config.yaml')]

    if (this.config.logLevel) {
      args.push('-log-level', this.config.logLevel)
    }

    if (this.config.metricsEnabled) {
      args.push('-metric-web', `:${this.config.metricsPort}`)
    }

    return args
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const health = await this.getHealth()

      if (health.healthy && health.details) {
        this.state.blockHeight =
          (health.details.blockHeight as number) ?? this.state.blockHeight
        this.state.peerCount =
          (health.details.peerCount as number) ?? this.state.peerCount
        this.state.databaseCount =
          (health.details.databases as number) ?? this.state.databaseCount

        if (this.state.startTime) {
          this.state.uptime = Math.floor(
            (Date.now() - this.state.startTime.getTime()) / 1000,
          )
        }
      } else {
        if (this.state.status === EQLiteNodeStatus.RUNNING) {
          this.state.status = EQLiteNodeStatus.ERROR
          this.state.lastError = 'Health check failed'
        }
      }
    }, 10000)
  }
}

/**
 * Create and start a EQLite node
 */
export async function createEQLiteNode(
  config: EQLiteNodeConfig,
): Promise<EQLiteNodeManager> {
  const manager = new EQLiteNodeManager(config)
  await manager.start()
  return manager
}

/**
 * Check if EQLite is available (via internal packages/eqlite or external)
 */
export async function isEQLiteAvailable(endpoint?: string): Promise<boolean> {
  const url = endpoint ?? getEQLiteUrl() ?? getEQLiteBlockProducerUrl()

  // Try multiple health endpoints
  const endpoints = [`${url}/v1/status`, `${url}/status`, `${url}/health`]

  for (const ep of endpoints) {
    try {
      const response = await fetch(ep, { signal: AbortSignal.timeout(3000) })
      if (response.ok) {
        return true
      }
    } catch {}
  }

  return false
}
