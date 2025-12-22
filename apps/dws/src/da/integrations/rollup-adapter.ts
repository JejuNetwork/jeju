/**
 * Rollup DA Adapter
 * 
 * Adapter for integrating Jeju DA with rollup frameworks:
 * - OP Stack compatible
 * - Arbitrum Orbit compatible
 * - Generic sequencer integration
 * - L1 DA commitment verification
 * - Calldata fallback support
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { createPublicClient, createWalletClient, http, toBytes, toHex, keccak256, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DAClient, createDAClient, type DAClientConfig } from '../client';
import type { BlobCommitment, AvailabilityAttestation, BlobSubmissionResult, OperatorSignature } from '../types';
import { 
  verifyAttestation, 
  verifyAggregate,
  type BLSPublicKey,
  type BLSSignature,
} from '../crypto/bls';

// L1 Contract ABIs
const DACommitmentVerifierABI = [
  {
    name: 'registerCommitment',
    type: 'function',
    inputs: [
      { name: 'outputRoot', type: 'bytes32' },
      { name: 'daCommitment', type: 'tuple', components: [
        { name: 'blobId', type: 'bytes32' },
        { name: 'commitment', type: 'bytes32' },
        { name: 'merkleRoot', type: 'bytes32' },
        { name: 'submittedAt', type: 'uint256' },
        { name: 'isCalldata', type: 'bool' }
      ]}
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    name: 'verifyCommitment',
    type: 'function',
    inputs: [
      { name: 'outputRoot', type: 'bytes32' },
      { name: 'daCommitment', type: 'tuple', components: [
        { name: 'blobId', type: 'bytes32' },
        { name: 'commitment', type: 'bytes32' },
        { name: 'merkleRoot', type: 'bytes32' },
        { name: 'submittedAt', type: 'uint256' },
        { name: 'isCalldata', type: 'bool' }
      ]},
      { name: 'proof', type: 'bytes' }
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  }
] as const;

const CalldataFallbackABI = [
  {
    name: 'postCalldata',
    type: 'function',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [{ name: 'blobId', type: 'bytes32' }],
    stateMutability: 'payable'
  },
  {
    name: 'verifyCalldata',
    type: 'function',
    inputs: [
      { name: 'blobId', type: 'bytes32' },
      { name: 'data', type: 'bytes' }
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  }
] as const;

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
    daCommitmentVerifier?: Address;
    calldataFallback?: Address;
    l2OutputOracleAdapter?: Address;
  };
  /** Sequencer private key */
  sequencerKey?: Hex;
  /** Batch size threshold (bytes) */
  batchThreshold?: number;
  /** Batch time threshold (ms) */
  batchTimeThreshold?: number;
  /** Namespace for this rollup */
  namespace?: Hex;
  /** Enable calldata fallback when DA is unavailable */
  enableCalldataFallback?: boolean;
  /** Max retries before falling back to calldata */
  maxDARetries?: number;
}

export interface DAProof {
  /** State root from L2 */
  stateRoot: Hex;
  /** Message passer storage root */
  messagePasserRoot: Hex;
  /** Block hash */
  blockHash: Hex;
  /** Merkle proof for state inclusion */
  merkleProof: Hex[];
}

export interface L1SubmissionResult {
  /** Transaction hash on L1 */
  txHash: Hex;
  /** Output root submitted */
  outputRoot: Hex;
  /** DA commitment */
  daCommitment: Hex;
  /** Whether calldata fallback was used */
  usedCalldataFallback: boolean;
  /** Submission timestamp */
  submittedAt: number;
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
  private readonly config: Required<RollupConfig> & { 
    contracts: Required<RollupConfig['contracts']> & {
      daCommitmentVerifier: Address;
      calldataFallback: Address;
      l2OutputOracleAdapter: Address;
    };
    enableCalldataFallback: boolean;
    maxDARetries: number;
  };
  private readonly daClient: DAClient;
  private readonly sequencerAddress: Address | null;
  private l1Client: PublicClient | null = null;
  private l1WalletClient: WalletClient | null = null;
  
  // Batching state
  private pendingBatches: BatchData[] = [];
  private pendingSize = 0;
  private lastBatchTime = Date.now();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Fallback tracking
  private daFailureCount = 0;
  private lastDAFailure: number | null = null;

