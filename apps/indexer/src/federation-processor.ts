/**
 * Federation Processor - Multi-chain registry aggregation
 * 
 * Watches:
 * - NetworkRegistry events on L1 hub
 * - RegistryHub events on L1 hub
 * - IdentityRegistry events on all federated chains
 * - ComputeRegistry events on all federated chains
 * - StorageProviderRegistry events on all federated chains
 * - SolverRegistry events on all federated chains
 * 
 * Aggregates:
 * - All federated networks
 * - All registries across networks
 * - Deduplicated entries (by federated ID)
 */

import { Store } from '@subsquid/typeorm-store';
import { ethers } from 'ethers';

// Event signatures
const NETWORK_REGISTERED = ethers.id('NetworkRegistered(uint256,string,address,uint256)');
const REGISTRY_REGISTERED = ethers.id('RegistryRegistered(bytes32,uint256,uint8,bytes32,string)');
const ENTRY_FEDERATED = ethers.id('EntryFederated(bytes32,bytes32,bytes32,string)');
const AGENT_REGISTERED = ethers.id('Registered(uint256,address,uint8,uint256,string)');

// Trust tiers
enum TrustTier {
  UNSTAKED = 0,
  STAKED = 1,
  VERIFIED = 2
}

// Registry types
enum RegistryType {
  IDENTITY = 0,
  COMPUTE = 1,
  STORAGE = 2,
  SOLVER = 3,
  PACKAGE = 4,
  CONTAINER = 5,
  MODEL = 6,
  NAME_SERVICE = 7,
  REPUTATION = 8,
  OTHER = 9
}

interface FederatedNetwork {
  chainId: number;
  name: string;
  rpcUrl: string;
  operator: string;
  stake: bigint;
  trustTier: TrustTier;
  isActive: boolean;
  isSuperchain: boolean;
  registeredAt: Date;
  contracts: {
    identityRegistry: string;
    solverRegistry: string;
    inputSettler: string;
    outputSettler: string;
  };
}

interface FederatedRegistry {
  registryId: string;
  chainId: number;
  registryType: RegistryType;
  contractAddress: string;
  name: string;
  version: string;
  entryCount: number;
  lastSyncBlock: number;
  isActive: boolean;
}

interface FederatedEntry {
  entryId: string;
  registryId: string;
  originId: string;
  name: string;
  metadataUri: string;
  originChainId: number;
  syncedAt: Date;
}

// In-memory cache (would be stored in DB in production)
const federatedNetworks = new Map<number, FederatedNetwork>();
const federatedRegistries = new Map<string, FederatedRegistry>();
const federatedEntries = new Map<string, FederatedEntry>();

// Chain providers for multi-chain queries
const chainProviders = new Map<number, ethers.JsonRpcProvider>();

/**
 * Initialize providers for all federated networks
 */
export async function initializeFederationProviders(hubRpc: string): Promise<void> {
  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  
  // Query NetworkRegistry for all networks
  // In production, this would be event-driven
  console.log('[Federation] Initializing multi-chain providers...');
  
  // Add hub chain
  chainProviders.set(1, hubProvider);
}

/**
 * Process NetworkRegistry events
 */
export function processNetworkRegistryEvent(
  log: { topics: string[]; data: string },
  block: { timestamp: number }
): FederatedNetwork | null {
  if (log.topics[0] !== NETWORK_REGISTERED) return null;

  const chainId = parseInt(log.topics[1], 16);
  const operator = '0x' + log.topics[2].slice(26);
  
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ['string', 'uint256'],
    log.data
  );
  
  const name = decoded[0] as string;
  const stake = decoded[1] as bigint;

  const trustTier = stake >= ethers.parseEther('10') ? TrustTier.VERIFIED :
                    stake >= ethers.parseEther('1') ? TrustTier.STAKED :
                    TrustTier.UNSTAKED;

  const network: FederatedNetwork = {
    chainId,
    name,
    rpcUrl: '', // Fetched separately
    operator,
    stake,
    trustTier,
    isActive: true,
    isSuperchain: false,
    registeredAt: new Date(block.timestamp * 1000),
    contracts: {
      identityRegistry: ethers.ZeroAddress,
      solverRegistry: ethers.ZeroAddress,
      inputSettler: ethers.ZeroAddress,
      outputSettler: ethers.ZeroAddress,
    }
  };

  federatedNetworks.set(chainId, network);
  console.log(`[Federation] Network registered: ${name} (${chainId}) - ${TrustTier[trustTier]}`);

  return network;
}

