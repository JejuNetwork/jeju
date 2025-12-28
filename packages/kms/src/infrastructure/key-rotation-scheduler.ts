/**
 * Key Rotation Scheduler
 *
 * Coordinates periodic key rotation across all MPC clusters.
 * Integrates with the distributed KMS and on-chain registry.
 *
 * SECURITY FEATURES:
 * 1. Automatic rotation on a configurable schedule
 * 2. Manual rotation triggers for emergency scenarios
 * 3. Rotation health monitoring
 * 4. Failed rotation alerts
 * 5. Minimum uptime requirements before rotation
 */

import { createLogger } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { createPublicClient, http } from 'viem'
import { base, mainnet, sepolia } from 'viem/chains'
import {
  createFROSTKeyRotationManager,
  type FROSTKeyRotationManager,
  type RotationConfig,
  type RotationSession,
} from './frost-key-rotation.js'

const log = createLogger('key-rotation-scheduler')

// ============ Types ============

export interface SchedulerConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  partyIndex: number
  registryAddress: Address
  rpcUrl: string
  rotationIntervalMs: number
  minUptimeBeforeRotationMs: number
  maxConsecutiveFailures: number
  alertWebhook?: string
}

export interface ClusterRotationState {
  clusterId: string
  lastRotationEpoch: number
  lastRotationTime: number
  nextRotationTime: number
  consecutiveFailures: number
  isRotating: boolean
}

export interface RotationEvent {
  type: 'started' | 'completed' | 'failed'
  clusterId: string
  epoch: number
  timestamp: number
  details?: string
}

// ============ On-chain ABI (for reference when querying registry) ============

const _MPC_KEY_REGISTRY_ABI = [
  {
    type: 'event',
    name: 'KeyRotated',
    inputs: [
      { type: 'bytes32', name: 'clusterId', indexed: true },
      { type: 'uint256', name: 'epoch' },
      { type: 'bytes32', name: 'newGroupPublicKeyHash' },
    ],
  },
  {
    type: 'function',
    name: 'getClusterInfo',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'clusterId' }],
    outputs: [
      { type: 'uint256', name: 'partyCount' },
      { type: 'uint256', name: 'threshold' },
      { type: 'uint256', name: 'epoch' },
      { type: 'bytes32', name: 'groupPublicKeyHash' },
    ],
  },
  {
    type: 'function',
    name: 'getPartyEndpoints',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'clusterId' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { type: 'address', name: 'operator' },
          { type: 'string', name: 'endpoint' },
          { type: 'bytes32', name: 'pubKeyHash' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'recordRotation',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'bytes32', name: 'clusterId' },
      { type: 'uint256', name: 'newEpoch' },
      { type: 'bytes32', name: 'newGroupPublicKeyHash' },
    ],
    outputs: [],
  },
] as const
void _MPC_KEY_REGISTRY_ABI // Reference for documentation

// ============ Key Rotation Scheduler ============

export class KeyRotationScheduler {
  private config: SchedulerConfig
  private rotationManagers: Map<string, FROSTKeyRotationManager> = new Map()
  private clusterStates: Map<string, ClusterRotationState> = new Map()
  private rotationHistory: RotationEvent[] = []
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  private startTime: number = 0
  private isRunning = false

  constructor(config: SchedulerConfig) {
    this.config = config
    // PublicClient available for on-chain registry queries if needed
    void createPublicClient({
      chain: this.getChain(),
      transport: http(config.rpcUrl),
    })
  }

  private getChain() {
    switch (this.config.network) {
      case 'mainnet':
        return mainnet
      case 'testnet':
        return sepolia
      default:
        return base
    }
  }

  /**
   * Start the rotation scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Scheduler already running')
      return
    }

    this.startTime = Date.now()
    this.isRunning = true

    log.info('Starting key rotation scheduler', {
      network: this.config.network,
      partyIndex: this.config.partyIndex,
      rotationIntervalMs: this.config.rotationIntervalMs,
    })

    // Discover clusters this party belongs to
    await this.discoverClusters()

    // Start periodic check
    this.schedulerTimer = setInterval(
      () => this.checkRotations(),
      60 * 1000, // Check every minute
    )
  }

  /**
   * Stop the rotation scheduler
   */
  stop(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }

