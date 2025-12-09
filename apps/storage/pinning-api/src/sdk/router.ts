/**
 * Storage Router
 * 
 * Automatically selects the best storage provider based on:
 * - Price
 * - Availability
 * - Performance/latency
 * - Capacity
 * - User preferences
 * 
 * Supports multiple backend types:
 * - IPFS nodes (decentralized)
 * - Cloud storage (Vercel Blob, S3, R2)
 * - Arweave (permanent)
 * - Filecoin (long-term archival)
 */

import type {
  StorageProviderInfo,
  StorageRouterOptions,
  ProviderScore,
  StorageTier,
  StorageTierEnum,
} from './types';

// ============================================================================
// Router Configuration
// ============================================================================

interface RouterConfig {
  providers: StorageProviderInfo[];
  defaultTier: StorageTier;
  maxProvidersCached: number;
  cacheRefreshIntervalMs: number;
}

// ============================================================================
// Scoring Weights
// ============================================================================

const SCORING_WEIGHTS = {
  price: 0.35,      // 35% weight for price
  uptime: 0.25,     // 25% weight for uptime
  latency: 0.20,    // 20% weight for latency
  capacity: 0.10,   // 10% weight for available capacity
  health: 0.10,     // 10% weight for health score
} as const;

// ============================================================================
// Storage Router
// ============================================================================

export class StorageRouter {
  private providers: Map<string, StorageProviderInfo> = new Map();
  private lastRefresh: number = 0;
  private refreshIntervalMs: number;
  private defaultTier: StorageTier;

  constructor(config?: Partial<RouterConfig>) {
    this.refreshIntervalMs = config?.cacheRefreshIntervalMs || 60_000;
    this.defaultTier = config?.defaultTier ?? 1; // WARM tier by default

    if (config?.providers) {
      for (const p of config.providers) {
        this.providers.set(p.provider.address, p);
      }
    }
  }

  /**
   * Update provider list from registry
   */
  updateProviders(providers: StorageProviderInfo[]): void {
    this.providers.clear();
    for (const p of providers) {
      if (p.provider.active) {
        this.providers.set(p.provider.address, p);
      }
    }
    this.lastRefresh = Date.now();
  }

  /**
   * Add or update a single provider
   */
  updateProvider(provider: StorageProviderInfo): void {
    if (provider.provider.active) {
      this.providers.set(provider.provider.address, provider);
    } else {
      this.providers.delete(provider.provider.address);
    }
  }

  /**
   * Get the best provider for given storage requirements
   */
  selectBestProvider(
    sizeBytes: bigint,
    durationDays: number,
    options: StorageRouterOptions = {}
  ): StorageProviderInfo | null {
    const candidates = this.filterProviders(sizeBytes, durationDays, options);
    if (candidates.length === 0) return null;

    const scores = this.scoreProviders(candidates, sizeBytes, durationDays, options);
    scores.sort((a, b) => b.score - a.score);

    const bestAddress = scores[0]?.provider;
    return bestAddress ? this.providers.get(bestAddress) || null : null;
  }

  /**
   * Get ranked list of providers with scores
   */
  rankProviders(
    sizeBytes: bigint,
    durationDays: number,
    options: StorageRouterOptions = {}
  ): Array<{ provider: StorageProviderInfo; score: ProviderScore }> {
    const candidates = this.filterProviders(sizeBytes, durationDays, options);
    const scores = this.scoreProviders(candidates, sizeBytes, durationDays, options);
    scores.sort((a, b) => b.score - a.score);

    return scores.map(score => ({
      provider: this.providers.get(score.provider)!,
      score,
    })).filter(r => r.provider);
  }

  /**
   * Select multiple providers for replication
   */
  selectProvidersForReplication(
    sizeBytes: bigint,
    durationDays: number,
    replicationFactor: number,
    options: StorageRouterOptions = {}
  ): StorageProviderInfo[] {
    const ranked = this.rankProviders(sizeBytes, durationDays, options);
    return ranked.slice(0, replicationFactor).map(r => r.provider);
  }

  /**
   * Find providers supporting permanent storage (Arweave)
   */
  findPermanentStorageProviders(): StorageProviderInfo[] {
    return Array.from(this.providers.values()).filter(p => 
      p.supportedTiers.includes(3) // StorageTierEnum.PERMANENT
    );
  }

