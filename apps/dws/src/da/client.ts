/**
 * DA Client SDK
 * 
 * Client library for rollups and applications:
 * - Submit blobs
 * - Verify availability
 * - Retrieve data
 * - On-chain verification
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { createPublicClient, createWalletClient, http, toBytes, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  Blob,
  BlobCommitment,
  BlobSubmissionResult,
  BlobRetrievalResult,
  SampleVerificationResult,
  AvailabilityAttestation,
  DAConfig,
} from './types';
import { computeBlobId } from './commitment';

// ============================================================================
// Client Configuration
// ============================================================================

export interface DAClientConfig {
  /** DA gateway endpoint */
  gatewayEndpoint: string;
  /** RPC URL for on-chain verification */
  rpcUrl?: string;
  /** Private key for signing (optional) */
  signerKey?: Hex;
  /** Request timeout (ms) */
  timeoutMs?: number;
  /** Retry attempts */
  retries?: number;
}

// ============================================================================
// DA Client
// ============================================================================

export class DAClient {
  private readonly config: DAClientConfig;
  private readonly signerAddress: Address | null;
  private publicClient: PublicClient | null = null;

  constructor(config: DAClientConfig) {
    this.config = {
      timeoutMs: 30000,
      retries: 3,
      ...config,
    };
    
    if (config.signerKey) {
      const account = privateKeyToAccount(config.signerKey);
      this.signerAddress = account.address;
    } else {
      this.signerAddress = null;
    }
    
    if (config.rpcUrl) {
      this.publicClient = createPublicClient({
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Submit a blob to the DA layer
   */
  async submitBlob(
    data: Uint8Array,
    options?: {
      namespace?: Hex;
      quorumPercent?: number;
      retentionPeriod?: number;
      submitter?: Address;
    }
  ): Promise<BlobSubmissionResult> {
    const submitter = options?.submitter ?? this.signerAddress;
    if (!submitter) {
      throw new Error('Submitter address required');
    }
    
    const response = await this.fetch('/da/blob', {
      method: 'POST',
      body: JSON.stringify({
        data: toHex(data),
        submitter,
        namespace: options?.namespace,
        quorumPercent: options?.quorumPercent,
        retentionPeriod: options?.retentionPeriod,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json() as { error: string };
      throw new Error(`Blob submission failed: ${error.error}`);
    }
    
    return response.json() as Promise<BlobSubmissionResult>;
  }

  /**
   * Submit blob from string
   */
  async submitString(
    content: string,
    options?: {
      namespace?: Hex;
      quorumPercent?: number;
      retentionPeriod?: number;
      submitter?: Address;
    }
  ): Promise<BlobSubmissionResult> {
    const data = new TextEncoder().encode(content);
    return this.submitBlob(data, options);
  }

  /**
   * Submit blob from JSON
   */
  async submitJSON(
    obj: Record<string, unknown>,
    options?: {
      namespace?: Hex;
      quorumPercent?: number;
      retentionPeriod?: number;
      submitter?: Address;
    }
  ): Promise<BlobSubmissionResult> {
    const json = JSON.stringify(obj);
    return this.submitString(json, options);
  }

  /**
   * Get blob status
   */
  async getBlobStatus(blobId: Hex): Promise<{
    id: Hex;
    status: string;
    size: number;
    commitment: BlobCommitment;
    submitter: Address;
    submittedAt: number;
    confirmedAt?: number;
    expiresAt: number;
  }> {
    const response = await this.fetch(`/da/blob/${blobId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Blob not found: ${blobId}`);
      }
      throw new Error('Failed to get blob status');
    }
    
    return response.json();
  }

  /**
   * Retrieve blob data
   */
  async retrieveBlob(blobId: Hex): Promise<Uint8Array> {
    const response = await this.fetch(`/da/blob/${blobId}/data`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Blob not found: ${blobId}`);
      }
      throw new Error('Failed to retrieve blob');
    }
    
    const result = await response.json() as {
      data: Hex;
      verified: boolean;
    };
    
    if (!result.verified) {
      throw new Error('Blob verification failed');
    }
    
    return toBytes(result.data);
  }

  /**
   * Retrieve blob as string
   */
  async retrieveString(blobId: Hex): Promise<string> {
    const data = await this.retrieveBlob(blobId);
    return new TextDecoder().decode(data);
  }

  /**
   * Retrieve blob as JSON
   */
  async retrieveJSON<T = Record<string, unknown>>(blobId: Hex): Promise<T> {
    const str = await this.retrieveString(blobId);
    return JSON.parse(str) as T;
  }

  /**
   * Verify blob availability via sampling
   */
  async verifyAvailability(
    blobId: Hex,
    requester?: Address
  ): Promise<SampleVerificationResult> {
    const address = requester ?? this.signerAddress;
    if (!address) {
      throw new Error('Requester address required');
    }
    
    const response = await this.fetch('/da/sample', {
      method: 'POST',
      body: JSON.stringify({
        blobId,
        requester: address,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Sampling request failed');
    }
    
    return response.json() as Promise<SampleVerificationResult>;
  }

  /**
   * Check if blob is available
   */
  async isAvailable(blobId: Hex): Promise<boolean> {
    const status = await this.getBlobStatus(blobId).catch(() => null);
    
    if (!status) return false;
    if (status.status !== 'available') return false;
    if (status.expiresAt < Date.now()) return false;
    
    return true;
  }

  /**
   * Wait for blob to become available
   */
  async waitForAvailability(
    blobId: Hex,
    timeoutMs = 60000,
    pollIntervalMs = 1000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const available = await this.isAvailable(blobId);
      if (available) return true;
      
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    
    return false;
  }

  /**
   * Get DA layer stats
   */
  async getStats(): Promise<{
    blobs: {
      totalBlobs: number;
      totalChunks: number;
      byStatus: Record<string, number>;
      totalSize: number;
    };
    operators: {
      active: number;
      totalCapacityGB: number;
      usedCapacityGB: number;
    };
  }> {
    const response = await this.fetch('/da/stats');
    
    if (!response.ok) {
      throw new Error('Failed to get stats');
    }
    
    return response.json();
  }

  /**
   * Get active operators
   */
  async getOperators(): Promise<Array<{
    address: Address;
    endpoint: string;
    region: string;
    status: string;
    capacityGB: number;
    usedGB: number;
  }>> {
    const response = await this.fetch('/da/operators');
    
    if (!response.ok) {
      throw new Error('Failed to get operators');
    }
    
    const result = await response.json() as { operators: Array<{
      address: Address;
      endpoint: string;
      region: string;
      status: string;
      capacityGB: number;
      usedGB: number;
    }> };
    return result.operators;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: string;
    operators: number;
    timestamp: number;
  }> {
    const response = await this.fetch('/da/health');
    
    if (!response.ok) {
      throw new Error('Health check failed');
    }
    
    return response.json();
  }

  /**
   * Compute blob ID locally
   */
  computeBlobId(data: Uint8Array): Hex {
    return computeBlobId(data);
  }

  // ============================================================================
  // On-Chain Verification
  // ============================================================================

  /**
   * Verify commitment on-chain
   */
  async verifyCommitmentOnChain(
    blobId: Hex,
    commitment: BlobCommitment,
    _contractAddress: Address
  ): Promise<boolean> {
    if (!this.publicClient) {
      throw new Error('RPC URL required for on-chain verification');
    }
    
    // Read from on-chain blob registry
    // This would call the DABlobRegistry contract
    // For now, return true as placeholder
    return true;
  }

  /**
   * Verify attestation on-chain
   */
  async verifyAttestationOnChain(
    attestation: AvailabilityAttestation,
    _contractAddress: Address
  ): Promise<boolean> {
    if (!this.publicClient) {
      throw new Error('RPC URL required for on-chain verification');
    }
    
    // Verify attestation signatures against on-chain operator registry
    // This would call the DAAttestationManager contract
    // For now, return attestation.quorumReached as placeholder
    return attestation.quorumReached;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async fetch(
    path: string,
    options?: RequestInit
  ): Promise<Response> {
    const url = `${this.config.gatewayEndpoint}${path}`;
    const timeout = this.config.timeoutMs ?? 30000;
    const retries = this.config.retries ?? 3;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        signal: controller.signal,
      }).catch((err: Error) => {
        clearTimeout(timeoutId);
        if (attempt === retries - 1) {
          throw err;
        }
        return null;
      });
      
      clearTimeout(timeoutId);
      
      if (response) {
        return response;
      }
      
      // Wait before retry
      await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
    }
    
    throw new Error(`Request failed after ${retries} attempts`);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDAClient(config: DAClientConfig): DAClient {
  return new DAClient(config);
}

/**
 * Create client with common defaults
 */
export function createDefaultDAClient(gatewayEndpoint: string): DAClient {
  return new DAClient({
    gatewayEndpoint,
    timeoutMs: 30000,
    retries: 3,
  });
}

