/**
 * Federation multi-chain event processor
 */

import {
  type Address,
  createPublicClient,
  encodePacked,
  getContract,
  type Hex,
  http,
  isAddress,
  keccak256,
  type PublicClient,
  pad,
  parseEther,
  toEventSelector,
  zeroAddress,
} from 'viem'
import { decodeLogData } from './utils/hex'

// Event signatures (keccak256 hash of event signature)
const NETWORK_REGISTERED = toEventSelector(
  'NetworkRegistered(uint256,string,address,uint256)',
)
const REGISTRY_REGISTERED = toEventSelector(
  'RegistryRegistered(bytes32,uint256,uint8,bytes32,string)',
)
const ENTRY_FEDERATED = toEventSelector(
  'EntryFederated(bytes32,bytes32,bytes32,string)',
)
const _AGENT_REGISTERED = toEventSelector(
  'Registered(uint256,address,uint8,uint256,string)',
)

// Trust tiers
const TrustTier = {
  UNSTAKED: 0,
  STAKED: 1,
  VERIFIED: 2,
} as const
type TrustTier = (typeof TrustTier)[keyof typeof TrustTier]

// Reverse mapping for TrustTier names
const TrustTierNames: Record<TrustTier, string> = {
  [TrustTier.UNSTAKED]: 'UNSTAKED',
  [TrustTier.STAKED]: 'STAKED',
  [TrustTier.VERIFIED]: 'VERIFIED',
}

// Registry types
const RegistryType = {
  IDENTITY: 0,
  COMPUTE: 1,
  STORAGE: 2,
  SOLVER: 3,
  PACKAGE: 4,
  CONTAINER: 5,
  MODEL: 6,
  NAME_SERVICE: 7,
  REPUTATION: 8,
  OTHER: 9,
} as const
type RegistryType = (typeof RegistryType)[keyof typeof RegistryType]

// Reverse mapping for RegistryType names
const RegistryTypeNames: Record<RegistryType, string> = {
  [RegistryType.IDENTITY]: 'IDENTITY',
  [RegistryType.COMPUTE]: 'COMPUTE',
  [RegistryType.STORAGE]: 'STORAGE',
  [RegistryType.SOLVER]: 'SOLVER',
  [RegistryType.PACKAGE]: 'PACKAGE',
  [RegistryType.CONTAINER]: 'CONTAINER',
  [RegistryType.MODEL]: 'MODEL',
  [RegistryType.NAME_SERVICE]: 'NAME_SERVICE',
  [RegistryType.REPUTATION]: 'REPUTATION',
  [RegistryType.OTHER]: 'OTHER',
}

// Type guard for RegistryType
function isRegistryType(value: number): value is RegistryType {
  return value >= 0 && value <= 9
}

interface FederatedNetwork {
  chainId: number
  name: string
  rpcUrl: string
  operator: string
  stake: bigint
  trustTier: TrustTier
  isActive: boolean
  isSuperchain: boolean
  registeredAt: Date
  contracts: {
    identityRegistry: string
    solverRegistry: string
    inputSettler: string
    outputSettler: string
  }
}

interface FederatedRegistry {
  registryId: string
  chainId: number
  registryType: RegistryType
  contractAddress: string
  name: string
  version: string
  entryCount: number
  lastSyncBlock: number
  isActive: boolean
}

interface FederatedEntry {
  entryId: string
  registryId: string
  originId: string
  name: string
  metadataUri: string
  originChainId: number
  syncedAt: Date
}

// In-memory cache (would be stored in DB in production)
const federatedNetworks = new Map<number, FederatedNetwork>()
const federatedRegistries = new Map<string, FederatedRegistry>()
const federatedEntries = new Map<string, FederatedEntry>()

// Chain providers for multi-chain queries
const chainProviders = new Map<number, PublicClient>()

/**
 * Initialize providers for all federated networks
 */
export async function initializeFederationProviders(
  hubRpc: string,
): Promise<void> {
  const hubProvider = createPublicClient({ transport: http(hubRpc) })

  // Query NetworkRegistry for all networks
  // In production, this would be event-driven
  console.log('[Federation] Initializing multi-chain providers...')

  // Add hub chain
  chainProviders.set(1, hubProvider)
}

/**
 * Process NetworkRegistry events
 */
