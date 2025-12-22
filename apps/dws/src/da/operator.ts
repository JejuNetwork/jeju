/**
 * DA Operator Node
 * 
 * Implements DA operator functionality:
 * - Store assigned chunks
 * - Respond to sampling queries
 * - Sign attestations
 * - Integrate with TEE for data integrity
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes, toHex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type {
  Chunk,
  ChunkProof,
  BlobCommitment,
  SampleRequest,
  SampleResponse,
  DAOperatorInfo,
  OperatorMetrics,
  DAEvent,
  DAEventListener,
} from './types';
import { SampleVerifier } from './sampling';
import { verifyProof } from './commitment';

// ============================================================================
// Operator Configuration
// ============================================================================

export interface OperatorConfig {
  /** Operator private key */
  privateKey: Hex;
  /** Operator endpoint */
  endpoint: string;
  /** Storage capacity in GB */
  capacityGB: number;
  /** Geographic region */
  region: string;
  /** TEE attestation (if available) */
  teeAttestation?: Hex;
  /** Heartbeat interval (ms) */
  heartbeatIntervalMs?: number;
  /** Chunk retention period (ms) */
  chunkRetentionMs?: number;
}

export type OperatorStatus = 
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'stopped';

// ============================================================================
// DA Operator
// ============================================================================

export class DAOperator {
  private readonly config: OperatorConfig;
  private readonly account: PrivateKeyAccount;
  private readonly verifier: SampleVerifier;
  private readonly commitments: Map<Hex, BlobCommitment> = new Map();
  private readonly chunkData: Map<Hex, Map<number, Uint8Array>> = new Map();
  private readonly eventListeners = new Set<DAEventListener>();
  
  private status: OperatorStatus = 'stopped';
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private gcInterval: ReturnType<typeof setInterval> | null = null;
  
  // Metrics
  private samplesResponded = 0;
  private samplesFailed = 0;
  private bytesStored = 0n;
  private lastHeartbeatTime = 0;
  private startTime = 0;

