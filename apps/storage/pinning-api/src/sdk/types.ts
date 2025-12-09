/**
 * SDK Types for Jeju Storage Marketplace
 * 
 * Decentralized storage marketplace with:
 * - Multiple storage providers (IPFS nodes, cloud, Arweave)
 * - Automatic best provider selection
 * - x402 micropayments
 * - ERC-4337 multi-token payments
 */

import type { Wallet } from 'ethers';
import type { Address } from 'viem';

// ============================================================================
// SDK Configuration
// ============================================================================

export interface StorageSDKConfig {
  rpcUrl: string;
  signer?: Wallet;
  contracts: {
    registry: string;         // StorageProviderRegistry
    ledger: string;           // StorageLedgerManager
    market: string;           // StorageMarket (deals/rentals)
    creditManager?: string;   // CreditManager for prepaid balances
    paymasterFactory?: string; // PaymasterFactory for gas sponsorship
    tokenRegistry?: string;   // TokenRegistry for supported tokens
    entryPoint?: string;      // ERC-4337 EntryPoint address
  };
}

// ============================================================================
// Provider Types
// ============================================================================

export const StorageProviderTypeEnum = {
  IPFS_NODE: 0,        // Self-hosted IPFS node
  FILECOIN: 1,         // Filecoin storage deal
  ARWEAVE: 2,          // Permanent Arweave storage
  CLOUD_S3: 3,         // S3-compatible cloud storage
  CLOUD_VERCEL: 4,     // Vercel Blob storage
  CLOUD_R2: 5,         // Cloudflare R2
  HYBRID: 6,           // Multi-backend provider
} as const;

export type StorageProviderType = typeof StorageProviderTypeEnum[keyof typeof StorageProviderTypeEnum];

export const StorageTierEnum = {
  HOT: 0,              // Fast access, higher cost
  WARM: 1,             // Balanced access and cost
  COLD: 2,             // Slow access, archival pricing
  PERMANENT: 3,        // Permanent storage (Arweave)
} as const;

export type StorageTier = typeof StorageTierEnum[keyof typeof StorageTierEnum];

export const StorageDealStatusEnum = {
  PENDING: 0,          // Deal created, awaiting payment
  ACTIVE: 1,           // Deal active, data stored
  EXPIRED: 2,          // Deal expired
  TERMINATED: 3,       // Early termination
  FAILED: 4,           // Storage failure
  DISPUTED: 5,         // Under dispute
} as const;

export type StorageDealStatus = typeof StorageDealStatusEnum[keyof typeof StorageDealStatusEnum];

// ============================================================================
// Provider Registration
// ============================================================================

export interface StorageProvider {
  address: string;
  name: string;
  endpoint: string;
  providerType: StorageProviderType;
  stake: bigint;
  registeredAt: number;
  agentId: number;     // ERC-8004 agent ID (0 if not linked)
  active: boolean;
  verified: boolean;   // TEE attestation verified
}

export interface StorageCapacity {
  totalCapacityGB: number;
  usedCapacityGB: number;
  availableCapacityGB: number;
  reservedCapacityGB: number;
}

export interface StoragePricing {
  pricePerGBMonth: bigint;         // Base price per GB per month
  minStoragePeriodDays: number;
  maxStoragePeriodDays: number;
  retrievalPricePerGB: bigint;     // Price per GB retrieved
  uploadPricePerGB: bigint;        // Price per GB uploaded
}

export interface StorageProviderInfo {
  provider: StorageProvider;
  capacity: StorageCapacity;
  pricing: StoragePricing;
  supportedTiers: StorageTier[];
  replicationFactor: number;
  ipfsGateway?: string;
  healthScore: number;     // 0-100
  avgLatencyMs: number;
}

// ============================================================================
// Storage Deals
// ============================================================================

export interface StorageDeal {
  dealId: string;
  user: string;
  provider: string;
  status: StorageDealStatus;
  cid: string;
  sizeBytes: bigint;
  tier: StorageTier;
  startTime: number;
  endTime: number;
  totalCost: bigint;
  paidAmount: bigint;
  refundedAmount: bigint;
  replicationFactor: number;
  retrievalCount: number;
}

export interface CreateStorageDealParams {
  provider: string;
  cid?: string;              // Existing CID to pin
  sizeBytes: bigint;
  durationDays: number;
  tier?: StorageTier;
  replicationFactor?: number;
  metadata?: Record<string, string>;
}

