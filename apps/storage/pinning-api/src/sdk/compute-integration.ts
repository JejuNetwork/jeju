/**
 * Compute Integration for Storage SDK
 * 
 * Enables storage providers to:
 * - Find compute providers that can run stored containers
 * - Track container usage across compute rentals
 * - Discover compute resources by ERC-8004 agent
 * - Link storage deals to compute rentals
 */

import { Contract, JsonRpcProvider, formatEther } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export interface ComputeProviderInfo {
  address: string;
  name: string;
  endpoint: string;
  agentId: number; // ERC-8004 agent ID
  isActive: boolean;
  stake: bigint;
  
  // Hardware
  gpuType: string;
  gpuCount: number;
  gpuVram: number;
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
  teeCapable: boolean;
  
  // Pricing
  pricePerHour: bigint;
  minimumHours: number;
  
  // Features
  sshEnabled: boolean;
  dockerEnabled: boolean;
  
  // Performance
  healthScore: number;
  avgRating: number;
  totalRentals: number;
}

export interface ComputeQuote {
  provider: string;
  providerName: string;
  durationHours: number;
  cost: bigint;
  costFormatted: string;
  gpuType: string;
  gpuCount: number;
  teeCapable: boolean;
}

export interface ContainerCompatibility {
  cid: string;
  compatibleProviders: Array<{
    provider: string;
    name: string;
    pricePerHour: bigint;
    meetsGpuRequirement: boolean;
    meetsTeeRequirement: boolean;
  }>;
}

