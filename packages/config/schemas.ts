/**
 * @fileoverview Zod schemas for config validation
 * @module config/schemas
 * 
 * Centralized validation schemas for all config files.
 * Ensures type safety when loading JSON configs.
 */

import { z } from 'zod';

// ============================================================================
// Network Type
// ============================================================================

export const NetworkSchema = z.enum(['localnet', 'testnet', 'mainnet']);
export type NetworkType = z.infer<typeof NetworkSchema>;

// ============================================================================
// Chain Configuration Schema
// ============================================================================

/**
 * Address schema using regex validation (no viem dependency)
 */
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/**
 * Optional address schema - allows empty strings for contracts that haven't been deployed yet
 */
const OptionalAddressSchema = z.string().refine(
  (val) => val === '' || /^0x[a-fA-F0-9]{40}$/.test(val),
  { message: 'Must be empty or valid Ethereum address' }
);

const GasTokenSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
});

/** OP Stack L2 contract addresses for chain config */
const ChainL2ContractsSchema = z.object({
  L2CrossDomainMessenger: AddressSchema,
  L2StandardBridge: AddressSchema,
  L2ToL1MessagePasser: AddressSchema,
  L2ERC721Bridge: AddressSchema,
  GasPriceOracle: AddressSchema,
  L1Block: AddressSchema,
  WETH: AddressSchema,
});

/** OP Stack L1 contract addresses for chain config - allows empty for undeployed contracts */
const ChainL1ContractsSchema = z.object({
  OptimismPortal: OptionalAddressSchema,
  L2OutputOracle: OptionalAddressSchema,
  L1CrossDomainMessenger: OptionalAddressSchema,
  L1StandardBridge: OptionalAddressSchema,
  SystemConfig: OptionalAddressSchema,
});

/**
 * OP Stack chain configuration schema
 */
export const ChainConfigSchema = z.object({
  chainId: z.number(),
  networkId: z.number(),
  name: z.string(),
  rpcUrl: z.string(),
  wsUrl: z.string(),
  explorerUrl: z.string(),
  l1ChainId: z.number(),
  l1RpcUrl: z.string(),
  l1Name: z.string(),
  flashblocksEnabled: z.boolean(),
  flashblocksSubBlockTime: z.number(),
  blockTime: z.number(),
  gasToken: GasTokenSchema,
  contracts: z.object({
    l2: ChainL2ContractsSchema,
    l1: ChainL1ContractsSchema,
  }),
});
export type ChainConfig = z.infer<typeof ChainConfigSchema>;

// ============================================================================
// Contract Schemas
// ============================================================================

const ContractCategorySchema = z.record(z.string(), z.string());

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
  | 'payments' 
  | 'defi' 
  | 'compute' 
  | 'governance' 
  | 'oif' 
  | 'eil'
  | 'security';

/**
 * Extended contract categories that may be used in deployments
 * Includes additional categories for update operations
 */
export type ContractCategoryExtended = ContractCategory | 'commerce' | 'fees';

const NetworkContractsSchema = z.object({
  chainId: z.number(),
  tokens: ContractCategorySchema,
  registry: ContractCategorySchema,
  moderation: ContractCategorySchema,
  nodeStaking: ContractCategorySchema,
  jns: ContractCategorySchema,
  payments: ContractCategorySchema,
  defi: ContractCategorySchema,
  compute: ContractCategorySchema,
  governance: ContractCategorySchema,
  oif: ContractCategorySchema,
  eil: ContractCategorySchema,
  security: ContractCategorySchema,
});

const ExternalChainContractsSchema = z.object({
  chainId: z.number(),
  rpcUrl: z.string(),
  oif: ContractCategorySchema.optional(),
  eil: ContractCategorySchema.optional(),
  tokens: ContractCategorySchema.optional(),
  poc: ContractCategorySchema.optional(),
});

