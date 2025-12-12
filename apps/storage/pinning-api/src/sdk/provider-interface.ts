/**
 * Decentralized Storage Provider Interface
 *
 * This interface defines how storage providers participate in the Jeju marketplace.
 * ALL storage - whether cloud (Vercel, S3, R2) or decentralized (IPFS, Arweave) -
 * MUST implement this interface to be discoverable on the marketplace.
 *
 * KEY PRINCIPLES:
 * 1. NO vendor-specific code in Jeju core - all providers are abstracted
 * 2. Providers register on-chain and expose a standard API
 * 3. Compute marketplace discovers providers via ERC-8004 agents
 * 4. Payment is handled via x402 protocol (permissionless)
 *
 * ARCHITECTURE:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                    JEJU MARKETPLACE (on-chain)                  │
 *   │  - Provider Registry (ERC-8004 agents)                        │
 *   │  - Storage Deals                                               │
 *   │  - Payment Protocol (x402)                                     │
 *   └─────────────────────────────────────────────────────────────────┘
 *                               ▲
 *                               │ Implements StorageProviderInterface
 *                               │
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                    STORAGE PROVIDERS                            │
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │  Cloud Providers (wrapped):    │  Native Decentralized:        │
 *   │  - Vercel Blob Provider        │  - IPFS (local node)          │
 *   │  - S3 Provider                 │  - Arweave (via Irys)         │
 *   │  - R2 Provider                 │  - Filecoin                   │
 *   │  (Vendor code in provider)     │  (Protocol native)            │
 *   └─────────────────────────────────────────────────────────────────┘
 *                               ▲
 *                               │ Consumed by
 *                               │
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                    COMPUTE MARKETPLACE                          │
 *   │  - Only interacts via StorageProviderInterface                 │
 *   │  - No vendor dependencies                                       │
 *   │  - Discovers providers via registry                             │
 *   └─────────────────────────────────────────────────────────────────┘
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Content identifier - can be IPFS CID, Arweave TX, or cloud CID
 */
export type ContentId = string;

/**
 * Provider types available on the marketplace
 */
export type ProviderType = 'ipfs' | 'arweave' | 'cloud' | 'filecoin';

/**
 * Storage tier determines durability and access patterns
 */
export type StorageTier = 'hot' | 'warm' | 'cold' | 'permanent';

/**
 * Upload result from any provider
 */
export interface StorageUploadResult {
  /** Content identifier (CID for IPFS/cloud, TX for Arweave) */
  cid: ContentId;
  /** Direct URL to access the content */
  url: string;
  /** Size in bytes */
  size: number;
  /** Provider type that stored the content */
  provider: ProviderType;
  /** Storage tier */
  tier: StorageTier;
  /** Cost in wei (0 for free tiers) */
  cost: bigint;
  /** Expiry timestamp (0 for permanent) */
  expiresAt: number;
  /** Provider-specific metadata */
  metadata?: Record<string, string>;
}

/**
 * Upload options
 */
export interface StorageUploadOptions {
  /** Preferred storage tier */
  tier?: StorageTier;
  /** Make permanent (if supported) */
  permanent?: boolean;
  /** Folder/path prefix */
  folder?: string;
  /** Content type */
  contentType?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
  /** Maximum cost willing to pay (wei) */
  maxCost?: bigint;
}

/**
 * Provider capabilities advertised to the marketplace
 */
export interface ProviderCapabilities {
  /** Supported storage tiers */
  tiers: StorageTier[];
  /** Maximum file size (bytes) */
  maxFileSize: number;
  /** Maximum total storage (bytes, 0 = unlimited) */
  maxTotalStorage: number;
  /** Supports permanent storage */
  supportsPermanent: boolean;
  /** Supports folder organization */
  supportsFolders: boolean;
  /** Supports file listing */
  supportsListing: boolean;
  /** Supports deletion */
  supportsDeletion: boolean;
  /** Geographic regions */
  regions: string[];
  /** Encryption supported */
  supportsEncryption: boolean;
}

/**
 * Provider pricing information
 */
export interface ProviderPricing {
  /** Cost per GB stored per month (wei) */
  storagePerGBMonth: bigint;
  /** Cost per GB bandwidth (wei) */
  bandwidthPerGB: bigint;
  /** Cost for permanent storage per GB (wei, one-time) */
  permanentPerGB: bigint;
  /** Minimum payment (wei) */
  minimumPayment: bigint;
  /** Free tier bytes (if any) */
  freeTierBytes: number;
}

/**
 * Provider health and status
 */
export interface ProviderHealth {
  /** Provider is online and accepting requests */
  healthy: boolean;
  /** Latency to provider (ms) */
  latencyMs: number;
  /** Last successful request */
  lastSuccess: number;
  /** Error count in last hour */
  errorCount: number;
  /** Available capacity (bytes) */
  availableCapacity: number;
}

/**
 * Registered provider information (from on-chain registry)
 */
