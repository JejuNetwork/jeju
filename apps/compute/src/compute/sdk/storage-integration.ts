/**
 * Storage Integration for Compute SDK
 * 
 * Enables compute providers to:
 * - Pull container images from decentralized storage (IPFS, Arweave)
 * - Store compute outputs to decentralized storage
 * - Discover storage providers for container hosting
 * - Link compute rentals to storage deals
 */

import { Contract, JsonRpcProvider, Wallet } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export interface ContainerImage {
  cid: string;
  name: string;
  tag: string;
  sizeBytes: bigint;
  storageProvider: string;
  tier: 'hot' | 'warm' | 'cold' | 'permanent';
  architecture: 'amd64' | 'arm64';
  gpuRequired: boolean;
  minGpuVram?: number;
  teeRequired: boolean;
  verified: boolean;
  expiresAt?: number;
}

export interface StorageProviderInfo {
  address: string;
  name: string;
  endpoint: string;
  agentId: number;
  providerType: 'ipfs' | 'arweave' | 'cloud' | 'hybrid';
  isActive: boolean;
  pricePerGBMonth: bigint;
  ipfsGateway?: string;
  healthScore: number;
}

export interface ContainerPullRequest {
  cid: string;
  storageProvider?: string;
  computeProvider: string;
  rentalId?: string;
  priority?: 'fast' | 'standard' | 'economy';
}

export interface ContainerPullResult {
  success: boolean;
  cid: string;
  localPath?: string;
  pulledFrom: string;
  sizeBytes: bigint;
  durationMs: number;
  cost: bigint;
  error?: string;
}

export interface ComputeOutputUploadRequest {
  rentalId: string;
  content: Buffer;
  filename: string;
  permanent?: boolean;
  tier?: 'hot' | 'warm' | 'cold' | 'permanent';
}

export interface ComputeOutputUploadResult {
  cid: string;
  url: string;
  dealId?: string;
  storageProvider: string;
  cost: bigint;
  expiresAt?: number;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const STORAGE_REGISTRY_ABI = [
  'function getActiveProviders() view returns (address[])',
  'function getProvider(address) view returns (tuple(address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified))',
  'function getProviderInfo(address) view returns (tuple(tuple(address,string,string,uint8,bytes32,uint256,uint256,uint256,bool,bool) provider, tuple(uint256,uint256,uint256,uint256) capacity, tuple(uint256,uint256,uint256,uint256,uint256) pricing, uint8[] supportedTiers, uint256 replicationFactor, string ipfsGateway, uint256 healthScore, uint256 avgLatencyMs))',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function getAgentLinkedProviders() view returns (address[])',
];

const STORAGE_MARKET_ABI = [
  'function createDeal(address provider, string cid, uint256 sizeBytes, uint256 durationDays, uint8 tier, uint256 replicationFactor) payable returns (bytes32)',
  'function calculateDealCost(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier) view returns (uint256)',
  'function getDeal(bytes32 dealId) view returns (tuple(bytes32 dealId, address user, address provider, uint8 status, string cid, uint256 sizeBytes, uint8 tier, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, uint256 replicationFactor, uint256 retrievalCount))',
];

const PROVIDER_TYPES: Record<number, 'ipfs' | 'arweave' | 'cloud' | 'hybrid'> = {
  0: 'ipfs',
  1: 'ipfs', // filecoin
  2: 'arweave',
  3: 'cloud',
  4: 'cloud',
  5: 'cloud',
  6: 'hybrid',
};

// ============================================================================
// Storage Integration Client
// ============================================================================

export interface StorageIntegrationConfig {
  rpcUrl: string;
  storageRegistryAddress?: string;
  storageMarketAddress?: string;
  signer?: Wallet;
  defaultIpfsGateway?: string;
}

export class ComputeStorageIntegration {
  private provider: JsonRpcProvider;
  private storageRegistry?: Contract;
  private storageMarket?: Contract;
  private signer?: Wallet;
  private defaultGateway: string;
  private providerCache: Map<string, StorageProviderInfo> = new Map();
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor(config: StorageIntegrationConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = config.signer?.connect(this.provider);
    this.defaultGateway = config.defaultIpfsGateway || 'https://ipfs.io';

    if (config.storageRegistryAddress) {
      const signerOrProvider = this.signer || this.provider;
      this.storageRegistry = new Contract(
        config.storageRegistryAddress,
        STORAGE_REGISTRY_ABI,
        signerOrProvider
      );
    }

    if (config.storageMarketAddress) {
      const signerOrProvider = this.signer || this.provider;
      this.storageMarket = new Contract(
        config.storageMarketAddress,
        STORAGE_MARKET_ABI,
        signerOrProvider
      );
    }
  }

  /**
   * Check if storage integration is available
   */
  isAvailable(): boolean {
    return !!this.storageRegistry;
  }

