/**
 * @fileoverview Zod schemas for config validation
 * @module config/schemas
 *
 * Centralized validation schemas for all config files.
 * Ensures type safety when loading JSON configs.
 */

import { NetworkSchema, type NetworkType } from '@jejunetwork/types'
import { z } from 'zod'

export { NetworkSchema, type NetworkType }

// Chain Configuration Schema

/**
 * Address schema using regex validation (no viem dependency)
 */
const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')

/**
 * Optional address schema - allows empty strings for contracts that haven't been deployed yet
 */
const OptionalAddressSchema = z
  .string()
  .refine((val) => val === '' || /^0x[a-fA-F0-9]{40}$/.test(val), {
    message: 'Must be empty or valid Ethereum address',
  })

const GasTokenSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().nonnegative().max(18),
})

/** OP Stack L2 contract addresses for chain config */
const ChainL2ContractsSchema = z.object({
  L2CrossDomainMessenger: AddressSchema,
  L2StandardBridge: AddressSchema,
  L2ToL1MessagePasser: AddressSchema,
  L2ERC721Bridge: AddressSchema,
  GasPriceOracle: AddressSchema,
  L1Block: AddressSchema,
  WETH: AddressSchema,
})

/** OP Stack L1 contract addresses for chain config - allows empty for undeployed contracts */
const ChainL1ContractsSchema = z.object({
  OptimismPortal: OptionalAddressSchema,
  L2OutputOracle: OptionalAddressSchema,
  L1CrossDomainMessenger: OptionalAddressSchema,
  L1StandardBridge: OptionalAddressSchema,
  SystemConfig: OptionalAddressSchema,
})

/**
 * OP Stack chain configuration schema
 */
export const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  networkId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  wsUrl: z.string().min(1),
  explorerUrl: z.string().min(1),
  l1ChainId: z.number().int().positive(),
  l1RpcUrl: z.string().min(1),
  l1Name: z.string().min(1),
  flashblocksEnabled: z.boolean(),
  flashblocksSubBlockTime: z.number().int().nonnegative(),
  blockTime: z.number().int().positive(),
  gasToken: GasTokenSchema,
  contracts: z.object({
    l2: ChainL2ContractsSchema,
    l1: ChainL1ContractsSchema,
  }),
})
export type ChainConfig = z.infer<typeof ChainConfigSchema>

// Contract Schemas

/**
 * Contract address - empty string or valid Ethereum address
 * Empty strings allowed for undeployed contracts
 */
const ContractAddressOrEmpty = z
  .string()
  .refine((val) => val === '' || /^0x[a-fA-F0-9]{40}$/.test(val), {
    message: 'Must be empty or valid Ethereum address',
  })

/** Contract category - maps contract names to addresses (can be empty if not deployed) */
const ContractCategorySchema = z.record(
  z.string().min(1),
  ContractAddressOrEmpty,
)

/**
 * Contract category names - unified across all config modules
 * Used for type-safe access to contract categories in contracts.json
 */
export type ContractCategory =
  | 'tokens'
  | 'registry'
  | 'moderation'
  | 'nodeStaking'
  | 'jns'
  | 'oauth3'
  | 'dws'
  | 'payments'
  | 'defi'
  | 'compute'
  | 'governance'
  | 'oif'
  | 'eil'
  | 'security'
  | 'agents'
  | 'amm'
  | 'bazaar'
  | 'bridge'
  | 'cdn'
  | 'chainlink'
  | 'commerce'
  | 'distributor'
  | 'fees'
  | 'liquidity'
  | 'messaging'
  | 'oracle'
  | 'otc'
  | 'perps'
  | 'prediction'
  | 'rpc'
  | 'sequencer'
  | 'staking'
  | 'training'
  | 'work'

