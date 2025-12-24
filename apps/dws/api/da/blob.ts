/**
 * Blob Management
 *
 * Handles blob lifecycle:
 * - Submission and encoding
 * - Storage and retrieval
 * - Expiration and garbage collection
 */

import type { Address, Hex } from 'viem'
import { keccak256, toHex } from 'viem'
import { computeBlobId, createPolynomialCommitment } from './commitment'
import { createReedSolomonCodec, type ReedSolomonCodec } from './erasure'
import type {
  Blob,
  BlobCommitment,
  BlobRetrievalRequest,
  BlobRetrievalResult,
  BlobSubmissionRequest,
  Chunk,
  ErasureConfig,
} from './types'

// Blob Status

export type BlobStatus =
  | 'pending' // Submitted, awaiting dispersal
  | 'dispersing' // Being dispersed to operators
  | 'available' // Confirmed available
  | 'expired' // Past retention period
  | 'unavailable' // Failed availability check

export interface BlobMetadata {
  id: Hex
  status: BlobStatus
  size: number
  commitment: BlobCommitment
  submitter: Address
  submittedAt: number
  confirmedAt?: number
  expiresAt: number
  namespace?: Hex
  chunkAssignments: Map<number, Address[]>
}

// Blob Submission

export interface BlobSubmissionConfig {
  erasure: ErasureConfig
  defaultRetentionPeriod: number // seconds
  maxBlobSize: number // bytes
}

const DEFAULT_SUBMISSION_CONFIG: BlobSubmissionConfig = {
  erasure: {
    dataShards: 16,
    parityShards: 16,
    chunkSize: 32768, // 32KB per chunk
  },
  defaultRetentionPeriod: 7 * 24 * 60 * 60, // 7 days
  maxBlobSize: 128 * 1024 * 1024, // 128MB
}

export class BlobSubmission {
  private readonly config: BlobSubmissionConfig
  private readonly codec: ReedSolomonCodec

  constructor(config?: Partial<BlobSubmissionConfig>) {
    this.config = { ...DEFAULT_SUBMISSION_CONFIG, ...config }
    this.codec = createReedSolomonCodec(this.config.erasure)
  }

  /**
   * Prepare blob for submission
   */
  prepare(request: BlobSubmissionRequest): {
    blob: Blob
    chunks: Chunk[]
    commitment: BlobCommitment
  } {
    const { data, submitter, namespace } = request

    // Validate size
    if (data.length > this.config.maxBlobSize) {
      throw new Error(
        `Blob too large: ${data.length} bytes (max: ${this.config.maxBlobSize})`,
      )
    }

    // Compute blob ID
    const id = computeBlobId(data)

    // Create blob object
    const blob: Blob = {
      id,
      data,
      size: data.length,
      submitter,
      submittedAt: Date.now(),
      namespace,
    }

    // Encode with erasure coding
    const shards = this.codec.encode(data, this.config.erasure.chunkSize)

    // Create commitment and chunks with proofs
    const polyCommitment = createPolynomialCommitment(
      data,
      shards,
      this.config.erasure.dataShards,
      this.config.erasure.parityShards,
      id,
    )

    return {
      blob,
      chunks: polyCommitment.chunks,
      commitment: polyCommitment.commitment,
    }
  }

  /**
   * Calculate required number of operators for quorum
   */
  calculateOperatorCount(quorumPercent: number, totalChunks: number): number {
    // Need enough operators that quorum percent have the data
    // Each operator gets totalChunks / operatorCount chunks
    // For reconstruction, need dataShards chunks
    const minForReconstruction = this.config.erasure.dataShards
    const baseOperators = Math.ceil(totalChunks / 10) // Each operator stores ~10 chunks

    // Increase for quorum requirement
    const forQuorum = Math.ceil(baseOperators / (quorumPercent / 100))

    return Math.max(minForReconstruction, forQuorum)
  }

  /**
   * Calculate retention expiry timestamp
   */
  calculateExpiry(retentionPeriod?: number): number {
    const period = retentionPeriod ?? this.config.defaultRetentionPeriod
    return Date.now() + period * 1000
  }
}

// Blob Manager

export class BlobManager {
  private readonly blobs: Map<Hex, BlobMetadata> = new Map()
  private readonly chunks: Map<Hex, Map<number, Chunk>> = new Map()
  private readonly submission: BlobSubmission
  private gcInterval: ReturnType<typeof setInterval> | null = null

  constructor(config?: Partial<BlobSubmissionConfig>) {
    this.submission = new BlobSubmission(config)
  }

  /**
   * Submit a new blob
   */
  submit(request: BlobSubmissionRequest): {
    blob: Blob
    chunks: Chunk[]
    commitment: BlobCommitment
    metadata: BlobMetadata
  } {
    const { blob, chunks, commitment } = this.submission.prepare(request)

    // Store chunks
    const chunkMap = new Map<number, Chunk>()
    for (const chunk of chunks) {
      chunkMap.set(chunk.index, chunk)
    }
    this.chunks.set(blob.id, chunkMap)

    // Create metadata
    const metadata: BlobMetadata = {
      id: blob.id,
      status: 'pending',
      size: blob.size,
      commitment,
      submitter: request.submitter,
      submittedAt: blob.submittedAt,
      expiresAt: this.submission.calculateExpiry(request.retentionPeriod),
      namespace: request.namespace,
      chunkAssignments: new Map(),
    }

    this.blobs.set(blob.id, metadata)

    return { blob, chunks, commitment, metadata }
  }

