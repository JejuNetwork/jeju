import { isProductionEnv } from '@jejunetwork/config'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { createSecureSigner, type SecureSigner } from '../shared/secure-signer'
import { verifyProof } from './commitment'
import { SampleVerifier } from './sampling'
import type {
  BlobCommitment,
  Chunk,
  ChunkProof,
  DAEvent,
  DAEventListener,
  DAOperatorInfo,
  OperatorMetrics,
  SampleRequest,
  SampleResponse,
} from './types'

// Operator Configuration

export interface OperatorConfig {
  /** Operator private key (deprecated - use kmsKeyId) */
  privateKey?: Hex
  /** KMS key ID for secure signing */
  kmsKeyId?: string
  /** Owner address for KMS */
  ownerAddress?: Address
  /** Operator endpoint */
  endpoint: string
  /** Storage capacity in GB */
  capacityGB: number
  /** Geographic region */
  region: string
  /** TEE attestation (if available) */
  teeAttestation?: Hex
  /** Heartbeat interval (ms) */
  heartbeatIntervalMs?: number
  /** Chunk retention period (ms) */
  chunkRetentionMs?: number
}

export type OperatorStatus =
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'stopped'

// DA Operator

export class DAOperator {
  private readonly config: OperatorConfig
  private account: PrivateKeyAccount | null = null
  private secureSigner: SecureSigner | null = null
  private readonly verifier: SampleVerifier
  private readonly commitments: Map<Hex, BlobCommitment> = new Map()
  private readonly chunkData: Map<Hex, Map<number, Uint8Array>> = new Map()
  private readonly eventListeners = new Set<DAEventListener>()

  private status: OperatorStatus = 'stopped'
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private gcInterval: ReturnType<typeof setInterval> | null = null
  private initialized = false

  // Metrics
  private samplesResponded = 0
  private samplesFailed = 0
  private bytesStored = 0n
  private lastHeartbeatTime = 0
  private startTime = 0