/**
 * Process RegistryHub events
 */
export function processRegistryHubEvent(
  log: { topics: string[]; data: string },
  block: { timestamp: number }
): FederatedRegistry | null {
  if (log.topics[0] !== REGISTRY_REGISTERED) return null;

  const registryId = log.topics[1];
  const chainId = parseInt(log.topics[2], 16);
  
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ['uint8', 'bytes32', 'string'],
    log.data
  );
  
  const registryType = decoded[0] as number;
  const contractAddress = decoded[1] as string;
  const name = decoded[2] as string;

  const registry: FederatedRegistry = {
    registryId,
    chainId,
    registryType,
    contractAddress,
    name,
    version: '1.0.0',
    entryCount: 0,
    lastSyncBlock: 0,
    isActive: true,
  };

  federatedRegistries.set(registryId, registry);
  console.log(`[Federation] Registry registered: ${name} (${RegistryType[registryType]}) on chain ${chainId}`);

  return registry;
}

/**
 * Process federated entry events
 */
export function processEntryFederatedEvent(
  log: { topics: string[]; data: string },
  block: { timestamp: number }
): FederatedEntry | null {
  if (log.topics[0] !== ENTRY_FEDERATED) return null;

  const entryId = log.topics[1];
  const registryId = log.topics[2];
  
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ['bytes32', 'string'],
    log.data
  );
  
  const originId = decoded[0] as string;
  const name = decoded[1] as string;

  const registry = federatedRegistries.get(registryId);
  
  const entry: FederatedEntry = {
    entryId,
    registryId,
    originId,
    name,
    metadataUri: '',
    originChainId: registry?.chainId || 0,
    syncedAt: new Date(block.timestamp * 1000),
  };

  federatedEntries.set(entryId, entry);
  console.log(`[Federation] Entry federated: ${name} from chain ${entry.originChainId}`);

  return entry;
}

/**
 * Sync registries from a specific chain
 */
export async function syncChainRegistries(chainId: number): Promise<void> {
  const network = federatedNetworks.get(chainId);
  if (!network) {
    console.log(`[Federation] Chain ${chainId} not in federation`);
    return;
  }

  if (!network.rpcUrl) {
    console.log(`[Federation] No RPC URL for chain ${chainId}`);
    return;
  }

  let provider = chainProviders.get(chainId);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(network.rpcUrl);
    chainProviders.set(chainId, provider);
  }

  console.log(`[Federation] Syncing registries from ${network.name}...`);

  // Sync IdentityRegistry
  if (network.contracts.identityRegistry !== ethers.ZeroAddress) {
    await syncIdentityRegistry(chainId, network.contracts.identityRegistry, provider);
  }

  // Sync SolverRegistry
  if (network.contracts.solverRegistry !== ethers.ZeroAddress) {
    await syncSolverRegistry(chainId, network.contracts.solverRegistry, provider);
  }
}

/**
 * Sync IdentityRegistry entries
 */
async function syncIdentityRegistry(
  chainId: number,
  address: string,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  const abi = [
    'function totalAgents() view returns (uint256)',
    'function agents(uint256) view returns (uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed)',
    'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)'
  ];

  const contract = new ethers.Contract(address, abi, provider);

  const totalAgents = await contract.totalAgents();
  console.log(`[Federation] Chain ${chainId} IdentityRegistry: ${totalAgents} agents`);

  // Update registry entry count
  const registryId = computeRegistryId(chainId, RegistryType.IDENTITY, address);
  const registry = federatedRegistries.get(registryId);
  if (registry) {
    registry.entryCount = Number(totalAgents);
    registry.lastSyncBlock = await provider.getBlockNumber();
  }
}

