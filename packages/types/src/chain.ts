import { z } from 'zod';

export const NetworkSchema = z.enum(['localnet', 'testnet', 'mainnet']);
export type NetworkType = z.infer<typeof NetworkSchema>;

const GasTokenSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
});

const L2ContractsSchema = z.object({
  L2CrossDomainMessenger: z.string(),
  L2StandardBridge: z.string(),
  L2ToL1MessagePasser: z.string(),
  L2ERC721Bridge: z.string(),
  GasPriceOracle: z.string(),
  L1Block: z.string(),
  WETH: z.string(),
});

const L1ContractsSchema = z.object({
  OptimismPortal: z.string(),
  L2OutputOracle: z.string(),
  L1CrossDomainMessenger: z.string(),
  L1StandardBridge: z.string(),
  SystemConfig: z.string(),
});

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
    l2: L2ContractsSchema,
    l1: L1ContractsSchema,
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