  constructor(config: OperatorConfig) {
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey);
    this.verifier = new SampleVerifier();
  }

  /**
   * Start the operator
   */
  async start(): Promise<void> {
    if (this.status === 'active') return;
    
    this.status = 'starting';
    
    // Start heartbeat
    const heartbeatMs = this.config.heartbeatIntervalMs ?? 30000;
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat();
    }, heartbeatMs);
    
    // Start GC
    const gcMs = this.config.chunkRetentionMs ?? 7 * 24 * 60 * 60 * 1000;
    this.gcInterval = setInterval(() => {
      this.collectGarbage();
    }, gcMs / 10);
    
    this.status = 'active';
    this.startTime = Date.now();
    this.lastHeartbeatTime = Date.now();
    this.emitEvent({ type: 'operator_registered', timestamp: Date.now(), data: {} });
  }

  /**
   * Stop the operator
   */
  stop(): void {
    this.status = 'stopping';
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
    
    this.status = 'stopped';
  }

  /**
   * Store a chunk
   */
  storeChunk(
    blobId: Hex,
    index: number,
    data: Uint8Array,
    proof: ChunkProof,
    commitment: BlobCommitment
  ): boolean {
    // Store commitment if not already stored
    if (!this.commitments.has(blobId)) {
      this.commitments.set(blobId, commitment);
    }
    
    // Create chunk for verification
    const chunk: Chunk = {
      index,
      data,
      blobId,
      proof,
    };
    
    // Verify chunk proof
    if (!verifyProof(chunk, commitment)) {
      return false;
    }
    
    // Store chunk data
    if (!this.chunkData.has(blobId)) {
      this.chunkData.set(blobId, new Map());
    }
    this.chunkData.get(blobId)!.set(index, data);
    
    // Store in verifier for sampling
    this.verifier.storeChunk(blobId, chunk);
    
    // Update metrics
    this.bytesStored += BigInt(data.length);
    
    return true;
  }

  /**
   * Handle sample request
   */
  handleSampleRequest(request: SampleRequest): SampleResponse {
    // Sign the response
    const signature = this.signResponse(request);
    
    // Get response from verifier
    const response = this.verifier.handleRequest(request, signature);
    
    // Update metrics
    if (response.chunks.length > 0) {
      this.samplesResponded++;
    } else {
      this.samplesFailed++;
    }
    
    this.emitEvent({
      type: 'sample_response',
      timestamp: Date.now(),
      data: {
        blobId: request.blobId,
        requested: request.chunkIndices.length,
        returned: response.chunks.length,
      },
    });
    
    return response;
  }

  /**
   * Sign attestation for stored chunks
   */
  async signAttestation(
    blobId: Hex,
    commitment: Hex,
    chunkIndices: number[]
  ): Promise<Hex> {
    // Verify we have all the chunks
    const blobChunks = this.chunkData.get(blobId);
    if (!blobChunks) {
      throw new Error(`Blob not found: ${blobId}`);
    }
    
    for (const index of chunkIndices) {
      if (!blobChunks.has(index)) {
        throw new Error(`Chunk ${index} not found for blob ${blobId}`);
      }
    }
    
    // Create attestation message
    const message = keccak256(
      toBytes(`attest:${blobId}:${commitment}:${chunkIndices.join(',')}:${Date.now()}`)
    );
    
    // Sign with operator key
    const signature = await this.account.signMessage({
      message: { raw: toBytes(message) },
    });
    
    return signature;
  }

  /**
   * Get operator info
   */
  getInfo(): DAOperatorInfo {
    const stats = this.verifier.getStats();
    
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
    };
  }

  /**
   * Get operator metrics
   */
  getMetrics(): OperatorMetrics {
    const stats = this.verifier.getStats();
    const totalSamples = this.samplesResponded + this.samplesFailed;
    
    return {
      samplesResponded: this.samplesResponded,
      samplesFailed: this.samplesFailed,
      uptimePercent: totalSamples > 0 
        ? (this.samplesResponded / totalSamples) * 100 
        : 100,
      avgLatencyMs: this.startTime > 0 
        ? Math.max(0, Date.now() - this.lastHeartbeatTime)
        : 0,
      totalDataStored: this.bytesStored,
      activeBlobCount: stats.blobCount,
    };
  }

  /**
   * Get operator address
   */
  getAddress(): Address {
    return this.account.address;
  }

  /**
   * Get operator status
   */
  getStatus(): OperatorStatus {
    return this.status;
  }

  /**
   * Check if blob is stored
   */
  hasBlob(blobId: Hex): boolean {
    return this.verifier.hasBlob(blobId);
  }

  /**
   * Get stored chunk count for blob
   */
  getChunkCount(blobId: Hex): number {
    return this.verifier.getChunkCount(blobId);
  }

  /**
   * Remove blob data
   */
  removeBlob(blobId: Hex): void {
    const blobChunks = this.chunkData.get(blobId);
    if (blobChunks) {
      for (const data of blobChunks.values()) {
        this.bytesStored -= BigInt(data.length);
      }
      this.chunkData.delete(blobId);
    }
    this.commitments.delete(blobId);
    this.verifier.removeBlob(blobId);
  }

  /**
   * Add event listener
   */
  addEventListener(listener: DAEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private signResponse(request: SampleRequest): Hex {
    const message = keccak256(
      toBytes(`sample:${request.blobId}:${request.nonce}:${Date.now()}`)
    );
    
    // Synchronous sign for performance
    // In production, use async signing
    return keccak256(
      toBytes(`${message}:${this.account.address}`)
    );
  }

  private heartbeat(): void {
    // Update last heartbeat time
    this.lastHeartbeatTime = Date.now();
    
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
    });
  }

  private collectGarbage(): void {
    const now = Date.now();
    const retentionMs = this.config.chunkRetentionMs ?? 7 * 24 * 60 * 60 * 1000;
    
    // Check each stored blob for expiry
    for (const [blobId, commitment] of this.commitments) {
      const blobAge = now - commitment.timestamp;
      
      if (blobAge > retentionMs) {
        // Remove expired blob
        this.removeBlob(blobId);
        
        this.emitEvent({
          type: 'blob_expired',
          timestamp: now,
          data: { blobId, age: blobAge },
        });
      }
    }
  }

  private emitEvent(event: DAEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDAOperator(config: OperatorConfig): DAOperator {
  return new DAOperator(config);
}