/**
 * Sync SolverRegistry entries
 */
async function syncSolverRegistry(
  chainId: number,
  address: string,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  const abi = [
    'function getSolvers() view returns (address[])',
    'function solverInfo(address) view returns (bool isActive, uint256 stake, uint256 fills, uint256 slashes)'
  ];

  const contract = new ethers.Contract(address, abi, provider);

  const solvers = await contract.getSolvers();
  console.log(`[Federation] Chain ${chainId} SolverRegistry: ${solvers.length} solvers`);

  // Update registry entry count
  const registryId = computeRegistryId(chainId, RegistryType.SOLVER, address);
  const registry = federatedRegistries.get(registryId);
  if (registry) {
    registry.entryCount = solvers.length;
    registry.lastSyncBlock = await provider.getBlockNumber();
  }
}

/**
 * Compute registry ID (matches contract)
 */
function computeRegistryId(chainId: number, registryType: RegistryType, address: string): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'uint256', 'string', 'uint8', 'string', 'bytes32'],
      ['jeju:registry:', chainId, ':', registryType, ':', ethers.zeroPadValue(address, 32)]
    )
  );
}

/**
 * Get all federated networks
 */
export function getAllFederatedNetworks(): FederatedNetwork[] {
  return Array.from(federatedNetworks.values());
}

/**
 * Get all federated registries
 */
export function getAllFederatedRegistries(): FederatedRegistry[] {
  return Array.from(federatedRegistries.values());
}

/**
 * Get registries by type across all chains
 */
export function getRegistriesByType(type: RegistryType): FederatedRegistry[] {
  return Array.from(federatedRegistries.values()).filter(r => r.registryType === type);
}

/**
 * Get federated entries by registry type
 */
export function getEntriesByRegistryType(type: RegistryType): FederatedEntry[] {
  const registryIds = new Set(
    Array.from(federatedRegistries.values())
      .filter(r => r.registryType === type)
      .map(r => r.registryId)
  );
  
  return Array.from(federatedEntries.values()).filter(e => registryIds.has(e.registryId));
}

/**
 * Get staked networks only
 */
export function getStakedNetworks(): FederatedNetwork[] {
  return Array.from(federatedNetworks.values()).filter(n => n.trustTier >= TrustTier.STAKED);
}

/**
 * Check if network can participate in consensus
 */
export function canParticipateInConsensus(chainId: number): boolean {
  const network = federatedNetworks.get(chainId);
  return network ? network.isActive && network.trustTier >= TrustTier.STAKED : false;
}

/**
 * GraphQL resolvers for federation queries
 */
export const federationResolvers = {
  Query: {
    federatedNetworks: () => getAllFederatedNetworks(),
    federatedNetwork: (_: unknown, { chainId }: { chainId: number }) => federatedNetworks.get(chainId),
    federatedRegistries: (_: unknown, { type }: { type?: string }) => {
      if (type) {
        const typeIndex = Object.keys(RegistryType).indexOf(type.toUpperCase());
        return getRegistriesByType(typeIndex);
      }
      return getAllFederatedRegistries();
    },
    federatedEntries: (_: unknown, { registryType }: { registryType: string }) => {
      const typeIndex = Object.keys(RegistryType).indexOf(registryType.toUpperCase());
      return getEntriesByRegistryType(typeIndex);
    },
    stakedNetworks: () => getStakedNetworks(),
  }
};

export default {
  processNetworkRegistryEvent,
  processRegistryHubEvent,
  processEntryFederatedEvent,
  syncChainRegistries,
  getAllFederatedNetworks,
  getAllFederatedRegistries,
  getStakedNetworks,
  canParticipateInConsensus,
  federationResolvers,
};