export function processNetworkRegistryEvent(
  log: { topics: string[]; data: string },
  block: { timestamp: number },
): FederatedNetwork | null {
  if (log.topics[0] !== NETWORK_REGISTERED) return null

  const chainId = parseInt(log.topics[1], 16)
  const operator = `0x${log.topics[2].slice(26)}`

  const decoded = decodeLogData(
    [{ type: 'string' }, { type: 'uint256' }] as const,
    log.data,
  )

  const name = decoded[0]
  const stake = decoded[1]

  const trustTier =
    stake >= parseEther('10')
      ? TrustTier.VERIFIED
      : stake >= parseEther('1')
        ? TrustTier.STAKED
        : TrustTier.UNSTAKED

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
      identityRegistry: zeroAddress,
      solverRegistry: zeroAddress,
      inputSettler: zeroAddress,
      outputSettler: zeroAddress,
    },
  }

  federatedNetworks.set(chainId, network)
  console.log(
    `[Federation] Network registered: ${name} (${chainId}) - ${TrustTierNames[trustTier]}`,
  )

  return network
}

/**
 * Process RegistryHub events
 */
export function processRegistryHubEvent(
  log: { topics: string[]; data: string },
  _block: { timestamp: number },
): FederatedRegistry | null {
  if (log.topics[0] !== REGISTRY_REGISTERED) return null

  const registryId = log.topics[1]
  const chainId = parseInt(log.topics[2], 16)

  const decoded = decodeLogData(
    [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'string' }] as const,
    log.data,
  )

  const registryTypeNum = Number(decoded[0])
  const contractAddress = decoded[1]
  const name = decoded[2]

  // Validate and cast registry type
  if (!isRegistryType(registryTypeNum)) {
    console.warn(`[Federation] Unknown registry type: ${registryTypeNum}`)
    return null
  }
  const registryType: RegistryType = registryTypeNum

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
  }

  federatedRegistries.set(registryId, registry)
  console.log(
    `[Federation] Registry registered: ${name} (${RegistryTypeNames[registryType]}) on chain ${chainId}`,
  )

  return registry
}

/**
 * Process federated entry events
 */
export function processEntryFederatedEvent(
  log: { topics: string[]; data: string },
  block: { timestamp: number },
): FederatedEntry | null {
  if (log.topics[0] !== ENTRY_FEDERATED) return null

  const entryId = log.topics[1]
  const registryId = log.topics[2]

  const decoded = decodeLogData(
    [{ type: 'bytes32' }, { type: 'string' }] as const,
    log.data,
  )

  const originId = decoded[0]
  const name = decoded[1]

  const registry = federatedRegistries.get(registryId)

  const entry: FederatedEntry = {
    entryId,
    registryId,
    originId,
    name,
    metadataUri: '',
    originChainId: registry?.chainId || 0,
    syncedAt: new Date(block.timestamp * 1000),
  }

  federatedEntries.set(entryId, entry)
  console.log(
    `[Federation] Entry federated: ${name} from chain ${entry.originChainId}`,
  )

  return entry
}

/**
 * Sync registries from a specific chain
 */
export async function syncChainRegistries(chainId: number): Promise<void> {
  const network = federatedNetworks.get(chainId)
  if (!network) {
    console.log(`[Federation] Chain ${chainId} not in federation`)
    return
  }

  if (!network.rpcUrl) {
    console.log(`[Federation] No RPC URL for chain ${chainId}`)
    return
  }

  let provider = chainProviders.get(chainId)
  if (!provider) {
    provider = createPublicClient({ transport: http(network.rpcUrl) })
    chainProviders.set(chainId, provider)
  }

  console.log(`[Federation] Syncing registries from ${network.name}...`)

  // Sync IdentityRegistry
  if (
    network.contracts.identityRegistry !== zeroAddress &&
    isAddress(network.contracts.identityRegistry)
  ) {
    await syncIdentityRegistry(
      chainId,
      network.contracts.identityRegistry,
      provider,
    )
  }

  // Sync SolverRegistry
  if (
    network.contracts.solverRegistry !== zeroAddress &&
    isAddress(network.contracts.solverRegistry)
  ) {
    await syncSolverRegistry(
      chainId,
      network.contracts.solverRegistry,
      provider,
    )
  }
}

/**
 * Sync IdentityRegistry entries
 */
