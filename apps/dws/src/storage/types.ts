/**
 * Storage Types - Multi-backend decentralized storage
 */

import type { Address } from 'viem';

// ============================================================================
// Backend Types
// ============================================================================

export type StorageBackendType = 
  | 'local' 
  | 'ipfs' 
  | 'arweave' 
  | 'filecoin' 
  | 'webtorrent'
  | 'http';

export type ContentTier = 
  | 'system'    // Free, all nodes must seed (core apps, ABIs, JNS)
  | 'popular'   // Incentivized, nodes earn for serving hot content
  | 'private';  // Paid, encrypted, access-controlled

export type ContentCategory =
  | 'app-bundle'     // Compiled frontend apps
  | 'app-manifest'   // jeju-manifest.json files
  | 'contract-abi'   // Contract ABIs
  | 'jns-record'     // JNS resolution data
  | 'documentation'  // Docs and guides
  | 'user-content'   // User-uploaded content
  | 'media'          // Images, videos, audio
  | 'data';          // JSON, configs, etc.

// ============================================================================
// Content Addressing
// ============================================================================

export interface ContentAddress {
  cid: string;                    // Primary content identifier (IPFS CID or hash)
  backends: StorageBackendType[]; // Where content is stored
  magnetUri?: string;             // WebTorrent magnet link
  arweaveTxId?: string;           // Arweave transaction ID
  filecoinDealId?: string;        // Filecoin deal ID
  httpUrls?: string[];            // HTTP fallback URLs
}

export interface ContentMetadata {
  cid: string;
  size: number;
  contentType: string;
  tier: ContentTier;
  category: ContentCategory;
  name?: string;
  description?: string;
  createdAt: number;
  updatedAt?: number;
  owner?: Address;
  
  // Content addressing
  sha256: string;
  addresses: ContentAddress;
  
  // Access control
  encrypted?: boolean;
  encryptionKeyId?: string;
  accessPolicy?: string;         // KMS policy ID
  
  // Stats
  accessCount: number;
  lastAccessed?: number;
  seederCount?: number;
  regionalStats?: Record<string, RegionalContentStats>;
}

export interface RegionalContentStats {
  region: string;
  accessCount: number;
  seederCount: number;
  avgLatencyMs: number;
  lastAccessed: number;
}

// ============================================================================
// Backend Configuration
// ============================================================================

export interface StorageBackendConfig {
  type: StorageBackendType;
  enabled: boolean;
  priority: number;              // Lower = higher priority for reads
  
  // IPFS
  ipfsApiUrl?: string;
  ipfsGatewayUrl?: string;
  
  // Arweave
  arweaveGateway?: string;
  arweaveWalletPath?: string;
  
  // Filecoin
  filecoinApiUrl?: string;
  filecoinToken?: string;
  
  // WebTorrent
  webtorrentTrackers?: string[];
  webtorrentDhtEnabled?: boolean;
  maxSeedRatioSystem?: number;   // Unlimited for system content
  maxSeedRatioPopular?: number;
  bandwidthLimitMbps?: number;
  
  // HTTP
  httpOrigins?: string[];
}

export interface MultiBackendConfig {
  backends: StorageBackendConfig[];
  defaultTier: ContentTier;
  replicationFactor: number;     // Min backends for redundancy
  
  // Content tier settings
  systemContentBackends: StorageBackendType[];
  popularContentBackends: StorageBackendType[];
  privateContentBackends: StorageBackendType[];
  
  // KMS integration
  kmsEndpoint?: string;
  defaultEncryptionPolicy?: string;
}

// ============================================================================
// Upload/Download
// ============================================================================

export interface UploadOptions {
  filename?: string;
  contentType?: string;
  tier?: ContentTier;
  category?: ContentCategory;
  
  // Backend selection
  preferredBackends?: StorageBackendType[];
  replicationFactor?: number;
  
  // Encryption (for private content)
  encrypt?: boolean;
  encryptionKeyId?: string;
  accessPolicy?: string;
  
  // Arweave-specific
  permanent?: boolean;           // User-selected Arweave storage
  arweaveTags?: Record<string, string>;
  
  // WebTorrent-specific
  createMagnet?: boolean;
  initialSeeders?: string[];     // Node endpoints to notify
}

