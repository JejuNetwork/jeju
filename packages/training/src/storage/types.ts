/**
 * Storage Types for Training Infrastructure
 *
 * Types for encrypted trajectory storage and IPFS-based storage.
 */

import type { Address } from 'viem'
import { isAddress } from 'viem'
import { z } from 'zod'

const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  'Invalid Ethereum address',
)

// ============================================================================
// Zod Schemas for Storage Types
// ============================================================================

export const CIDResponseSchema = z.object({
  cid: z.string().min(1),
})

export const AccessConditionSchema = z.object({
  type: z.enum(['role', 'contract', 'timestamp']),
  chainId: z.string(),
  address: AddressSchema.optional(),
  role: z.string().optional(),
  timestamp: z.number().optional(),
})

export const EncryptedPayloadSchema = z.object({
  ciphertext: z.string(),
  dataHash: z.string(),
  accessControlConditions: z.array(AccessConditionSchema),
  accessControlConditionType: z.string(),
  encryptedSymmetricKey: z.string(),
  chain: z.string().optional(),
})

export const IPFSUploadResultSchema = z.object({
  cid: z.string().min(1),
  url: z.string(),
  size: z.number().int().nonnegative(),
  provider: z.enum(['ipfs', 'arweave']),
})

export const DWSUploadResponseSchema = z.object({
  cid: z.string().min(1),
})

export const TrajectoryBatchHeaderSchema = z.object({
  _type: z.literal('header'),
  batchId: z.string().min(1),
  appName: z.string().min(1),
  trajectoryCount: z.number().int().positive(),
  timestamp: z.string(),
})

export const StringArraySchema = z.array(z.string())

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

/**
 * Reference to a scored dataset in permanent storage
 */
export interface DatasetReference {
  datasetId: string
  appName: string
  archetype: string
  sourceBatchCids: string[]
  permanentCid: string
  storageProvider: 'arweave'
  trajectoryCount: number
  totalSteps: number
  averageScore: number
  scoreDistribution: {
    min: number
    max: number
    median: number
    stdDev: number
  }
  createdAt: Date
  processedAt: Date
  rulerModelId: string
  rulerVersion: string
}