const NetworkContractsSchema = z.object({
  chainId: z.number().int().positive(),
  tokens: ContractCategorySchema,
  registry: ContractCategorySchema,
  moderation: ContractCategorySchema,
  nodeStaking: ContractCategorySchema,
  jns: ContractCategorySchema,
  oauth3: ContractCategorySchema.optional(),
  dws: ContractCategorySchema.optional(),
  payments: ContractCategorySchema,
  defi: ContractCategorySchema,
  compute: ContractCategorySchema,
  governance: ContractCategorySchema,
  oif: ContractCategorySchema,
  eil: ContractCategorySchema,
  security: ContractCategorySchema,
  agents: ContractCategorySchema.optional(),
  amm: ContractCategorySchema.optional(),
  bazaar: ContractCategorySchema.optional(),
  bridge: ContractCategorySchema.optional(),
  cdn: ContractCategorySchema.optional(),
  chainlink: ContractCategorySchema.optional(),
  commerce: ContractCategorySchema.optional(),
  distributor: ContractCategorySchema.optional(),
  fees: ContractCategorySchema.optional(),
  liquidity: ContractCategorySchema.optional(),
  messaging: ContractCategorySchema.optional(),
  oracle: ContractCategorySchema.optional(),
  otc: ContractCategorySchema.optional(),
  perps: ContractCategorySchema.optional(),
  prediction: ContractCategorySchema.optional(),
  rpc: ContractCategorySchema.optional(),
  sequencer: ContractCategorySchema.optional(),
  staking: ContractCategorySchema.optional(),
  training: ContractCategorySchema.optional(),
  work: ContractCategorySchema.optional(),
})
export type NetworkContracts = z.infer<typeof NetworkContractsSchema>

/**
 * Type for dynamic contract category access.
 * Use this with explicit type narrowing when accessing dynamic keys.
 * The contractCategory getter functions (getContractCategory) provide type-safe access.
 */
export type ContractCategoryValue = Record<string, string>
export type NetworkContractsDynamic = NetworkContracts & {
  [K in ContractCategory]?: ContractCategoryValue
}

const ExternalChainContractsSchema = z.object({
  chainId: z.number().int().positive(),
  rpcUrl: z.string().min(1),
  oif: ContractCategorySchema.optional(),
  eil: ContractCategorySchema.optional(),
  payments: ContractCategorySchema.optional(),
  tokens: ContractCategorySchema.optional(),
  poc: ContractCategorySchema.optional(),
})
export type ExternalChainContracts = z.infer<
  typeof ExternalChainContractsSchema
>

/** External chain contract categories that support dynamic access */
export type ExternalContractCategory =
  | 'oif'
  | 'eil'
  | 'payments'
  | 'tokens'
  | 'poc'

/** Type for dynamic category access on external chains */
export type ExternalChainContractsDynamic = ExternalChainContracts & {
  [K in ExternalContractCategory]?: ContractCategoryValue
}

export const ContractsConfigSchema = z.object({
  version: z.string().min(1),
  constants: z.object({
    entryPoint: AddressSchema,
    entryPointV07: AddressSchema,
    l2Messenger: AddressSchema,
    l2StandardBridge: AddressSchema,
    weth: AddressSchema,
  }),
  localnet: NetworkContractsSchema,
  testnet: NetworkContractsSchema,
  mainnet: NetworkContractsSchema,
  external: z.record(z.string(), ExternalChainContractsSchema),
})
export type ContractsConfig = z.infer<typeof ContractsConfigSchema>

// Services Schemas

/** URL string - must be non-empty */
const UrlString = z.string().min(1)

