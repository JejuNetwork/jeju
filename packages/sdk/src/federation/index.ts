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

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getContract,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Types
// ============================================================================

export const TrustTier = {
  UNSTAKED: 0,
  STAKED: 1,
  VERIFIED: 2,
} as const
export type TrustTier = (typeof TrustTier)[keyof typeof TrustTier]

export const ChainType = {
  EVM: 0,
  SOLANA: 1,
  COSMOS: 2,
  OTHER: 3,
} as const
export type ChainType = (typeof ChainType)[keyof typeof ChainType]

export const RegistryType = {
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
export type RegistryType = (typeof RegistryType)[keyof typeof RegistryType]

export interface NetworkInfo {
  chainId: bigint
  name: string
  rpcUrl: string
  explorerUrl: string
  wsUrl: string
  operator: string
  contracts: NetworkContracts
  genesisHash: string
  registeredAt: bigint
  stake: bigint
  trustTier: TrustTier
  isActive: boolean
  isVerified: boolean
  isSuperchain: boolean
}

export interface NetworkContracts {
  identityRegistry: string
  solverRegistry: string
  inputSettler: string
  outputSettler: string
  liquidityVault: string
  governance: string
  oracle: string
  registryHub: string
}

export interface ChainInfo {
  chainId: bigint
  chainType: ChainType
  name: string
  rpcUrl: string
  networkOperator: string
  stake: bigint
  trustTier: TrustTier
  isActive: boolean
  registeredAt: bigint
}

export interface RegistryInfo {
  registryId: string
  chainId: bigint
  chainType: ChainType
  registryType: RegistryType
  contractAddress: string
  name: string
  version: string
  metadataUri: string
  entryCount: bigint
  lastSyncBlock: bigint
  isActive: boolean
  registeredAt: bigint
}

export interface FederationClientConfig {
  hubRpc: string
  networkRegistry: string
  registryHub: string
  privateKey?: string
}

export interface FederationClient {
  // Network Registry
  getNetwork(chainId: number): Promise<NetworkInfo>
  getAllNetworks(): Promise<NetworkInfo[]>
  getStakedNetworks(): Promise<NetworkInfo[]>
  getVerifiedNetworks(): Promise<NetworkInfo[]>
  canParticipateInConsensus(chainId: number): Promise<boolean>
  isSequencerEligible(chainId: number): Promise<boolean>

  // Registry Hub
  getChain(chainId: number): Promise<ChainInfo>
  getAllChains(): Promise<ChainInfo[]>
  getRegistry(registryId: string): Promise<RegistryInfo>
  getAllRegistries(): Promise<RegistryInfo[]>
  getRegistriesByType(type: RegistryType): Promise<RegistryInfo[]>
  getRegistriesByChain(chainId: number): Promise<RegistryInfo[]>
  isTrustedForConsensus(chainId: number): Promise<boolean>

  // Write operations (require privateKey)
  joinFederation(params: JoinFederationParams): Promise<string>
  addStake(chainId: number, amount: bigint): Promise<string>
  registerRegistry(params: RegisterRegistryParams): Promise<string>
}

export interface JoinFederationParams {
  chainId: number
  name: string
  rpcUrl: string
  explorerUrl?: string
  wsUrl?: string
  stake?: bigint
}

export interface RegisterRegistryParams {
  chainId: number
  registryType: RegistryType
  contractAddress: string
  name: string
  version?: string
  metadataUri?: string
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
]

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
]

// ============================================================================
// Client Implementation
// ============================================================================

