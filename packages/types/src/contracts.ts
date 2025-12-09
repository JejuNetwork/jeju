import { z } from 'zod';

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export type Address = z.infer<typeof AddressSchema>;

export const L1ContractsSchema = z.object({
  OptimismPortal: AddressSchema,
  L2OutputOracle: AddressSchema,
  L1CrossDomainMessenger: AddressSchema,
  L1StandardBridge: AddressSchema,
  L1ERC721Bridge: AddressSchema,
  SystemConfig: AddressSchema,
  AddressManager: AddressSchema,
  ProxyAdmin: AddressSchema,
  DisputeGameFactory: AddressSchema.optional(),
});
export type L1Contracts = z.infer<typeof L1ContractsSchema>;

export const L2ContractsSchema = z.object({
  L2CrossDomainMessenger: AddressSchema,
  L2StandardBridge: AddressSchema,
  L2ERC721Bridge: AddressSchema,
  L2ToL1MessagePasser: AddressSchema,
  GasPriceOracle: AddressSchema,
  L1Block: AddressSchema,
  WETH: AddressSchema,
});
export type L2Contracts = z.infer<typeof L2ContractsSchema>;

export const HyperlaneContractsSchema = z.object({
  Mailbox: AddressSchema,
  InterchainGasPaymaster: AddressSchema,
  ValidatorAnnounce: AddressSchema,
  MultisigIsm: AddressSchema,
  InterchainSecurityModule: AddressSchema,
  domainId: z.number(),
});
export type HyperlaneContracts = z.infer<typeof HyperlaneContractsSchema>;

export const UniswapV4ContractsSchema = z.object({
  PoolManager: AddressSchema,
  SwapRouter: AddressSchema,
  PositionManager: AddressSchema,
  QuoterV4: AddressSchema,
  StateView: AddressSchema,
});
export type UniswapV4Contracts = z.infer<typeof UniswapV4ContractsSchema>;

export const SynthetixV3ContractsSchema = z.object({
  CoreProxy: AddressSchema,
  AccountProxy: AddressSchema,
  USDProxy: AddressSchema,
  PerpsMarketProxy: AddressSchema,
  SpotMarketProxy: AddressSchema,
  OracleManager: AddressSchema,
});
export type SynthetixV3Contracts = z.infer<typeof SynthetixV3ContractsSchema>;

export const CompoundV3ContractsSchema = z.object({
  Comet: AddressSchema,
  CometRewards: AddressSchema,
  Configurator: AddressSchema,
  ProxyAdmin: AddressSchema,
});
export type CompoundV3Contracts = z.infer<typeof CompoundV3ContractsSchema>;

export const ChainlinkContractsSchema = z.object({
  feeds: z.record(z.string(), z.object({
    address: AddressSchema,
    heartbeat: z.number(),
    decimals: z.number(),
  })),
});
export type ChainlinkContracts = z.infer<typeof ChainlinkContractsSchema>;

export const ERC4337ContractsSchema = z.object({
  EntryPoint: AddressSchema,
  AccountFactory: AddressSchema,
  Paymaster: AddressSchema,
  PaymasterVerifier: AddressSchema.optional(),
});
export type ERC4337Contracts = z.infer<typeof ERC4337ContractsSchema>;

export const GovernanceContractsSchema = z.object({
  Safe: AddressSchema,
  Governor: AddressSchema,
  TimelockController: AddressSchema,
  GovernanceToken: AddressSchema,
});
export type GovernanceContracts = z.infer<typeof GovernanceContractsSchema>;

export const DeploymentSchema = z.object({
  network: z.string(),
  timestamp: z.number(),
  deployer: AddressSchema,
  l1Contracts: L1ContractsSchema,
  l2Contracts: L2ContractsSchema,
  hyperlane: HyperlaneContractsSchema.optional(),
  uniswapV4: UniswapV4ContractsSchema.optional(),
  synthetixV3: SynthetixV3ContractsSchema.optional(),
  compoundV3: CompoundV3ContractsSchema.optional(),
  chainlink: ChainlinkContractsSchema.optional(),
  erc4337: ERC4337ContractsSchema.optional(),
  governance: GovernanceContractsSchema.optional(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;