export const ContractsConfigSchema = z.object({
  version: z.string(),
  constants: z.object({
    entryPoint: z.string(),
    entryPointV07: z.string(),
    l2Messenger: z.string(),
    l2StandardBridge: z.string(),
    weth: z.string(),
  }),
  localnet: NetworkContractsSchema,
  testnet: NetworkContractsSchema,
  mainnet: NetworkContractsSchema,
  external: z.record(z.string(), ExternalChainContractsSchema),
});
export type ContractsConfig = z.infer<typeof ContractsConfigSchema>;

// ============================================================================
// Services Schemas
// ============================================================================

export const ServicesNetworkConfigSchema = z.object({
  rpc: z.object({
    l1: z.string(),
    l2: z.string(),
    ws: z.string(),
  }),
  explorer: z.string(),
  indexer: z.object({
    graphql: z.string(),
    websocket: z.string(),
  }),
  gateway: z.object({
    ui: z.string(),
    api: z.string(),
    a2a: z.string(),
    mcp: z.string(),
    ws: z.string(),
  }),
  rpcGateway: z.string(),
  bazaar: z.string(),
  storage: z.object({
    api: z.string(),
    ipfsGateway: z.string(),
  }),
  compute: z.object({
    marketplace: z.string(),
    nodeApi: z.string(),
  }),
  oif: z.object({
    aggregator: z.string(),
  }),
  leaderboard: z.object({
    api: z.string(),
    ui: z.string(),
  }),
  monitoring: z.object({
    prometheus: z.string(),
    grafana: z.string(),
  }),
  crucible: z.object({
    api: z.string(),
    executor: z.string(),
  }),
  cql: z.object({
    blockProducer: z.string(),
    miner: z.string(),
  }),
  dws: z.object({
    api: z.string(),
    compute: z.string(),
  }),
  autocrat: z.object({
    api: z.string(),
    a2a: z.string(),
  }),
  kms: z.object({
    api: z.string(),
    mpc: z.string(),
  }),
  factory: z.object({
    ui: z.string(),
    api: z.string(),
    mcp: z.string(),
  }),
  externalRpcs: z.record(z.string(), z.string()).optional(),
});
export type ServicesNetworkConfig = z.infer<typeof ServicesNetworkConfigSchema>;

export const ServicesConfigSchema = z.object({
  localnet: ServicesNetworkConfigSchema,
  testnet: ServicesNetworkConfigSchema,
  mainnet: ServicesNetworkConfigSchema,
});
export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;

// ============================================================================
// EIL (Cross-Chain Liquidity) Schemas
// ============================================================================

export const EILChainConfigSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  rpcUrl: z.string(),
  crossChainPaymaster: z.string(),
  l1StakeManager: z.string().optional(),
  status: z.enum(['active', 'planned']),
  tokens: z.record(z.string(), z.string()),
});
export type EILChainConfig = z.infer<typeof EILChainConfigSchema>;

export const EILHubConfigSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  rpcUrl: z.string(),
  l1StakeManager: z.string(),
  crossChainPaymaster: z.string(),
  status: z.enum(['active', 'planned']),
});

export const EILNetworkConfigSchema = z.object({
  hub: EILHubConfigSchema,
  chains: z.record(z.string(), EILChainConfigSchema),
});
export type EILNetworkConfig = z.infer<typeof EILNetworkConfigSchema>;

export const EILConfigSchema = z.object({
  version: z.string(),
  entryPoint: z.string(),
  l2Messenger: z.string(),
  supportedTokens: z.array(z.string()),
  localnet: EILNetworkConfigSchema,
  testnet: EILNetworkConfigSchema,
  mainnet: EILNetworkConfigSchema,
});
export type EILConfig = z.infer<typeof EILConfigSchema>;

// ============================================================================
// Federation Schemas
// ============================================================================