export async function createFederationClient(
  config: FederationClientConfig,
): Promise<FederationClient> {
  const publicClient = createPublicClient({ transport: http(config.hubRpc) })
  const account = config.privateKey
    ? privateKeyToAccount(config.privateKey as `0x${string}`)
    : null
  const walletClient = account
    ? createWalletClient({ account, transport: http(config.hubRpc) })
    : null

  const networkRegistry = getContract({
    address: config.networkRegistry as `0x${string}`,
    abi: NETWORK_REGISTRY_ABI,
    client: publicClient,
  })

  const registryHub = getContract({
    address: config.registryHub as `0x${string}`,
    abi: REGISTRY_HUB_ABI,
    client: publicClient,
  })

  // Raw tuple types from contract returns
  type RawNetworkInfo = readonly [
    bigint, // chainId
    string, // name
    string, // rpcUrl
    string, // explorerUrl
    string, // wsUrl
    string, // operator
    readonly string[], // contracts tuple
    string, // genesisHash
    bigint, // registeredAt
    bigint, // stake
    number, // trustTier
    boolean, // isActive
    boolean, // isVerified
    boolean, // isSuperchain
  ]

  type RawChainInfo = readonly [
    bigint, // chainId
    number, // chainType
    string, // name
    string, // rpcUrl
    string, // networkOperator
    bigint, // stake
    number, // trustTier
    boolean, // isActive
    bigint, // registeredAt
  ]

  type RawRegistryInfo = readonly [
    string, // registryId
    bigint, // chainId
    number, // chainType
    number, // registryType
    string, // contractAddress
    string, // name
    string, // version
    string, // metadataUri
    bigint, // entryCount
    bigint, // lastSyncBlock
    boolean, // isActive
    bigint, // registeredAt
  ]

  // Helper to parse network info
  function parseNetworkInfo(raw: RawNetworkInfo): NetworkInfo {
    const contracts = raw[6]
    return {
      chainId: raw[0],
      name: raw[1],
      rpcUrl: raw[2],
      explorerUrl: raw[3],
      wsUrl: raw[4],
      operator: raw[5],
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
      genesisHash: raw[7],
      registeredAt: raw[8],
      stake: raw[9],
      trustTier: raw[10] as TrustTier,
      isActive: raw[11],
      isVerified: raw[12],
      isSuperchain: raw[13],
    }
  }

  function parseChainInfo(raw: RawChainInfo): ChainInfo {
    return {
      chainId: raw[0],
      chainType: raw[1] as ChainType,
      name: raw[2],
      rpcUrl: raw[3],
      networkOperator: raw[4],
      stake: raw[5],
      trustTier: raw[6] as TrustTier,
      isActive: raw[7],
      registeredAt: raw[8],
    }
  }

  function parseRegistryInfo(raw: RawRegistryInfo): RegistryInfo {
    return {
      registryId: raw[0],
      chainId: raw[1],
      chainType: raw[2] as ChainType,
      registryType: raw[3] as RegistryType,
      contractAddress: raw[4],
      name: raw[5],
      version: raw[6],
      metadataUri: raw[7],
      entryCount: raw[8],
      lastSyncBlock: raw[9],
      isActive: raw[10],
      registeredAt: raw[11],
    }
  }

  return {
    // Network Registry methods
    async getNetwork(chainId: number): Promise<NetworkInfo> {
      const raw = await networkRegistry.read.getNetwork([BigInt(chainId)])
      return parseNetworkInfo(raw as RawNetworkInfo)
    },

    async getAllNetworks(): Promise<NetworkInfo[]> {
      const ids =
        (await networkRegistry.read.getAllNetworkIds()) as readonly bigint[]
      const networks = await Promise.all(
        ids.map((id) => networkRegistry.read.getNetwork([id])),
      )
      return networks.map((n) => parseNetworkInfo(n as RawNetworkInfo))
    },

    async getStakedNetworks(): Promise<NetworkInfo[]> {
      const ids =
        (await networkRegistry.read.getAllNetworkIds()) as readonly bigint[]
      const networks = await Promise.all(
        ids.map((id) => networkRegistry.read.getNetwork([id])),
      )
      return networks
        .map((n) => parseNetworkInfo(n as RawNetworkInfo))
        .filter(
          (n: NetworkInfo) => n.trustTier >= TrustTier.STAKED && n.isActive,
        )
    },

    async getVerifiedNetworks(): Promise<NetworkInfo[]> {
      const ids =
        (await networkRegistry.read.getVerifiedNetworks()) as readonly bigint[]
      const networks = await Promise.all(
        ids.map((id) => networkRegistry.read.getNetwork([id])),
      )
      return networks.map((n) => parseNetworkInfo(n as RawNetworkInfo))
    },

    async canParticipateInConsensus(chainId: number): Promise<boolean> {
      return networkRegistry.read.canParticipateInConsensus([
        BigInt(chainId),
      ]) as Promise<boolean>
    },

    async isSequencerEligible(chainId: number): Promise<boolean> {
      return networkRegistry.read.isSequencerEligible([
        BigInt(chainId),
      ]) as Promise<boolean>
    },

    // Registry Hub methods
    async getChain(chainId: number): Promise<ChainInfo> {
      const raw = await registryHub.read.getChain([BigInt(chainId)])
      return parseChainInfo(raw as RawChainInfo)
    },

    async getAllChains(): Promise<ChainInfo[]> {
      const ids = (await registryHub.read.getAllChainIds()) as readonly bigint[]
      const chains = await Promise.all(
        ids.map((id) => registryHub.read.getChain([id])),
      )
      return chains.map((c) => parseChainInfo(c as RawChainInfo))
    },

    async getRegistry(registryId: string): Promise<RegistryInfo> {
      const raw = await registryHub.read.getRegistry([
        registryId as `0x${string}`,
      ])
      return parseRegistryInfo(raw as RawRegistryInfo)
    },

    async getAllRegistries(): Promise<RegistryInfo[]> {
      const ids =
        (await registryHub.read.getAllRegistryIds()) as readonly `0x${string}`[]
      const registries = await Promise.all(
        ids.map((id) => registryHub.read.getRegistry([id])),
      )
      return registries.map((r) => parseRegistryInfo(r as RawRegistryInfo))
    },

    async getRegistriesByType(type: RegistryType): Promise<RegistryInfo[]> {
      const ids = (await registryHub.read.getRegistriesByType([
        type,
      ])) as readonly `0x${string}`[]
      const registries = await Promise.all(
        ids.map((id) => registryHub.read.getRegistry([id])),
      )
      return registries.map((r) => parseRegistryInfo(r as RawRegistryInfo))
    },

    async getRegistriesByChain(chainId: number): Promise<RegistryInfo[]> {
      const ids = (await registryHub.read.getRegistriesByChain([
        BigInt(chainId),
      ])) as readonly `0x${string}`[]
      const registries = await Promise.all(
        ids.map((id) => registryHub.read.getRegistry([id])),
      )
      return registries.map((r) => parseRegistryInfo(r as RawRegistryInfo))
    },

    async isTrustedForConsensus(chainId: number): Promise<boolean> {
      return registryHub.read.isTrustedForConsensus([
        BigInt(chainId),
      ]) as Promise<boolean>
    },

    // Write methods
    async joinFederation(params: JoinFederationParams): Promise<string> {
      if (!walletClient)
        throw new Error('Private key required for write operations')

      const contracts = [
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
      ] as const

      const hash = await walletClient.writeContract({
        address: config.networkRegistry as `0x${string}`,
        abi: NETWORK_REGISTRY_ABI,
        functionName: 'registerNetwork',
        args: [
          BigInt(params.chainId),
          params.name,
          params.rpcUrl,
          params.explorerUrl || '',
          params.wsUrl || '',
          contracts,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        value: params.stake || 0n,
        chain: null,
      })

      await publicClient.waitForTransactionReceipt({ hash })
      return hash
    },

    async addStake(chainId: number, amount: bigint): Promise<string> {
      if (!walletClient)
        throw new Error('Private key required for write operations')

      const hash = await walletClient.writeContract({
        address: config.networkRegistry as `0x${string}`,
        abi: NETWORK_REGISTRY_ABI,
        functionName: 'addStake',
        args: [BigInt(chainId)],
        value: amount,
        chain: null,
      })

      await publicClient.waitForTransactionReceipt({ hash })
      return hash
    },

    async registerRegistry(params: RegisterRegistryParams): Promise<string> {
      if (!walletClient)
        throw new Error('Private key required for write operations')

      // Pad address to bytes32
      const addressBytes32 = ('0x' +
        params.contractAddress.slice(2).padStart(64, '0')) as `0x${string}`

      const hash = await walletClient.writeContract({
        address: config.registryHub as `0x${string}`,
        abi: REGISTRY_HUB_ABI,
        functionName: 'registerRegistry',
        args: [
          BigInt(params.chainId),
          params.registryType,
          addressBytes32,
          params.name,
          params.version || '1.0.0',
          params.metadataUri || '',
        ],
        chain: null,
      })

      await publicClient.waitForTransactionReceipt({ hash })
      return hash
    },
  }
}

// ============================================================================
// Utilities
// ============================================================================

export function trustTierToString(tier: TrustTier): string {
  switch (tier) {
    case TrustTier.UNSTAKED:
      return 'UNSTAKED'
    case TrustTier.STAKED:
      return 'STAKED'
    case TrustTier.VERIFIED:
      return 'VERIFIED'
    default:
      return 'UNKNOWN'
  }
}

export function registryTypeToString(type: RegistryType): string {
  const types = [
    'IDENTITY',
    'COMPUTE',
    'STORAGE',
    'SOLVER',
    'PACKAGE',
    'CONTAINER',
    'MODEL',
    'NAME_SERVICE',
    'REPUTATION',
    'OTHER',
  ]
  return types[type] || 'UNKNOWN'
}

export function chainTypeToString(type: ChainType): string {
  switch (type) {
    case ChainType.EVM:
      return 'EVM'
    case ChainType.SOLANA:
      return 'SOLANA'
    case ChainType.COSMOS:
      return 'COSMOS'
    case ChainType.OTHER:
      return 'OTHER'
    default:
      return 'UNKNOWN'
  }
}

export { parseEther, formatEther }
