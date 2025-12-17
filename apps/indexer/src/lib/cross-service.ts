import { createPublicClient, http, keccak256, stringToHex, type Address, type Chain } from 'viem';
import { parseAbi } from 'viem';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readContract<T>(client: { readContract: (params: unknown) => Promise<unknown> }, params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<T> {
  return client.readContract(params) as Promise<T>;
}

export interface CrossServiceProvider {
  address: string;
  name: string;
  endpoint: string;
  agentId: number; // ERC-8004 agent ID (0 if not linked)
  stake: bigint;
  isActive: boolean;
  registeredAt: number;
  providerType: 'compute' | 'storage';
  
  // Common metrics
  healthScore: number;
  totalEarnings: bigint;
  
  // Service-specific capabilities
  capabilities: ComputeCapabilities | StorageCapabilities;
}

export interface ComputeCapabilities {
  type: 'compute';
  gpuType: string;
  gpuCount: number;
  gpuVram: number;
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
  teeCapable: boolean;
  sshEnabled: boolean;
  dockerEnabled: boolean;
  pricePerHour: bigint;
  supportedModels: string[];
  containerRegistries: string[]; // Supported container sources (CIDs from storage)
}

export interface StorageCapabilities {
  type: 'storage';
  providerType: 'ipfs' | 'arweave' | 'cloud' | 'hybrid';
  totalCapacityGB: number;
  availableCapacityGB: number;
  pricePerGBMonth: bigint;
  supportedTiers: ('hot' | 'warm' | 'cold' | 'permanent')[];
  ipfsGateway?: string;
  replicationFactor: number;
}

/**
 * Container image stored on decentralized storage for compute use
 */
export interface ContainerImage {
  cid: string; // IPFS CID or Arweave TX ID
  name: string;
  tag: string;
  sizeBytes: bigint;
  uploadedAt: number;
  uploadedBy: string;
  
  // Storage info
  storageProvider: string;
  storageDealId?: string;
  tier: 'hot' | 'warm' | 'cold' | 'permanent';
  expiresAt?: number;
  
  // Compute compatibility
  architecture: 'amd64' | 'arm64';
  gpuRequired: boolean;
  minGpuVram?: number;
  teeRequired: boolean;
  
  // Verification
  contentHash: string; // SHA256 of container
  verified: boolean;
  verifiedBy?: string; // ERC-8004 agent ID that verified
}

/**
 * Cross-service resource request
 * Used when a compute rental needs to pull from storage
 */
export interface CrossServiceRequest {
  requestId: string;
  requester: string;
  type: 'container_pull' | 'data_load' | 'model_fetch';
  
  // Source (storage)
  sourceCid: string;
  sourceProvider?: string;
  
  // Destination (compute)
  destinationProvider: string;
  destinationRentalId?: string;
  
  // Status
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  
  // Cost
  storageCost: bigint;
  bandwidthCost: bigint;
  totalCost: bigint;
  
  // Result
  error?: string;
}

/**
 * Marketplace stats across compute and storage
 */
export interface MarketplaceStats {
  // Compute
  compute: {
    totalProviders: number;
    activeProviders: number;
    agentLinkedProviders: number;
    totalGpuHours: number;
    activeRentals: number;
    totalStaked: bigint;
    totalEarnings: bigint;
    avgPricePerHour: bigint;
  };
  
  // Storage
  storage: {
    totalProviders: number;
    activeProviders: number;
    agentLinkedProviders: number;
    totalCapacityTB: number;
    usedCapacityTB: number;
    activeDeals: number;
    totalStaked: bigint;
    totalEarnings: bigint;
    avgPricePerGBMonth: bigint;
  };
  
  // Cross-service
  crossService: {
    totalContainerImages: number;
    totalCrossServiceRequests: number;
    successfulRequests: number;
    avgCrossServiceLatencyMs: number;
  };
  
  // ERC-8004
  erc8004: {
    totalAgentLinkedProviders: number;
    computeWithAgents: number;
    storageWithAgents: number;
    bannedAgents: number;
  };
  
  lastUpdated: number;
}

// ============================================================================
// Contract ABIs for Cross-Service Operations
// ============================================================================

export const COMPUTE_REGISTRY_ABI = parseAbi([
  'function getProvider(address) view returns (tuple(string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active))',
  'function getActiveProviders() view returns (address[])',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function isActive(address) view returns (bool)',
]);

export const STORAGE_REGISTRY_ABI = parseAbi([
  'function getProvider(address) view returns (tuple(address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified))',
  'function getActiveProviders() view returns (address[])',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function hasValidAgent(address) view returns (bool)',
  'function getAgentLinkedProviders() view returns (address[])',
]);

export const IDENTITY_REGISTRY_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function agentExists(uint256 agentId) view returns (bool)',
  'function getMetadata(uint256 agentId, string key) view returns (bytes)',
  'function getAgentsByTag(string tag) view returns (uint256[])',
]);