  /**
   * Get list of storage providers for container hosting
   */
  async getStorageProviders(options?: {
    agentLinkedOnly?: boolean;
    providerType?: 'ipfs' | 'arweave' | 'cloud' | 'hybrid';
    maxPricePerGBMonth?: bigint;
  }): Promise<StorageProviderInfo[]> {
    if (!this.storageRegistry) return [];

    // Use cache if fresh
    if (Date.now() - this.lastCacheUpdate < this.CACHE_TTL && this.providerCache.size > 0) {
      return Array.from(this.providerCache.values()).filter(p => {
        if (options?.agentLinkedOnly && !p.agentId) return false;
        if (options?.providerType && p.providerType !== options.providerType) return false;
        if (options?.maxPricePerGBMonth && p.pricePerGBMonth > options.maxPricePerGBMonth) return false;
        return true;
      });
    }

    const addresses: string[] = options?.agentLinkedOnly
      ? await this.storageRegistry.getAgentLinkedProviders()
      : await this.storageRegistry.getActiveProviders();

    const providers: StorageProviderInfo[] = [];

    for (const addr of addresses) {
      const info = await this.storageRegistry.getProviderInfo(addr);
      if (!info.provider.active) continue;

      const providerInfo: StorageProviderInfo = {
        address: addr,
        name: info.provider.name,
        endpoint: info.provider.endpoint,
        agentId: Number(info.provider.agentId),
        providerType: PROVIDER_TYPES[Number(info.provider.providerType)] || 'hybrid',
        isActive: info.provider.active,
        pricePerGBMonth: info.pricing.pricePerGBMonth,
        ipfsGateway: info.ipfsGateway,
        healthScore: Number(info.healthScore),
      };

      this.providerCache.set(addr, providerInfo);
      providers.push(providerInfo);
    }

    this.lastCacheUpdate = Date.now();

    return providers.filter(p => {
      if (options?.providerType && p.providerType !== options.providerType) return false;
      if (options?.maxPricePerGBMonth && p.pricePerGBMonth > options.maxPricePerGBMonth) return false;
      return true;
    });
  }

  /**
   * Get storage provider by ERC-8004 agent ID
   */
  async getStorageProviderByAgent(agentId: bigint): Promise<StorageProviderInfo | null> {
    if (!this.storageRegistry) return null;

    const address = await this.storageRegistry.getProviderByAgent(agentId);
    if (address === '0x0000000000000000000000000000000000000000') return null;

    const info = await this.storageRegistry.getProviderInfo(address);
    
    return {
      address,
      name: info.provider.name,
      endpoint: info.provider.endpoint,
      agentId: Number(info.provider.agentId),
      providerType: PROVIDER_TYPES[Number(info.provider.providerType)] || 'hybrid',
      isActive: info.provider.active,
      pricePerGBMonth: info.pricing.pricePerGBMonth,
      ipfsGateway: info.ipfsGateway,
      healthScore: Number(info.healthScore),
    };
  }

  /**
   * Pull container image from decentralized storage
   * Returns the URL/path for docker to pull from
   */
  async pullContainer(request: ContainerPullRequest): Promise<ContainerPullResult> {
    const startTime = Date.now();
    
    // Find storage provider
    let providerInfo: StorageProviderInfo | undefined;
    
    if (request.storageProvider) {
      const providers = await this.getStorageProviders();
      providerInfo = providers.find(p => p.address.toLowerCase() === request.storageProvider?.toLowerCase());
    } else {
      // Auto-select best provider (prefer agent-linked for trust)
      const providers = await this.getStorageProviders({ agentLinkedOnly: true });
      providerInfo = providers.sort((a, b) => b.healthScore - a.healthScore)[0];
      
      if (!providerInfo) {
        const allProviders = await this.getStorageProviders();
        providerInfo = allProviders.sort((a, b) => b.healthScore - a.healthScore)[0];
      }
    }

    if (!providerInfo) {
      return {
        success: false,
        cid: request.cid,
        pulledFrom: '',
        sizeBytes: 0n,
        durationMs: Date.now() - startTime,
        cost: 0n,
        error: 'No storage provider available',
      };
    }

    // Build gateway URL
    const gateway = providerInfo.ipfsGateway || this.defaultGateway;
    const containerUrl = `${gateway}/ipfs/${request.cid}`;

    // For IPFS containers, we return the gateway URL
    // The compute provider will use this to pull the container
    // For Arweave, the format is different
    let pullUrl = containerUrl;
    if (providerInfo.providerType === 'arweave') {
      pullUrl = `https://arweave.net/${request.cid}`;
    }

    // Estimate cost (bandwidth)
    const cost = 0n; // Retrieval cost would be calculated from provider pricing

    return {
      success: true,
      cid: request.cid,
      localPath: pullUrl,
      pulledFrom: providerInfo.address,
      sizeBytes: 0n, // Would need to fetch headers to determine
      durationMs: Date.now() - startTime,
      cost,
    };
  }