export const ServicesNetworkConfigSchema = z.object({
  rpc: z.object({
    l1: UrlString,
    l2: UrlString,
    ws: UrlString,
  }),
  explorer: UrlString,
  indexer: z.object({
    graphql: UrlString,
    websocket: UrlString,
    rest: UrlString.optional(),
    dws: UrlString.optional(),
  }),
  gateway: z.object({
    ui: UrlString,
    api: UrlString,
    a2a: UrlString,
    mcp: UrlString,
    ws: UrlString,
  }),
  rpcGateway: UrlString,
  bazaar: UrlString,
  storage: z.object({
    api: UrlString,
    ipfsGateway: UrlString,
  }),
  compute: z.object({
    marketplace: UrlString,
    nodeApi: UrlString,
  }),
  oif: z.object({
    aggregator: UrlString,
  }),
  leaderboard: z.object({
    api: UrlString,
    ui: UrlString,
  }),
  monitoring: z.object({
    prometheus: UrlString,
    grafana: UrlString,
  }),
  crucible: z.object({
    api: UrlString,
    executor: UrlString,
    bots: UrlString.optional(),
  }),
  eqlite: z.object({
    blockProducer: UrlString,
    miner: UrlString,
  }),
  dws: z.object({
    api: UrlString,
    cache: UrlString,
    compute: UrlString,
    inference: UrlString.optional(),
    gateway: UrlString.optional(),
    triggers: UrlString.optional(),
  }),
  autocrat: z.object({
    api: UrlString,
    a2a: UrlString,
    mcp: UrlString.optional(),
    ceo: UrlString.optional(),
  }),
  kms: z.object({
    api: UrlString,
    mpc: UrlString,
    defaultProvider: z.string().min(1).optional(),
  }),
  factory: z.object({
    ui: UrlString,
    api: UrlString,
    mcp: UrlString,
  }),
  oauth3: z
    .object({
      api: UrlString,
      tee: UrlString,
    })
    .optional(),
  tee: z
    .object({
      mode: z.enum(['simulated', 'phala', 'gcp', 'aws']),
      platform: z.enum(['local', 'phala', 'gcp-confidential', 'aws-nitro']),
      region: z.string().min(1).optional(),
      endpoint: UrlString.optional(),
    })
    .optional(),
  oracle: z
    .object({
      api: UrlString,
      feeds: UrlString,
    })
    .optional(),
  node: z
    .object({
      api: UrlString,
      cdn: UrlString,
      vpn: UrlString,
      proxy: UrlString,
    })
    .optional(),
  training: z
    .object({
      api: UrlString,
      atropos: UrlString,
      psyche: UrlString.optional(),
    })
    .optional(),
  ipfs: z
    .object({
      api: UrlString,
      gateway: UrlString,
    })
    .optional(),
  agents: z
    .object({
      api: UrlString,
      agent0: UrlString.optional(),
    })
    .optional(),
  externalRpcs: z.record(z.string().min(1), UrlString).optional(),
  external: z
    .object({
      farcaster: z
        .object({
          hub: UrlString,
          api: UrlString,
        })
        .optional(),
      bundler: UrlString.optional(),
    })
    .optional(),
})
export type ServicesNetworkConfig = z.infer<typeof ServicesNetworkConfigSchema>

/**
 * Type for dynamic service category access during mutable operations.
 * Used when dynamically updating service URLs by category name.
 * Loses strict typing for known categories but allows dynamic writes.
 */
/**
 * Nested service value type - allows string values or nested objects
 */
type ServiceValue =
  | string
  | { [key: string]: string | ServiceValue | undefined }
  | undefined

export type ServicesNetworkConfigDynamic = Record<string, ServiceValue>

export const ServicesConfigSchema = z.object({
  localnet: ServicesNetworkConfigSchema,
  testnet: ServicesNetworkConfigSchema,
  mainnet: ServicesNetworkConfigSchema,
})
export type ServicesConfig = z.infer<typeof ServicesConfigSchema>

// EIL (Cross-Chain Liquidity) Schemas

export const EILChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  crossChainPaymaster: OptionalAddressSchema.optional(),
  l1StakeManager: OptionalAddressSchema.optional(),
  status: z.enum(['active', 'planned']),
  tokens: z.record(z.string(), z.string().min(1)),
  type: z.string().min(1).optional(),
  programs: z.record(z.string(), z.string().min(1)).optional(),
})
export type EILChainConfig = z.infer<typeof EILChainConfigSchema>

export const EILHubConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  l1StakeManager: OptionalAddressSchema,
  crossChainPaymaster: OptionalAddressSchema,
  status: z.enum(['active', 'planned']),
})

export const EILNetworkConfigSchema = z.object({
  hub: EILHubConfigSchema,
  chains: z.record(z.string(), EILChainConfigSchema),
})
export type EILNetworkConfig = z.infer<typeof EILNetworkConfigSchema>

export const EILConfigSchema = z.object({
  version: z.string().min(1),
  entryPoint: AddressSchema,
  l2Messenger: AddressSchema,
  supportedTokens: z.array(z.string().min(1)),
  localnet: EILNetworkConfigSchema,
  testnet: EILNetworkConfigSchema,
  mainnet: EILNetworkConfigSchema,
})
export type EILConfig = z.infer<typeof EILConfigSchema>

