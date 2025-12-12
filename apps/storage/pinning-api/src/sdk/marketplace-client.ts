/**
 * Storage Marketplace Client
 *
 * This is the ONLY interface that external services (like the compute marketplace)
 * should use to interact with storage. It provides:
 *
 * 1. Provider discovery via on-chain registry
 * 2. Automatic provider selection based on requirements
 * 3. Failover between providers
 * 4. Payment handling via x402 protocol
 *
 * IMPORTANT: No vendor-specific code is exposed here. All cloud providers
 * (Vercel, S3, R2) are accessed through the provider interface.
 */

import type {
  ContentId,
  ProviderType,
  RegisteredProvider,
  StorageProviderInterface,
  StorageProviderRegistry,
  StorageTier,
  StorageUploadOptions,
  StorageUploadResult,
} from './provider-interface';

// ============================================================================
// Marketplace Client Types
// ============================================================================

export interface StorageMarketplaceConfig {
  /** RPC URL for provider registry */
  rpcUrl: string;
  /** Storage registry contract address */
  registryAddress?: string;
  /** Preferred provider types (in order) */
  preferredProviders?: ProviderType[];
  /** Preferred storage tier */
  preferredTier?: StorageTier;
  /** Maximum cost per GB (wei) */
  maxCostPerGB?: bigint;
  /** Enable failover to other providers */
  enableFailover?: boolean;
  /** Provider endpoint URLs for direct access (no registry) */
  directProviders?: Array<{
    type: ProviderType;
    endpoint: string;
    apiKey?: string;
  }>;
}

export interface UploadRequest {
  content: Buffer;
  filename: string;
  options?: StorageUploadOptions;
}

export interface DownloadRequest {
  cid: ContentId;
  /** Preferred provider (if known) */
  provider?: string;
}

// ============================================================================
// Storage Marketplace Client
// ============================================================================

export class StorageMarketplaceClient {
  private config: StorageMarketplaceConfig;
  private registry?: StorageProviderRegistry;
  private providers: Map<string, StorageProviderInterface> = new Map();
  private cidToProvider: Map<ContentId, string> = new Map();

  constructor(config: StorageMarketplaceConfig) {
    this.config = {
      enableFailover: true,
      preferredProviders: ['ipfs', 'arweave', 'cloud'],
      preferredTier: 'hot',
      ...config,
    };
  }

  /**
   * Initialize marketplace client
   */
  async initialize(): Promise<void> {
    // Initialize direct providers if configured
    if (this.config.directProviders) {
      for (const direct of this.config.directProviders) {
        const provider = await this.createDirectProvider(direct);
        if (provider) {
          this.providers.set(`direct-${direct.type}`, provider);
        }
      }
    }

    // Initialize registry if configured
    if (this.config.registryAddress) {
      this.registry = await this.createRegistry();
    }
  }

  /**
   * Upload content to the best available provider
   */
  async upload(request: UploadRequest): Promise<StorageUploadResult> {
    const providers = await this.getAvailableProviders({
      tier: request.options?.tier ?? this.config.preferredTier,
      maxCost: this.config.maxCostPerGB,
    });

    if (providers.length === 0) {
      throw new Error('No storage providers available');
    }

    // Try providers in order of preference
    let lastError: Error | undefined;
    for (const provider of providers) {
      try {
        const result = await provider.upload(
          request.content,
          request.filename,
          request.options
        );

        // Track which provider stored this content
        this.cidToProvider.set(result.cid, provider.type);

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!this.config.enableFailover) {
          throw lastError;
        }
        // Continue to next provider
      }
    }