  constructor(config: RollupConfig) {
    this.config = {
      daGateway: config.daGateway,
      l1RpcUrl: config.l1RpcUrl ?? '',
      contracts: {
        operatorRegistry: config.contracts?.operatorRegistry ?? '0x' as Address,
        blobRegistry: config.contracts?.blobRegistry ?? '0x' as Address,
        attestationManager: config.contracts?.attestationManager ?? '0x' as Address,
        daCommitmentVerifier: config.contracts?.daCommitmentVerifier ?? '0x' as Address,
        calldataFallback: config.contracts?.calldataFallback ?? '0x' as Address,
        l2OutputOracleAdapter: config.contracts?.l2OutputOracleAdapter ?? '0x' as Address,
      },
      sequencerKey: config.sequencerKey ?? '0x' as Hex,
      batchThreshold: config.batchThreshold ?? 128 * 1024, // 128KB
      batchTimeThreshold: config.batchTimeThreshold ?? 60000, // 1 minute
      namespace: config.namespace ?? keccak256(toBytes('default-rollup')) as Hex,
      enableCalldataFallback: config.enableCalldataFallback ?? true,
      maxDARetries: config.maxDARetries ?? 3,
    };
    
    this.daClient = createDAClient({
      gatewayEndpoint: config.daGateway,
      rpcUrl: config.l1RpcUrl,
      signerKey: config.sequencerKey,
    });
    
    this.sequencerAddress = config.sequencerKey 
      ? privateKeyToAccount(config.sequencerKey).address 
      : null;
    
    // Initialize L1 clients if RPC URL provided
    if (config.l1RpcUrl && config.sequencerKey) {
      this.l1Client = createPublicClient({
        transport: http(config.l1RpcUrl),
      });
      this.l1WalletClient = createWalletClient({
        account: privateKeyToAccount(config.sequencerKey),
        transport: http(config.l1RpcUrl),
      });
    }
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
   * Performs cryptographic verification of attestation signatures
   */
  async verifyDAReference(
    daRef: DAReference,
    registeredOperatorKeys?: Map<Address, BLSPublicKey>
  ): Promise<boolean> {
    // Verify blob is available
    const isAvailable = await this.daClient.isAvailable(daRef.blobId);
    if (!isAvailable) return false;
    
    // Verify quorum status
    if (!daRef.attestation.quorumReached) return false;
    
    // Verify attestation signatures cryptographically
    const attestation = daRef.attestation;
    
    // If aggregate signature is provided, verify it
    if (attestation.aggregateSignature && registeredOperatorKeys) {
      const publicKeys = attestation.signatures.map(sig => {
        const pk = registeredOperatorKeys.get(sig.operator);
        if (!pk) throw new Error(`Unknown operator: ${sig.operator}`);
        return pk;
      });
      
      // Verify the aggregate signature against the commitment
      const aggregateValid = verifyAggregate(
        publicKeys,
        toBytes(`DA_ATTEST:${attestation.blobId}:${attestation.commitment}:${attestation.timestamp}`),
        attestation.aggregateSignature as BLSSignature
      );
      
      if (!aggregateValid) return false;
    } else if (registeredOperatorKeys) {
      // Verify individual signatures
      for (const sig of attestation.signatures) {
        const pk = registeredOperatorKeys.get(sig.operator);
        if (!pk) {
          // Operator not registered
          return false;
        }
        
        const valid = verifyAttestation(
          pk,
          sig.signature as BLSSignature,
          attestation.blobId,
          attestation.commitment,
          sig.chunkIndices,
          attestation.timestamp
        );
        
        if (!valid) return false;
      }
    }
    // Note: If no operator keys provided, we can only check availability and quorum flag
    // For full security, on-chain verification should be used: verifyAttestationOnChain()
    
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
    failureCount: number;
    lastFailure: number | null;
  }> {
    const health = await this.daClient.healthCheck().catch(() => ({ status: 'error', operators: 0 }));
    
    return {
      healthy: health.status === 'healthy',
      operators: health.operators,
      pendingBatches: this.pendingBatches.length,
      pendingSize: this.pendingSize,
      failureCount: this.daFailureCount,
      lastFailure: this.lastDAFailure,
    };
  }

  // ============================================================================
  // DA Proof Generation
  // ============================================================================

  /**
   * Generate DA proof for L1 submission
   * Links output root to DA commitment
   */
  generateDAProof(
    daRef: DAReference,
    stateRoot: Hex,
    messagePasserRoot: Hex,
    blockHash: Hex,
    merkleProof: Hex[] = []
  ): Hex {
    // Encode proof: stateRoot(32) | messagePasserRoot(32) | blockHash(32) | merkleProof(...)
    const proofParts: Hex[] = [
      stateRoot,
      messagePasserRoot,
      blockHash,
    ];
    
    // Concatenate merkle proof elements
    for (const proofElement of merkleProof) {
      proofParts.push(proofElement);
    }
    
    // Combine all parts
    const combined = proofParts.map(p => p.slice(2)).join('');
    return `0x${combined}` as Hex;
  }

  /**
   * Submit batch with DA commitment to L1
   */
  async submitToL1WithDA(
    batch: BatchData,
    outputRoot: Hex,
    daProof: DAProof
  ): Promise<L1SubmissionResult> {
    if (!this.l1WalletClient || !this.l1Client) {
      throw new Error('L1 clients not initialized');
    }

    let usedCalldataFallback = false;
    let daCommitment: Hex;
    let retryCount = 0;

    // Try DA submission with retries
    while (retryCount < this.config.maxDARetries) {
      const result = await this.submitBatch(batch).catch((error: Error) => {
        console.error(`DA submission attempt ${retryCount + 1} failed:`, error.message);
        this.daFailureCount++;
        this.lastDAFailure = Date.now();
        return null;
      });

      if (result) {
        daCommitment = result.daRef.blobId;
        break;
      }

      retryCount++;
      
      // Wait before retry
      if (retryCount < this.config.maxDARetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    // Fallback to calldata if DA failed
    if (!daCommitment!) {
      if (!this.config.enableCalldataFallback) {
        throw new Error('DA submission failed and calldata fallback is disabled');
      }

      console.warn('DA submission failed, using calldata fallback');
      usedCalldataFallback = true;

      // Post to calldata fallback contract
      const encodedBatch = this.encodeBatch(batch);
      daCommitment = await this.postToCalldataFallback(encodedBatch);
    }

    // Generate proof bytes
    const proofBytes = this.generateDAProof(
      { blobId: daCommitment, commitment: {} as BlobCommitment, attestation: {} as AvailabilityAttestation, submittedAt: Date.now() },
      daProof.stateRoot,
      daProof.messagePasserRoot,
      daProof.blockHash,
      daProof.merkleProof
    );

    // Submit to L2OutputOracleAdapter
    const txHash = await this.submitOutputToL1(
      outputRoot,
      batch.l2BlockRange.end,
      daCommitment,
      proofBytes,
      usedCalldataFallback
    );

    return {
      txHash,
      outputRoot,
      daCommitment,
      usedCalldataFallback,
      submittedAt: Date.now(),
    };
  }

  /**
   * Post data to calldata fallback contract
   */
  private async postToCalldataFallback(data: Uint8Array): Promise<Hex> {
    if (!this.l1WalletClient || !this.l1Client) {
      throw new Error('L1 clients not initialized');
    }

    const calldataFallbackAddress = this.config.contracts.calldataFallback;
    if (calldataFallbackAddress === '0x') {
      throw new Error('Calldata fallback contract not configured');
    }

    const txHash = await this.l1WalletClient.writeContract({
      address: calldataFallbackAddress,
      abi: CalldataFallbackABI,
      functionName: 'postCalldata',
      args: [toHex(data)],
      chain: null,
    });

    // Wait for transaction and get blob ID from logs
    const receipt = await this.l1Client.waitForTransactionReceipt({ hash: txHash });
    
    // Extract blobId from CalldataPosted event
    const calldataPostedTopic = keccak256(toBytes('CalldataPosted(bytes32,address,uint256,bytes32)'));
    const log = receipt.logs.find(l => l.topics[0] === calldataPostedTopic);
    
    if (!log || !log.topics[1]) {
      throw new Error('Failed to extract blobId from CalldataPosted event');
    }

    return log.topics[1] as Hex;
  }

  /**
   * Submit output with DA commitment to L1
   */
  private async submitOutputToL1(
    outputRoot: Hex,
    l2BlockNumber: bigint,
    daCommitment: Hex,
    daProof: Hex,
    _isCalldataFallback: boolean
  ): Promise<Hex> {
    if (!this.l1WalletClient) {
      throw new Error('L1 wallet client not initialized');
    }

    const l2OutputOracleAdapter = this.config.contracts.l2OutputOracleAdapter;
    if (l2OutputOracleAdapter === '0x') {
      throw new Error('L2OutputOracleAdapter not configured');
    }

    // Call proposeOutput on L2OutputOracleAdapter
    const txHash = await this.l1WalletClient.writeContract({
      address: l2OutputOracleAdapter,
      abi: [
        {
          name: 'proposeOutput',
          type: 'function',
          inputs: [
            { name: '_outputRoot', type: 'bytes32' },
            { name: '_l2BlockNumber', type: 'uint256' },
            { name: '_daCommitment', type: 'bytes32' },
            { name: '_daProof', type: 'bytes' }
          ],
          outputs: [],
          stateMutability: 'nonpayable'
        }
      ],
      functionName: 'proposeOutput',
      args: [outputRoot, l2BlockNumber, daCommitment, daProof],
      chain: null,
    });

    return txHash;
  }

  /**
   * Verify DA commitment on L1
   */
  async verifyDACommitmentOnL1(
    outputRoot: Hex,
    daCommitment: {
      blobId: Hex;
      commitment: Hex;
      merkleRoot: Hex;
      submittedAt: bigint;
      isCalldata: boolean;
    },
    proof: Hex
  ): Promise<boolean> {
    if (!this.l1Client) {
      throw new Error('L1 client not initialized');
    }

    const verifierAddress = this.config.contracts.daCommitmentVerifier;
    if (verifierAddress === '0x') {
      throw new Error('DA commitment verifier not configured');
    }

    const result = await this.l1Client.readContract({
      address: verifierAddress,
      abi: DACommitmentVerifierABI,
      functionName: 'verifyCommitment',
      args: [outputRoot, daCommitment, proof],
    });

    return result;
  }

  /**
   * Check if DA layer is healthy
   */
  async isDAHealthy(): Promise<boolean> {
    const status = await this.getDAStatus();
    return status.healthy && status.operators > 0;
  }

  /**
   * Reset failure tracking (call after successful recovery)
   */
  resetFailureTracking(): void {
    this.daFailureCount = 0;
    this.lastDAFailure = null;
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