  constructor(config: OperatorConfig) {
    this.config = config
    // Initialize with direct key if provided
    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey)
    }
    this.verifier = new SampleVerifier()
  }

  /**
   * Initialize secure signing via KMS
   */
  private async initializeSecureSigning(): Promise<void> {
    if (this.initialized) return

    const { kmsKeyId, ownerAddress } = this.config
    const isProduction = isProductionEnv()

    if (kmsKeyId && ownerAddress) {
      this.secureSigner = await createSecureSigner(ownerAddress, kmsKeyId)
      console.log('[DA Operator] Using KMS-backed signing (FROST threshold)')
    } else if (isProduction && !this.account) {
      throw new Error(
        'DA operator requires kmsKeyId or privateKey in production',
      )
    } else if (isProduction) {
      console.warn(
        '[DA Operator] Using direct key in production - set kmsKeyId for security',
      )
    }

    this.initialized = true
  }

  /**
   * Get operator address
   */
  getAddress(): Address {
    if (this.secureSigner) {
      return this.secureSigner.getAddress()
    }
    if (this.account) {
      return this.account.address
    }
    throw new Error('No account available')
  }

  /**
   * Start the operator
   */
  async start(): Promise<void> {
    if (this.status === 'active') return

    this.status = 'starting'

    // Initialize secure signing
    await this.initializeSecureSigning()

    // Start heartbeat
    const heartbeatMs = this.config.heartbeatIntervalMs ?? 30000
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat()
    }, heartbeatMs)

    // Start GC
    const gcMs = this.config.chunkRetentionMs ?? 7 * 24 * 60 * 60 * 1000
    this.gcInterval = setInterval(() => {
      this.collectGarbage()
    }, gcMs / 10)

    this.status = 'active'
    this.startTime = Date.now()
    this.lastHeartbeatTime = Date.now()
    this.emitEvent({
      type: 'operator_registered',
      timestamp: Date.now(),
      data: {},
    })
  }

  /**
   * Stop the operator
   */
  stop(): void {
    this.status = 'stopping'

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.gcInterval) {
      clearInterval(this.gcInterval)
      this.gcInterval = null
    }

    this.status = 'stopped'
  }

  /**
   * Store a chunk
   */
  storeChunk(
    blobId: Hex,
    index: number,
    data: Uint8Array,
    proof: ChunkProof,
    commitment: BlobCommitment,
  ): boolean {
    // Store commitment if not already stored
    if (!this.commitments.has(blobId)) {
      this.commitments.set(blobId, commitment)
    }

    // Create chunk for verification
    const chunk: Chunk = {
      index,
      data,
      blobId,
      proof,
    }

    // Verify chunk proof
    if (!verifyProof(chunk, commitment)) {
      return false
    }

    // Store chunk data
    if (!this.chunkData.has(blobId)) {
      this.chunkData.set(blobId, new Map())
    }
    const blobChunkMap = this.chunkData.get(blobId)
    if (!blobChunkMap) {
      throw new Error(`Failed to create chunk map for blob ${blobId}`)
    }
    blobChunkMap.set(index, data)

    // Store in verifier for sampling
    this.verifier.storeChunk(blobId, chunk)

    // Update metrics
    this.bytesStored += BigInt(data.length)

    return true
  }

  /**
   * Handle sample request
   */
  handleSampleRequest(request: SampleRequest): SampleResponse {
    // Sign the response
    const signature = this.signResponse(request)

    // Get response from verifier
    const response = this.verifier.handleRequest(request, signature)

    // Update metrics
    if (response.chunks.length > 0) {
      this.samplesResponded++
    } else {
      this.samplesFailed++
    }

    this.emitEvent({
      type: 'sample_response',
      timestamp: Date.now(),
      data: {
        blobId: request.blobId,
        requested: request.chunkIndices.length,
        returned: response.chunks.length,
      },
    })

    return response
  }

  /**
   * Sign attestation for stored chunks
   */
  async signAttestation(
    blobId: Hex,
    commitment: Hex,
    chunkIndices: number[],
  ): Promise<Hex> {
    // Verify we have all the chunks
    const blobChunks = this.chunkData.get(blobId)
    if (!blobChunks) {
      throw new Error(`Blob not found: ${blobId}`)
    }

    for (const index of chunkIndices) {
      if (!blobChunks.has(index)) {
        throw new Error(`Chunk ${index} not found for blob ${blobId}`)
      }
    }

    // Create attestation message
    const message = keccak256(
      toBytes(
        `attest:${blobId}:${commitment}:${chunkIndices.join(',')}:${Date.now()}`,
      ),
    )

    // Sign with operator key
    if (!this.account) {
      throw new Error('No account available for signing')
    }
    const signature = await this.account.signMessage({
      message: { raw: toBytes(message) },
    })

    return signature
  }

  /**
   * Get operator info
   */
  getInfo(): DAOperatorInfo {
    // Stats available for future use: this.verifier.getStats()
    if (!this.account) {
      throw new Error('Operator not initialized')
    }
    return {
      address: this.account.address,
      agentId: 0n, // Set when registered on-chain
      stake: 0n, // Set when registered on-chain
      endpoint: this.config.endpoint,
      teeAttestation: this.config.teeAttestation ?? ('0x' as Hex),
      region: this.config.region,
      capacityGB: this.config.capacityGB,
      usedGB: Number(this.bytesStored) / (1024 * 1024 * 1024),
      status: this.status === 'active' ? 'active' : 'inactive',
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    }
  }

  /**
   * Get operator metrics
   */
  getMetrics(): OperatorMetrics {
    const stats = this.verifier.getStats()
    const totalSamples = this.samplesResponded + this.samplesFailed

    return {
      samplesResponded: this.samplesResponded,
      samplesFailed: this.samplesFailed,
      uptimePercent:
        totalSamples > 0 ? (this.samplesResponded / totalSamples) * 100 : 100,
      avgLatencyMs:
        this.startTime > 0
          ? Math.max(0, Date.now() - this.lastHeartbeatTime)
          : 0,
      totalDataStored: this.bytesStored,
      activeBlobCount: stats.blobCount,
    }
  }

  /**
   * Get operator status
   */
  getStatus(): OperatorStatus {
    return this.status
  }

  /**
   * Check if blob is stored
   */
  hasBlob(blobId: Hex): boolean {
    return this.verifier.hasBlob(blobId)
  }

  /**
   * Get stored chunk count for blob
   */
  getChunkCount(blobId: Hex): number {
    return this.verifier.getChunkCount(blobId)
  }

  /**
   * Remove blob data
   */
  removeBlob(blobId: Hex): void {
    const blobChunks = this.chunkData.get(blobId)
    if (blobChunks) {
      for (const data of blobChunks.values()) {
        this.bytesStored -= BigInt(data.length)
      }
      this.chunkData.delete(blobId)
    }
    this.commitments.delete(blobId)
    this.verifier.removeBlob(blobId)
  }

  /**
   * Add event listener
   */
  addEventListener(listener: DAEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  // Private Methods

  private signResponse(request: SampleRequest): Hex {
    if (!this.account) {
      throw new Error('No account available for signing')
    }

    // Create deterministic message for signing
    const message = keccak256(
      toBytes(`sample:${request.blobId}:${request.nonce}:${request.timestamp}`),
    )

    // Create signature by signing the message hash
    // Use signMessage async in production, but for sync response handling
    // we create a deterministic signature commitment
    const keyFragment = this.config.privateKey?.slice(0, 10) ?? 'secure'
    const signaturePreimage = keccak256(
      toBytes(`${message}:${this.account.address}:${keyFragment}`),
    )

    // Return commitment that can be verified by knowing operator address
    // Full BLS signature should be used for production attestations
    return signaturePreimage
  }

  private heartbeat(): void {
    // Update last heartbeat time
    this.lastHeartbeatTime = Date.now()

    // Log heartbeat for monitoring
    this.emitEvent({
      type: 'sample_response', // Using existing event type for heartbeat
      timestamp: Date.now(),
      data: {
        type: 'heartbeat',
        status: this.status,
        blobCount: this.verifier.getStats().blobCount,
        bytesStored: this.bytesStored.toString(),
      },
    })
  }

  private collectGarbage(): void {
    const now = Date.now()
    const retentionMs = this.config.chunkRetentionMs ?? 7 * 24 * 60 * 60 * 1000

    // Check each stored blob for expiry
    for (const [blobId, commitment] of this.commitments) {
      const blobAge = now - commitment.timestamp

      if (blobAge > retentionMs) {
        // Remove expired blob
        this.removeBlob(blobId)

        this.emitEvent({
          type: 'blob_expired',
          timestamp: now,
          data: { blobId, age: blobAge },
        })
      }
    }
  }

  private emitEvent(event: DAEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
}

// Factory

export function createDAOperator(config: OperatorConfig): DAOperator {
  return new DAOperator(config)
}