  /**
   * Filter providers based on requirements
   */
  private filterProviders(
    sizeBytes: bigint,
    durationDays: number,
    options: StorageRouterOptions
  ): StorageProviderInfo[] {
    const tier = options.tier ?? this.defaultTier;
    const sizeGB = Number(sizeBytes) / (1024 ** 3);

    return Array.from(this.providers.values()).filter(p => {
      // Check if active
      if (!p.provider.active) return false;

      // Check tier support
      if (!p.supportedTiers.includes(tier)) return false;

      // Check capacity
      if (p.capacity.availableCapacityGB < sizeGB) return false;

      // Check duration
      if (durationDays < p.pricing.minStoragePeriodDays) return false;
      if (p.pricing.maxStoragePeriodDays > 0 && durationDays > p.pricing.maxStoragePeriodDays) return false;

      // Check max cost constraint
      if (options.maxCostPerGBMonth && p.pricing.pricePerGBMonth > options.maxCostPerGBMonth) return false;

      // Check uptime
      if (options.minUptimePercent && p.healthScore < options.minUptimePercent) return false;

      // Check health score
      if (options.minHealthScore && p.healthScore < options.minHealthScore) return false;

      // Check preferred providers
      if (options.preferredProviders?.length && !options.preferredProviders.includes(p.provider.address)) {
        return false;
      }

      // Check excluded providers
      if (options.excludeProviders?.includes(p.provider.address)) return false;

      // Check permanent storage
      if (options.permanentStorage && !p.supportedTiers.includes(3)) return false;

      return true;
    });
  }

  /**
   * Score providers based on multiple factors
   */
  private scoreProviders(
    providers: StorageProviderInfo[],
    sizeBytes: bigint,
    durationDays: number,
    options: StorageRouterOptions
  ): ProviderScore[] {
    if (providers.length === 0) return [];

    // Calculate min/max values for normalization
    const prices = providers.map(p => Number(p.pricing.pricePerGBMonth));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    const latencies = providers.map(p => p.avgLatencyMs);
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    const latencyRange = maxLatency - minLatency || 1;

    const sizeGB = Number(sizeBytes) / (1024 ** 3);

    return providers.map(p => {
      // Price score: lower is better (inverted)
      const priceScore = 100 - ((Number(p.pricing.pricePerGBMonth) - minPrice) / priceRange) * 100;

      // Uptime score: health score is 0-100
      const uptimeScore = p.healthScore;

      // Latency score: lower is better (inverted)
      const latencyScore = 100 - ((p.avgLatencyMs - minLatency) / latencyRange) * 100;

      // Capacity score: more available = better
      const capacityRatio = sizeGB / p.capacity.availableCapacityGB;
      const capacityScore = Math.max(0, 100 - capacityRatio * 100);

      // Composite score
      const score = (
        priceScore * SCORING_WEIGHTS.price +
        uptimeScore * SCORING_WEIGHTS.uptime +
        latencyScore * SCORING_WEIGHTS.latency +
        capacityScore * SCORING_WEIGHTS.capacity +
        p.healthScore * SCORING_WEIGHTS.health
      );

      return {
        provider: p.provider.address,
        score,
        priceScore,
        uptimeScore,
        latencyScore,
        capacityScore,
      };
    });
  }

  /**
   * Get all active providers
   */
  getActiveProviders(): StorageProviderInfo[] {
    return Array.from(this.providers.values()).filter(p => p.provider.active);
  }

  /**
   * Get provider by address
   */
  getProvider(address: string): StorageProviderInfo | undefined {
    return this.providers.get(address);
  }

  /**
   * Check if cache needs refresh
   */
  needsRefresh(): boolean {
    return Date.now() - this.lastRefresh > this.refreshIntervalMs;
  }