// Federation Schemas

export const FederationHubConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  networkRegistryAddress: OptionalAddressSchema,
  status: z.enum(['active', 'pending', 'planned']),
})
export type FederationHubConfig = z.infer<typeof FederationHubConfigSchema>

export const FederationNetworkConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  explorerUrl: z.string().min(1),
  wsUrl: z.string().min(1),
  contracts: z.object({
    identityRegistry: OptionalAddressSchema,
    solverRegistry: OptionalAddressSchema,
    inputSettler: OptionalAddressSchema,
    outputSettler: OptionalAddressSchema,
    liquidityVault: OptionalAddressSchema,
    governance: OptionalAddressSchema,
    oracle: OptionalAddressSchema,
    federatedIdentity: OptionalAddressSchema,
    federatedSolver: OptionalAddressSchema,
    federatedLiquidity: OptionalAddressSchema,
  }),
  isOrigin: z.boolean(),
  status: z.enum(['active', 'pending', 'planned']),
})
export type FederationNetworkConfig = z.infer<
  typeof FederationNetworkConfigSchema
>

export const FederationFullConfigSchema = z.object({
  version: z.string().min(1),
  hub: z.object({
    testnet: FederationHubConfigSchema,
    mainnet: FederationHubConfigSchema,
  }),
  networks: z.record(z.string(), FederationNetworkConfigSchema),
  trustConfig: z.object({
    defaultTrust: z.string().min(1),
    trustLevels: z.record(z.string(), z.number().nonnegative()),
    requiredStakeETH: z.record(z.string(), z.string().min(1)),
  }),
  crossChain: z.object({
    supportedOracles: z.array(z.string().min(1)),
    defaultOracle: z.string().min(1),
    superchainConfig: z.object({
      crossL2InboxAddress: AddressSchema,
      l2ToL2MessengerAddress: AddressSchema,
    }),
  }),
  discovery: z.object({
    endpoints: z.array(z.string().url()),
    refreshIntervalSeconds: z.number().int().positive(),
    cacheEnabled: z.boolean(),
  }),
  governance: z.object({
    networkVerificationQuorum: z.number().int().positive(),
    trustEstablishmentDelay: z.number().int().nonnegative(),
    slashingEnabled: z.boolean(),
    slashingPercentBps: z.number().int().nonnegative().max(10000),
  }),
})
export type FederationFullConfig = z.infer<typeof FederationFullConfigSchema>

// Branding Schemas

export const ChainBrandingSchema = z.object({
  name: z.string().min(1),
  chainId: z.number().int().positive(),
  symbol: z.string().min(1).max(10),
  explorerName: z.string().min(1),
})
export type ChainBranding = z.infer<typeof ChainBrandingSchema>

export const TokenBrandingSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().nonnegative().max(18),
})
export type TokenBranding = z.infer<typeof TokenBrandingSchema>

export const LogoBrandingSchema = z.object({
  light: z.string().min(1),
  dark: z.string().min(1),
  icon: z.string().min(1),
})

export const UrlsBrandingSchema = z.object({
  website: z.string().url(),
  docs: z.string().url(),
  explorer: z.object({
    testnet: z.string().url(),
    mainnet: z.string().url(),
  }),
  rpc: z.object({
    testnet: z.string().url(),
    mainnet: z.string().url(),
  }),
  api: z.object({
    testnet: z.string().url(),
    mainnet: z.string().url(),
  }),
  gateway: z.object({
    testnet: z.string().url(),
    mainnet: z.string().url(),
  }),
  github: z.string().url(),
  twitter: z.string().url(),
  discord: z.string().url(),
  telegram: z.string().url(),
})
export type UrlsBranding = z.infer<typeof UrlsBrandingSchema>

/** Hex color - matches #RGB or #RRGGBB format */
const HexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Invalid hex color')

export const VisualBrandingSchema = z.object({
  primaryColor: HexColorSchema,
  secondaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  textColor: HexColorSchema,
  logo: LogoBrandingSchema,
  favicon: z.string().min(1),
})
export type VisualBranding = z.infer<typeof VisualBrandingSchema>