export const FederationHubConfigSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  rpcUrl: z.string(),
  networkRegistryAddress: z.string(),
  status: z.enum(['active', 'pending', 'planned']),
});
export type FederationHubConfig = z.infer<typeof FederationHubConfigSchema>;

export const FederationNetworkConfigSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  rpcUrl: z.string(),
  explorerUrl: z.string(),
  wsUrl: z.string(),
  contracts: z.object({
    identityRegistry: z.string(),
    solverRegistry: z.string(),
    inputSettler: z.string(),
    outputSettler: z.string(),
    liquidityVault: z.string(),
    governance: z.string(),
    oracle: z.string(),
    federatedIdentity: z.string(),
    federatedSolver: z.string(),
    federatedLiquidity: z.string(),
  }),
  isOrigin: z.boolean(),
  status: z.enum(['active', 'pending', 'planned']),
});
export type FederationNetworkConfig = z.infer<typeof FederationNetworkConfigSchema>;

export const FederationFullConfigSchema = z.object({
  version: z.string(),
  hub: z.object({
    testnet: FederationHubConfigSchema,
    mainnet: FederationHubConfigSchema,
  }),
  networks: z.record(z.string(), FederationNetworkConfigSchema),
  trustConfig: z.object({
    defaultTrust: z.string(),
    trustLevels: z.record(z.string(), z.number()),
    requiredStakeETH: z.record(z.string(), z.string()),
  }),
  crossChain: z.object({
    supportedOracles: z.array(z.string()),
    defaultOracle: z.string(),
    superchainConfig: z.object({
      crossL2InboxAddress: z.string(),
      l2ToL2MessengerAddress: z.string(),
    }),
  }),
  discovery: z.object({
    endpoints: z.array(z.string()),
    refreshIntervalSeconds: z.number(),
    cacheEnabled: z.boolean(),
  }),
  governance: z.object({
    networkVerificationQuorum: z.number(),
    trustEstablishmentDelay: z.number(),
    slashingEnabled: z.boolean(),
    slashingPercentBps: z.number(),
  }),
});
export type FederationFullConfig = z.infer<typeof FederationFullConfigSchema>;

// ============================================================================
// Branding Schemas
// ============================================================================

export const ChainBrandingSchema = z.object({
  name: z.string(),
  chainId: z.number(),
  symbol: z.string(),
  explorerName: z.string(),
});
export type ChainBranding = z.infer<typeof ChainBrandingSchema>;

export const TokenBrandingSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
});
export type TokenBranding = z.infer<typeof TokenBrandingSchema>;

export const LogoBrandingSchema = z.object({
  light: z.string(),
  dark: z.string(),
  icon: z.string(),
});

export const UrlsBrandingSchema = z.object({
  website: z.string(),
  docs: z.string(),
  explorer: z.object({
    testnet: z.string(),
    mainnet: z.string(),
  }),
  rpc: z.object({
    testnet: z.string(),
    mainnet: z.string(),
  }),
  api: z.object({
    testnet: z.string(),
    mainnet: z.string(),
  }),
  gateway: z.object({
    testnet: z.string(),
    mainnet: z.string(),
  }),
  github: z.string(),
  twitter: z.string(),
  discord: z.string(),
  telegram: z.string(),
});
export type UrlsBranding = z.infer<typeof UrlsBrandingSchema>;

export const VisualBrandingSchema = z.object({
  primaryColor: z.string(),
  secondaryColor: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  logo: LogoBrandingSchema,
  favicon: z.string(),
});
export type VisualBranding = z.infer<typeof VisualBrandingSchema>;

export const FeaturesBrandingSchema = z.object({
  flashblocks: z.boolean(),
  flashblocksSubBlockTime: z.number(),
  blockTime: z.number(),
  erc4337: z.boolean(),
  crossChain: z.boolean(),
  governance: z.boolean(),
  staking: z.boolean(),
  identityRegistry: z.boolean(),
});
export type FeaturesBranding = z.infer<typeof FeaturesBrandingSchema>;