async function syncIdentityRegistry(
  chainId: number,
  address: Address,
  provider: PublicClient,
): Promise<void> {
  const abi = [
    {
      name: 'totalAgents',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'uint256' }],
    },
  ] as const

  const contract = getContract({
    address,
    abi,
    client: provider,
  })

  const totalAgents = await contract.read.totalAgents()
  console.log(
    `[Federation] Chain ${chainId} IdentityRegistry: ${totalAgents} agents`,
  )

  // Update registry entry count
  const registryId = computeRegistryId(chainId, RegistryType.IDENTITY, address)
  const registry = federatedRegistries.get(registryId)
  if (registry) {
    registry.entryCount = Number(totalAgents)
    registry.lastSyncBlock = Number(await provider.getBlockNumber())
  }
}

/**
 * Sync SolverRegistry entries
 */
async function syncSolverRegistry(
  chainId: number,
  address: Address,
  provider: PublicClient,
): Promise<void> {
  const abi = [
    {
      name: 'getSolvers',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'address[]' }],
    },
  ] as const

  const contract = getContract({
    address,
    abi,
    client: provider,
  })

  const solvers = await contract.read.getSolvers()
  console.log(
    `[Federation] Chain ${chainId} SolverRegistry: ${solvers.length} solvers`,
  )

  // Update registry entry count
  const registryId = computeRegistryId(chainId, RegistryType.SOLVER, address)
  const registry = federatedRegistries.get(registryId)
  if (registry) {
    registry.entryCount = solvers.length
    registry.lastSyncBlock = Number(await provider.getBlockNumber())
  }
}

/**
 * Compute registry ID (matches contract)
 */
function computeRegistryId(
  chainId: number,
  registryType: RegistryType,
  address: Hex,
): Hex {
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'string', 'uint8', 'string', 'bytes32'],
      [
        'jeju:registry:',
        BigInt(chainId),
        ':',
        registryType,
        ':',
        pad(address, { size: 32 }),
      ],
    ),
  )
}

/**
 * Get all federated networks
 */
export function getAllFederatedNetworks(): FederatedNetwork[] {
  return Array.from(federatedNetworks.values())
}

/**
 * Get all federated registries
 */
export function getAllFederatedRegistries(): FederatedRegistry[] {
  return Array.from(federatedRegistries.values())
}

/**
 * Get registries by type across all chains
 */
export function getRegistriesByType(type: RegistryType): FederatedRegistry[] {
  return Array.from(federatedRegistries.values()).filter(
    (r) => r.registryType === type,
  )
}

/**
 * Get federated entries by registry type
 */
export function getEntriesByRegistryType(type: RegistryType): FederatedEntry[] {
  const registryIds = new Set(
    Array.from(federatedRegistries.values())
      .filter((r) => r.registryType === type)
      .map((r) => r.registryId),
  )

  return Array.from(federatedEntries.values()).filter((e) =>
    registryIds.has(e.registryId),
  )
}

/**
 * Get staked networks only
 */
export function getStakedNetworks(): FederatedNetwork[] {
  return Array.from(federatedNetworks.values()).filter(
    (n) => n.trustTier >= TrustTier.STAKED,
  )
}

/**
 * Check if network can participate in consensus
 */
export function canParticipateInConsensus(chainId: number): boolean {
  const network = federatedNetworks.get(chainId)
  return network
    ? network.isActive && network.trustTier >= TrustTier.STAKED
    : false
}

/**
 * GraphQL resolvers for federation queries
 */
/**
 * GraphQL resolver parent type for root Query resolvers.
 * Root query resolvers receive null as the parent since there's no parent object.
 */
type QueryParent = null

/**
 * GraphQL resolvers for federation queries
 */
export const federationResolvers = {
  Query: {
    federatedNetworks: () => getAllFederatedNetworks(),
    federatedNetwork: (
      _parent: QueryParent,
      { chainId }: { chainId: number },
    ) => federatedNetworks.get(chainId),
    federatedRegistries: (
      _parent: QueryParent,
      { type }: { type?: string },
    ) => {
      if (type) {
        const upperType = type.toUpperCase() as keyof typeof RegistryType
        const typeValue = RegistryType[upperType]
        if (typeValue === undefined) {
          return []
        }
        return getRegistriesByType(typeValue)
      }
      return getAllFederatedRegistries()
    },
    federatedEntries: (
      _parent: QueryParent,
      { registryType }: { registryType: string },
    ) => {
      const upperType = registryType.toUpperCase() as keyof typeof RegistryType
      const typeValue = RegistryType[upperType]
      if (typeValue === undefined) {
        return []
      }
      return getEntriesByRegistryType(typeValue)
    },
    stakedNetworks: () => getStakedNetworks(),
  },
}

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
}