export interface UploadResult {
  cid: string;
  size: number;
  addresses: ContentAddress;
  tier: ContentTier;
  backends: StorageBackendType[];
  magnetUri?: string;
  arweaveTxId?: string;
  encrypted?: boolean;
  encryptionKeyId?: string;
}

export interface DownloadOptions {
  preferredBackends?: StorageBackendType[];
  timeout?: number;
  decryptionKeyId?: string;
  region?: string;               // For regional routing
}

export interface DownloadResult {
  content: Buffer;
  metadata: ContentMetadata;
  backend: StorageBackendType;
  latencyMs: number;
  fromCache: boolean;
}

// ============================================================================
// System Content Manifest
// ============================================================================

export interface SystemContentManifest {
  version: string;
  generatedAt: number;
  
  // Core app bundles
  apps: SystemAppEntry[];
  
  // Contract ABIs
  abis: SystemABIEntry[];
  
  // JNS records
  jnsRecords: SystemJNSEntry[];
  
  // Total stats
  totalSize: number;
  totalItems: number;
  
  // Manifest CID (self-referential after upload)
  manifestCid?: string;
}

export interface SystemAppEntry {
  name: string;
  displayName: string;
  version: string;
  cid: string;
  size: number;
  buildDir: string;
  jnsName?: string;
  dependencies: string[];
}

export interface SystemABIEntry {
  contractName: string;
  version: string;
  cid: string;
  size: number;
  networks: Record<string, Address>;
}

export interface SystemJNSEntry {
  name: string;
  contentCid: string;
  resolver: Address;
  owner: Address;
  ttl: number;
}

// ============================================================================
// Popularity Tracking
// ============================================================================

export interface PopularityScore {
  cid: string;
  score: number;                 // Composite score
  
  // Factors
  accessCount24h: number;
  accessCount7d: number;
  accessCount30d: number;
  uniqueRegions: number;
  seederCount: number;
  
  // Computed
  recencyWeight: number;
  regionalWeight: number;
  replicationPriority: number;   // score / seederCount
  
  lastCalculated: number;
}

export interface RegionalPopularity {
  region: string;
  topContent: Array<{
    cid: string;
    score: number;
    seederCount: number;
  }>;
  underseeded: Array<{
    cid: string;
    score: number;
    seederCount: number;
    targetSeeders: number;
  }>;
}

// ============================================================================
// Node Stats
// ============================================================================

export interface NodeStorageStats {
  nodeId: string;
  region: string;
  
  // Capacity
  totalCapacityGB: number;
  usedCapacityGB: number;
  availableCapacityGB: number;
  
  // Bandwidth
  bandwidthLimitMbps: number;
  currentBandwidthMbps: number;
  bytesServed24h: number;
  bytesServed7d: number;
  
  // Content
  systemContentCount: number;
  systemContentSize: number;
  popularContentCount: number;
  popularContentSize: number;
  privateContentCount: number;
  privateContentSize: number;
  
  // WebTorrent
  activeTorrents: number;
  seedingTorrents: number;
  downloadingTorrents: number;
  peersConnected: number;
  
  // Earnings (for popular/private content)
  pendingEarnings: bigint;
  totalEarnings: bigint;
  
  lastUpdated: number;
}

export interface NodeContentList {
  nodeId: string;
  systemContent: string[];       // CIDs of system content
  popularContent: string[];      // CIDs of popular content
  privateContent: string[];      // CIDs of private content (encrypted)
}

// ============================================================================
// Events
// ============================================================================

export interface ContentUploadedEvent {
  cid: string;
  tier: ContentTier;
  category: ContentCategory;
  size: number;
  backends: StorageBackendType[];
  uploader?: Address;
  timestamp: number;
}

export interface ContentAccessedEvent {
  cid: string;
  region: string;
  backend: StorageBackendType;
  latencyMs: number;
  fromCache: boolean;
  timestamp: number;
}

export interface ContentReplicatedEvent {
  cid: string;
  fromNode: string;
  toNode: string;
  backend: StorageBackendType;
  reason: 'popularity' | 'underseeded' | 'requested';
  timestamp: number;
}