export const BAN_MANAGER_ABI = parseAbi([
  'function isBanned(uint256 agentId) view returns (bool)',
  'function isAddressBanned(address) view returns (bool)',
  'function isAccessAllowed(uint256 agentId, bytes32 appId) view returns (bool)',
]);

// ============================================================================
// Cross-Service Client
// ============================================================================

export interface CrossServiceConfig {
  rpcUrl: string;
  computeRegistryAddress?: string;
  storageRegistryAddress?: string;
  identityRegistryAddress?: string;
  banManagerAddress?: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class CrossServiceClient {
  private publicClient: { readContract: (params: unknown) => Promise<unknown> };
  private computeRegistryAddress?: Address;
  private storageRegistryAddress?: Address;
  private identityRegistryAddress?: Address;
  private banManagerAddress?: Address;

  constructor(config: CrossServiceConfig) {
    const chain: Chain = { id: 42069, name: 'Network', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } };
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    
    if (config.computeRegistryAddress && config.computeRegistryAddress !== ZERO_ADDRESS) {
      this.computeRegistryAddress = config.computeRegistryAddress as Address;
    }
    
    if (config.storageRegistryAddress && config.storageRegistryAddress !== ZERO_ADDRESS) {
      this.storageRegistryAddress = config.storageRegistryAddress as Address;
    }
    
    if (config.identityRegistryAddress && config.identityRegistryAddress !== ZERO_ADDRESS) {
      this.identityRegistryAddress = config.identityRegistryAddress as Address;
    }
    
    if (config.banManagerAddress && config.banManagerAddress !== ZERO_ADDRESS) {
      this.banManagerAddress = config.banManagerAddress as Address;
    }
  }

  /**
   * Find all providers (compute + storage) linked to an ERC-8004 agent
   */
  async getProvidersByAgent(agentId: bigint): Promise<{
    compute: string | null;
    storage: string | null;
    banned: boolean;
  }> {
    let computeAddress: string | null = null;
    let storageAddress: string | null = null;
    let banned = false;

    if (this.computeRegistryAddress) {
      const addr = await readContract<string>(this.publicClient, {
        address: this.computeRegistryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getProviderByAgent',
        args: [agentId],
      });
      if (addr !== ZERO_ADDRESS) computeAddress = addr;
    }

    if (this.storageRegistryAddress) {
      const addr = await readContract<string>(this.publicClient, {
        address: this.storageRegistryAddress,
        abi: STORAGE_REGISTRY_ABI,
        functionName: 'getProviderByAgent',
        args: [agentId],
      });
      if (addr !== ZERO_ADDRESS) storageAddress = addr;
    }

    if (this.banManagerAddress) {
      banned = await readContract<boolean>(this.publicClient, {
        address: this.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isBanned',
        args: [agentId],
      });
    }

    return { compute: computeAddress, storage: storageAddress, banned };
  }

