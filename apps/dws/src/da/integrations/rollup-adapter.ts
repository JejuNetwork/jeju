/**
 * Rollup DA Adapter
 * 
 * Adapter for integrating Jeju DA with rollup frameworks:
 * - OP Stack compatible
 * - Arbitrum Orbit compatible
 * - Generic sequencer integration
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { createPublicClient, createWalletClient, http, toBytes, toHex, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DAClient, createDAClient, type DAClientConfig } from '../client';
import type { BlobCommitment, AvailabilityAttestation, BlobSubmissionResult } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface RollupConfig {
  /** DA gateway endpoint */
  daGateway: string;
  /** L1 RPC URL for verification */
  l1RpcUrl?: string;
  /** DA contract addresses */
  contracts?: {
    operatorRegistry: Address;
    blobRegistry: Address;
    attestationManager: Address;
  };
  /** Sequencer private key */
  sequencerKey?: Hex;
  /** Batch size threshold (bytes) */
  batchThreshold?: number;
  /** Batch time threshold (ms) */
  batchTimeThreshold?: number;
  /** Namespace for this rollup */
  namespace?: Hex;
}

export interface BatchData {
  /** Batch number */
  batchNumber: bigint;
  /** L2 block range */
  l2BlockRange: { start: bigint; end: bigint };
  /** Compressed transaction data */
  transactions: Uint8Array;
  /** State root after batch */
  stateRoot: Hex;
  /** Timestamp */
  timestamp: number;
}

export interface DAReference {
  /** Blob ID */
  blobId: Hex;
  /** Blob commitment */
  commitment: BlobCommitment;
  /** Availability attestation */
  attestation: AvailabilityAttestation;
  /** Submission timestamp */
  submittedAt: number;
}

export interface BatchSubmissionResult {
  /** DA reference for the batch */
  daRef: DAReference;
  /** Batch metadata */
  batch: BatchData;
  /** Size in bytes */
  size: number;
  /** Submission time (ms) */
  latencyMs: number;
}

// ============================================================================
// Rollup DA Adapter
// ============================================================================

export class RollupDAAdapter {
  private readonly config: Required<RollupConfig>;
  private readonly daClient: DAClient;
  private readonly sequencerAddress: Address | null;
  