export interface ComputeRentalForFile {
  rentalId: string;
  containerCid: string;
  computeProvider: string;
  storageProvider: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  startTime?: number;
  endTime?: number;
  cost: bigint;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const COMPUTE_REGISTRY_ABI = [
  'function getActiveProviders() view returns (address[])',
  'function getProvider(address) view returns (tuple(address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active))',
  'function isActive(address) view returns (bool)',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
];

const COMPUTE_RENTAL_ABI = [
  'function getProviderResources(address) view returns (tuple(tuple(uint8 gpuType, uint8 gpuCount, uint16 gpuVram, uint16 cpuCores, uint32 memory, uint32 storage, uint32 bandwidth, bool teeCapable) resources, tuple(uint256 pricePerHour, uint256 pricePerGpuHour, uint256 minimumRentalHours, uint256 maximumRentalHours) pricing, uint256 maxConcurrent, uint256 active, bool sshEnabled, bool dockerEnabled))',
  'function calculateRentalCost(address provider, uint256 durationHours) view returns (uint256)',
  'function getProviderRecord(address) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 failedRentals, uint256 totalEarnings, uint256 avgRating, uint256 ratingCount, bool banned))',
];

const GPU_TYPES = [
  'NONE', 'NVIDIA_RTX_4090', 'NVIDIA_A100_40GB', 'NVIDIA_A100_80GB', 
  'NVIDIA_H100', 'NVIDIA_H200', 'AMD_MI300X', 'APPLE_M1_MAX', 
  'APPLE_M2_ULTRA', 'APPLE_M3_MAX'
];

// ============================================================================
// Indexer Client - Query indexer REST API for provider discovery
// ============================================================================

export interface IndexerConfig {
  indexerUrl: string;
  timeout?: number;
}

export class IndexerClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: IndexerConfig) {
    this.baseUrl = config.indexerUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 5000;
  }

  private async fetch<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const response = await fetch(`${this.baseUrl}${path}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Indexer request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getComputeProviders(limit?: number): Promise<Array<{
    type: 'compute';
    address: string;
    name: string;
    endpoint: string;
    agentId: number | null;
    isActive: boolean;
  }>> {
    const params = new URLSearchParams({ type: 'compute' });
    if (limit) params.set('limit', limit.toString());

    const result = await this.fetch<{ providers: Array<{
      type: 'compute';
      address: string;
      name: string;
      endpoint: string;
      agentId: number | null;
      isActive: boolean;
    }> }>(`/api/providers?${params.toString()}`);
    return result.providers;
  }

  async getFullStackProviders(limit?: number): Promise<Array<{
    agentId: number;
    compute: Array<{ address: string; name: string; endpoint: string }>;
    storage: Array<{ address: string; name: string; endpoint: string; providerType: string }>;
  }>> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit.toString());

    const result = await this.fetch<{
      fullStackProviders: Array<{
        agentId: number;
        compute: Array<{ address: string; name: string; endpoint: string }>;
        storage: Array<{ address: string; name: string; endpoint: string; providerType: string }>;
      }>;
    }>(`/api/full-stack?${params.toString()}`);
    return result.fullStackProviders;
  }

  async getContainerWithProviders(cid: string): Promise<{
    container: {
      cid: string;
      name: string;
      sizeBytes: string;
      storageProvider: string | null;
      tier: string;
      architecture: string;
      gpuRequired: boolean;
      teeRequired: boolean;
      verified: boolean;
    } | null;
    compatibleProviders: Array<{
      address: string;
      name: string;
      endpoint: string;
      agentId: number | null;
    }>;
  }> {
    return this.fetch(`/api/containers/${cid}`);
  }

  async getMarketplaceStats(): Promise<{
    compute: {
      totalProviders: number;
      activeProviders: number;
      agentLinkedProviders: number;
      totalRentals: number;
      activeRentals: number;
    };
    storage: {
      totalProviders: number;
      activeProviders: number;
      agentLinkedProviders: number;
      totalDeals: number;
      activeDeals: number;
    };
    crossService: {
      totalContainerImages: number;
      fullStackAgents: number;
    };
    lastUpdated: string;
  }> {
    return this.fetch('/api/marketplace/stats');
  }
}

// ============================================================================
// Compute Integration Client
// ============================================================================

export interface ComputeIntegrationConfig {
  rpcUrl: string;
  computeRegistryAddress?: string;
  computeRentalAddress?: string;
  indexerUrl?: string;
}

export class StorageComputeIntegration {
  private provider: JsonRpcProvider;
  private computeRegistry?: Contract;
  private computeRental?: Contract;
  private providerCache: Map<string, ComputeProviderInfo> = new Map();
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 60000;
  private indexerClient?: IndexerClient;

  constructor(config: ComputeIntegrationConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);

    if (config.computeRegistryAddress) {
      this.computeRegistry = new Contract(
        config.computeRegistryAddress,
        COMPUTE_REGISTRY_ABI,
        this.provider
      );
    }

    if (config.computeRentalAddress) {
      this.computeRental = new Contract(
        config.computeRentalAddress,
        COMPUTE_RENTAL_ABI,
        this.provider
      );
    }

    // Initialize indexer client for fast lookups
    if (config.indexerUrl) {
      this.indexerClient = new IndexerClient({ indexerUrl: config.indexerUrl });
    }
  }

  /**
   * Check if compute integration is available
   */
  isAvailable(): boolean {
    return !!(this.computeRegistry && this.computeRental) || !!this.indexerClient;
  }

  /**
   * Get indexer client for direct queries
   */
  getIndexerClient(): IndexerClient | undefined {
    return this.indexerClient;
  }

  /**
   * Get all active compute providers
   * Tries indexer first for fast lookups, falls back to on-chain queries
   */
  async getComputeProviders(options?: {
    agentLinkedOnly?: boolean;
    minGpuVram?: number;
    requireTee?: boolean;
    maxPricePerHour?: bigint;
    useIndexer?: boolean;
  }): Promise<ComputeProviderInfo[]> {
    // Use cache if fresh
    if (Date.now() - this.lastCacheUpdate < this.CACHE_TTL && this.providerCache.size > 0) {
      return this.filterProviders(Array.from(this.providerCache.values()), options);
    }

    // Try indexer first if available (faster, no RPC calls)
    if (this.indexerClient && options?.useIndexer !== false) {
      const indexerProviders = await this.indexerClient.getComputeProviders(100).catch(() => null);
      if (indexerProviders && indexerProviders.length > 0) {
        const providers: ComputeProviderInfo[] = indexerProviders.map(p => ({
          address: p.address,
          name: p.name,
          endpoint: p.endpoint,
          agentId: p.agentId || 0,
          isActive: p.isActive,
          stake: 0n,
          gpuType: 'NONE',
          gpuCount: 0,
          gpuVram: 0,
          cpuCores: 0,
          memoryGB: 0,
          storageGB: 0,
          teeCapable: false,
          pricePerHour: 0n,
          minimumHours: 1,
          sshEnabled: true,
          dockerEnabled: true,
          healthScore: 100,
          avgRating: 0,
          totalRentals: 0,
        }));

        // Update cache
        for (const p of providers) {
          this.providerCache.set(p.address, p);
        }
        this.lastCacheUpdate = Date.now();

        return this.filterProviders(providers, options);
      }
    }

    // Fall back to on-chain queries
    if (!this.computeRegistry || !this.computeRental) return [];

    const addresses: string[] = await this.computeRegistry.getActiveProviders();
    const providers: ComputeProviderInfo[] = [];

    for (const addr of addresses) {
      const isActive = await this.computeRegistry.isActive(addr);
      if (!isActive) continue;

      const providerData = await this.computeRegistry.getProvider(addr);
      const resources = await this.computeRental.getProviderResources(addr);
      const record = await this.computeRental.getProviderRecord(addr);

      if (record.banned) continue;

      const avgRating = Number(record.ratingCount) > 0
        ? Number(record.avgRating) / Number(record.ratingCount)
        : 0;

      const providerInfo: ComputeProviderInfo = {
        address: addr,
        name: providerData.name,
        endpoint: providerData.endpoint,
        agentId: Number(providerData.agentId),
        isActive: providerData.active,
        stake: providerData.stake,
        gpuType: GPU_TYPES[Number(resources.resources.gpuType)] || 'NONE',
        gpuCount: Number(resources.resources.gpuCount),
        gpuVram: Number(resources.resources.gpuVram),
        cpuCores: Number(resources.resources.cpuCores),
        memoryGB: Number(resources.resources.memory),
        storageGB: Number(resources.resources.storage),
        teeCapable: resources.resources.teeCapable,
        pricePerHour: resources.pricing.pricePerHour,
        minimumHours: Number(resources.pricing.minimumRentalHours),
        sshEnabled: resources.sshEnabled,
        dockerEnabled: resources.dockerEnabled,
        healthScore: 100, // Would need additional metrics
        avgRating,
        totalRentals: Number(record.totalRentals),
      };

      this.providerCache.set(addr, providerInfo);
      providers.push(providerInfo);
    }

    this.lastCacheUpdate = Date.now();

    return this.filterProviders(providers, options);
  }

  private filterProviders(
    providers: ComputeProviderInfo[],
    options?: {
      agentLinkedOnly?: boolean;
      minGpuVram?: number;
      requireTee?: boolean;
      maxPricePerHour?: bigint;
    }
  ): ComputeProviderInfo[] {
    return providers.filter(p => {
      if (options?.agentLinkedOnly && !p.agentId) return false;
      if (options?.minGpuVram && p.gpuVram < options.minGpuVram) return false;
      if (options?.requireTee && !p.teeCapable) return false;
      if (options?.maxPricePerHour && p.pricePerHour > options.maxPricePerHour) return false;
      return true;
    });
  }

  /**
   * Get compute provider by ERC-8004 agent ID
   */
  async getComputeProviderByAgent(agentId: bigint): Promise<ComputeProviderInfo | null> {
    if (!this.computeRegistry) return null;

    const address = await this.computeRegistry.getProviderByAgent(agentId);
    if (address === '0x0000000000000000000000000000000000000000') return null;

    const providers = await this.getComputeProviders();
    return providers.find(p => p.address.toLowerCase() === address.toLowerCase()) || null;
  }

  /**
   * Find compute providers compatible with a stored container
   */
  async findProvidersForContainer(params: {
    cid: string;
    minGpuVram?: number;
    requireTee?: boolean;
    architecture?: 'amd64' | 'arm64';
  }): Promise<ContainerCompatibility> {
    const providers = await this.getComputeProviders({
      minGpuVram: params.minGpuVram,
      requireTee: params.requireTee,
    });

    // Filter to Docker-enabled providers
    const dockerProviders = providers.filter(p => p.dockerEnabled);

    return {
      cid: params.cid,
      compatibleProviders: dockerProviders.map(p => ({
        provider: p.address,
        name: p.name,
        pricePerHour: p.pricePerHour,
        meetsGpuRequirement: !params.minGpuVram || p.gpuVram >= params.minGpuVram,
        meetsTeeRequirement: !params.requireTee || p.teeCapable,
      })),
    };
  }

  /**
   * Get quote for running a container on compute
   */
  async getComputeQuote(params: {
    cid: string;
    durationHours: number;
    minGpuVram?: number;
    requireTee?: boolean;
    preferAgentLinked?: boolean;
  }): Promise<ComputeQuote[]> {
    if (!this.computeRental) return [];

    const providers = await this.getComputeProviders({
      agentLinkedOnly: params.preferAgentLinked,
      minGpuVram: params.minGpuVram,
      requireTee: params.requireTee,
    });

    const quotes: ComputeQuote[] = [];

    for (const provider of providers.slice(0, 10)) {
      const cost = await this.computeRental.calculateRentalCost(
        provider.address,
        params.durationHours
      );

      quotes.push({
        provider: provider.address,
        providerName: provider.name,
        durationHours: params.durationHours,
        cost,
        costFormatted: formatEther(cost) + ' ETH',
        gpuType: provider.gpuType,
        gpuCount: provider.gpuCount,
        teeCapable: provider.teeCapable,
      });
    }

    // Sort by cost
    return quotes.sort((a, b) => Number(a.cost - b.cost));
  }

  /**
   * Get the best compute provider for a container
   * Considers: price, ERC-8004 verification, rating, compatibility
   */
  async getBestProviderForContainer(params: {
    cid: string;
    durationHours: number;
    minGpuVram?: number;
    requireTee?: boolean;
    maxBudget?: bigint;
  }): Promise<ComputeProviderInfo | null> {
    const providers = await this.getComputeProviders({
      minGpuVram: params.minGpuVram,
      requireTee: params.requireTee,
    });

    if (providers.length === 0) return null;

    // Score each provider
    type ScoredProvider = ComputeProviderInfo & { score: number };
    const scored: ScoredProvider[] = [];

    for (const provider of providers) {
      if (!this.computeRental) continue;
      
      const cost = await this.computeRental.calculateRentalCost(
        provider.address,
        params.durationHours
      );

      // Skip if over budget
      if (params.maxBudget && cost > params.maxBudget) continue;

      // Calculate score (higher is better)
      let score = 0;

      // ERC-8004 verification bonus
      if (provider.agentId > 0) score += 30;

      // Rating score (0-25 points)
      score += Math.min(25, provider.avgRating * 5);

      // Price efficiency (0-25 points, cheaper is better)
      const priceScore = 25 - Math.min(25, Number(cost) / 1e18 * 10);
      score += priceScore;

      // Experience bonus
      if (provider.totalRentals > 100) score += 10;
      else if (provider.totalRentals > 10) score += 5;

      // TEE bonus if required
      if (params.requireTee && provider.teeCapable) score += 10;

      scored.push({ ...provider, score });
    }

    if (scored.length === 0) return null;

    // Return highest scored
    return scored.sort((a, b) => b.score - a.score)[0] || null;
  }

  /**
   * Get providers that are both storage and compute (full stack)
   * These are linked via the same ERC-8004 agent
   */
  async getFullStackProviders(): Promise<Array<{
    agentId: number;
    computeProvider: ComputeProviderInfo;
  }>> {
    const providers = await this.getComputeProviders({ agentLinkedOnly: true });
    
    return providers
      .filter(p => p.agentId > 0)
      .map(p => ({
        agentId: p.agentId,
        computeProvider: p,
      }));
  }
}

/**
 * Create compute integration from environment
 */
export function createComputeIntegration(): StorageComputeIntegration {
  return new StorageComputeIntegration({
    rpcUrl: process.env.RPC_URL || 'http://localhost:9545',
    computeRegistryAddress: process.env.COMPUTE_REGISTRY_ADDRESS,
    computeRentalAddress: process.env.COMPUTE_RENTAL_ADDRESS,
  });
}
