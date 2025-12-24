/**
 * Token economics and cross-chain deployment types.
 */

import type { ChainType, EVMChainId, SolanaNetwork } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

export type ChainId = EVMChainId | SolanaNetwork

export interface ChainConfig {
  chainId: ChainId
  chainType: ChainType
  name: string
  rpcUrl: string
  blockExplorerUrl: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  hyperlaneMailbox: string
  hyperlaneIgp: string
  isHomeChain: boolean
  avgBlockTime: number
  uniswapV4PoolManager?: Address
  dexRouter?: Address | string
}

export interface TokenAllocation {
  publicSale: number
  presale: number
  team: number
  advisors: number
  ecosystem: number
  liquidity: number
  stakingRewards: number
}

export interface VestingSchedule {
  cliffDuration: number
  vestingDuration: number
  tgeUnlockPercent: number
  vestingType: 'linear' | 'discrete'
  discretePeriods?: number
}

export interface VestingConfig {
  team: VestingSchedule
  advisors: VestingSchedule
  presale: VestingSchedule
  ecosystem: VestingSchedule
  publicSale?: VestingSchedule
}

export interface FeeDistribution {
  holders: number
  creators: number
  treasury: number
  liquidityProviders: number
  burn: number
}

export interface FeeConfig {
  transferFeeBps: number
  bridgeFeeBps: number
  swapFeeBps: number
  distribution: FeeDistribution
  feeExemptAddresses: Address[]
}

export interface TokenEconomics {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  allocation: TokenAllocation
  vesting: VestingConfig
  fees: FeeConfig
  maxWalletPercent: number
  maxTxPercent: number
}

export type LiquidityDex =
  | 'uniswap-v4'
  | 'uniswap-v3'
  | 'sushiswap'
  | 'raydium'
  | 'orca'
  | 'jupiter'

export interface LiquidityAllocation {
  chainId: ChainId
  percentage: number
  initialPriceUsd: number
  pairedAsset: Address | 'SOL'
  dex: LiquidityDex
}

export interface LiquidityConfig {
  lockDuration: number
  lpTokenRecipient: Address
  allocations: LiquidityAllocation[]
}

export interface PresaleTier {
  name: string
  minContribution: number
  maxContribution: number
  discountPercent: number
  vestingOverride?: VestingSchedule
  whitelistMerkleRoot?: Hex
}

export interface PresaleConfig {
  enabled: boolean
  startTime: number
  endTime: number
  softCapUsd: number
  hardCapUsd: number
  priceUsd: number
  tiers: PresaleTier[]
  acceptedTokens: Record<ChainId, Address[]>
  refundIfSoftCapMissed: boolean
}

export type CCADeploymentMode = 'uniswap-platform' | 'self-deployed'

export interface CCAConfig {
  deploymentMode: CCADeploymentMode
  startTime: number
  duration: number
  startPriceUsd: number
  reservePriceUsd: number
  supplyReleaseCurve: 'linear' | 'exponential' | 'step'
  maxBidPercent: number
  minBidUsd: number
  autoMigrateLiquidity: boolean
  auctionFees?: {
    platformFeeBps: number
    referralFeeBps: number
  }
}

export type ISMType =
  | 'multisig'
  | 'optimistic'
  | 'aggregation'
  | 'routing'
  | 'pausable'
  | 'trusted-relayer'

export interface MultisigISMConfig {
  type: 'multisig'
  validators: string[]
  threshold: number
}

export interface OptimisticISMConfig {
  type: 'optimistic'
  challengePeriod: number
  watchers: string[]
}

export type ISMConfig = MultisigISMConfig | OptimisticISMConfig

export interface WarpRouteConfig {
  chainId: ChainId
  tokenType: 'native' | 'synthetic' | 'collateral'
  collateralAddress?: string
  ism: ISMConfig
  owner: string
  rateLimitPerDay: bigint
}

export interface HyperlaneConfig {
  routes: WarpRouteConfig[]
  validators: {
    address: string
    chains: ChainId[]
  }[]
  gasConfig: {
    defaultGasLimit: bigint
    gasOverhead: bigint
  }
}

export interface DeploymentConfig {
  token: TokenEconomics
  liquidity: LiquidityConfig
  presale: PresaleConfig
  cca: CCAConfig
  hyperlane: HyperlaneConfig
  chains: ChainConfig[]
  owner: Address
  timelockDelay: number
  deploymentSalt: Hex
}

export interface ChainDeployment {
  chainId: ChainId
  token: string
  vesting: string
  feeDistributor: string
  warpRoute: string
  ism: string
  liquidityPool?: string
  presale?: string
  ccaAuction?: string
  deploymentTxHashes: Hex[]
  deployedAtBlock: bigint
}

export interface DeploymentResult {
  deployedAt: number
  config: DeploymentConfig
  deployments: ChainDeployment[]
  salt: Hex
  deterministicAddresses: Record<ChainId, string>
}

export interface BridgeRequest {
  sourceChain: ChainId
  destinationChain: ChainId
  sender: string
  recipient: string
  amount: bigint
  callData?: Hex
}

export interface BridgeStatus {
  requestId: Hex
  status: 'pending' | 'dispatched' | 'delivered' | 'failed'
  sourceChain: ChainId
  destinationChain: ChainId
  amount: bigint
  sourceTxHash?: Hex
  destTxHash?: Hex
  error?: string
}

export interface FeeClaimRequest {
  chainId: ChainId
  claimant: Address
  claimToken?: Address
}

export interface VestingClaimRequest {
  chainId: ChainId
  beneficiary: Address
  amount?: bigint
}