export const FeaturesBrandingSchema = z.object({
  flashblocks: z.boolean(),
  flashblocksSubBlockTime: z.number().int().nonnegative(),
  blockTime: z.number().int().positive(),
  erc4337: z.boolean(),
  crossChain: z.boolean(),
  governance: z.boolean(),
  staking: z.boolean(),
  identityRegistry: z.boolean(),
})
export type FeaturesBranding = z.infer<typeof FeaturesBrandingSchema>

export const LegalBrandingSchema = z.object({
  companyName: z.string().min(1),
  termsUrl: z.string().url(),
  privacyUrl: z.string().url(),
  copyrightYear: z.number().int().min(2000).max(2100),
})
export type LegalBranding = z.infer<typeof LegalBrandingSchema>

export const SupportBrandingSchema = z.object({
  email: z.string().email(),
  discordChannel: z.string().min(1),
})
export type SupportBranding = z.infer<typeof SupportBrandingSchema>

export const CliBrandingSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9-]+$/,
      'CLI name must be lowercase alphanumeric with dashes',
    ),
  displayName: z.string().min(1),
  banner: z.array(z.string()).min(1),
})
export type CliBranding = z.infer<typeof CliBrandingSchema>

export const BrandingConfigSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format (x.y.z)'),
  network: z.object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    tagline: z.string().min(1),
    description: z.string().min(10),
    shortDescription: z.string().min(1),
    keywords: z.array(z.string().min(1)).min(1),
  }),
  chains: z.object({
    testnet: ChainBrandingSchema,
    mainnet: ChainBrandingSchema,
  }),
  urls: UrlsBrandingSchema,
  tokens: z.object({
    native: TokenBrandingSchema,
    governance: TokenBrandingSchema,
  }),
  branding: VisualBrandingSchema,
  features: FeaturesBrandingSchema,
  legal: LegalBrandingSchema,
  support: SupportBrandingSchema,
  cli: CliBrandingSchema,
})
export type BrandingConfig = z.infer<typeof BrandingConfigSchema>

// Vendor Apps Schema

export const VendorAppConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  private: z.boolean(),
  optional: z.boolean(),
  branch: z.string().min(1),
})
export type VendorAppConfig = z.infer<typeof VendorAppConfigSchema>

export const VendorAppsConfigSchema = z.object({
  apps: z.array(VendorAppConfigSchema),
})
export type VendorAppsConfig = z.infer<typeof VendorAppsConfigSchema>

// Test Keys Schema

export const KeyRoleSchema = z.enum([
  'deployer',
  'sequencer',
  'batcher',
  'proposer',
  'challenger',
  'admin',
  'guardian',
  'feeRecipient',
  'xlp',
  'multisig1',
  'multisig2',
  'multisig3',
])
export type KeyRole = z.infer<typeof KeyRoleSchema>

export const KeyPairSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})
export type KeyPair = z.infer<typeof KeyPairSchema>

export const TestnetKeyFileSchema = z.object({
  mnemonic: z.string().min(1),
  createdAt: z.string().datetime(),
  keys: z.record(KeyRoleSchema, KeyPairSchema),
})
export type TestnetKeyFile = z.infer<typeof TestnetKeyFileSchema>

export const SolanaKeyPairSchema = z.object({
  publicKey: z.string().min(32).max(64),
  secretKey: z.string().min(64).max(128),
})
export type SolanaKeyPair = z.infer<typeof SolanaKeyPairSchema>

// Deployment File Schemas (for loading contract addresses from deployment files)

/**
 * JSON value type for deployment files - can be any valid JSON
 */
type DeploymentJsonValue =
  | string
  | number
  | boolean
  | null
  | DeploymentJsonValue[]
  | { [key: string]: DeploymentJsonValue }

/**
 * Schema for deployment file data values (recursive JSON)
 * Handles various deployment file formats including:
 * - Flat addresses (strings)
 * - Numeric values (chainId, timestamps)
 * - Nested objects (contracts object)
 */
const DeploymentValueSchema: z.ZodType<DeploymentJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(DeploymentValueSchema),
    z.record(z.string(), DeploymentValueSchema),
  ]),
)