export interface RegisteredProvider {
  /** Provider address */
  address: string;
  /** ERC-8004 agent ID */
  agentId: bigint;
  /** Provider name */
  name: string;
  /** API endpoint */
  endpoint: string;
  /** Provider type */
  type: ProviderType;
  /** Capabilities */
  capabilities: ProviderCapabilities;
  /** Pricing */
  pricing: ProviderPricing;
  /** Current health */
  health?: ProviderHealth;
  /** Stake amount (wei) */
  stake: bigint;
  /** Registration timestamp */
  registeredAt: number;
  /** Is currently active */
  isActive: boolean;
}

// ============================================================================
// Storage Provider Interface (must be implemented by all providers)
// ============================================================================

/**
 * Interface that ALL storage providers must implement to participate
 * in the Jeju marketplace. This is the ONLY interface the compute
 * marketplace uses - no vendor-specific code allowed.
 */
export interface StorageProviderInterface {
  /**
   * Provider type identifier
   */
  readonly type: ProviderType;

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Get provider pricing
   */
  getPricing(): ProviderPricing;

  /**
   * Check provider health
   */
  healthCheck(): Promise<ProviderHealth>;

  /**
   * Upload content to storage
   */
  upload(
    content: Buffer,
    filename: string,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult>;

  /**
   * Download content by CID
   */
  download(cid: ContentId): Promise<Buffer>;

  /**
   * Check if content exists
   */
  exists(cid: ContentId): Promise<boolean>;

  /**
   * Delete content (if supported)
   */
  delete(cid: ContentId): Promise<void>;

  /**
   * Get direct URL for content
   */
  getUrl(cid: ContentId): string;

  /**
   * List content in folder (if supported)
   */
  list?(
    folder: string
  ): Promise<Array<{ cid: ContentId; filename: string; size: number }>>;

  /**
   * Pin content to prevent garbage collection (if applicable)
   */
  pin?(cid: ContentId): Promise<void>;

  /**
   * Unpin content (if applicable)
   */
  unpin?(cid: ContentId): Promise<void>;

  /**
   * Get estimated cost for upload
   */
  estimateCost(size: number, options?: StorageUploadOptions): Promise<bigint>;
}

// ============================================================================
// Provider Registry Interface (on-chain discovery)
// ============================================================================

/**
 * Interface for discovering and interacting with registered providers
 */
export interface StorageProviderRegistry {
  /**
   * Get all active storage providers
   */
  getProviders(options?: {
    type?: ProviderType;
    tier?: StorageTier;
    minCapacity?: number;
    maxPrice?: bigint;
    region?: string;
  }): Promise<RegisteredProvider[]>;

  /**
   * Get provider by address
   */
  getProvider(address: string): Promise<RegisteredProvider | null>;

  /**
   * Get provider by ERC-8004 agent ID
   */
  getProviderByAgent(agentId: bigint): Promise<RegisteredProvider | null>;

  /**
   * Find best provider for a given request
   */
  findBestProvider(options: {
    size: number;
    tier?: StorageTier;
    permanent?: boolean;
    maxCost?: bigint;
    region?: string;
  }): Promise<RegisteredProvider | null>;

  /**
   * Get providers that can serve specific content
   */
  getProvidersForContent(cid: ContentId): Promise<RegisteredProvider[]>;
}

// ============================================================================
// Client Factory (for compute marketplace use)
// ============================================================================

/**
 * Create a storage provider client from a registered provider.
 * This is what the compute marketplace uses - it never deals with
 * vendor-specific implementations directly.
 */
export interface StorageProviderClientFactory {
  /**
   * Create client for a registered provider
   */
  createClient(provider: RegisteredProvider): Promise<StorageProviderInterface>;

  /**
   * Create client for the best available provider
   */
  createBestClient(options?: {
    type?: ProviderType;
    tier?: StorageTier;
    minCapacity?: number;
    maxPrice?: bigint;
  }): Promise<StorageProviderInterface | null>;
}

// ============================================================================
// Provider Registration (for providers to join marketplace)
// ============================================================================

/**
 * Registration request for a new storage provider
 */
export interface ProviderRegistration {
  /** Provider name */
  name: string;
  /** API endpoint */
  endpoint: string;
  /** Provider type */
  type: ProviderType;
  /** Capabilities */
  capabilities: ProviderCapabilities;
  /** Pricing */
  pricing: ProviderPricing;
  /** Initial stake (wei) */
  stake: bigint;
}

/**
 * Interface for providers to register with the marketplace
 */
export interface ProviderRegistrationService {
  /**
   * Register as a storage provider
   */
  register(registration: ProviderRegistration): Promise<{
    agentId: bigint;
    transactionHash: string;
  }>;

  /**
   * Update provider details
   */
  update(updates: Partial<ProviderRegistration>): Promise<string>;

  /**
   * Deactivate provider
   */
  deactivate(): Promise<string>;

  /**
   * Withdraw stake
   */
  withdrawStake(): Promise<string>;
}
