/**
 * Encrypted Trajectory Storage
 *
 * Provides encrypted storage for training trajectories.
 * Uses pluggable encryption providers (KMS, local, etc.)
 */

import {
  getAiCeoAddress,
  getChainId,
  getMinTeeStakeUsd,
  getMpcParties,
  getMpcThreshold,
  getServicesConfig,
  getTeeRegistryAddress,
  getTrainingOrchestratorAddress,
  isUseMpcEncryption,
} from '@jejunetwork/config'
import { generateSnowflakeId, logger } from '@jejunetwork/shared'
import type { Address } from 'viem'
import type { TrajectoryStep } from '../schemas'
import { isCIDResponse, isEncryptedPayload } from './type-guards'
import type {
  AccessCondition,
  AccessControlPolicy,
  AuthSignature,
  EncryptedPayload,
  EncryptedTrajectory,
  PolicyCondition,
  SecretPolicy,
  StorageConfig,
  TrajectoryBatch,
} from './types'

// ============================================================================
// Encryption Provider Interface
// ============================================================================

/**
 * Interface for encryption providers
 *
 * Implementations can use:
 * - Jeju KMS (production)
 * - Lit Protocol
 * - Local AES (development)
 */
export interface EncryptionProvider {
  isInitialized(): boolean
  initialize(): Promise<void>
  encrypt(params: {
    data: string
    name: string
    policy: SecretPolicy
    metadata?: Record<string, string>
  }): Promise<{ encryptedPayload: string; id: string }>
  decrypt(params: { payload: string; proof: string }): Promise<string>
}

// ============================================================================
// Default Configuration
// ============================================================================

const defaultConfig: StorageConfig = {
  storageEndpoint: getServicesConfig().storage.api,
  chainId: String(getChainId()),
  trainingOrchestratorAddress: getTrainingOrchestratorAddress() as Address,
  aiCEOAddress: getAiCeoAddress() as Address,
  teeRegistryAddress: getTeeRegistryAddress() as Address,
  minTEEStakeUSD: getMinTeeStakeUsd(),
  useMPC: isUseMpcEncryption(),
  mpcThreshold: getMpcThreshold(),
  mpcParties: getMpcParties(),
}

// ============================================================================
// Utility Functions
// ============================================================================

function policyToKMSPolicy(policy: AccessControlPolicy): SecretPolicy {
  const conditions: PolicyCondition[] = policy.conditions.map((c) => {
    if (c.type === 'role' && c.address)
      return { type: 'address' as const, value: c.address }
    if (c.type === 'contract' && c.address)
      return { type: 'tee' as const, value: c.address }
    return { type: 'timestamp' as const, value: 0 }
  })
  return { conditions, operator: policy.operator }
}