    throw lastError ?? new Error('All providers failed');
  }

  /**
   * Download content from any available provider
   */
  async download(request: DownloadRequest): Promise<Buffer> {
    // Check if we know which provider has this content
    const knownProvider = this.cidToProvider.get(request.cid);
    if (knownProvider) {
      const provider = Array.from(this.providers.values()).find(
        (p) => p.type === knownProvider
      );
      if (provider) {
        try {
          return await provider.download(request.cid);
        } catch {
          // Fall through to try other providers
        }
      }
    }

    // Try all providers
    const providers = await this.getAvailableProviders();

    for (const provider of providers) {
      try {
        const exists = await provider.exists(request.cid);
        if (exists) {
          return await provider.download(request.cid);
        }
      } catch {
        // Continue to next provider
      }
    }

    throw new Error(`Content not found: ${request.cid}`);
  }

  /**
   * Check if content exists on any provider
   */
  async exists(cid: ContentId): Promise<boolean> {
    const providers = await this.getAvailableProviders();

    for (const provider of providers) {
      try {
        if (await provider.exists(cid)) {
          return true;
        }
      } catch {
        // Continue to next provider
      }
    }

    return false;
  }

  /**
   * Delete content from provider that has it
   */
  async delete(cid: ContentId): Promise<void> {
    const knownProvider = this.cidToProvider.get(cid);

    if (knownProvider) {
      const provider = Array.from(this.providers.values()).find(
        (p) => p.type === knownProvider
      );
      if (provider) {
        await provider.delete(cid);
        this.cidToProvider.delete(cid);
        return;
      }
    }

    // Try all providers
    const providers = await this.getAvailableProviders();

    for (const provider of providers) {
      try {
        if (await provider.exists(cid)) {
          await provider.delete(cid);
          this.cidToProvider.delete(cid);
          return;
        }
      } catch {
        // Continue to next provider
      }
    }

    throw new Error(`Content not found: ${cid}`);
  }

  /**
   * Get URL for content
   */
  getUrl(cid: ContentId): string {
    const knownProvider = this.cidToProvider.get(cid);

    if (knownProvider) {
      const provider = Array.from(this.providers.values()).find(
        (p) => p.type === knownProvider
      );
      if (provider) {
        return provider.getUrl(cid);
      }
    }

    // Return first provider's URL format
    const first = Array.from(this.providers.values())[0];
    return first?.getUrl(cid) ?? cid;
  }

  /**
   * Get available providers sorted by preference
   */
  private async getAvailableProviders(options?: {
    tier?: StorageTier;
    maxCost?: bigint;
    type?: ProviderType;
  }): Promise<StorageProviderInterface[]> {
    const available: StorageProviderInterface[] = [];

    // Check direct providers
    for (const provider of this.providers.values()) {
      if (options?.type && provider.type !== options.type) continue;

      try {
        const health = await provider.healthCheck();
        if (health.healthy) {
          // Check capabilities
          if (options?.tier) {
            const caps = provider.getCapabilities();
            if (!caps.tiers.includes(options.tier)) continue;
          }

          // Check pricing
          if (options?.maxCost) {
            const pricing = provider.getPricing();
            if (pricing.storagePerGBMonth > options.maxCost) continue;
          }

          available.push(provider);
        }
      } catch {
        // Skip unhealthy providers
      }
    }

    // Sort by preference
    const preference = this.config.preferredProviders ?? ['ipfs', 'arweave', 'cloud'];
    return available.sort((a, b) => {
      const aIndex = preference.indexOf(a.type);
      const bIndex = preference.indexOf(b.type);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  }

  /**
   * Create a direct provider (no registry)
   */
  private async createDirectProvider(config: {
    type: ProviderType;
    endpoint: string;
    apiKey?: string;
  }): Promise<StorageProviderInterface | null> {
    switch (config.type) {
      case 'ipfs':
        return this.createIPFSProvider(config.endpoint);

      case 'arweave':
        return this.createArweaveProvider(config.endpoint);

      case 'cloud':
        return this.createCloudProvider(config.endpoint, config.apiKey);

      default:
        return null;
    }
  }

  /**
   * Create IPFS provider
   */
  private async createIPFSProvider(
    endpoint: string
  ): Promise<StorageProviderInterface> {
    return {
      type: 'ipfs',

      getCapabilities: () => ({
        tiers: ['hot', 'warm'],
        maxFileSize: 1024 * 1024 * 1024,
        maxTotalStorage: 0,
        supportsPermanent: false,
        supportsFolders: true,
        supportsListing: true,
        supportsDeletion: true,
        regions: ['global'],
        supportsEncryption: true,
      }),

      getPricing: () => ({
        storagePerGBMonth: 0n,
        bandwidthPerGB: 0n,
        permanentPerGB: 0n,
        minimumPayment: 0n,
        freeTierBytes: 1024 * 1024 * 1024, // 1GB
      }),

      healthCheck: async () => {
        const start = Date.now();
        try {
          const res = await fetch(`${endpoint}/api/v0/id`, { method: 'POST' });
          return {
            healthy: res.ok,
            latencyMs: Date.now() - start,
            lastSuccess: res.ok ? Date.now() : 0,
            errorCount: res.ok ? 0 : 1,
            availableCapacity: Number.MAX_SAFE_INTEGER,
          };
        } catch {
          return {
            healthy: false,
            latencyMs: Date.now() - start,
            lastSuccess: 0,
            errorCount: 1,
            availableCapacity: 0,
          };
        }
      },

      upload: async (content, filename, options) => {
        const formData = new FormData();
        formData.append('file', new Blob([content]), filename);

        const res = await fetch(`${endpoint}/api/v0/add?pin=true`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error(`IPFS upload failed: ${res.statusText}`);

        const result = (await res.json()) as { Hash: string; Size: string };

        return {
          cid: result.Hash,
          url: `${endpoint.replace(':5001', ':8080')}/ipfs/${result.Hash}`,
          size: parseInt(result.Size),
          provider: 'ipfs',
          tier: options?.tier ?? 'hot',
          cost: 0n,
          expiresAt: 0,
        };
      },

      download: async (cid) => {
        const gateway = endpoint.replace(':5001', ':8080');
        const res = await fetch(`${gateway}/ipfs/${cid}`);
        if (!res.ok) throw new Error(`IPFS download failed: ${res.statusText}`);
        return Buffer.from(await res.arrayBuffer());
      },

      exists: async (cid) => {
        try {
          const res = await fetch(
            `${endpoint}/api/v0/pin/ls?arg=${cid}&type=all`,
            { method: 'POST' }
          );
          return res.ok;
        } catch {
          return false;
        }
      },

      delete: async (cid) => {
        await fetch(`${endpoint}/api/v0/pin/rm?arg=${cid}`, { method: 'POST' });
      },

      getUrl: (cid) => `${endpoint.replace(':5001', ':8080')}/ipfs/${cid}`,

      estimateCost: async () => 0n,
    };
  }

  /**
   * Create Arweave provider
   */
  private async createArweaveProvider(
    endpoint: string
  ): Promise<StorageProviderInterface> {
    return {
      type: 'arweave',

      getCapabilities: () => ({
        tiers: ['permanent'],
        maxFileSize: 10 * 1024 * 1024 * 1024,
        maxTotalStorage: 0,
        supportsPermanent: true,
        supportsFolders: true,
        supportsListing: false,
        supportsDeletion: false,
        regions: ['global'],
        supportsEncryption: true,
      }),

      getPricing: () => ({
        storagePerGBMonth: 0n,
        bandwidthPerGB: 0n,
        permanentPerGB: BigInt(1e15), // ~0.001 ETH per GB
        minimumPayment: 0n,
        freeTierBytes: 100 * 1024, // 100KB
      }),

      healthCheck: async () => {
        const start = Date.now();
        try {
          const res = await fetch(`${endpoint}/info`);
          return {
            healthy: res.ok,
            latencyMs: Date.now() - start,
            lastSuccess: res.ok ? Date.now() : 0,
            errorCount: res.ok ? 0 : 1,
            availableCapacity: Number.MAX_SAFE_INTEGER,
          };
        } catch {
          return {
            healthy: false,
            latencyMs: Date.now() - start,
            lastSuccess: 0,
            errorCount: 1,
            availableCapacity: 0,
          };
        }
      },

      upload: async (content, filename, options) => {
        // For now, just return placeholder - real implementation uses Irys
        throw new Error(
          'Arweave upload requires Irys SDK. Use permissionless-storage for wallet-signed uploads.'
        );
      },

      download: async (cid) => {
        const res = await fetch(`${endpoint}/${cid}`);
        if (!res.ok) throw new Error(`Arweave download failed: ${res.statusText}`);
        return Buffer.from(await res.arrayBuffer());
      },

      exists: async (cid) => {
        try {
          const res = await fetch(`${endpoint}/${cid}`, { method: 'HEAD' });
          return res.ok;
        } catch {
          return false;
        }
      },

      delete: async () => {
        throw new Error('Arweave storage is permanent and cannot be deleted');
      },

      getUrl: (cid) => `${endpoint}/${cid}`,

      estimateCost: async (size) => {
        return BigInt(Math.ceil(size / (1024 * 1024 * 1024))) * BigInt(1e15);
      },
    };
  }

  /**
   * Create cloud provider (through marketplace API)
   */
  private async createCloudProvider(
    endpoint: string,
    apiKey?: string
  ): Promise<StorageProviderInterface> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return {
      type: 'cloud',

      getCapabilities: () => ({
        tiers: ['hot', 'warm'],
        maxFileSize: 500 * 1024 * 1024,
        maxTotalStorage: 0,
        supportsPermanent: false,
        supportsFolders: true,
        supportsListing: true,
        supportsDeletion: true,
        regions: ['global'],
        supportsEncryption: true,
      }),

      getPricing: () => ({
        storagePerGBMonth: 0n,
        bandwidthPerGB: 0n,
        permanentPerGB: 0n,
        minimumPayment: 0n,
        freeTierBytes: 5 * 1024 * 1024 * 1024,
      }),

      healthCheck: async () => {
        const start = Date.now();
        try {
          const res = await fetch(`${endpoint}/health`, { headers });
          return {
            healthy: res.ok,
            latencyMs: Date.now() - start,
            lastSuccess: res.ok ? Date.now() : 0,
            errorCount: res.ok ? 0 : 1,
            availableCapacity: Number.MAX_SAFE_INTEGER,
          };
        } catch {
          return {
            healthy: false,
            latencyMs: Date.now() - start,
            lastSuccess: 0,
            errorCount: 1,
            availableCapacity: 0,
          };
        }
      },

      upload: async (content, filename, options) => {
        const res = await fetch(`${endpoint}/upload`, {
          method: 'POST',
          headers: {
            ...headers,
            'X-Filename': filename,
            'X-Folder': options?.folder ?? '',
          },
          body: content,
        });

        if (!res.ok) throw new Error(`Cloud upload failed: ${res.statusText}`);

        const result = (await res.json()) as {
          cid: string;
          url: string;
          size: number;
        };

        return {
          cid: result.cid,
          url: result.url,
          size: result.size,
          provider: 'cloud',
          tier: options?.tier ?? 'hot',
          cost: 0n,
          expiresAt: 0,
        };
      },

      download: async (cid) => {
        const res = await fetch(`${endpoint}/download/${cid}`, { headers });
        if (!res.ok) throw new Error(`Cloud download failed: ${res.statusText}`);
        return Buffer.from(await res.arrayBuffer());
      },

      exists: async (cid) => {
        try {
          const res = await fetch(`${endpoint}/exists/${cid}`, { headers });
          return res.ok;
        } catch {
          return false;
        }
      },

      delete: async (cid) => {
        const res = await fetch(`${endpoint}/delete/${cid}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok) throw new Error(`Cloud delete failed: ${res.statusText}`);
      },

      getUrl: (cid) => `${endpoint}/content/${cid}`,

      estimateCost: async () => 0n,
    };
  }

  /**
   * Create registry client
   */
  private async createRegistry(): Promise<StorageProviderRegistry> {
    // Placeholder - would connect to on-chain registry
    return {
      getProviders: async () => [],
      getProvider: async () => null,
      getProviderByAgent: async () => null,
      findBestProvider: async () => null,
      getProvidersForContent: async () => [],
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create storage marketplace client from environment
 */
export function createStorageMarketplaceClient(
  config?: Partial<StorageMarketplaceConfig>
): StorageMarketplaceClient {
  const directProviders: Array<{
    type: ProviderType;
    endpoint: string;
    apiKey?: string;
  }> = [];

  // Add IPFS if configured
  if (process.env.IPFS_API_URL) {
    directProviders.push({
      type: 'ipfs',
      endpoint: process.env.IPFS_API_URL,
    });
  }

  // Add Arweave if configured
  if (process.env.ARWEAVE_GATEWAY_URL) {
    directProviders.push({
      type: 'arweave',
      endpoint: process.env.ARWEAVE_GATEWAY_URL,
    });
  }

  // Add cloud if Jeju storage endpoint configured
  if (process.env.JEJU_STORAGE_ENDPOINT) {
    directProviders.push({
      type: 'cloud',
      endpoint: process.env.JEJU_STORAGE_ENDPOINT,
      apiKey: process.env.JEJU_STORAGE_API_KEY,
    });
  }

  return new StorageMarketplaceClient({
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
    registryAddress: process.env.STORAGE_REGISTRY_ADDRESS,
    directProviders,
    preferredProviders: ['ipfs', 'arweave', 'cloud'],
    preferredTier: 'hot',
    enableFailover: true,
    ...config,
  });
}

/**
 * Create storage client for compute marketplace use
 * This is the recommended entry point for the compute marketplace.
 */
export function createComputeStorageClient(): StorageMarketplaceClient {
  return createStorageMarketplaceClient({
    preferredProviders: ['ipfs', 'arweave', 'cloud'],
    enableFailover: true,
  });
}
