/**
 * Federation SDK - Cross-chain interoperability
 * 
 * Provides access to:
 * - NetworkRegistry: Query and manage federated networks
 * - RegistryHub: Query all registries across chains
 * - FederatedIdentity: Cross-chain identity verification
 * - FederatedSolver: Cross-chain solver discovery
 * 
 * @example
 * ```typescript
 * import { createFederationClient } from '@jejunetwork/sdk';
 * 
 * const federation = await createFederationClient({
 *   hubRpc: 'https://eth.llamarpc.com',
 *   networkRegistry: '0x...',
 *   registryHub: '0x...',
 * });
 * 
 * // List all federated networks
 * const networks = await federation.getNetworks();
 * 
 * // Check if a network can participate in consensus
 * const canVote = await federation.canParticipateInConsensus(420690);
 * ```
 */

import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export enum TrustTier {
  UNSTAKED = 0,
  STAKED = 1,
  VERIFIED = 2,
}

export enum ChainType {
  EVM = 0,
  SOLANA = 1,
  COSMOS = 2,
  OTHER = 3,
}

export enum RegistryType {
  IDENTITY = 0,
  COMPUTE = 1,
  STORAGE = 2,
  SOLVER = 3,
  PACKAGE = 4,
  CONTAINER = 5,
  MODEL = 6,
  NAME_SERVICE = 7,
  REPUTATION = 8,
  OTHER = 9,
}

export interface NetworkInfo {
  chainId: bigint;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  wsUrl: string;
  operator: string;
  contracts: NetworkContracts;
  genesisHash: string;
  registeredAt: bigint;
  stake: bigint;
  trustTier: TrustTier;
  isActive: boolean;
  isVerified: boolean;
  isSuperchain: boolean;
}

export interface NetworkContracts {
  identityRegistry: string;
  solverRegistry: string;
  inputSettler: string;
  outputSettler: string;
  liquidityVault: string;
  governance: string;
  oracle: string;
  registryHub: string;
}

export interface ChainInfo {
  chainId: bigint;
  chainType: ChainType;
  name: string;
  rpcUrl: string;
  networkOperator: string;
  stake: bigint;
  trustTier: TrustTier;
  isActive: boolean;
  registeredAt: bigint;
}

export interface RegistryInfo {
  registryId: string;
  chainId: bigint;
  chainType: ChainType;
  registryType: RegistryType;
  contractAddress: string;
  name: string;
  version: string;
  metadataUri: string;
  entryCount: bigint;
  lastSyncBlock: bigint;
  isActive: boolean;
  registeredAt: bigint;
}

export interface FederationClientConfig {
  hubRpc: string;
  networkRegistry: string;
  registryHub: string;
  privateKey?: string;
}

export interface FederationClient {
  // Network Registry
  getNetwork(chainId: number): Promise<NetworkInfo>;
  getAllNetworks(): Promise<NetworkInfo[]>;
  getStakedNetworks(): Promise<NetworkInfo[]>;
  getVerifiedNetworks(): Promise<NetworkInfo[]>;
  canParticipateInConsensus(chainId: number): Promise<boolean>;
  isSequencerEligible(chainId: number): Promise<boolean>;
  
  // Registry Hub
  getChain(chainId: number): Promise<ChainInfo>;
  getAllChains(): Promise<ChainInfo[]>;
  getRegistry(registryId: string): Promise<RegistryInfo>;
  getAllRegistries(): Promise<RegistryInfo[]>;
  getRegistriesByType(type: RegistryType): Promise<RegistryInfo[]>;
  getRegistriesByChain(chainId: number): Promise<RegistryInfo[]>;
  isTrustedForConsensus(chainId: number): Promise<boolean>;
  
  // Write operations (require privateKey)
  joinFederation(params: JoinFederationParams): Promise<string>;
  addStake(chainId: number, amount: bigint): Promise<string>;
  registerRegistry(params: RegisterRegistryParams): Promise<string>;
}

export interface JoinFederationParams {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
  wsUrl?: string;
  stake?: bigint;
}

export interface RegisterRegistryParams {
  chainId: number;
  registryType: RegistryType;
  contractAddress: string;
  name: string;
  version?: string;
  metadataUri?: string;
}

// ============================================================================
// ABIs
// ============================================================================

const NETWORK_REGISTRY_ABI = [
  'function getNetwork(uint256 chainId) view returns (tuple(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, address operator, tuple(address,address,address,address,address,address,address,address) contracts, bytes32 genesisHash, uint256 registeredAt, uint256 stake, uint8 trustTier, bool isActive, bool isVerified, bool isSuperchain))',
  'function getAllNetworkIds() view returns (uint256[])',
  'function canParticipateInConsensus(uint256 chainId) view returns (bool)',
  'function isSequencerEligible(uint256 chainId) view returns (bool)',
  'function getVerifiedNetworks() view returns (uint256[])',
  'function getActiveNetworks() view returns (uint256[])',
  'function registerNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, tuple(address,address,address,address,address,address,address,address) contracts, bytes32 genesisHash) payable',
  'function addStake(uint256 chainId) payable',
  'function totalNetworks() view returns (uint256)',
  'function activeNetworks() view returns (uint256)',
  'function verifiedNetworks() view returns (uint256)',
];

