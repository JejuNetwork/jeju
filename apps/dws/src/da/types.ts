/**
 * Data Availability Layer Types
 */

import type { Address, Hex } from 'viem'

// ============================================================================
// Core Data Types
// ============================================================================

/** Raw blob data before encoding */
export interface Blob {
  /** Unique identifier (hash of content) */
  id: Hex
  /** Raw blob data */
  data: Uint8Array
  /** Size in bytes */
  size: number
  /** Submitter address */
  submitter: Address
  /** Submission timestamp */
  submittedAt: number
  /** Optional namespace for rollup separation */
  namespace?: Hex
}

/** Encoded chunk after erasure coding */
export interface Chunk {
  /** Chunk index in the encoded blob */
  index: number
  /** Chunk data */
  data: Uint8Array
  /** Parent blob ID */
  blobId: Hex
  /** Proof for this chunk */
  proof: ChunkProof
}

/** Proof that a chunk belongs to a blob */
export interface ChunkProof {
  /** Merkle proof path */
  merkleProof: Hex[]
  /** Opening proof for polynomial commitment */
  openingProof: Hex
  /** Index in the polynomial */
  polynomialIndex: number
}

// ============================================================================
// Commitment Types
// ============================================================================

/** Polynomial commitment to blob data */
export interface BlobCommitment {
  /** Commitment hash */
  commitment: Hex
  /** Number of original data chunks */
  dataChunkCount: number
  /** Number of parity chunks */
  parityChunkCount: number
  /** Total chunks after encoding */
  totalChunkCount: number
  /** Chunk size in bytes */
  chunkSize: number
  /** Merkle root of all chunks */
  merkleRoot: Hex
  /** Timestamp */
  timestamp: number
}

/** Availability attestation from operators */
export interface AvailabilityAttestation {
  /** Blob ID */
  blobId: Hex
  /** Attestation commitment */
  commitment: Hex
  /** Operator signatures */
  signatures: OperatorSignature[]
  /** Aggregate signature (if using BLS) */
  aggregateSignature?: Hex
  /** Quorum reached */
  quorumReached: boolean
  /** Timestamp */
  timestamp: number
}

/** Individual operator signature */
export interface OperatorSignature {
  /** Operator address */
  operator: Address
  /** Signature */
  signature: Hex
  /** Operator's chunk indices */
  chunkIndices: number[]
}

// ============================================================================
// Operator Types
// ============================================================================

/** DA operator registration */
export interface DAOperatorInfo {
  /** Operator address */
  address: Address
  /** ERC-8004 agent ID */
  agentId: bigint
  /** Staked amount */
  stake: bigint
  /** Operator endpoint */
  endpoint: string
  /** TEE attestation hash */
  teeAttestation: Hex
  /** Geographic region */
  region: string
  /** Storage capacity in GB */
  capacityGB: number
  /** Used capacity in GB */
  usedGB: number
  /** Operator status */
  status: OperatorRegistrationStatus
  /** Registration timestamp */
  registeredAt: number
  /** Last heartbeat */
  lastHeartbeat: number
}

export type OperatorRegistrationStatus =
  | 'pending'
  | 'active'
  | 'inactive'
  | 'slashed'
  | 'exiting'

/** Operator performance metrics */
export interface OperatorMetrics {
  /** Total samples responded */
  samplesResponded: number
  /** Samples failed */
  samplesFailed: number
  /** Uptime percentage */
  uptimePercent: number
  /** Average response latency (ms) */
  avgLatencyMs: number
  /** Total data stored (bytes) */
  totalDataStored: bigint
  /** Blobs currently holding */
  activeBlobCount: number
}

// ============================================================================
// Sampling Types
// ============================================================================

/** Sampling request */
export interface SampleRequest {
  /** Blob ID to sample */
  blobId: Hex
  /** Chunk indices to sample */
  chunkIndices: number[]
  /** Requester address */
  requester: Address
  /** Request nonce for uniqueness */
  nonce: Hex
  /** Timestamp */
  timestamp: number
}

/** Sampling response */
export interface SampleResponse {
  /** Original request */
  request: SampleRequest
  /** Chunks returned */
  chunks: Chunk[]
  /** Operator signature */
  signature: Hex
  /** Response timestamp */
  timestamp: number
}

/** Sampling verification result */
export interface SampleVerificationResult {
  /** Whether sampling succeeded */
  success: boolean
  /** Number of samples verified */
  samplesVerified: number
  /** Number of samples failed */
  samplesFailed: number
  /** Availability confidence (0-1) */
  confidence: number
  /** Error if any */
  error?: string
}