  /**
   * Get blob metadata
   */
  getMetadata(blobId: Hex): BlobMetadata | null {
    return this.blobs.get(blobId) ?? null
  }

  /**
   * Get blob chunks
   */
  getChunks(blobId: Hex): Chunk[] {
    const chunkMap = this.chunks.get(blobId)
    if (!chunkMap) return []
    return Array.from(chunkMap.values())
  }

  /**
   * Get specific chunk
   */
  getChunk(blobId: Hex, index: number): Chunk | null {
    return this.chunks.get(blobId)?.get(index) ?? null
  }

  /**
   * Update blob status
   */
  updateStatus(blobId: Hex, status: BlobStatus): void {
    const metadata = this.blobs.get(blobId)
    if (metadata) {
      metadata.status = status
      if (status === 'available' && !metadata.confirmedAt) {
        metadata.confirmedAt = Date.now()
      }
    }
  }

  /**
   * Set chunk assignments
   */
  setAssignments(blobId: Hex, assignments: Map<number, Address[]>): void {
    const metadata = this.blobs.get(blobId)
    if (metadata) {
      metadata.chunkAssignments = assignments
    }
  }

  /**
   * Retrieve blob data by reconstructing from chunks
   */
  retrieve(request: BlobRetrievalRequest): BlobRetrievalResult {
    const startTime = Date.now()
    const chunkMap = this.chunks.get(request.blobId)

    if (!chunkMap) {
      throw new Error(`Blob not found: ${request.blobId}`)
    }

    const metadata = this.blobs.get(request.blobId)
    if (!metadata) {
      throw new Error(`Blob metadata not found: ${request.blobId}`)
    }

    // Get available chunks
    const chunks = Array.from(chunkMap.values())

    // Reconstruct using erasure codec
    const codec = createReedSolomonCodec({
      dataShards: request.commitment.dataChunkCount,
      parityShards: request.commitment.parityChunkCount,
    })

    const data = codec.reconstructFromChunks(chunks, metadata.size)

    // Verify reconstruction
    const verified = computeBlobId(data) === request.blobId

    return {
      data,
      chunksUsed: chunks.length,
      verified,
      latencyMs: Date.now() - startTime,
    }
  }

  /**
   * Check if blob is available
   */
  isAvailable(blobId: Hex): boolean {
    const metadata = this.blobs.get(blobId)
    if (!metadata) return false

    return metadata.status === 'available' && metadata.expiresAt > Date.now()
  }

  /**
   * List blobs by status
   */
  listByStatus(status: BlobStatus): BlobMetadata[] {
    return Array.from(this.blobs.values()).filter((m) => m.status === status)
  }

  /**
   * List blobs by submitter
   */
  listBySubmitter(submitter: Address): BlobMetadata[] {
    return Array.from(this.blobs.values()).filter(
      (m) => m.submitter === submitter,
    )
  }

  /**
   * List expiring blobs
   */
  listExpiring(withinMs: number): BlobMetadata[] {
    const cutoff = Date.now() + withinMs
    return Array.from(this.blobs.values()).filter(
      (m) => m.status === 'available' && m.expiresAt < cutoff,
    )
  }

  /**
   * Start garbage collection
   */
  startGC(intervalMs = 60000): void {
    if (this.gcInterval) return

    this.gcInterval = setInterval(() => {
      this.collectGarbage()
    }, intervalMs)
  }

  /**
   * Stop garbage collection
   */
  stopGC(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval)
      this.gcInterval = null
    }
  }

  /**
   * Run garbage collection
   */
  collectGarbage(): { removed: number } {
    const now = Date.now()
    let removed = 0

    for (const [blobId, metadata] of this.blobs) {
      if (metadata.expiresAt < now) {
        this.blobs.delete(blobId)
        this.chunks.delete(blobId)
        removed++
      }
    }

    return { removed }
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    totalBlobs: number
    totalChunks: number
    byStatus: Record<BlobStatus, number>
    totalSize: number
  } {
    const byStatus: Record<BlobStatus, number> = {
      pending: 0,
      dispersing: 0,
      available: 0,
      expired: 0,
      unavailable: 0,
    }

    let totalSize = 0
    let totalChunks = 0

    for (const metadata of this.blobs.values()) {
      byStatus[metadata.status]++
      totalSize += metadata.size
    }

    for (const chunkMap of this.chunks.values()) {
      totalChunks += chunkMap.size
    }

    return {
      totalBlobs: this.blobs.size,
      totalChunks,
      byStatus,
      totalSize,
    }
  }
}

// Utilities

/**
 * Create blob ID from content
 */
export function createBlobId(data: Uint8Array): Hex {
  return keccak256(data)
}

/**
 * Create namespace ID
 */
export function createNamespace(name: string): Hex {
  return keccak256(toHex(new TextEncoder().encode(name)))
}

/**
 * Filter blobs by namespace
 */
export function filterByNamespace(
  blobs: BlobMetadata[],
  namespace: Hex,
): BlobMetadata[] {
  return blobs.filter((b) => b.namespace === namespace)
}