export const DeploymentFileDataSchema = z.record(
  z.string(),
  DeploymentValueSchema,
)
export type DeploymentFileData = z.infer<typeof DeploymentFileDataSchema>

// RPC Response Schemas (for validating JSON-RPC responses)

/**
 * Simple RPC response with optional hex result (for eth_blockNumber, eth_getBalance, etc.)
 */
export const RpcHexResultSchema = z.object({
  result: z.string().optional(),
})
export type RpcHexResult = z.infer<typeof RpcHexResultSchema>

// Bridge Config Schemas (EVMSol cross-chain bridge)

/** Bridge mode - determines which chains and features are active */
export const BridgeModeSchema = z.enum(['local', 'testnet', 'mainnet'])
export type BridgeMode = z.infer<typeof BridgeModeSchema>

/** Bridge components configuration */
export const BridgeComponentsSchema = z.object({
  relayer: z.boolean(),
  prover: z.boolean(),
  beaconWatcher: z.boolean(),
  healthMonitor: z.boolean(),
})
export type BridgeComponents = z.infer<typeof BridgeComponentsSchema>

/** Bridge ports configuration */
export const BridgePortsSchema = z.object({
  relayer: z.number().int().positive(),
  prover: z.number().int().positive(),
  health: z.number().int().positive(),
})
export type BridgePorts = z.infer<typeof BridgePortsSchema>

/** EVM chain configuration for bridge */
export const BridgeEvmChainSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  beaconUrl: z.string().optional(),
  bridgeAddress: z.string(),
  lightClientAddress: z.string(),
})
export type BridgeEvmChain = z.infer<typeof BridgeEvmChainSchema>

/** Solana configuration for bridge */
export const BridgeSolanaConfigSchema = z.object({
  network: z.string().optional(),
  rpcUrl: z.string().min(1),
  bridgeProgramId: z.string(),
  evmLightClientProgramId: z.string(),
})
export type BridgeSolanaConfig = z.infer<typeof BridgeSolanaConfigSchema>

/** TEE configuration for bridge */
export const BridgeTeeConfigSchema = z.object({
  endpoint: z.string().min(1),
  maxBatchSize: z.number().int().positive(),
  batchTimeoutMs: z.number().int().positive(),
  requireRealTEE: z.boolean().optional(),
})
export type BridgeTeeConfig = z.infer<typeof BridgeTeeConfigSchema>

/** Prover configuration for bridge */
export const BridgeProverConfigSchema = z.object({
  mode: z.enum(['self-hosted', 'succinct-network']),
  workers: z.number().int().positive(),
  maxMemoryMb: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  useMockProofs: z.boolean(),
})
export type BridgeProverConfig = z.infer<typeof BridgeProverConfigSchema>

/** Security configuration for mainnet */
export const BridgeSecurityConfigSchema = z.object({
  multisigRequired: z.boolean(),
  minValidators: z.number().int().positive(),
  validatorThreshold: z.number().int().positive(),
})
export type BridgeSecurityConfig = z.infer<typeof BridgeSecurityConfigSchema>

/** Full bridge configuration schema */
export const BridgeConfigSchema = z.object({
  mode: BridgeModeSchema,
  components: BridgeComponentsSchema,
  ports: BridgePortsSchema,
  chains: z.object({
    evm: z.array(BridgeEvmChainSchema),
    solana: BridgeSolanaConfigSchema,
  }),
  tee: BridgeTeeConfigSchema,
  prover: BridgeProverConfigSchema,
  security: BridgeSecurityConfigSchema.optional(),
})
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>

// Moderation Config Schemas

/** Moderation categories */
export const ModerationCategorySchema = z.enum([
  'clean',
  'spam',
  'scam',
  'malware',
  'csam',
  'adult',
  'violence',
  'hate',
  'harassment',
  'self_harm',
  'illegal',
  'copyright',
  'pii',
  'drugs',
])
export type ModerationCategoryConfig = z.infer<typeof ModerationCategorySchema>

/** Moderation action types */
export const ModerationActionSchema = z.enum([
  'allow',
  'warn',
  'queue',
  'block',
  'ban',
])
export type ModerationActionConfig = z.infer<typeof ModerationActionSchema>