// ============================================================================
// Dispersal Types
// ============================================================================

/** Blob submission request */
export interface BlobSubmissionRequest {
  /** Raw blob data */
  data: Uint8Array
  /** Submitter address */
  submitter: Address
  /** Optional namespace */
  namespace?: Hex
  /** Quorum percentage required */
  quorumPercent?: number
  /** Retention period in seconds */
  retentionPeriod?: number
}

/** Blob submission result */
export interface BlobSubmissionResult {
  /** Blob ID */
  blobId: Hex
  /** Commitment */
  commitment: BlobCommitment
  /** Availability attestation */
  attestation: AvailabilityAttestation
  /** Operators storing the blob */
  operators: Address[]
  /** Chunk assignments */
  chunkAssignments: ChunkAssignment[]
  /** Total cost (if applicable) */
  cost?: bigint
  /** Transaction hash (if on-chain) */
  txHash?: Hex
}

/** Chunk to operator assignment */
export interface ChunkAssignment {
  /** Chunk index */
  chunkIndex: number
  /** Assigned operators */
  operators: Address[]
}

// ============================================================================
// Retrieval Types
// ============================================================================

/** Blob retrieval request */
export interface BlobRetrievalRequest {
  /** Blob ID */
  blobId: Hex
  /** Commitment for verification */
  commitment: BlobCommitment
}

/** Blob retrieval result */
export interface BlobRetrievalResult {
  /** Reconstructed blob data */
  data: Uint8Array
  /** Chunks used for reconstruction */
  chunksUsed: number
  /** Verification passed */
  verified: boolean
  /** Retrieval latency (ms) */
  latencyMs: number
}

// ============================================================================
// Configuration Types
// ============================================================================

/** Erasure coding configuration */
export interface ErasureConfig {
  /** Number of data shards */
  dataShards: number
  /** Number of parity shards */
  parityShards: number
  /** Chunk size in bytes */
  chunkSize: number
}

/** Sampling configuration */
export interface SamplingConfig {
  /** Number of samples per verification */
  sampleCount: number
  /** Target availability confidence */
  targetConfidence: number
  /** Timeout for sample responses (ms) */
  timeoutMs: number
  /** Retry count */
  retries: number
}

/** DA layer configuration */
export interface DAConfig {
  /** Erasure coding config */
  erasure: ErasureConfig
  /** Sampling config */
  sampling: SamplingConfig
  /** Minimum operator stake */
  minOperatorStake: bigint
  /** Minimum quorum percentage */
  minQuorumPercent: number
  /** Default retention period (seconds) */
  defaultRetentionPeriod: number
  /** Contract addresses */
  contracts: {
    operatorRegistry: Address
    blobRegistry: Address
    attestationManager: Address
  }
  /** RPC URL */
  rpcUrl: string
}

// ============================================================================
// Event Types
// ============================================================================

export type DAEventType =
  | 'blob_submitted'
  | 'blob_attested'
  | 'blob_expired'
  | 'operator_registered'
  | 'operator_slashed'
  | 'sample_request'
  | 'sample_response'

export interface DAEvent {
  type: DAEventType
  timestamp: number
  data: Record<string, unknown>
}

export type DAEventListener = (event: DAEvent) => void

// ============================================================================
// Error Types
// ============================================================================

export enum DAErrorCode {
  BLOB_NOT_FOUND = 'BLOB_NOT_FOUND',
  BLOB_TOO_LARGE = 'BLOB_TOO_LARGE',
  COMMITMENT_INVALID = 'COMMITMENT_INVALID',
  PROOF_INVALID = 'PROOF_INVALID',
  QUORUM_NOT_REACHED = 'QUORUM_NOT_REACHED',
  OPERATOR_NOT_FOUND = 'OPERATOR_NOT_FOUND',
  OPERATOR_UNAVAILABLE = 'OPERATOR_UNAVAILABLE',
  SAMPLING_FAILED = 'SAMPLING_FAILED',
  RECONSTRUCTION_FAILED = 'RECONSTRUCTION_FAILED',
  INSUFFICIENT_STAKE = 'INSUFFICIENT_STAKE',
  ATTESTATION_EXPIRED = 'ATTESTATION_EXPIRED',
}

export class DAError extends Error {
  constructor(
    public readonly code: DAErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DAError'
  }
}
