/**
 * Chain configuration types for EVM and Solana networks.
 */

import { z } from 'zod'
import { AddressSchema } from './validation'

export const NetworkSchema = z.enum(['localnet', 'testnet', 'mainnet'])
export type NetworkType = z.infer<typeof NetworkSchema>

const OptionalAddressSchema = z
  .string()
  .refine((val) => val === '' || /^0x[a-fA-F0-9]{40}$/.test(val), {
    message: 'Must be empty or valid Ethereum address',
  })

export type ChainType = 'evm' | 'solana'

export type EVMChainId =
  | 1 // Ethereum Mainnet
  | 10 // Optimism
  | 56 // BSC (Binance Smart Chain)
  | 137 // Polygon
  | 42161 // Arbitrum One
  | 43114 // Avalanche
  | 8453 // Base
  | 84532 // Base Sepolia (testnet)
  | 11155111 // Sepolia (testnet)
  | 11155420 // Optimism Sepolia (testnet)
  | 421614 // Arbitrum Sepolia (testnet)
  | 420690 // Jeju Testnet (L2 on Sepolia)
  | 420691 // Jeju Mainnet (L2 on Ethereum)
  | 31337
  | 31337

export type SolanaNetwork =
  | 'mainnet-beta'
  | 'devnet'
  | 'localnet'
  | 'solana-mainnet'
  | 'solana-devnet'

const GasTokenSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
})

const ChainL2ContractsSchema = z.object({
  L2CrossDomainMessenger: AddressSchema,
  L2StandardBridge: AddressSchema,
  L2ToL1MessagePasser: AddressSchema,
  L2ERC721Bridge: AddressSchema,
  GasPriceOracle: AddressSchema,
  L1Block: AddressSchema,
  WETH: AddressSchema,
})

const ChainL1ContractsSchema = z.object({
  OptimismPortal: OptionalAddressSchema,
  L2OutputOracle: OptionalAddressSchema,
  L1CrossDomainMessenger: OptionalAddressSchema,
  L1StandardBridge: OptionalAddressSchema,
  SystemConfig: OptionalAddressSchema,
})

export interface BaseChainConfig {
  chainId: EVMChainId | SolanaNetwork
  chainType: ChainType
  name: string
  rpcUrl: string
  explorerUrl?: string
  nativeCurrency?: {
    symbol: string
    decimals: number
    name?: string
  }
}

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
})
export type ChainConfig = z.infer<typeof ChainConfigSchema>

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
    daProvider: z.enum(['jeju-da', 'ethereum-blobs', 'calldata']),
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
})
export type OPStackConfig = z.infer<typeof OPStackConfigSchema>

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
})
export type RethConfig = z.infer<typeof RethConfigSchema>

export const JejuDAConfigSchema = z.object({
  enabled: z.boolean(),
  serverImage: z.string(),
  serverVersion: z.string(),
  serverUrl: z.string(),
  ipfsApiUrl: z.string(),
  ipfsGatewayUrl: z.string(),
  peerdasEnabled: z.boolean(),
  minConfirmations: z.number(),
})
export type JejuDAConfig = z.infer<typeof JejuDAConfigSchema>

export const FlashblocksConfigSchema = z.object({
  enabled: z.boolean(),
  subBlockTime: z.number(),
  leaderElection: z.object({
    enabled: z.boolean(),
    heartbeatInterval: z.number(),
    electionTimeout: z.number(),
  }),
  sequencerFollowers: z.number(),
})
export type FlashblocksConfig = z.infer<typeof FlashblocksConfigSchema>

export const GenesisConfigSchema = z.object({
  timestamp: z.number(),
  gasLimit: z.number(),
  difficulty: z.number(),
  extraData: z.string(),
  baseFeePerGas: z.string(),
  l1BlockHash: z.string().optional(),
  l1BlockNumber: z.number().optional(),
})
export type GenesisConfig = z.infer<typeof GenesisConfigSchema>

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
})
export type RollupConfig = z.infer<typeof RollupConfigSchema>

/**
 * Transaction log from receipt - compatible with viem Log type.
 * Use this for event decoding and log processing.
 */
export interface TransactionLog {
  address: `0x${string}`
  blockHash: `0x${string}`
  blockNumber: bigint
  data: `0x${string}`
  logIndex: number
  transactionHash: `0x${string}`
  transactionIndex: number
  removed: boolean
  topics: readonly `0x${string}`[]
}