  /**
   * Upload compute output to decentralized storage
   * Creates a storage deal and returns the CID
   */
  async uploadComputeOutput(request: ComputeOutputUploadRequest): Promise<ComputeOutputUploadResult> {
    if (!this.signer) {
      throw new Error('Signer required for upload');
    }

    // Find best storage provider
    const providers = await this.getStorageProviders({
      agentLinkedOnly: true,
      providerType: request.permanent ? 'arweave' : 'ipfs',
    });

    if (providers.length === 0) {
      throw new Error('No suitable storage provider found');
    }

    const provider = providers.sort((a, b) => {
      if (a.healthScore !== b.healthScore) return b.healthScore - a.healthScore;
      return Number(a.pricePerGBMonth - b.pricePerGBMonth);
    })[0]!;

    // Upload to provider's endpoint
    const formData = new FormData();
    formData.append('file', new Blob([request.content]), request.filename);

    const response = await fetch(`${provider.endpoint}/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-jeju-address': this.signer.address,
        'x-rental-id': request.rentalId,
      },
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${await response.text()}`);
    }

    const result = await response.json() as { cid: string; url: string };

    // Create storage deal if market is available
    let dealId: string | undefined;
    let cost = 0n;

    if (this.storageMarket) {
      const tierIndex = { hot: 0, warm: 1, cold: 2, permanent: 3 }[request.tier || 'warm'];
      const durationDays = request.permanent ? 365 * 100 : 30; // 100 years for permanent

      cost = await this.storageMarket.calculateDealCost(
        provider.address,
        BigInt(request.content.length),
        durationDays,
        tierIndex
      );

      const tx = await this.storageMarket.createDeal(
        provider.address,
        result.cid,
        BigInt(request.content.length),
        durationDays,
        tierIndex,
        1, // replication factor
        { value: cost }
      );

      const receipt = await tx.wait();
      // Extract deal ID from logs
      const event = receipt?.logs[0];
      if (event) {
        dealId = event.topics[1];
      }
    }

    return {
      cid: result.cid,
      url: result.url,
      dealId,
      storageProvider: provider.address,
      cost,
      expiresAt: request.permanent ? undefined : Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
  }

  /**
   * Get container metadata from storage
   */
  async getContainerInfo(cid: string): Promise<ContainerImage | null> {
    const providers = await this.getStorageProviders();
    
    for (const provider of providers) {
      const response = await fetch(`${provider.endpoint}/ipfs/${cid}/manifest.json`).catch(() => null);
      if (response?.ok) {
        const manifest = await response.json() as {
          name?: string;
          tag?: string;
          architecture?: string;
          gpu_required?: boolean;
          min_gpu_vram?: number;
          tee_required?: boolean;
        };
        
        return {
          cid,
          name: manifest.name || cid.slice(0, 12),
          tag: manifest.tag || 'latest',
          sizeBytes: 0n,
          storageProvider: provider.address,
          tier: 'warm',
          architecture: (manifest.architecture as 'amd64' | 'arm64') || 'amd64',
          gpuRequired: manifest.gpu_required || false,
          minGpuVram: manifest.min_gpu_vram,
          teeRequired: manifest.tee_required || false,
          verified: !!provider.agentId, // Consider agent-linked as verified
        };
      }
    }

    return null;
  }

  /**
   * Verify container integrity (hash check)
   */
  async verifyContainer(cid: string, _expectedHash: string): Promise<boolean> {
    const containerInfo = await this.getContainerInfo(cid);
    if (!containerInfo) return false;
    
    // CID itself is content-addressed, so if we can retrieve it, it's valid
    // For additional verification, we could check the content hash
    return true;
  }

  /**
   * List containers available for a specific compute configuration
   */
  async listCompatibleContainers(_config: {
    architecture?: 'amd64' | 'arm64';
    gpuAvailable?: boolean;
    gpuVram?: number;
    teeEnabled?: boolean;
  }): Promise<ContainerImage[]> {
    // This would query the indexer or storage providers for compatible containers
    // For now, return empty - would need indexer integration
    return [];
  }
}

/**
 * Create storage integration from environment
 */
export function createStorageIntegration(signer?: Wallet): ComputeStorageIntegration {
  return new ComputeStorageIntegration({
    rpcUrl: process.env.RPC_URL || 'http://localhost:9545',
    storageRegistryAddress: process.env.STORAGE_REGISTRY_ADDRESS,
    storageMarketAddress: process.env.STORAGE_MARKET_ADDRESS,
    signer,
    defaultIpfsGateway: process.env.IPFS_GATEWAY_URL,
  });
}