export const LegalBrandingSchema = z.object({
  companyName: z.string(),
  termsUrl: z.string(),
  privacyUrl: z.string(),
  copyrightYear: z.number(),
});
export type LegalBranding = z.infer<typeof LegalBrandingSchema>;

export const SupportBrandingSchema = z.object({
  email: z.string(),
  discordChannel: z.string(),
});
export type SupportBranding = z.infer<typeof SupportBrandingSchema>;

export const CliBrandingSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  banner: z.array(z.string()),
});
export type CliBranding = z.infer<typeof CliBrandingSchema>;

export const BrandingConfigSchema = z.object({
  version: z.string(),
  network: z.object({
    name: z.string(),
    displayName: z.string(),
    tagline: z.string(),
    description: z.string(),
    shortDescription: z.string(),
    keywords: z.array(z.string()),
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
});
export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;

// ============================================================================
// Vendor Apps Schema
// ============================================================================

export const VendorAppConfigSchema = z.object({
  name: z.string(),
  url: z.string(),
  path: z.string(),
  description: z.string().optional(),
  private: z.boolean(),
  optional: z.boolean(),
  branch: z.string(),
});
export type VendorAppConfig = z.infer<typeof VendorAppConfigSchema>;

export const VendorAppsConfigSchema = z.object({
  apps: z.array(VendorAppConfigSchema),
});
export type VendorAppsConfig = z.infer<typeof VendorAppsConfigSchema>;

// ============================================================================
// Testnet Config Schema
// ============================================================================

export const TestnetConfigSchema = z.object({
  network: z.string(),
  version: z.string(),
  jeju: z.object({
    chainId: z.number(),
    networkName: z.string(),
    currency: z.object({
      name: z.string(),
      symbol: z.string(),
      decimals: z.number(),
    }),
    rpc: z.object({
      http: z.string(),
      ws: z.string(),
      internal: z.string(),
    }),
    explorer: z.string(),
    blockTime: z.number(),
  }),
  l1: z.object({
    chainId: z.number(),
    networkName: z.string(),
    rpc: z.object({
      http: z.string(),
      fallback: z.array(z.string()),
      beacon: z.string(),
      internal: z.string(),
    }),
  }),
  api: z.object({
    gateway: z.string(),
    bundler: z.string(),
    indexer: z.string(),
    faucet: z.string(),
  }),
  contracts: z.object({
    jeju: z.record(z.string(), z.string()),
    sepolia: z.record(z.string(), z.string()),
  }),
  supportedChains: z.record(z.string(), z.object({
    name: z.string(),
    rpc: z.string(),
    explorer: z.string(),
    crossChainPaymaster: z.string(),
  })),
  deployer: z.object({
    address: z.string(),
  }),
  infrastructure: z.object({
    domain: z.string(),
    aws: z.object({
      region: z.string(),
      eksCluster: z.string(),
      route53Zone: z.string(),
      acmCertificate: z.string(),
    }),
    dns: z.record(z.string(), z.string()),
    nameservers: z.array(z.string()),
  }),
});
export type TestnetConfig = z.infer<typeof TestnetConfigSchema>;

// ============================================================================
// Test Keys Schema
// ============================================================================

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
]);
export type KeyRole = z.infer<typeof KeyRoleSchema>;

export const KeyPairSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});
export type KeyPair = z.infer<typeof KeyPairSchema>;

export const TestnetKeyFileSchema = z.object({
  mnemonic: z.string(),
  createdAt: z.string(),
  keys: z.record(KeyRoleSchema, KeyPairSchema),
});
export type TestnetKeyFile = z.infer<typeof TestnetKeyFileSchema>;

export const SolanaKeyPairSchema = z.object({
  publicKey: z.string(),
  secretKey: z.string(),
});
export type SolanaKeyPair = z.infer<typeof SolanaKeyPairSchema>;