  /**
   * Get stats about cached providers
   */
  getStats(): {
    totalProviders: number;
    activeProviders: number;
    totalCapacityTB: number;
    avgPricePerGBMonth: bigint;
  } {
    const active = this.getActiveProviders();
    const totalCapacity = active.reduce((sum, p) => sum + p.capacity.totalCapacityGB, 0);
    const avgPrice = active.length > 0
      ? active.reduce((sum, p) => sum + p.pricing.pricePerGBMonth, 0n) / BigInt(active.length)
      : 0n;

    return {
      totalProviders: this.providers.size,
      activeProviders: active.length,
      totalCapacityTB: totalCapacity / 1024,
      avgPricePerGBMonth: avgPrice,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStorageRouter(config?: Partial<RouterConfig>): StorageRouter {
  return new StorageRouter(config);
}

// ============================================================================
// Provider Backend Helpers
// ============================================================================

export interface StorageBackend {
  type: 'ipfs' | 'cloud' | 'arweave' | 'filecoin';
  upload(content: Buffer, options: { filename: string }): Promise<{ cid: string; url: string }>;
  download(cid: string): Promise<Buffer>;
  delete(cid: string): Promise<void>;
  getStatus(cid: string): Promise<{ available: boolean; size?: number }>;
}

/**
 * Create backend client for a provider type
 */
export function createBackendForProvider(
  providerInfo: StorageProviderInfo
): StorageBackend {
  switch (providerInfo.provider.providerType) {
    case 0: // IPFS_NODE
      return createIPFSBackend(providerInfo.provider.endpoint);
    case 3: // CLOUD_S3
    case 4: // CLOUD_VERCEL
    case 5: // CLOUD_R2
      return createCloudBackend(providerInfo.provider.endpoint);
    case 2: // ARWEAVE
      return createArweaveBackend(providerInfo.provider.endpoint);
    default:
      return createIPFSBackend(providerInfo.provider.endpoint);
  }
}

function createIPFSBackend(endpoint: string): StorageBackend {
  return {
    type: 'ipfs',
    async upload(content: Buffer, options: { filename: string }) {
      const formData = new FormData();
      formData.append('file', new Blob([content]), options.filename);

      const response = await fetch(`${endpoint}/api/v0/add`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error(`IPFS upload failed: ${response.statusText}`);
      const result = await response.json() as { Hash: string };
      return { cid: result.Hash, url: `${endpoint}/ipfs/${result.Hash}` };
    },
    async download(cid: string) {
      const response = await fetch(`${endpoint}/ipfs/${cid}`);
      if (!response.ok) throw new Error(`IPFS download failed: ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(cid: string) {
      await fetch(`${endpoint}/api/v0/pin/rm?arg=${cid}`, { method: 'POST' });
    },
    async getStatus(cid: string) {
      const response = await fetch(`${endpoint}/api/v0/pin/ls?arg=${cid}&type=all`);
      return { available: response.ok };
    },
  };
}

function createCloudBackend(endpoint: string): StorageBackend {
  return {
    type: 'cloud',
    async upload(content: Buffer, options: { filename: string }) {
      const response = await fetch(`${endpoint}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': options.filename },
        body: content,
      });

      if (!response.ok) throw new Error(`Cloud upload failed: ${response.statusText}`);
      const result = await response.json() as { id: string; url: string };
      return { cid: result.id, url: result.url };
    },
    async download(cid: string) {
      const response = await fetch(`${endpoint}/files/${cid}`);
      if (!response.ok) throw new Error(`Cloud download failed: ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(cid: string) {
      await fetch(`${endpoint}/files/${cid}`, { method: 'DELETE' });
    },
    async getStatus(cid: string) {
      const response = await fetch(`${endpoint}/files/${cid}/status`);
      return { available: response.ok };
    },
  };
}

function createArweaveBackend(endpoint: string): StorageBackend {
  return {
    type: 'arweave',
    async upload(content: Buffer, options: { filename: string }) {
      const response = await fetch(`${endpoint}/upload`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/octet-stream',
          'X-Filename': options.filename,
        },
        body: content,
      });

      if (!response.ok) throw new Error(`Arweave upload failed: ${response.statusText}`);
      const result = await response.json() as { id: string };
      return { cid: result.id, url: `https://arweave.net/${result.id}` };
    },
    async download(cid: string) {
      const response = await fetch(`https://arweave.net/${cid}`);
      if (!response.ok) throw new Error(`Arweave download failed: ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(_cid: string) {
      throw new Error('Arweave storage is permanent and cannot be deleted');
    },
    async getStatus(cid: string) {
      const response = await fetch(`https://arweave.net/${cid}`, { method: 'HEAD' });
      return { available: response.ok };
    },
  };
}