  /**
   * Find agents providing both compute and storage services
   */
  async getFullStackAgents(): Promise<Array<{
    agentId: bigint;
    computeProvider: string;
    storageProvider: string;
    owner: string;
  }>> {
    if (!this.identityRegistryAddress) return [];

    const fullStackAgents: Array<{
      agentId: bigint;
      computeProvider: string;
      storageProvider: string;
      owner: string;
    }> = [];

    // Get agents tagged as both compute and storage providers
    const computeAgents = await readContract<bigint[]>(this.publicClient, {
      address: this.identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: ['compute'],
    }) as bigint[];
    const storageAgents = await readContract<bigint[]>(this.publicClient, {
      address: this.identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: ['storage'],
    }) as bigint[];

    const computeSet = new Set(computeAgents.map((a: bigint) => a.toString()));
    
    for (const agentId of storageAgents) {
      if (computeSet.has(agentId.toString())) {
        const providers = await this.getProvidersByAgent(agentId);
        if (providers.compute && providers.storage && !providers.banned) {
          const owner = await readContract<string>(this.publicClient, {
            address: this.identityRegistryAddress!,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'ownerOf',
            args: [agentId],
          });
          fullStackAgents.push({
            agentId,
            computeProvider: providers.compute,
            storageProvider: providers.storage,
            owner,
          });
        }
      }
    }

    return fullStackAgents;
  }

  /**
   * Find storage providers that can serve a container for a compute rental
   */
  async findStorageForCompute(params: {
    containerCid: string;
    computeProvider: string;
    requiredTier?: 'hot' | 'warm' | 'cold';
    preferAgentLinked?: boolean;
  }): Promise<string[]> {
    if (!this.storageRegistryAddress) return [];

    const providers = await readContract<string[]>(this.publicClient, {
      address: this.storageRegistryAddress,
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'getActiveProviders',
    }) as Address[];
    const candidates: string[] = [];

    for (const addr of providers) {
      const provider = await readContract<{ endpoint?: string; stakeAmount?: bigint; stake?: bigint; isActive?: boolean; active?: boolean; agentId: bigint }>(this.publicClient, {
        address: this.storageRegistryAddress!,
        abi: STORAGE_REGISTRY_ABI,
        functionName: 'getProvider',
        args: [addr],
      }) as { active: boolean; agentId: bigint };
      if (!provider.active) continue;

      // Prefer agent-linked providers if requested
      if (params.preferAgentLinked && !provider.agentId) continue;

      candidates.push(addr);
    }

    return candidates;
  }

  /**
   * Find compute providers that can run a container stored in storage
   */
  async findComputeForContainer(params: {
    containerCid: string;
    minGpuVram?: number;
    requireTee?: boolean;
    preferAgentLinked?: boolean;
  }): Promise<string[]> {
    if (!this.computeRegistryAddress) return [];

    const providers = await readContract<string[]>(this.publicClient, {
      address: this.computeRegistryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'getActiveProviders',
    }) as Address[];
    const candidates: string[] = [];

    for (const addr of providers) {
      const isActive = await readContract<boolean>(this.publicClient, {
        address: this.computeRegistryAddress!,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'isActive',
        args: [addr],
      });
      if (!isActive) continue;

      const provider = await readContract<{ endpoint?: string; stakeAmount?: bigint; stake?: bigint; isActive?: boolean; active?: boolean; agentId: bigint }>(this.publicClient, {
        address: this.computeRegistryAddress!,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getProvider',
        args: [addr],
      }) as { agentId: bigint };
      
      // Prefer agent-linked providers if requested
      if (params.preferAgentLinked && !provider.agentId) continue;

      candidates.push(addr);
    }

    return candidates;
  }

  /**
   * Check if an agent is banned from either compute or storage
   */
  async isAgentBanned(agentId: bigint): Promise<boolean> {
    if (!this.banManagerAddress) return false;
    return await readContract<boolean>(this.publicClient, {
      address: this.banManagerAddress,
      abi: BAN_MANAGER_ABI,
      functionName: 'isBanned',
      args: [agentId],
    });
  }