const REGISTRY_HUB_ABI = [
  'function getChain(uint256 chainId) view returns (tuple(uint256 chainId, uint8 chainType, string name, string rpcUrl, address networkOperator, uint256 stake, uint8 trustTier, bool isActive, uint256 registeredAt))',
  'function getAllChainIds() view returns (uint256[])',
  'function getRegistry(bytes32 registryId) view returns (tuple(bytes32 registryId, uint256 chainId, uint8 chainType, uint8 registryType, bytes32 contractAddress, string name, string version, string metadataUri, uint256 entryCount, uint256 lastSyncBlock, bool isActive, uint256 registeredAt))',
  'function getAllRegistryIds() view returns (bytes32[])',
  'function getRegistriesByType(uint8 registryType) view returns (bytes32[])',
  'function getRegistriesByChain(uint256 chainId) view returns (bytes32[])',
  'function isTrustedForConsensus(uint256 chainId) view returns (bool)',
  'function registerChain(uint256 chainId, uint8 chainType, string name, string rpcUrl) payable',
  'function registerRegistry(uint256 chainId, uint8 registryType, bytes32 contractAddress, string name, string version, string metadataUri)',
  'function totalChains() view returns (uint256)',
  'function totalRegistries() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
];

// ============================================================================
// Client Implementation
// ============================================================================