    for (const manager of this.rotationManagers.values()) {
      manager.shutdown()
    }
    this.rotationManagers.clear()
    this.isRunning = false

    log.info('Key rotation scheduler stopped')
  }

  /**
   * Discover clusters from on-chain registry
   */
  private async discoverClusters(): Promise<void> {
    // In production, query the registry for all clusters this party belongs to
    // For now, we'll use a placeholder
    log.info('Discovering MPC clusters...')

    // This would query the MPCKeyRegistry contract
    // For each cluster where this party is a member, initialize a rotation manager
  }

  /**
   * Register a cluster for rotation management
   */
  async registerCluster(
    clusterId: string,
    threshold: number,
    totalParties: number,
    partyEndpoints: Map<string, string>,
    partyPublicKeys: Map<string, Hex>,
    currentEpoch: number,
    currentShare: bigint,
  ): Promise<void> {
    if (this.rotationManagers.has(clusterId)) {
      log.warn('Cluster already registered', { clusterId })
      return
    }

    const rotationConfig: RotationConfig = {
      clusterId,
      threshold,
      totalParties,
      partyEndpoints,
      partyPublicKeys,
      rotationIntervalMs: this.config.rotationIntervalMs,
      autoRotate: false, // We handle rotation scheduling
      minPartiesForRotation: threshold,
    }

    const manager = createFROSTKeyRotationManager(
      rotationConfig,
      this.config.partyIndex,
    )
    manager.setCurrentShare(currentShare, currentEpoch)

    this.rotationManagers.set(clusterId, manager)

    const state: ClusterRotationState = {
      clusterId,
      lastRotationEpoch: currentEpoch,
      lastRotationTime: Date.now(),
      nextRotationTime: Date.now() + this.config.rotationIntervalMs,
      consecutiveFailures: 0,
      isRotating: false,
    }

    this.clusterStates.set(clusterId, state)

    log.info('Registered cluster for rotation', {
      clusterId,
      threshold,
      totalParties,
      currentEpoch,
    })
  }

  /**
   * Check if any clusters need rotation
   */
  private async checkRotations(): Promise<void> {
    const now = Date.now()
    const uptime = now - this.startTime

    // Don't rotate if uptime is too short
    if (uptime < this.config.minUptimeBeforeRotationMs) {
      log.debug('Skipping rotation check - insufficient uptime', {
        uptimeMs: uptime,
        requiredMs: this.config.minUptimeBeforeRotationMs,
      })
      return
    }

    for (const [clusterId, state] of this.clusterStates) {
      if (state.isRotating) continue

      if (now >= state.nextRotationTime) {
        await this.triggerRotation(clusterId, 'scheduled')
      }
    }
  }

  /**
   * Trigger rotation for a cluster
   */
  async triggerRotation(
    clusterId: string,
    reason: 'scheduled' | 'manual' | 'emergency',
  ): Promise<RotationSession | null> {
    const manager = this.rotationManagers.get(clusterId)
    const state = this.clusterStates.get(clusterId)

    if (!manager || !state) {
      log.error('Cluster not registered', { clusterId })
      return null
    }

    if (state.isRotating) {
      log.warn('Rotation already in progress', { clusterId })
      return null
    }

    state.isRotating = true

    log.info('Triggering key rotation', {
      clusterId,
      reason,
      currentEpoch: state.lastRotationEpoch,
    })

    this.recordEvent({
      type: 'started',
      clusterId,
      epoch: state.lastRotationEpoch + 1,
      timestamp: Date.now(),
      details: reason,
    })

    try {
      // Initiate rotation
      const session = await manager.initiateRotation()

      // Generate our contribution
      await manager.generateRotationContribution(session.sessionId)

      // In a real implementation, we'd:
      // 1. Broadcast our contribution to other parties
      // 2. Receive their contributions
      // 3. Wait for the rotation to complete

      // For now, simulate waiting for completion
      await this.waitForRotationCompletion(manager, session.sessionId)

      // Finalize
      const refreshedShare = await manager.finalizeRotation(session.sessionId)

      // Update state
      state.lastRotationEpoch = refreshedShare.epoch
      state.lastRotationTime = Date.now()
      state.nextRotationTime = Date.now() + this.config.rotationIntervalMs
      state.consecutiveFailures = 0
      state.isRotating = false

      this.recordEvent({
        type: 'completed',
        clusterId,
        epoch: refreshedShare.epoch,
        timestamp: Date.now(),
      })

      // Record on-chain
      await this.recordRotationOnChain(
        clusterId,
        refreshedShare.epoch,
        refreshedShare.verificationPoint,
      )

      log.info('Key rotation completed', {
        clusterId,
        newEpoch: refreshedShare.epoch,
      })

      return session
    } catch (error) {
      state.consecutiveFailures++
      state.isRotating = false

      this.recordEvent({
        type: 'failed',
        clusterId,
        epoch: state.lastRotationEpoch + 1,
        timestamp: Date.now(),
        details: String(error),
      })

      log.error('Key rotation failed', {
        clusterId,
        error: String(error),
        consecutiveFailures: state.consecutiveFailures,
      })

      // Send alert if too many failures
      if (state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        await this.sendAlert(
          `Cluster ${clusterId} has ${state.consecutiveFailures} consecutive rotation failures`,
        )
      }

      // Retry sooner on failure
      state.nextRotationTime = Date.now() + 60 * 1000 // 1 minute

      return null
    }
  }

  /**
   * Wait for rotation to complete (with timeout)
   */
  private async waitForRotationCompletion(
    manager: FROSTKeyRotationManager,
    sessionId: string,
    timeoutMs = 60000,
  ): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const session = manager.getSessionStatus(sessionId)

      if (!session) {
        throw new Error('Session not found')
      }

      if (session.status === 'complete') {
        return
      }

      if (session.status === 'failed') {
        throw new Error('Rotation session failed')
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error('Rotation timed out')
  }

  /**
   * Record rotation completion on-chain
   */
  private async recordRotationOnChain(
    clusterId: string,
    epoch: number,
    verificationPoint: Hex,
  ): Promise<void> {
    // In production, this would submit a transaction to the MPCKeyRegistry
    // to record the successful rotation
    log.debug('Recording rotation on-chain', {
      clusterId,
      epoch,
      verificationPoint: `${verificationPoint.slice(0, 18)}...`,
    })

    // The actual transaction would be signed using the group key
    // and would update the on-chain epoch
  }

  /**
   * Record a rotation event
   */
  private recordEvent(event: RotationEvent): void {
    this.rotationHistory.push(event)

    // Keep last 1000 events
    if (this.rotationHistory.length > 1000) {
      this.rotationHistory = this.rotationHistory.slice(-1000)
    }
  }

  /**
   * Send an alert
   */
  private async sendAlert(message: string): Promise<void> {
    log.error(`ALERT: ${message}`)

    if (this.config.alertWebhook) {
      try {
        await fetch(this.config.alertWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'key_rotation_alert',
            message,
            timestamp: Date.now(),
            network: this.config.network,
          }),
        })
      } catch {
        log.error('Failed to send alert webhook')
      }
    }
  }

  /**
   * Get rotation history
   */
  getRotationHistory(clusterId?: string): RotationEvent[] {
    if (clusterId) {
      return this.rotationHistory.filter((e) => e.clusterId === clusterId)
    }
    return [...this.rotationHistory]
  }

  /**
   * Get cluster state
   */
  getClusterState(clusterId: string): ClusterRotationState | null {
    return this.clusterStates.get(clusterId) ?? null
  }

  /**
   * Get all cluster states
   */
  getAllClusterStates(): ClusterRotationState[] {
    return [...this.clusterStates.values()]
  }

  /**
   * Force immediate rotation (for emergencies)
   */
  async forceRotation(clusterId: string): Promise<RotationSession | null> {
    log.warn('Force rotation triggered', { clusterId })
    return this.triggerRotation(clusterId, 'emergency')
  }
}

/**
 * Create a key rotation scheduler
 */
export function createKeyRotationScheduler(
  config: SchedulerConfig,
): KeyRotationScheduler {
  return new KeyRotationScheduler(config)
}