  /**
   * Get stats across compute and storage
   */
  async getMarketplaceStats(): Promise<MarketplaceStats> {
    const stats: MarketplaceStats = {
      compute: {
        totalProviders: 0,
        activeProviders: 0,
        agentLinkedProviders: 0,
        totalGpuHours: 0,
        activeRentals: 0,
        totalStaked: 0n,
        totalEarnings: 0n,
        avgPricePerHour: 0n,
      },
      storage: {
        totalProviders: 0,
        activeProviders: 0,
        agentLinkedProviders: 0,
        totalCapacityTB: 0,
        usedCapacityTB: 0,
        activeDeals: 0,
        totalStaked: 0n,
        totalEarnings: 0n,
        avgPricePerGBMonth: 0n,
      },
      crossService: {
        totalContainerImages: 0,
        totalCrossServiceRequests: 0,
        successfulRequests: 0,
        avgCrossServiceLatencyMs: 0,
      },
      erc8004: {
        totalAgentLinkedProviders: 0,
        computeWithAgents: 0,
        storageWithAgents: 0,
        bannedAgents: 0,
      },
      lastUpdated: Date.now(),
    };

    // Compute providers
    if (this.computeRegistryAddress) {
      const computeProviders = await readContract<string[]>(this.publicClient, {
        address: this.computeRegistryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getActiveProviders',
      }) as Address[];
      stats.compute.totalProviders = computeProviders.length;
      
      for (const addr of computeProviders) {
        const provider = await readContract<{ endpoint?: string; stakeAmount?: bigint; stake?: bigint; isActive?: boolean; active?: boolean; agentId: bigint }>(this.publicClient, {
          address: this.computeRegistryAddress!,
          abi: COMPUTE_REGISTRY_ABI,
          functionName: 'getProvider',
          args: [addr],
        }) as { active: boolean; stake: bigint; agentId: bigint };
        if (provider.active) {
          stats.compute.activeProviders++;
          stats.compute.totalStaked += provider.stake;
          if (provider.agentId > 0n) {
            stats.compute.agentLinkedProviders++;
            stats.erc8004.computeWithAgents++;
          }
        }
      }
    }

    // Storage providers
    if (this.storageRegistryAddress) {
      const storageProviders = await readContract<string[]>(this.publicClient, {
        address: this.storageRegistryAddress,
        abi: STORAGE_REGISTRY_ABI,
        functionName: 'getActiveProviders',
      }) as Address[];
      stats.storage.totalProviders = storageProviders.length;
      
      for (const addr of storageProviders) {
        const provider = await readContract<{ endpoint?: string; stakeAmount?: bigint; stake?: bigint; isActive?: boolean; active?: boolean; agentId: bigint }>(this.publicClient, {
          address: this.storageRegistryAddress!,
          abi: STORAGE_REGISTRY_ABI,
          functionName: 'getProvider',
          args: [addr],
        }) as { active: boolean; stake: bigint; agentId: bigint };
        if (provider.active) {
          stats.storage.activeProviders++;
          stats.storage.totalStaked += provider.stake;
          if (provider.agentId > 0n) {
            stats.storage.agentLinkedProviders++;
            stats.erc8004.storageWithAgents++;
          }
        }
      }
    }

    stats.erc8004.totalAgentLinkedProviders = 
      stats.erc8004.computeWithAgents + stats.erc8004.storageWithAgents;

    return stats;
  }
}

/**
 * Create cross-service client from environment
 */
export function createCrossServiceClient(): CrossServiceClient {
  return new CrossServiceClient({
    rpcUrl: process.env.RPC_URL || 'http://localhost:9545',
    computeRegistryAddress: process.env.COMPUTE_REGISTRY_ADDRESS,
    storageRegistryAddress: process.env.STORAGE_REGISTRY_ADDRESS,
    identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS,
    banManagerAddress: process.env.BAN_MANAGER_ADDRESS,
  });
}

// ============================================================================
// Event Signatures for Cross-Service Indexing
// ============================================================================

export const CROSS_SERVICE_EVENTS = {
  // Container stored for compute use
  ContainerStored: keccak256(stringToHex('ContainerStored(string,address,address,uint256)')),
  
  // Container pulled by compute provider
  ContainerPulled: keccak256(stringToHex('ContainerPulled(bytes32,string,address,address)')),
  
  // Cross-service request created
  CrossServiceRequestCreated: keccak256(stringToHex('CrossServiceRequestCreated(bytes32,address,string,address)')),
  
  // Cross-service request completed
  CrossServiceRequestCompleted: keccak256(stringToHex('CrossServiceRequestCompleted(bytes32,bool)')),
};

export const CROSS_SERVICE_EVENT_SET = new Set(Object.values(CROSS_SERVICE_EVENTS));

export function isCrossServiceEvent(topic0: string): boolean {
  return CROSS_SERVICE_EVENT_SET.has(topic0 as `0x${string}`);
}