export async function createFederationClient(
  config: FederationClientConfig
): Promise<FederationClient> {
  const provider = new JsonRpcProvider(config.hubRpc);
  const wallet = config.privateKey ? new Wallet(config.privateKey, provider) : null;
  
  const networkRegistry = new Contract(
    config.networkRegistry,
    NETWORK_REGISTRY_ABI,
    wallet || provider
  );
  
  const registryHub = new Contract(
    config.registryHub,
    REGISTRY_HUB_ABI,
    wallet || provider
  );

  // Helper to parse network info
  function parseNetworkInfo(raw: unknown[]): NetworkInfo {
    const arr = raw as unknown[];
    const contracts = arr[6] as string[];
    return {
      chainId: arr[0] as bigint,
      name: arr[1] as string,
      rpcUrl: arr[2] as string,
      explorerUrl: arr[3] as string,
      wsUrl: arr[4] as string,
      operator: arr[5] as string,
      contracts: {
        identityRegistry: contracts[0],
        solverRegistry: contracts[1],
        inputSettler: contracts[2],
        outputSettler: contracts[3],
        liquidityVault: contracts[4],
        governance: contracts[5],
        oracle: contracts[6],
        registryHub: contracts[7],
      },
      genesisHash: arr[7] as string,
      registeredAt: arr[8] as bigint,
      stake: arr[9] as bigint,
      trustTier: Number(arr[10]) as TrustTier,
      isActive: arr[11] as boolean,
      isVerified: arr[12] as boolean,
      isSuperchain: arr[13] as boolean,
    };
  }

  function parseChainInfo(raw: unknown[]): ChainInfo {
    const arr = raw as unknown[];
    return {
      chainId: arr[0] as bigint,
      chainType: Number(arr[1]) as ChainType,
      name: arr[2] as string,
      rpcUrl: arr[3] as string,
      networkOperator: arr[4] as string,
      stake: arr[5] as bigint,
      trustTier: Number(arr[6]) as TrustTier,
      isActive: arr[7] as boolean,
      registeredAt: arr[8] as bigint,
    };
  }

  function parseRegistryInfo(raw: unknown[]): RegistryInfo {
    const arr = raw as unknown[];
    return {
      registryId: arr[0] as string,
      chainId: arr[1] as bigint,
      chainType: Number(arr[2]) as ChainType,
      registryType: Number(arr[3]) as RegistryType,
      contractAddress: arr[4] as string,
      name: arr[5] as string,
      version: arr[6] as string,
      metadataUri: arr[7] as string,
      entryCount: arr[8] as bigint,
      lastSyncBlock: arr[9] as bigint,
      isActive: arr[10] as boolean,
      registeredAt: arr[11] as bigint,
    };
  }

  return {
    // Network Registry methods
    async getNetwork(chainId: number): Promise<NetworkInfo> {
      const raw = await networkRegistry.getNetwork(chainId);
      return parseNetworkInfo(raw);
    },

    async getAllNetworks(): Promise<NetworkInfo[]> {
      const ids = await networkRegistry.getAllNetworkIds();
      const networks = await Promise.all(
        ids.map((id: bigint) => networkRegistry.getNetwork(id))
      );
      return networks.map(parseNetworkInfo);
    },

    async getStakedNetworks(): Promise<NetworkInfo[]> {
      const ids = await networkRegistry.getAllNetworkIds();
      const networks = await Promise.all(
        ids.map((id: bigint) => networkRegistry.getNetwork(id))
      );
      return networks.map(parseNetworkInfo).filter((n: NetworkInfo) => n.trustTier >= TrustTier.STAKED && n.isActive);
    },

    async getVerifiedNetworks(): Promise<NetworkInfo[]> {
      const ids = await networkRegistry.getVerifiedNetworks();
      const networks = await Promise.all(
        ids.map((id: bigint) => networkRegistry.getNetwork(id))
      );
      return networks.map(parseNetworkInfo);
    },

    async canParticipateInConsensus(chainId: number): Promise<boolean> {
      return networkRegistry.canParticipateInConsensus(chainId);
    },

    async isSequencerEligible(chainId: number): Promise<boolean> {
      return networkRegistry.isSequencerEligible(chainId);
    },

    // Registry Hub methods
    async getChain(chainId: number): Promise<ChainInfo> {
      const raw = await registryHub.getChain(chainId);
      return parseChainInfo(raw);
    },

    async getAllChains(): Promise<ChainInfo[]> {
      const ids = await registryHub.getAllChainIds();
      const chains = await Promise.all(
        ids.map((id: bigint) => registryHub.getChain(id))
      );
      return chains.map(parseChainInfo);
    },

    async getRegistry(registryId: string): Promise<RegistryInfo> {
      const raw = await registryHub.getRegistry(registryId);
      return parseRegistryInfo(raw);
    },

    async getAllRegistries(): Promise<RegistryInfo[]> {
      const ids = await registryHub.getAllRegistryIds();
      const registries = await Promise.all(
        ids.map((id: string) => registryHub.getRegistry(id))
      );
      return registries.map(parseRegistryInfo);
    },

    async getRegistriesByType(type: RegistryType): Promise<RegistryInfo[]> {
      const ids = await registryHub.getRegistriesByType(type);
      const registries = await Promise.all(
        ids.map((id: string) => registryHub.getRegistry(id))
      );
      return registries.map(parseRegistryInfo);
    },

    async getRegistriesByChain(chainId: number): Promise<RegistryInfo[]> {
      const ids = await registryHub.getRegistriesByChain(chainId);
      const registries = await Promise.all(
        ids.map((id: string) => registryHub.getRegistry(id))
      );
      return registries.map(parseRegistryInfo);
    },

    async isTrustedForConsensus(chainId: number): Promise<boolean> {
      return registryHub.isTrustedForConsensus(chainId);
    },

    // Write methods
    async joinFederation(params: JoinFederationParams): Promise<string> {
      if (!wallet) throw new Error('Private key required for write operations');
      
      const contracts = {
        identityRegistry: '0x0000000000000000000000000000000000000000',
        solverRegistry: '0x0000000000000000000000000000000000000000',
        inputSettler: '0x0000000000000000000000000000000000000000',
        outputSettler: '0x0000000000000000000000000000000000000000',
        liquidityVault: '0x0000000000000000000000000000000000000000',
        governance: '0x0000000000000000000000000000000000000000',
        oracle: '0x0000000000000000000000000000000000000000',
        registryHub: '0x0000000000000000000000000000000000000000',
      };
      
      const tx = await networkRegistry.registerNetwork(
        params.chainId,
        params.name,
        params.rpcUrl,
        params.explorerUrl || '',
        params.wsUrl || '',
        Object.values(contracts),
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        { value: params.stake || 0n }
      );
      
      const receipt = await tx.wait();
      return receipt.hash;
    },

    async addStake(chainId: number, amount: bigint): Promise<string> {
      if (!wallet) throw new Error('Private key required for write operations');
      
      const tx = await networkRegistry.addStake(chainId, { value: amount });
      const receipt = await tx.wait();
      return receipt.hash;
    },

    async registerRegistry(params: RegisterRegistryParams): Promise<string> {
      if (!wallet) throw new Error('Private key required for write operations');
      
      // Pad address to bytes32
      const addressBytes32 = '0x' + params.contractAddress.slice(2).padStart(64, '0');
      
      const tx = await registryHub.registerRegistry(
        params.chainId,
        params.registryType,
        addressBytes32,
        params.name,
        params.version || '1.0.0',
        params.metadataUri || ''
      );
      
      const receipt = await tx.wait();
      return receipt.hash;
    },
  };
}

// ============================================================================
// Utilities
// ============================================================================

export function trustTierToString(tier: TrustTier): string {
  switch (tier) {
    case TrustTier.UNSTAKED: return 'UNSTAKED';
    case TrustTier.STAKED: return 'STAKED';
    case TrustTier.VERIFIED: return 'VERIFIED';
    default: return 'UNKNOWN';
  }
}

export function registryTypeToString(type: RegistryType): string {
  const types = ['IDENTITY', 'COMPUTE', 'STORAGE', 'SOLVER', 'PACKAGE', 'CONTAINER', 'MODEL', 'NAME_SERVICE', 'REPUTATION', 'OTHER'];
  return types[type] || 'UNKNOWN';
}

export function chainTypeToString(type: ChainType): string {
  switch (type) {
    case ChainType.EVM: return 'EVM';
    case ChainType.SOLANA: return 'SOLANA';
    case ChainType.COSMOS: return 'COSMOS';
    case ChainType.OTHER: return 'OTHER';
    default: return 'UNKNOWN';
  }
}

export { parseEther, formatEther };