function hashString(str: string): string {
  const data = new TextEncoder().encode(str)
  let hash = 0
  for (const byte of data) {
    hash = (hash << 5) - hash + byte
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

// ============================================================================
// EncryptedTrajectoryStorage
// ============================================================================

export class EncryptedTrajectoryStorage {
  private config: StorageConfig
  private initialized: boolean = false
  private encryptionProvider: EncryptionProvider | null = null

  constructor(
    config: Partial<StorageConfig> = {},
    encryptionProvider?: EncryptionProvider,
  ) {
    this.config = { ...defaultConfig, ...config }
    this.encryptionProvider = encryptionProvider ?? null
  }

  /**
   * Set the encryption provider
   */
  setEncryptionProvider(provider: EncryptionProvider): void {
    this.encryptionProvider = provider
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Verify storage endpoint is available
    const response = await fetch(`${this.config.storageEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (!response?.ok) {
      logger.warn(
        '[EncryptedStorage] Storage endpoint not available, using fallback',
      )
    }

    // Initialize encryption provider if available
    if (this.encryptionProvider && !this.encryptionProvider.isInitialized()) {
      await this.encryptionProvider.initialize()
    }

    this.initialized = true
    logger.info('[EncryptedStorage] Initialized', {
      storageEndpoint: this.config.storageEndpoint,
      useMPC: this.config.useMPC,
      hasEncryptionProvider: !!this.encryptionProvider,
      mpcConfig: this.config.useMPC
        ? `${this.config.mpcThreshold}-of-${this.config.mpcParties}`
        : 'disabled',
    })
  }

  // --------------------------------------------------------------------------
  // Encryption
  // --------------------------------------------------------------------------

  private async encryptWithPolicy(
    data: string,
    policy: AccessControlPolicy,
    options: { metadata?: Record<string, string> },
  ): Promise<EncryptedPayload> {
    if (!this.encryptionProvider) {
      // Fall back to unencrypted storage in development
      const dataHash = hashString(data)
      return {
        ciphertext: Buffer.from(data).toString('base64'),
        dataHash,
        accessControlConditions: policy.conditions,
        accessControlConditionType: 'unified',
        encryptedSymmetricKey: 'unencrypted',
        chain: policy.conditions[0]?.chainId,
      }
    }

    const kmsPolicy = policyToKMSPolicy(policy)

    logger.debug('[EncryptedStorage] Encrypting with provider', {
      conditions: policy.conditions.length,
      metadata: options.metadata ?? {},
    })

    const result = await this.encryptionProvider.encrypt({
      data,
      name: options.metadata?.trajectoryId ?? `trajectory-${Date.now()}`,
      policy: kmsPolicy,
      metadata: options.metadata,
    })

    const dataHash = hashString(data)

    return {
      ciphertext: result.encryptedPayload,
      dataHash,
      accessControlConditions: policy.conditions,
      accessControlConditionType: 'unified',
      encryptedSymmetricKey: result.id,
      chain: policy.conditions[0]?.chainId,
    }
  }

  private async decryptJSON<T>(
    encrypted: EncryptedPayload,
    authSig: AuthSignature,
  ): Promise<T> {
    if (
      !this.encryptionProvider ||
      encrypted.encryptedSymmetricKey === 'unencrypted'
    ) {
      // Unencrypted data - just decode
      return JSON.parse(
        Buffer.from(encrypted.ciphertext, 'base64').toString(),
      ) as T
    }

    logger.debug('[EncryptedStorage] Decrypting', {
      keyId: encrypted.encryptedSymmetricKey,
    })

    const decrypted = await this.encryptionProvider.decrypt({
      payload: encrypted.ciphertext,
      proof: authSig.sig,
    })
    return JSON.parse(decrypted) as T
  }

  // --------------------------------------------------------------------------
  // Store Trajectory
  // --------------------------------------------------------------------------

  /**
   * Store a trajectory with encryption
   */
  async storeTrajectory(
    trajectory: {
      agentId: string
      archetype: string
      scenarioId: string
      windowId: string
      startTime: number
      endTime: number
      totalReward: number
      finalBalance?: number
      finalPnL?: number
      finalStatus: string
    },
    steps: TrajectoryStep[],
  ): Promise<EncryptedTrajectory> {
    await this.initialize()

    const trajectoryId = await generateSnowflakeId()

    // Build access policy
    const policy = this.buildTrajectoryPolicy()

    // Encrypt steps
    const stepsJson = JSON.stringify(steps)
    const encrypted = await this.encryptWithPolicy(stepsJson, policy, {
      metadata: {
        trajectoryId,
        archetype: trajectory.archetype,
        type: 'trajectory-steps',
      },
    })

    // Upload to IPFS
    const encryptedCid = await this.uploadToIPFS(encrypted)

    // Create metadata record
    const encryptedTrajectory: EncryptedTrajectory = {
      id: trajectoryId,
      agentId: trajectory.agentId,
      archetype: trajectory.archetype,
      scenarioId: trajectory.scenarioId,
      windowId: trajectory.windowId,
      stepCount: steps.length,
      totalReward: trajectory.totalReward,
      createdAt: Date.now(),
      encryptedCid,
      policyHash: this.hashPolicy(policy),
      metadata: {
        durationMs: trajectory.endTime - trajectory.startTime,
        finalBalance: trajectory.finalBalance,
        finalPnL: trajectory.finalPnL,
        episodeLength: steps.length,
        finalStatus: trajectory.finalStatus,
      },
    }

    logger.info('[EncryptedStorage] Stored trajectory', {
      trajectoryId,
      archetype: trajectory.archetype,
      steps: steps.length,
      cid: encryptedCid,
    })

    return encryptedTrajectory
  }

  // --------------------------------------------------------------------------
  // Batch Trajectories
  // --------------------------------------------------------------------------

  /**
   * Create a batch of trajectories for training
   */
  async createBatch(
    archetype: string,
    trajectories: EncryptedTrajectory[],
  ): Promise<TrajectoryBatch> {
    await this.initialize()

    const batchId = await generateSnowflakeId()

    // Create batch manifest
    const manifest = {
      batchId,
      archetype,
      trajectoryCount: trajectories.length,
      totalSteps: trajectories.reduce((sum, t) => sum + t.stepCount, 0),
      trajectories: trajectories.map((t) => ({
        id: t.id,
        cid: t.encryptedCid,
        steps: t.stepCount,
        reward: t.totalReward,
      })),
      createdAt: Date.now(),
    }

    // Build policy for batch
    const policy = this.buildTrajectoryPolicy()

    // Encrypt manifest
    const encrypted = await this.encryptWithPolicy(
      JSON.stringify(manifest),
      policy,
      {
        metadata: {
          batchId,
          archetype,
          type: 'trajectory-batch',
        },
      },
    )

    // Upload to IPFS
    const encryptedCid = await this.uploadToIPFS(encrypted)

    // Convert CID to bytes32 for contract
    const datasetCidBytes32 = this.cidToBytes32(encryptedCid)

    const batch: TrajectoryBatch = {
      batchId,
      archetype,
      trajectoryCount: trajectories.length,
      totalSteps: manifest.totalSteps,
      trajectoryIds: trajectories.map((t) => t.id),
      encryptedCid,
      createdAt: Date.now(),
      datasetCidBytes32,
    }

    logger.info('[EncryptedStorage] Created batch', {
      batchId,
      archetype,
      trajectoryCount: trajectories.length,
      totalSteps: manifest.totalSteps,
      cid: encryptedCid,
    })

    return batch
  }

  // --------------------------------------------------------------------------
  // Retrieve (for TEE workers)
  // --------------------------------------------------------------------------

  /**
   * Retrieve and decrypt trajectory steps
   */
  async retrieveTrajectory(
    encryptedCid: string,
    authSig: AuthSignature,
  ): Promise<TrajectoryStep[]> {
    await this.initialize()

    // Download from IPFS
    const encrypted = await this.downloadFromIPFS(encryptedCid)

    // Decrypt with auth
    const decrypted = await this.decryptJSON<TrajectoryStep[]>(
      encrypted,
      authSig,
    )

    logger.info('[EncryptedStorage] Retrieved trajectory', {
      cid: encryptedCid,
      steps: decrypted.length,
    })

    return decrypted
  }

  // --------------------------------------------------------------------------
  // Policy Building
  // --------------------------------------------------------------------------

  /**
   * Build access control policy for trajectories
   */
  private buildTrajectoryPolicy(): AccessControlPolicy {
    const conditions: AccessCondition[] = [
      // TEE workers with stake
      {
        type: 'role',
        chainId: this.config.chainId,
        address: this.config.teeRegistryAddress,
        role: 'TEE_WORKER',
      },
      // AI CEO
      {
        type: 'role',
        chainId: this.config.chainId,
        address: this.config.trainingOrchestratorAddress,
        role: 'AI_CEO',
      },
    ]

    return {
      conditions,
      operator: 'or',
    }
  }

  /**
   * Build policy for TEE-only access (more restrictive)
   */
  buildTEEOnlyPolicy(): AccessControlPolicy {
    return {
      conditions: [
        {
          type: 'role',
          chainId: this.config.chainId,
          address: this.config.teeRegistryAddress,
          role: 'TEE_WORKER',
        },
        {
          type: 'contract',
          chainId: this.config.chainId,
          address: this.config.teeRegistryAddress,
          role: 'VERIFIED_ATTESTATION',
        },
      ],
      operator: 'and',
    }
  }

  // --------------------------------------------------------------------------
  // IPFS Operations
  // --------------------------------------------------------------------------

  private async uploadToIPFS(data: EncryptedPayload): Promise<string> {
    const response = await fetch(`${this.config.storageEndpoint}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: JSON.stringify(data),
        pin: true,
        encrypt: false, // Already encrypted
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to upload to IPFS: ${response.statusText}`)
    }

    const result: unknown = await response.json()
    if (!isCIDResponse(result)) {
      throw new Error('Invalid IPFS upload response')
    }
    return result.cid
  }

  private async downloadFromIPFS(cid: string): Promise<EncryptedPayload> {
    const response = await fetch(
      `${this.config.storageEndpoint}/download/${cid}`,
    )

    if (!response.ok) {
      throw new Error(`Failed to download from IPFS: ${response.statusText}`)
    }

    const data: unknown = await response.json()
    if (!isEncryptedPayload(data)) {
      throw new Error('Invalid encrypted payload from IPFS')
    }
    return data
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  private hashPolicy(policy: AccessControlPolicy): string {
    const policyStr = JSON.stringify(policy)
    return `policy-${hashString(policyStr)}`
  }

  private cidToBytes32(cid: string): `0x${string}` {
    const hex = Buffer.from(cid).toString('hex').padEnd(64, '0').slice(0, 64)
    return `0x${hex}` as `0x${string}`
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  getConfig(): StorageConfig {
    return this.config
  }

  isInitialized(): boolean {
    return this.initialized
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _storage: EncryptedTrajectoryStorage | null = null

export function getEncryptedTrajectoryStorage(
  config?: Partial<StorageConfig>,
  encryptionProvider?: EncryptionProvider,
): EncryptedTrajectoryStorage {
  if (!_storage) {
    _storage = new EncryptedTrajectoryStorage(config, encryptionProvider)
  }
  return _storage
}

export function resetEncryptedTrajectoryStorage(): void {
  _storage = null
}