export interface UploadParams {
  content: Buffer | Blob | File;
  filename: string;
  durationDays?: number;
  tier?: StorageTier;
  providers?: string[];      // Preferred providers (empty = auto-select)
  replicationFactor?: number;
  metadata?: Record<string, string>;
  pinToIPFS?: boolean;
  permanent?: boolean;       // Arweave permanent storage
}

export interface UploadResult {
  dealId: string;
  cid: string;
  url: string;
  ipfsGatewayUrl?: string;
  arweaveUrl?: string;
  size: number;
  provider: string;
  cost: bigint;
  tier: StorageTier;
  expiresAt?: Date;
  permanent: boolean;
}

// ============================================================================
// Retrieval Types
// ============================================================================

export interface RetrievalRequest {
  cid: string;
  preferredProvider?: string;
  priority?: 'fast' | 'cheap';
}

export interface RetrievalResult {
  cid: string;
  content: Buffer;
  provider: string;
  cost: bigint;
  latencyMs: number;
  fromCache: boolean;
}

// ============================================================================
// Reputation Types
// ============================================================================

export interface ProviderRecord {
  totalDeals: number;
  activeDeals: number;
  completedDeals: number;
  failedDeals: number;
  totalStoredGB: number;
  totalEarnings: bigint;
  avgRating: number;       // 0-100
  ratingCount: number;
  uptimePercent: number;
  banned: boolean;
}

export interface UserRecord {
  totalDeals: number;
  activeDeals: number;
  completedDeals: number;
  disputedDeals: number;
  totalStoredGB: number;
  totalSpent: bigint;
  banned: boolean;
}

export interface StorageRating {
  dealId: string;
  score: number;           // 0-100
  comment: string;
  ratedAt: number;
  uploadSpeed?: number;    // MB/s
  downloadSpeed?: number;  // MB/s
  reliability?: number;    // 0-100
}

// ============================================================================
// Dispute Types
// ============================================================================

export const StorageDisputeReasonEnum = {
  NONE: 0,
  DATA_UNAVAILABLE: 1,     // Data cannot be retrieved
  DATA_CORRUPTED: 2,       // Data integrity check failed
  SLOW_RETRIEVAL: 3,       // Retrieval too slow
  EARLY_TERMINATION: 4,    // Provider terminated early
  PRICE_DISPUTE: 5,        // Payment/billing dispute
} as const;

export type StorageDisputeReason = typeof StorageDisputeReasonEnum[keyof typeof StorageDisputeReasonEnum];

export interface StorageDispute {
  disputeId: string;
  dealId: string;
  initiator: string;
  defendant: string;
  reason: StorageDisputeReason;
  evidenceUri: string;
  createdAt: number;
  resolvedAt: number;
  resolved: boolean;
  inFavorOfInitiator: boolean;
  slashAmount: bigint;
}

// ============================================================================
// Router Types
// ============================================================================

export interface StorageRouterOptions {
  tier?: StorageTier;
  maxCostPerGBMonth?: bigint;
  minUptimePercent?: number;
  minHealthScore?: number;
  preferredProviders?: string[];
  excludeProviders?: string[];
  replicationFactor?: number;
  permanentStorage?: boolean;
}

export interface ProviderScore {
  provider: string;
  score: number;           // 0-100 composite score
  priceScore: number;
  uptimeScore: number;
  latencyScore: number;
  capacityScore: number;
}

// ============================================================================
// Ledger Types
// ============================================================================

export interface StorageLedger {
  totalBalance: bigint;
  availableBalance: bigint;
  lockedBalance: bigint;
  createdAt: number;
}

export interface ProviderSubAccount {
  balance: bigint;
  pendingRefund: bigint;
  refundUnlockTime: number;
  acknowledged: boolean;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthHeaders {
  'x-jeju-address': string;
  'x-jeju-nonce': string;
  'x-jeju-signature': string;
  'x-jeju-timestamp': string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface StorageStats {
  totalProviders: number;
  activeProviders: number;
  totalCapacityTB: number;
  usedCapacityTB: number;
  totalDeals: number;
  activeDeals: number;
  totalVolumePaid: bigint;
  avgPricePerGBMonth: bigint;
}

export interface PinStatus {
  requestId: string;
  cid: string;
  name: string;
  status: 'pinning' | 'pinned' | 'failed' | 'queued';
  created: string;
  delegates?: string[];
  info?: {
    sizeBytes: number;
    providers: string[];
  };
}

export interface StorageQuote {
  provider: string;
  sizeBytes: bigint;
  durationDays: number;
  tier: StorageTier;
  cost: bigint;
  costBreakdown: {
    storage: bigint;
    bandwidth: bigint;
    retrieval: bigint;
  };
  expiresAt: Date;
}

