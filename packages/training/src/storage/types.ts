/**
 * Storage Types for Training Infrastructure
 *
 * Types for encrypted trajectory storage and IPFS-based storage.
 */

import type { Address } from 'viem'

/**
 * Encrypted trajectory metadata
 */
export interface EncryptedTrajectory {
  id: string
  agentId: string
  archetype: string
  scenarioId: string
  windowId: string
  stepCount: number
  totalReward: number
  createdAt: number
  /** CID of encrypted data on IPFS */
  encryptedCid: string
  /** Policy for decryption */
  policyHash: string
  /** Metadata (unencrypted) */
  metadata: {
    durationMs: number
    finalBalance?: number
    finalPnL?: number
    episodeLength: number
    finalStatus: string
  }
}

/**
 * Batch of trajectories for training
 */
export interface TrajectoryBatch {
  batchId: string
  archetype: string
  trajectoryCount: number
  totalSteps: number
  trajectoryIds: string[]
  encryptedCid: string
  createdAt: number
  /** For training orchestrator contract */
  datasetCidBytes32: `0x${string}`
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Jeju storage endpoint */
  storageEndpoint: string
  /** Chain ID for policy conditions */
  chainId: string
  /** Training orchestrator address (for policy) */
  trainingOrchestratorAddress: Address
  /** AI CEO address (for policy) */
  aiCEOAddress: Address
  /** TEE registry address (for worker attestation) */
  teeRegistryAddress: Address
  /** Minimum TEE stake to decrypt */
  minTEEStakeUSD: number
  /** Enable MPC encryption (vs simpler AES for dev) */
  useMPC: boolean
  /** MPC threshold (e.g., 3 of 5) */
  mpcThreshold: number
  /** MPC party count */
  mpcParties: number
}

/**
 * Authentication signature for decryption
 */
export interface AuthSignature {
  sig: string
  derivedVia: string
  signedMessage: string
  address: string
}

/**
 * Access control condition for encryption policy
 */
export interface AccessCondition {
  type: 'role' | 'contract' | 'timestamp'
  chainId: string
  address?: Address
  role?: string
  timestamp?: number
}

/**
 * Access control policy for encryption
 */
export interface AccessControlPolicy {
  conditions: AccessCondition[]
  operator: 'and' | 'or'
}

/**
 * Encrypted payload structure
 */
export interface EncryptedPayload {
  ciphertext: string
  dataHash: string
  accessControlConditions: AccessCondition[]
  accessControlConditionType: string
  encryptedSymmetricKey: string
  chain?: string
}

/**
 * IPFS upload result
 */
export interface IPFSUploadResult {
  cid: string
  url: string
  size: number
  provider: 'ipfs' | 'arweave'
}

/**
 * Model metadata for storage
 */
export interface ModelMetadata {
  version: string
  baseModel: string
  trainedAt: string
  accuracy?: number
  avgReward?: number
  benchmarkScore?: number
  cid: string
  registryTx?: string
}

/**
 * Storage options
 */
export interface StorageOptions {
  permanent?: boolean
  registerOnChain?: boolean
  metadata?: Record<string, string>
}

/**
 * KMS policy condition type
 */
export interface PolicyCondition {
  type: 'address' | 'tee' | 'timestamp'
  value: Address | string | number
}

/**
 * KMS secret policy
 */
export interface SecretPolicy {
  conditions: PolicyCondition[]
  operator: 'and' | 'or'
}

/**
 * CID response from storage
 */
export interface CIDResponse {
  cid: string
}
