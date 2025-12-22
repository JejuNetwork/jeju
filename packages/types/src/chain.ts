import { z } from 'zod';
import { AddressSchema } from './validation';

export const NetworkSchema = z.enum(['localnet', 'testnet', 'mainnet']);

/**
 * Optional address schema - allows empty strings for contracts that haven't been deployed yet
 * Empty string means "not yet deployed/configured"
 */
const OptionalAddressSchema = z.string().refine(
  (val) => val === '' || /^0x[a-fA-F0-9]{40}$/.test(val),
  { message: 'Must be empty or valid Ethereum address' }
);
export type NetworkType = z.infer<typeof NetworkSchema>;

// ============ Chain Type Classification ============

/**
 * Chain type classification - distinguishes between EVM and Solana chains
 */
export type ChainType = 'evm' | 'solana';

// ============ EVM Chain IDs ============

/**
 * Supported EVM chain IDs across the Jeju ecosystem
 * Consolidates all EVM chain definitions into a single source of truth
 */
export type EVMChainId =
  | 1        // Ethereum Mainnet
  | 10       // Optimism
  | 56       // BSC (Binance Smart Chain)
  | 137      // Polygon
  | 42161    // Arbitrum One
  | 43114    // Avalanche
  | 8453     // Base
  | 84532    // Base Sepolia (testnet)
  | 11155111 // Sepolia (testnet)
  | 11155420 // Optimism Sepolia (testnet)
  | 421614   // Arbitrum Sepolia (testnet)
  | 420690   // Jeju Testnet (L2 on Sepolia)
  | 420691   // Jeju Mainnet (L2 on Ethereum)
  | 1337     // Localnet (development)
  | 31337;   // Local EVM (development)

// ============ Solana Networks ============

/**
 * Supported Solana network identifiers
 * Includes both standard and common alias names
 */
export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'localnet' | 'solana-mainnet' | 'solana-devnet';

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

// ============ Base Chain Configuration ============

/**
 * Base chain configuration interface
 * Used as foundation for domain-specific chain configs
 */
export interface BaseChainConfig {
  chainId: EVMChainId | SolanaNetwork;
  chainType: ChainType;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
  nativeCurrency?: {
    symbol: string;
    decimals: number;
    name?: string;
  };
}

// ============ OP Stack Chain Configuration ============

/**
 * OP Stack-specific chain configuration (extends base)
 * Used for OP Stack L2 deployments
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


export const OPStackConfigSchema = z.object({
  opNode: z.object({
    image: z.string(),
    version: z.string(),
    p2pPort: z.number(),
    rpcPort: z.number(),
    metricsPort: z.number(),
  }),
  opBatcher: z.object({
    image: z.string(),
    version: z.string(),
    maxChannelDuration: z.number(),
    subSafetyMargin: z.number(),
    pollInterval: z.string(),
    numConfirmations: z.number(),
    daProvider: z.enum(['eigenda', 'ethereum-blobs', 'calldata']),
  }),
  opProposer: z.object({
    image: z.string(),
    version: z.string(),
    pollInterval: z.string(),
    numConfirmations: z.number(),
  }),
  opChallenger: z.object({
    image: z.string(),
    version: z.string(),
    pollInterval: z.string(),
  }),
  opConductor: z.object({
    enabled: z.boolean(),
    image: z.string(),
    version: z.string(),
    consensusPort: z.number(),
    healthCheckPort: z.number(),
  }),
});
export type OPStackConfig = z.infer<typeof OPStackConfigSchema>;

export const RethConfigSchema = z.object({
  image: z.string(),
  version: z.string(),
  httpPort: z.number(),
  wsPort: z.number(),
  p2pPort: z.number(),
  metricsPort: z.number(),
  enginePort: z.number(),
  maxPeers: z.number(),
  pruning: z.enum(['full', 'archive']),
});
export type RethConfig = z.infer<typeof RethConfigSchema>;

export const EigenDAConfigSchema = z.object({
  enabled: z.boolean(),
  clientImage: z.string(),
  clientVersion: z.string(),
  disperserRpc: z.string(),
  retrieverRpc: z.string(),
  attestationServiceUrl: z.string(),
  minConfirmations: z.number(),
});
export type EigenDAConfig = z.infer<typeof EigenDAConfigSchema>;

export const FlashblocksConfigSchema = z.object({
  enabled: z.boolean(),
  subBlockTime: z.number(), // milliseconds
  leaderElection: z.object({
    enabled: z.boolean(),
    heartbeatInterval: z.number(), // milliseconds
    electionTimeout: z.number(), // milliseconds
  }),
  sequencerFollowers: z.number(),
});
export type FlashblocksConfig = z.infer<typeof FlashblocksConfigSchema>;

export const GenesisConfigSchema = z.object({
  timestamp: z.number(),
  gasLimit: z.number(),
  difficulty: z.number(),
  extraData: z.string(),
  baseFeePerGas: z.string(),
  l1BlockHash: z.string().optional(),
  l1BlockNumber: z.number().optional(),
});
export type GenesisConfig = z.infer<typeof GenesisConfigSchema>;

export const RollupConfigSchema = z.object({
  genesis: GenesisConfigSchema,
  blockTime: z.number(),
  maxSequencerDrift: z.number(),
  sequencerWindowSize: z.number(),
  channelTimeout: z.number(),
  l1ChainId: z.number(),
  l2ChainId: z.number(),
  batchInboxAddress: z.string(),
  depositContractAddress: z.string(),
  l1SystemConfigAddress: z.string(),
});
export type RollupConfig = z.infer<typeof RollupConfigSchema>;


