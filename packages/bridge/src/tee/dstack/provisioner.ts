/**
 * TEE Container Provisioner
 *
 * Auto-scaling provisioner for TEE containers on Phala Cloud.
 * Monitors ComputeRegistry demand and provisions containers accordingly.
 *
 * Features:
 * - Auto-scale based on queue depth and provider availability
 * - Region/zone selection for latency optimization
 * - Container health monitoring and replacement
 * - Attestation refresh scheduling
 * - Cost-aware scaling decisions
 */

import { readContract } from '@jejunetwork/contracts/viem'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { createLogger } from '../../utils/logger.js'
import { type BillingTracker, createBillingTracker } from './billing.js'
import type { DStackClient } from './client.js'
import type { Container, ContainerSpec, TEEType } from './types.js'

const log = createLogger('tee-provisioner')

// ============================================================================
// Types
// ============================================================================

export interface ProvisionerConfig {
  /** dstack client instance */
  dstackClient: DStackClient
  /** Viem public client for contract reads */
  publicClient: PublicClient
  /** ComputeRegistry contract address */
  computeRegistryAddress: Address
  /** Default container image */
  defaultImage: string
  /** TEE type requirement */
  teeType: TEEType
  /** Minimum containers to maintain */
  minContainers: number
  /** Maximum containers allowed */
  maxContainers: number
  /** Target containers per active request in queue */
  containersPerRequest: number
  /** Scale up threshold (queue depth) */
  scaleUpThreshold: number
  /** Scale down threshold (idle containers) */
  scaleDownThreshold: number
  /** Cooldown between scaling operations (ms) */
  scaleCooldown: number
  /** Container idle timeout before termination (ms) */
  idleTimeout: number
  /** Health check interval (ms) */
  healthCheckInterval: number
  /** Attestation refresh interval (ms) */
  attestationRefreshInterval: number
  /** Preferred regions for container placement */
  preferredRegions?: string[]
  /** Container resource requirements */
  resources?: {
    cpu?: number
    memory?: number
    gpu?: number
  }
  /** Environment variables for containers */
  containerEnv?: Record<string, string>
  /** Callback when container is provisioned */
  onContainerProvisioned?: (container: Container) => Promise<void>
  /** Callback when container is terminated */
  onContainerTerminated?: (containerId: string) => Promise<void>
  // Billing configuration
  /** Enable billing tracking - set to true to track costs and enable auto-withdraw */
  enableBilling?: boolean
  /** Wallet client for withdrawals (required if billing enabled) */
  walletClient?: WalletClient
  /** LedgerManager contract address for withdrawals */
  ledgerManagerAddress?: Address
  /** Provider address for earnings */
  providerAddress?: Address
  /**
   * Cost per second of runtime (wei)
   * Default: 1 gwei/sec - MUST be configured based on actual costs
   */
  costPerSecond?: bigint
  /**
   * Cost per GB memory per hour (wei)
   * Default: 0.0001 ETH/GB-hr - MUST be configured based on actual costs
   */
  costPerGbHour?: bigint
  /**
   * Cost per GPU hour (wei)
   * Default: 0.001 ETH/GPU-hr - MUST be configured based on actual costs
   */
  costPerGpuHour?: bigint
  /**
   * Auto-withdraw threshold (wei)
   * Default: 0.1 ETH
   */
  autoWithdrawThreshold?: bigint
  /** Callback when withdrawal completes */
  onWithdrawal?: (amount: bigint, txHash: Hex) => void
}

export interface ProvisionerState {
  /** Currently managed containers */
  containers: Map<string, ManagedContainer>
  /** Total containers provisioned */
  totalProvisioned: number
  /** Total containers terminated */
  totalTerminated: number
  /** Last scale up time */
  lastScaleUp: number
  /** Last scale down time */
  lastScaleDown: number
  /** Current queue depth estimate */
  estimatedQueueDepth: number
  /** Is provisioner running */
  running: boolean
}

export interface ManagedContainer {
  container: Container
  provisionedAt: number
  lastActivityAt: number
  attestationRefreshedAt: number
  requestsHandled: number
  region: string
}

export interface ScalingDecision {
  action: 'scale_up' | 'scale_down' | 'none'
  targetCount: number
  reason: string
}

export interface ProvisionerMetrics {
  containersRunning: number
  containersProvisioning: number
  containersFailed: number
  averageIdleTime: number
  averageUptime: number
  totalRequestsHandled: number
  attestationStatus: {
    valid: number
    expired: number
    pending: number
  }
}

// ============================================================================
// ABI for ComputeRegistry reads
// ============================================================================