/** Moderation provider configuration */
export const ModerationProviderConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  priority: z.number().int().nonnegative(),
  endpoint: z.string().optional(),
  model: z.string().optional(),
  contentTypes: z.array(z.string()),
  categories: z.array(z.string()),
  envKey: z.string().optional(),
  envKeys: z.record(z.string(), z.string()).optional(),
  defaultRegion: z.string().optional(),
  pricing: z.record(z.string(), z.number()).optional(),
  sources: z.record(z.string(), z.object({
    provider: z.string(),
    envKey: z.string(),
    refreshIntervalMs: z.number().optional(),
  })).optional(),
})
export type ModerationProviderConfig = z.infer<typeof ModerationProviderConfigSchema>

/** Moderation reputation configuration */
export const ModerationReputationConfigSchema = z.object({
  tiers: z.array(z.string()),
  reducedScanningLevel: z.string(),
  successesForBackoff: z.number().int().positive(),
  neverBypass: z.array(z.string()),
  backoffSchedule: z.record(z.string(), z.number()),
})
export type ModerationReputationConfig = z.infer<typeof ModerationReputationConfigSchema>

/** Moderation TEE configuration */
export const ModerationTeeConfigSchema = z.object({
  platforms: z.array(z.string()),
  requireAttestation: z.boolean(),
  sensitiveCategories: z.array(z.string()),
  auditLogRetentionDays: z.number().int().positive(),
})
export type ModerationTeeConfig = z.infer<typeof ModerationTeeConfigSchema>

/** Moderation queue configuration */
export const ModerationQueueConfigSchema = z.object({
  enabled: z.boolean(),
  maxPendingReviews: z.number().int().positive(),
  reviewTimeoutMs: z.number().int().positive(),
  priorityCategories: z.array(z.string()),
})
export type ModerationQueueConfig = z.infer<typeof ModerationQueueConfigSchema>

/** Environment-specific moderation settings */
export const ModerationEnvironmentConfigSchema = z.object({
  providers: z.array(z.string()),
  strictMode: z.boolean(),
})
export type ModerationEnvironmentConfig = z.infer<typeof ModerationEnvironmentConfigSchema>

/** Full moderation configuration schema */
export const ModerationConfigSchema = z.object({
  version: z.string(),
  lastUpdated: z.string(),
  description: z.string(),
  providers: z.record(z.string(), ModerationProviderConfigSchema),
  thresholds: z.record(z.string(), z.number()),
  actions: z.record(z.string(), ModerationActionSchema),
  reputation: ModerationReputationConfigSchema,
  tee: ModerationTeeConfigSchema,
  queue: ModerationQueueConfigSchema,
  environments: z.record(z.string(), ModerationEnvironmentConfigSchema),
})
export type ModerationConfig = z.infer<typeof ModerationConfigSchema>

// ============ Proof-of-Cloud (PoC) Configuration ============

/** AMD KDS (Key Distribution Service) configuration */
export const PoCKdsConfigSchema = z.object({
  baseUrl: z.string().url(),
  timeoutMs: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  retryDelayMs: z.number().int().positive(),
  defaultProduct: z.enum(['Milan', 'Genoa']),
})
export type PoCKdsConfig = z.infer<typeof PoCKdsConfigSchema>

/** TCB (Trusted Computing Base) minimum versions */
export const PoCTcbMinimumsSchema = z.object({
  intelTdx: z.object({
    cpu: z.number().int().nonnegative(),
    tcb: z.number().int().nonnegative(),
  }),
  intelSgx: z.object({
    cpu: z.number().int().nonnegative(),
    tcb: z.number().int().nonnegative(),
  }),
  amdSev: z.object({
    snp: z.number().int().nonnegative(),
  }),
})
export type PoCTcbMinimums = z.infer<typeof PoCTcbMinimumsSchema>

/** Full PoC verification configuration */
export const PoCVerificationConfigSchema = z.object({
  intelRootCaFingerprints: z.array(z.string().length(64)),
  amdKds: PoCKdsConfigSchema,
  tcbMinimums: PoCTcbMinimumsSchema,
})
export type PoCVerificationConfig = z.infer<typeof PoCVerificationConfigSchema>
