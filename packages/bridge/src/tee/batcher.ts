/**
 * TEE Batching - aggregates transfers for efficient ZK proving
 */

import type {
  CrossChainTransfer,
  Hash32,
  ProofBatch,
  SP1Proof,
  TEEAttestation,
  TEEBatchingConfig,
  TEECacheEntry,
} from '../types/index.js';
import { toHash32 } from '../types/index.js';
import { createLogger, hashToHex } from '../utils/index.js';

const log = createLogger('tee-batcher');

interface BatchState {
  id: Hash32;
  transfers: TEECacheEntry[];
  createdAt: bigint;
  estimatedTotalCost: bigint;
  status: 'accumulating' | 'ready' | 'proving' | 'proven';
}

export class TEEBatcher {
  private config: TEEBatchingConfig;
  private pendingBatches: Map<string, BatchState> = new Map();
  private currentBatch: BatchState | null = null;
  private attestation: TEEAttestation | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TEEBatchingConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.attestation = await this.generateAttestation();
    log.info('Batcher initialized with attestation');
  }

  async addTransfer(transfer: CrossChainTransfer): Promise<{
    batchId: string;
    position: number;
    estimatedCost: bigint;
  }> {
    // Validate transfer
    this.validateTransfer(transfer);

    // Estimate cost contribution
    const estimatedCost = this.estimateCostContribution(transfer);

    // Create cache entry
    const entry: TEECacheEntry = {
      transfer,
      partialState: await this.computePartialState(transfer),
      estimatedCost,
      priority: this.computePriority(transfer),
      expiresAt: BigInt(Date.now()) + BigInt(60000), // 1 minute TTL
    };

    // Get or create current batch
    if (!this.currentBatch) {
      this.currentBatch = this.createNewBatch();
      this.startBatchTimer();
    }

    // Add to batch
    const position = this.currentBatch.transfers.length;
    this.currentBatch.transfers.push(entry);
    this.currentBatch.estimatedTotalCost += estimatedCost;

    // Save batch info before potential finalization
    const batchId = hashToHex(this.currentBatch.id);

    // Check if batch is ready
    if (this.currentBatch.transfers.length >= this.config.maxBatchSize) {
      await this.finalizeBatch();
    }

    return {
      batchId,
      position,
      estimatedCost,
    };
  }

  getBatchStatus(batchId: string): BatchState | null {
    if (
      this.currentBatch &&
      hashToHex(this.currentBatch.id) === batchId
    ) {
      return this.currentBatch;
    }
    return this.pendingBatches.get(batchId) ?? null;
  }

  getNextBatchForProving(): BatchState | null {
    for (const [, batch] of this.pendingBatches) {
      if (batch.status === 'ready') {
        batch.status = 'proving';
        return batch;
      }
    }
    return null;
  }

  markBatchProven(batchId: string, proof: SP1Proof): ProofBatch {
    const batch = this.pendingBatches.get(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    batch.status = 'proven';

    const proofBatch: ProofBatch = {
      batchId: batch.id,
      items: batch.transfers.map((e) => e.transfer),
      aggregatedProof: proof,
      teeAttestation: this.attestation,
      totalFees: batch.transfers.reduce(
        (sum, e) => sum + e.estimatedCost,
        BigInt(0),
      ),
      proofCost: batch.estimatedTotalCost,
      createdAt: batch.createdAt,
      provenAt: BigInt(Date.now()),
    };

    // Remove from pending
    this.pendingBatches.delete(batchId);

    return proofBatch;
  }

  getAttestation(): TEEAttestation | null {
    return this.attestation;
  }

  private createNewBatch(): BatchState {
    const id = this.generateBatchId();
    return {
      id,
      transfers: [],
      createdAt: BigInt(Date.now()),
      estimatedTotalCost: BigInt(0),
      status: 'accumulating',
    };
  }

  private generateBatchId(): Hash32 {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toHash32(bytes);
  }

  private startBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(async () => {
      if (
        this.currentBatch &&
        this.currentBatch.transfers.length >= this.config.minBatchSize
      ) {
        await this.finalizeBatch();
      }
    }, this.config.maxBatchWaitMs);
  }

  private async finalizeBatch(): Promise<void> {
    if (!this.currentBatch) return;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Sort by priority
    this.currentBatch.transfers.sort((a, b) => b.priority - a.priority);

    // Mark as ready
    this.currentBatch.status = 'ready';

    // Move to pending
    const batchId = hashToHex(this.currentBatch.id);
    this.pendingBatches.set(batchId, this.currentBatch);

    log.info('Batch ready', { batchId: batchId.slice(0, 8), transferCount: this.currentBatch.transfers.length });

    // Clear current
    this.currentBatch = null;
  }

  private validateTransfer(transfer: CrossChainTransfer): void {
    if (transfer.amount <= BigInt(0)) {
      throw new Error('Transfer amount must be positive');
    }
    if (transfer.sender.length === 0) {
      throw new Error('Sender address required');
    }
    if (transfer.recipient.length === 0) {
      throw new Error('Recipient address required');
    }
  }

  private estimateCostContribution(transfer: CrossChainTransfer): bigint {
    // Base cost per transfer
    let cost = this.config.targetCostPerItem;

    // Add cost for payload
    if (transfer.payload.length > 0) {
      cost += BigInt(transfer.payload.length) * BigInt(100); // 100 wei per byte
    }

    return cost;
  }

  private computePriority(transfer: CrossChainTransfer): number {
    // Higher amount = higher priority
    const amountScore = Number(transfer.amount / BigInt(10 ** 18));

    // Older transfers = higher priority
    const ageScore = (Date.now() - Number(transfer.timestamp)) / 1000;

    return amountScore + ageScore;
  }

  private async computePartialState(
    transfer: CrossChainTransfer,
  ): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = JSON.stringify({
      transferId: Array.from(transfer.transferId),
      amount: transfer.amount.toString(),
      sender: Array.from(transfer.sender),
      recipient: Array.from(transfer.recipient),
    });
    return encoder.encode(data);
  }

  private async generateAttestation(): Promise<TEEAttestation> {
    // Check environment mode
    const isProduction = process.env.NODE_ENV === 'production';
    const requireRealTEE = process.env.REQUIRE_REAL_TEE === 'true';
    
    // Check if Phala is available
    const phalaEndpoint = process.env.PHALA_ENDPOINT;

    if (phalaEndpoint) {
      // Use real Phala TEE attestation
      const { createPhalaClient } = await import('./phala-client.js');
      const phalaClient = createPhalaClient({ endpoint: phalaEndpoint });
      await phalaClient.initialize();

      const attestation = await phalaClient.requestAttestation({
        data: `0x${'00'.repeat(32)}` as `0x${string}`,
        operatorAddress: `0x${'00'.repeat(20)}` as `0x${string}`,
      });

      return phalaClient.toTEEAttestation(attestation);
    }

    // Production mode without TEE configured is a critical error
    if (isProduction || requireRealTEE) {
      throw new Error(
        '[TEE] CRITICAL: Production requires real TEE attestation. ' +
        'Configure PHALA_ENDPOINT, AWS_ENCLAVE_ID, or run in a GCP Confidential VM. ' +
        'Mock attestations are only allowed in development mode (NODE_ENV !== production).'
      );
    }

    // Development-only mock attestation
    log.warn('Using mock attestation - DEVELOPMENT ONLY');
    
    const measurement = new Uint8Array(32);
    crypto.getRandomValues(measurement);

    const publicKey = new Uint8Array(33);
    crypto.getRandomValues(publicKey);
    publicKey[0] = 0x02; // Compressed public key prefix

    const quote = new Uint8Array(256);
    crypto.getRandomValues(quote);

    return {
      measurement: toHash32(measurement),
      quote,
      publicKey,
      timestamp: BigInt(Date.now()),
    };
  }
}

export function createTEEBatcher(config: TEEBatchingConfig): TEEBatcher {
  return new TEEBatcher(config);
}