const COMPUTE_REGISTRY_ABI = [
  {
    name: 'getActiveProviders',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getTEEVerifiedProviders',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Provisioner Class
// ============================================================================

export class TEEProvisioner {
  private config: ProvisionerConfig
  private state: ProvisionerState
  private healthCheckTimer?: ReturnType<typeof setInterval>
  private scalingTimer?: ReturnType<typeof setInterval>
  private attestationTimer?: ReturnType<typeof setInterval>
  private billingTracker: BillingTracker | null = null

  constructor(config: ProvisionerConfig) {
    this.config = {
      ...config,
      minContainers: config.minContainers ?? 1,
      maxContainers: config.maxContainers ?? 10,
      containersPerRequest: config.containersPerRequest ?? 0.1,
      scaleUpThreshold: config.scaleUpThreshold ?? 5,
      scaleDownThreshold: config.scaleDownThreshold ?? 2,
      scaleCooldown: config.scaleCooldown ?? 60000,
      idleTimeout: config.idleTimeout ?? 300000,
      healthCheckInterval: config.healthCheckInterval ?? 30000,
      attestationRefreshInterval:
        config.attestationRefreshInterval ?? 12 * 60 * 60 * 1000,
    }

    this.state = {
      containers: new Map(),
      totalProvisioned: 0,
      totalTerminated: 0,
      lastScaleUp: 0,
      lastScaleDown: 0,
      estimatedQueueDepth: 0,
      running: false,
    }

    // Initialize billing tracker if enabled
    if (
      config.enableBilling &&
      config.walletClient &&
      config.ledgerManagerAddress &&
      config.providerAddress
    ) {
      this.billingTracker = createBillingTracker({
        publicClient: config.publicClient,
        walletClient: config.walletClient,
        ledgerManagerAddress: config.ledgerManagerAddress,
        providerAddress: config.providerAddress,
        costPerSecond: config.costPerSecond ?? 1000000000n, // 1 gwei/sec default
        costPerGbHour: config.costPerGbHour ?? 100000000000000n, // 0.0001 ETH/GB-hr
        costPerGpuHour: config.costPerGpuHour ?? 1000000000000000n, // 0.001 ETH/GPU-hr
        autoWithdrawThreshold:
          config.autoWithdrawThreshold ?? 100000000000000000n, // 0.1 ETH
        minWithdrawAmount: 10000000000000000n, // 0.01 ETH
        updateInterval: 60000,
        onWithdrawal: config.onWithdrawal,
        onBillingUpdate: (stats) => {
          log.debug('Billing update', {
            netEarnings: stats.netEarnings.toString(),
            pendingWithdrawal: stats.pendingWithdrawal.toString(),
          })
        },
      })
      log.info('Billing tracker initialized')
    }
  }

  /**
   * Start the provisioner
   */
  async start(): Promise<void> {
    if (this.state.running) {
      log.warn('Provisioner already running')
      return
    }

    log.info('Starting TEE provisioner', {
      minContainers: this.config.minContainers,
      maxContainers: this.config.maxContainers,
      teeType: this.config.teeType,
    })

    this.state.running = true

    // Start billing tracker
    if (this.billingTracker) {
      this.billingTracker.start()
    }

    // Initialize with minimum containers
    await this.ensureMinimumContainers()

    // Start health check loop
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      this.config.healthCheckInterval,
    )

    // Start scaling loop
    this.scalingTimer = setInterval(
      () => this.evaluateScaling(),
      this.config.scaleCooldown / 2,
    )

    // Start attestation refresh loop
    this.attestationTimer = setInterval(
      () => this.refreshAttestations(),
      this.config.attestationRefreshInterval / 4,
    )

    log.info('TEE provisioner started')
  }

  /**
   * Stop the provisioner
   */
  async stop(terminateContainers = false): Promise<void> {
    if (!this.state.running) {
      return
    }

    log.info('Stopping TEE provisioner', { terminateContainers })

    this.state.running = false

    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = undefined
    }
    if (this.scalingTimer) {
      clearInterval(this.scalingTimer)
      this.scalingTimer = undefined
    }
    if (this.attestationTimer) {
      clearInterval(this.attestationTimer)
      this.attestationTimer = undefined
    }

    // Stop billing tracker
    if (this.billingTracker) {
      this.billingTracker.stop()
    }

    // Optionally terminate all containers
    if (terminateContainers) {
      const terminationPromises = Array.from(this.state.containers.keys()).map(
        (id) => this.terminateContainer(id),
      )
      await Promise.allSettled(terminationPromises)
    }

    log.info('TEE provisioner stopped')
  }

  /**
   * Get current metrics
   */
  getMetrics(): ProvisionerMetrics {
    const containers = Array.from(this.state.containers.values())
    const now = Date.now()

    const runningContainers = containers.filter(
      (c) => c.container.status === 'running',
    )
    const provisioningContainers = containers.filter((c) =>
      ['pending', 'creating'].includes(c.container.status),
    )
    const failedContainers = containers.filter(
      (c) => c.container.status === 'failed',
    )

    const idleTimes = runningContainers.map((c) => now - c.lastActivityAt)
    const uptimes = containers.map((c) => now - c.provisionedAt)

    return {
      containersRunning: runningContainers.length,
      containersProvisioning: provisioningContainers.length,
      containersFailed: failedContainers.length,
      averageIdleTime:
        idleTimes.length > 0
          ? idleTimes.reduce((a, b) => a + b, 0) / idleTimes.length
          : 0,
      averageUptime:
        uptimes.length > 0
          ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length
          : 0,
      totalRequestsHandled: containers.reduce(
        (sum, c) => sum + c.requestsHandled,
        0,
      ),
      attestationStatus: {
        valid: containers.filter((c) => c.container.attestation?.verified)
          .length,
        expired: containers.filter(
          (c) =>
            c.container.attestation &&
            !c.container.attestation.verified &&
            c.container.attestation.timestamp > 0,
        ).length,
        pending: containers.filter((c) => !c.container.attestation).length,
      },
    }
  }

  /**
   * Get state snapshot
   */
  getState(): ProvisionerState {
    return { ...this.state }
  }

  /**
   * Manually trigger scaling evaluation
   */
  async triggerScaling(): Promise<ScalingDecision> {
    return this.evaluateScaling()
  }

  /**
   * Record request handled by a container
   * @param containerId Container that handled the request
   * @param revenue Revenue generated from the request (wei)
   */
  recordRequest(containerId: string, revenue: bigint = 0n): void {
    const managed = this.state.containers.get(containerId)
    if (managed) {
      managed.requestsHandled++
      managed.lastActivityAt = Date.now()

      // Track revenue in billing
      if (this.billingTracker && revenue > 0n) {
        this.billingTracker.recordRequest(containerId, revenue)
      }
    }
  }

  /**
   * Get billing statistics
   */
  getBillingStats(): import('./billing.js').BillingStats | null {
    return this.billingTracker?.getStats() ?? null
  }

  /**
   * Manually trigger earnings withdrawal
   * @param amount Amount to withdraw (wei), or all pending if not specified
   */
  async withdrawEarnings(
    amount?: bigint,
  ): Promise<import('./billing.js').WithdrawalRecord | null> {
    if (!this.billingTracker) {
      log.warn('Billing tracker not enabled')
      return null
    }
    return this.billingTracker.withdraw(amount)
  }

  /**
   * Get on-chain earnings balance
   */
  async getEarningsBalance(): Promise<bigint | null> {
    if (!this.billingTracker) return null
    return this.billingTracker.getOnChainBalance()
  }

  /**
   * Get available container for request
   */
  getAvailableContainer(preferredRegion?: string): ManagedContainer | null {
    const runningContainers = Array.from(this.state.containers.values()).filter(
      (c) =>
        c.container.status === 'running' && c.container.attestation?.verified,
    )

    if (runningContainers.length === 0) {
      return null
    }

    // Prefer containers in requested region
    if (preferredRegion) {
      const regionalContainers = runningContainers.filter(
        (c) => c.region === preferredRegion,
      )
      if (regionalContainers.length > 0) {
        // Return least recently used
        return regionalContainers.sort(
          (a, b) => a.lastActivityAt - b.lastActivityAt,
        )[0]
      }
    }

    // Return least recently used
    return runningContainers.sort(
      (a, b) => a.lastActivityAt - b.lastActivityAt,
    )[0]
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async ensureMinimumContainers(): Promise<void> {
    const currentCount = this.state.containers.size
    const needed = this.config.minContainers - currentCount

    if (needed <= 0) {
      return
    }

    log.info('Provisioning minimum containers', {
      current: currentCount,
      target: this.config.minContainers,
    })

    const provisionPromises = []
    for (let i = 0; i < needed; i++) {
      provisionPromises.push(this.provisionContainer())
    }

    await Promise.allSettled(provisionPromises)
  }

  private async provisionContainer(region?: string): Promise<Container | null> {
    if (this.state.containers.size >= this.config.maxContainers) {
      log.warn('Max containers reached, cannot provision')
      return null
    }

    // Select region
    const targetRegion =
      region ?? this.selectRegion() ?? this.config.preferredRegions?.[0]

    const spec: ContainerSpec = {
      name: `tee-worker-${Date.now().toString(36)}`,
      image: this.config.defaultImage,
      teeType: this.config.teeType,
      cpu: this.config.resources?.cpu ?? 2,
      memory: this.config.resources?.memory ?? 4096,
      gpu: this.config.resources?.gpu ?? 0,
      env: this.config.containerEnv,
      healthCheck: {
        httpPath: '/health',
        httpPort: 8080,
        interval: 30,
        timeout: 10,
        retries: 3,
      },
      restartPolicy: 'on-failure',
      maxRetries: 3,
    }

    log.info('Provisioning container', {
      name: spec.name,
      region: targetRegion ?? 'auto',
    })

    try {
      const response = await this.config.dstackClient.createContainer({
        spec,
        region: targetRegion,
        waitForReady: true,
        waitTimeout: 120000,
      })

      const actualRegion = targetRegion ?? 'unknown'
      const managed: ManagedContainer = {
        container: response.container,
        provisionedAt: Date.now(),
        lastActivityAt: Date.now(),
        attestationRefreshedAt: 0,
        requestsHandled: 0,
        region: actualRegion,
      }

      this.state.containers.set(response.container.id, managed)
      this.state.totalProvisioned++
      this.state.lastScaleUp = Date.now()

      // Track container in billing
      if (this.billingTracker) {
        const memoryMb = this.config.resources?.memory ?? 1024
        const gpuCount = this.config.resources?.gpu ?? 0
        this.billingTracker.trackContainer(
          response.container.id,
          memoryMb,
          gpuCount,
        )
      }

      log.info('Container provisioned', {
        id: response.container.id,
        region: actualRegion,
      })

      // Callback
      if (this.config.onContainerProvisioned) {
        await this.config.onContainerProvisioned(response.container)
      }

      return response.container
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('Failed to provision container', { error: errorMsg })
      return null
    }
  }

  private async terminateContainer(containerId: string): Promise<void> {
    const managed = this.state.containers.get(containerId)
    if (!managed) {
      return
    }

    log.info('Terminating container', { id: containerId })

    try {
      await this.config.dstackClient.deleteContainer({
        id: containerId,
        force: true,
      })

      // Untrack from billing before removing
      if (this.billingTracker) {
        const costs = this.billingTracker.untrackContainer(containerId)
        if (costs) {
          log.debug('Container billing finalized', {
            containerId,
            totalCost: costs.totalCost.toString(),
            revenue: costs.revenueGenerated.toString(),
          })
        }
      }

      this.state.containers.delete(containerId)
      this.state.totalTerminated++
      this.state.lastScaleDown = Date.now()

      // Callback
      if (this.config.onContainerTerminated) {
        await this.config.onContainerTerminated(containerId)
      }

      log.info('Container terminated', { id: containerId })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('Failed to terminate container', {
        containerId,
        error: errorMsg,
      })
    }
  }

  private async evaluateScaling(): Promise<ScalingDecision> {
    if (!this.state.running) {
      return { action: 'none', targetCount: 0, reason: 'Provisioner stopped' }
    }

    const now = Date.now()
    const currentCount = this.state.containers.size
    const runningContainers = Array.from(this.state.containers.values()).filter(
      (c) => c.container.status === 'running',
    )
    const runningCount = runningContainers.length

    // Get queue depth from ComputeRegistry
    const queueDepth = await this.estimateQueueDepth()
    this.state.estimatedQueueDepth = queueDepth

    log.debug('Evaluating scaling', { currentCount, runningCount, queueDepth })

    // Calculate target container count
    const targetByQueue = Math.ceil(
      queueDepth * this.config.containersPerRequest,
    )
    const targetCount = Math.max(
      this.config.minContainers,
      Math.min(this.config.maxContainers, targetByQueue),
    )

    // Check cooldown
    const scaleUpCooldownActive =
      now - this.state.lastScaleUp < this.config.scaleCooldown
    const scaleDownCooldownActive =
      now - this.state.lastScaleDown < this.config.scaleCooldown

    let decision: ScalingDecision = {
      action: 'none',
      targetCount: currentCount,
      reason: 'No scaling needed',
    }

    // Scale up
    if (targetCount > currentCount && !scaleUpCooldownActive) {
      if (queueDepth >= this.config.scaleUpThreshold) {
        decision = {
          action: 'scale_up',
          targetCount,
          reason: `Queue depth ${queueDepth} >= threshold ${this.config.scaleUpThreshold}`,
        }
      }
    }

    // Scale down
    if (targetCount < currentCount && !scaleDownCooldownActive) {
      // Find idle containers
      const idleContainers = Array.from(this.state.containers.entries())
        .filter(
          ([, m]) =>
            m.container.status === 'running' &&
            now - m.lastActivityAt > this.config.idleTimeout,
        )
        .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt)

      if (
        idleContainers.length >= this.config.scaleDownThreshold &&
        currentCount > this.config.minContainers
      ) {
        decision = {
          action: 'scale_down',
          targetCount: Math.max(this.config.minContainers, targetCount),
          reason: `${idleContainers.length} idle containers >= threshold ${this.config.scaleDownThreshold}`,
        }
      }
    }

    // Execute scaling decision
    if (decision.action === 'scale_up') {
      const toProvision = decision.targetCount - currentCount
      log.info('Scaling up', {
        current: currentCount,
        target: decision.targetCount,
      })

      for (let i = 0; i < toProvision; i++) {
        await this.provisionContainer()
      }
    } else if (decision.action === 'scale_down') {
      const toTerminate = currentCount - decision.targetCount
      log.info('Scaling down', {
        current: currentCount,
        target: decision.targetCount,
      })

      // Terminate most idle containers first
      const idleContainers = Array.from(this.state.containers.entries())
        .filter(([, m]) => m.container.status === 'running')
        .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt)
        .slice(0, toTerminate)

      for (const [id] of idleContainers) {
        await this.terminateContainer(id)
      }
    }

    return decision
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.state.running) {
      return
    }

    const containersToCheck = Array.from(this.state.containers.entries())

    for (const [id, managed] of containersToCheck) {
      try {
        const { container } = await this.config.dstackClient.getContainer({
          id,
        })
        managed.container = container

        // Handle failed containers
        if (
          container.status === 'failed' ||
          container.status === 'terminated'
        ) {
          log.warn('Container unhealthy, removing', {
            id,
            status: container.status,
          })

          // Untrack from billing
          if (this.billingTracker) {
            this.billingTracker.untrackContainer(id)
          }

          this.state.containers.delete(id)

          // Reprovision if below minimum
          if (this.state.containers.size < this.config.minContainers) {
            await this.provisionContainer(managed.region)
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        log.error('Health check failed', { containerId: id, error: errorMsg })
      }
    }
  }

  private async refreshAttestations(): Promise<void> {
    if (!this.state.running) {
      return
    }

    const now = Date.now()
    const refreshThreshold = now - this.config.attestationRefreshInterval

    const containersToRefresh = Array.from(
      this.state.containers.entries(),
    ).filter(
      ([, m]) =>
        m.container.status === 'running' &&
        m.attestationRefreshedAt < refreshThreshold,
    )

    for (const [id, managed] of containersToRefresh) {
      try {
        const attestation =
          await this.config.dstackClient.refreshAttestation(id)
        managed.container.attestation = attestation
        managed.attestationRefreshedAt = now

        log.debug('Attestation refreshed', {
          containerId: id,
          verified: attestation.verified,
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        log.error('Attestation refresh failed', {
          containerId: id,
          error: errorMsg,
        })
      }
    }
  }

  private async estimateQueueDepth(): Promise<number> {
    try {
      // Read active provider count from ComputeRegistry
      const activeProviders = (await readContract(this.config.publicClient, {
        address: this.config.computeRegistryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getActiveProviders',
      })) as Address[]

      const teeProviders = (await readContract(this.config.publicClient, {
        address: this.config.computeRegistryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getTEEVerifiedProviders',
      })) as Address[]

      // Estimate demand based on ratio of active to TEE providers
      // More active providers relative to TEE providers = higher demand
      const ratio =
        teeProviders.length > 0
          ? activeProviders.length / teeProviders.length
          : activeProviders.length

      return Math.ceil(ratio * 10) // Scale factor
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('Failed to estimate queue depth', { error: errorMsg })
      return 0
    }
  }

  private selectRegion(): string | undefined {
    const regions = this.config.preferredRegions
    if (!regions || regions.length === 0) {
      return undefined
    }

    // Count containers per region
    const regionCounts = new Map<string, number>()
    for (const region of regions) {
      regionCounts.set(region, 0)
    }

    for (const managed of this.state.containers.values()) {
      const count = regionCounts.get(managed.region) ?? 0
      regionCounts.set(managed.region, count + 1)
    }

    // Select region with fewest containers
    let minCount = Infinity
    let selectedRegion: string | undefined

    for (const [region, count] of regionCounts) {
      if (count < minCount) {
        minCount = count
        selectedRegion = region
      }
    }

    return selectedRegion
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTEEProvisioner(
  config: ProvisionerConfig,
): TEEProvisioner {
  return new TEEProvisioner(config)
}