  // Batching state
  private pendingBatches: BatchData[] = [];
  private pendingSize = 0;
  private lastBatchTime = Date.now();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: RollupConfig) {
    this.config = {
      daGateway: config.daGateway,
      l1RpcUrl: config.l1RpcUrl ?? '',
      contracts: config.contracts ?? {
        operatorRegistry: '0x' as Address,
        blobRegistry: '0x' as Address,
        attestationManager: '0x' as Address,
      },
      sequencerKey: config.sequencerKey ?? '0x' as Hex,
      batchThreshold: config.batchThreshold ?? 128 * 1024, // 128KB
      batchTimeThreshold: config.batchTimeThreshold ?? 60000, // 1 minute
      namespace: config.namespace ?? keccak256(toBytes('default-rollup')) as Hex,
    };
    
    this.daClient = createDAClient({
      gatewayEndpoint: config.daGateway,
      rpcUrl: config.l1RpcUrl,
      signerKey: config.sequencerKey,
    });
    
    this.sequencerAddress = config.sequencerKey 
      ? privateKeyToAccount(config.sequencerKey).address 
      : null;
  }

  /**
   * Submit a single batch to DA
   */
  async submitBatch(batch: BatchData): Promise<BatchSubmissionResult> {
    const startTime = Date.now();
    
    // Encode batch data
    const encodedBatch = this.encodeBatch(batch);
    
    // Submit to DA
    const result = await this.daClient.submitBlob(encodedBatch, {
      namespace: this.config.namespace,
      submitter: this.sequencerAddress ?? undefined,
    });
    
    const daRef: DAReference = {
      blobId: result.blobId,
      commitment: result.commitment,
      attestation: result.attestation,
      submittedAt: Date.now(),
    };
    
    return {
      daRef,
      batch,
      size: encodedBatch.length,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Queue batch for automatic batching
   */
  queueBatch(batch: BatchData): void {
    this.pendingBatches.push(batch);
    this.pendingSize += batch.transactions.length;
    
    // Check if we should flush
    if (this.pendingSize >= this.config.batchThreshold) {
      this.flushBatches();
    } else if (!this.batchTimer) {
      // Start timer for time-based flushing
      this.batchTimer = setTimeout(() => {
        this.flushBatches();
      }, this.config.batchTimeThreshold);
    }
  }

  /**
   * Flush pending batches to DA
   */
  async flushBatches(): Promise<BatchSubmissionResult | null> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.pendingBatches.length === 0) {
      return null;
    }
    
    // Aggregate all pending batches
    const batches = [...this.pendingBatches];
    this.pendingBatches = [];
    this.pendingSize = 0;
    this.lastBatchTime = Date.now();
    
    // Create aggregated batch
    const aggregatedBatch: BatchData = {
      batchNumber: batches[batches.length - 1].batchNumber,
      l2BlockRange: {
        start: batches[0].l2BlockRange.start,
        end: batches[batches.length - 1].l2BlockRange.end,
      },
      transactions: this.aggregateTransactions(batches),
      stateRoot: batches[batches.length - 1].stateRoot,
      timestamp: Date.now(),
    };
    
    return this.submitBatch(aggregatedBatch);
  }

  /**
   * Verify DA reference is valid
   */
  async verifyDAReference(daRef: DAReference): Promise<boolean> {
    // Verify blob is available
    const isAvailable = await this.daClient.isAvailable(daRef.blobId);
    if (!isAvailable) return false;
    
    // Verify quorum attestation
    if (!daRef.attestation.quorumReached) return false;
    
    return true;
  }

  /**
   * Retrieve batch data from DA
   */
  async retrieveBatch(daRef: DAReference): Promise<BatchData> {
    const data = await this.daClient.retrieveBlob(daRef.blobId);
    return this.decodeBatch(data);
  }

  /**
   * Get DA status for monitoring
   */
  async getDAStatus(): Promise<{
    healthy: boolean;
    operators: number;
    pendingBatches: number;
    pendingSize: number;
  }> {
    const health = await this.daClient.healthCheck().catch(() => ({ status: 'error', operators: 0 }));
    
    return {
      healthy: health.status === 'healthy',
      operators: health.operators,
      pendingBatches: this.pendingBatches.length,
      pendingSize: this.pendingSize,
    };
  }

  // ============================================================================
  // Encoding/Decoding
  // ============================================================================

  private encodeBatch(batch: BatchData): Uint8Array {
    // Simple encoding: version + batchNumber + blocks + stateRoot + txData
    const header = new Uint8Array(1 + 8 + 8 + 8 + 32 + 8 + 4);
    const view = new DataView(header.buffer);
    
    let offset = 0;
    header[offset++] = 1; // Version
    view.setBigUint64(offset, batch.batchNumber, false); offset += 8;
    view.setBigUint64(offset, batch.l2BlockRange.start, false); offset += 8;
    view.setBigUint64(offset, batch.l2BlockRange.end, false); offset += 8;
    
    // State root
    const stateRootBytes = toBytes(batch.stateRoot);
    header.set(stateRootBytes.slice(0, 32), offset); offset += 32;
    
    // Timestamp
    view.setBigUint64(offset, BigInt(batch.timestamp), false); offset += 8;
    
    // Transaction length
    view.setUint32(offset, batch.transactions.length, false); offset += 4;
    
    // Combine header and transactions
    const result = new Uint8Array(header.length + batch.transactions.length);
    result.set(header, 0);
    result.set(batch.transactions, header.length);
    
    return result;
  }

  private decodeBatch(data: Uint8Array): BatchData {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    
    let offset = 0;
    const version = data[offset++];
    if (version !== 1) throw new Error(`Unsupported batch version: ${version}`);
    
    const batchNumber = view.getBigUint64(offset, false); offset += 8;
    const blockStart = view.getBigUint64(offset, false); offset += 8;
    const blockEnd = view.getBigUint64(offset, false); offset += 8;
    
    const stateRootBytes = data.slice(offset, offset + 32); offset += 32;
    const stateRoot = toHex(stateRootBytes);
    
    const timestamp = Number(view.getBigUint64(offset, false)); offset += 8;
    const txLength = view.getUint32(offset, false); offset += 4;
    
    const transactions = data.slice(offset, offset + txLength);
    
    return {
      batchNumber,
      l2BlockRange: { start: blockStart, end: blockEnd },
      transactions,
      stateRoot,
      timestamp,
    };
  }

  private aggregateTransactions(batches: BatchData[]): Uint8Array {
    const totalSize = batches.reduce((sum, b) => sum + b.transactions.length + 4, 0);
    const result = new Uint8Array(totalSize);
    const view = new DataView(result.buffer);
    
    let offset = 0;
    for (const batch of batches) {
      view.setUint32(offset, batch.transactions.length, false);
      offset += 4;
      result.set(batch.transactions, offset);
      offset += batch.transactions.length;
    }
    
    return result;
  }

  /**
   * Shutdown adapter
   */
  shutdown(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createRollupDAAdapter(config: RollupConfig): RollupDAAdapter {
  return new RollupDAAdapter(config);
}

// ============================================================================
// OP Stack Specific Adapter
// ============================================================================

export interface OPStackConfig extends RollupConfig {
  /** L1 batch inbox address */
  batchInbox: Address;
  /** Proposer address */
  proposer: Address;
}

export class OPStackDAAdapter extends RollupDAAdapter {
  private readonly opConfig: OPStackConfig;

  constructor(config: OPStackConfig) {
    super(config);
    this.opConfig = config;
  }

  /**
   * Create DA reference calldata for L1 submission
   * This replaces the full batch data with a DA pointer
   */
  createDAPointer(daRef: DAReference): Hex {
    // Format: 0x01 (DA version) + blobId (32) + commitment (32)
    const pointer = new Uint8Array(1 + 32 + 32);
    pointer[0] = 0x01; // DA pointer version
    
    const blobIdBytes = toBytes(daRef.blobId);
    pointer.set(blobIdBytes.slice(0, 32), 1);
    
    const commitmentBytes = toBytes(daRef.commitment.commitment);
    pointer.set(commitmentBytes.slice(0, 32), 33);
    
    return toHex(pointer);
  }

  /**
   * Parse DA pointer from L1 calldata
   */
  parseDAPointer(calldata: Hex): { blobId: Hex; commitment: Hex } | null {
    const data = toBytes(calldata);
    
    if (data.length < 65 || data[0] !== 0x01) {
      return null;
    }
    
    const blobId = toHex(data.slice(1, 33));
    const commitment = toHex(data.slice(33, 65));
    
    return { blobId, commitment };
  }
}

export function createOPStackDAAdapter(config: OPStackConfig): OPStackDAAdapter {
  return new OPStackDAAdapter(config);
}

// ============================================================================
// Arbitrum Orbit Specific Adapter
// ============================================================================

export interface ArbitrumOrbitConfig extends RollupConfig {
  /** Sequencer inbox address */
  sequencerInbox: Address;
  /** Data availability committee */
  dacMembers?: Address[];
}

export class ArbitrumOrbitDAAdapter extends RollupDAAdapter {
  private readonly orbitConfig: ArbitrumOrbitConfig;

  constructor(config: ArbitrumOrbitConfig) {
    super(config);
    this.orbitConfig = config;
  }

  /**
   * Create batch data hash for Arbitrum inbox
   */
  createBatchDataHash(daRef: DAReference): Hex {
    return keccak256(
      toBytes(`${daRef.blobId}${daRef.commitment.commitment}${daRef.commitment.merkleRoot}`)
    );
  }
}

export function createArbitrumOrbitDAAdapter(config: ArbitrumOrbitConfig): ArbitrumOrbitDAAdapter {
  return new ArbitrumOrbitDAAdapter(config);
}

