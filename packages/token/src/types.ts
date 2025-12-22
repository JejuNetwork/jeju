/**
 * @fileoverview Comprehensive type definitions for the experimental-token package
 * Covers token economics, cross-chain deployment, CCA ICO, vesting, and fee distribution
 */

import type { ChainType, EVMChainId, SolanaNetwork } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

// =============================================================================
// CHAIN TYPES
// =============================================================================

/** Supported chain identifiers - combines EVM and Solana */
export type ChainId = EVMChainId | SolanaNetwork

/** Chain configuration for deployment */
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
  /** Hyperlane mailbox address (or program ID for Solana) */
  hyperlaneMailbox: string
  /** Hyperlane Interchain Gas Paymaster */
  hyperlaneIgp: string
  /** Is this the home chain? Only one should be true */
  isHomeChain: boolean
  /** Average block time in seconds */
  avgBlockTime: number
  /** Uniswap V4 pool manager address (EVM only) */
  uniswapV4PoolManager?: Address
  /** DEX router for liquidity deployment (EVM address or Solana program ID) */
  dexRouter?: Address | string
}

// =============================================================================
// TOKEN ECONOMICS
// =============================================================================

/** Token allocation percentages (must sum to 100) */
export interface TokenAllocation {
  /** Percentage for public sale (CCA auction) */
  publicSale: number
  /** Percentage for presale participants */
  presale: number
  /** Percentage for team/creators */
  team: number
  /** Percentage for advisors */
  advisors: number
  /** Percentage for ecosystem/treasury */
  ecosystem: number
  /** Percentage for liquidity bootstrapping */
  liquidity: number
  /** Percentage for staking rewards */
  stakingRewards: number
}

/** Vesting schedule configuration */
export interface VestingSchedule {
  /** Cliff period in seconds (no tokens released) */
  cliffDuration: number
  /** Total vesting duration in seconds (after cliff) */
  vestingDuration: number
  /** Percentage released at TGE (before cliff) */
  tgeUnlockPercent: number
  /** Whether vesting is linear or discrete */
  vestingType: 'linear' | 'discrete'
  /** If discrete, number of unlock periods */
  discretePeriods?: number
}

/** Per-category vesting configuration */
export interface VestingConfig {
  team: VestingSchedule
  advisors: VestingSchedule
  presale: VestingSchedule
  ecosystem: VestingSchedule
  /** Public sale typically no vesting */
  publicSale?: VestingSchedule
}

/** Fee distribution configuration */
export interface FeeDistribution {
  /** Percentage of fees to token holders (stakers) */
  holders: number
  /** Percentage of fees to creators/team */
  creators: number
  /** Percentage of fees to treasury/DAO */
  treasury: number
  /** Percentage of fees to liquidity providers */
  liquidityProviders: number
  /** Percentage of fees burned (deflationary) */
  burn: number
}

/** Fee configuration for different operations */
export interface FeeConfig {
  /** Transfer fee in basis points (100 = 1%) */
  transferFeeBps: number
  /** Bridge fee in basis points */
  bridgeFeeBps: number
  /** Swap/DEX fee in basis points (typically set by DEX) */
  swapFeeBps: number
  /** How fees are distributed */
  distribution: FeeDistribution
  /** Addresses exempt from fees (e.g., DEX pools, vesting contracts) */
  feeExemptAddresses: Address[]
}

/** Complete token economics configuration */
export interface TokenEconomics {
  /** Token name (e.g., "Jeju Token") */
  name: string
  /** Token symbol (e.g., "JEJU") */
  symbol: string
  /** Token decimals (typically 18 for EVM, 9 for Solana) */
  decimals: number
  /** Total supply in human-readable units (not wei) */
  totalSupply: bigint
  /** How supply is allocated */
  allocation: TokenAllocation
  /** Vesting schedules per allocation category */
  vesting: VestingConfig
  /** Fee configuration */
  fees: FeeConfig
  /** Maximum wallet holding (0 = no limit) as percentage of total supply */
  maxWalletPercent: number
  /** Anti-whale: max transaction as percentage of total supply (0 = no limit) */
  maxTxPercent: number
}

// =============================================================================
// LIQUIDITY CONFIGURATION
// =============================================================================

/**
 * DEX protocols for liquidity deployment
 * Includes EVM DEXes (Uniswap) and Solana DEXes (Raydium, Orca, Jupiter)
 */
export type LiquidityDex =
  | 'uniswap-v4'
  | 'uniswap-v3'
  | 'sushiswap'
  | 'raydium'
  | 'orca'
  | 'jupiter'

/** Liquidity distribution per chain */
export interface LiquidityAllocation {
  chainId: ChainId
  /** Percentage of liquidity tokens for this chain (sum across all chains = 100) */
  percentage: number
  /** Initial price in USD for this chain's pool */
  initialPriceUsd: number
  /** Paired asset (e.g., WETH, USDC) */
  pairedAsset: Address | 'SOL'
  /** DEX to deploy on (e.g., 'uniswap-v4', 'raydium', 'orca') */
  dex: LiquidityDex
}

/** Complete liquidity deployment configuration */
export interface LiquidityConfig {
  /** Liquidity lock duration in seconds (0 = no lock) */
  lockDuration: number
  /** Address to receive LP tokens (if not locked) */
  lpTokenRecipient: Address
  /** Per-chain liquidity allocation */
  allocations: LiquidityAllocation[]
}

// =============================================================================
// PRESALE CONFIGURATION
// =============================================================================

/** Presale tier for different investor levels */
export interface PresaleTier {
  name: string
  /** Minimum contribution in USD */
  minContribution: number
  /** Maximum contribution in USD */
  maxContribution: number
  /** Discount percentage from public sale price */
  discountPercent: number
  /** Vesting override for this tier (if different from default) */
  vestingOverride?: VestingSchedule
  /** Merkle root for whitelist (null = no whitelist) */
  whitelistMerkleRoot?: Hex
}

/** Complete presale configuration */
export interface PresaleConfig {
  /** Whether presale is enabled */
  enabled: boolean
  /** Presale start timestamp */
  startTime: number
  /** Presale end timestamp */
  endTime: number
  /** Soft cap in USD (minimum raise to proceed) */
  softCapUsd: number
  /** Hard cap in USD (maximum raise) */
  hardCapUsd: number
  /** Price per token in USD during presale */
  priceUsd: number
  /** Available presale tiers */
  tiers: PresaleTier[]
  /** Accepted payment tokens per chain */
  acceptedTokens: Record<ChainId, Address[]>
  /** Refund policy if soft cap not met */
  refundIfSoftCapMissed: boolean
}

// =============================================================================
// CCA (CONTINUOUS CLEARING AUCTION) CONFIGURATION
// =============================================================================

/**
 * CCA Fee Comparison: Uniswap Platform vs Self-Deployed
 *
 * UNISWAP PLATFORM (Using their deployment):
 * - No protocol fee on CCA itself (just gas)
 * - Proceeds go directly to Uniswap V4 pool
 * - Trading fees: 0.3% default, split between LPs
 * - You don't control the auction contract
 * - Credibility/trust from Uniswap brand
 *
 * SELF-DEPLOYED (Fork their open-source code):
 * - No fees to Uniswap at all
 * - Full control over auction parameters
 * - Can add custom fee distribution
 * - Can integrate directly with your vesting
 * - You bear audit/security responsibility
 * - Less brand recognition
 *
 * RECOMMENDATION: Start with Uniswap platform for credibility,
 * but deploy Vesting contracts separately to control fee splits.
 */
export type CCADeploymentMode = 'uniswap-platform' | 'self-deployed'

/** CCA auction configuration */
export interface CCAConfig {
  /** Whether to use Uniswap's platform or self-deploy */
  deploymentMode: CCADeploymentMode
  /** Auction start timestamp */
  startTime: number
  /** Auction duration in seconds */
  duration: number
  /** Starting price in USD (Dutch auction starts high) */
  startPriceUsd: number
  /** Reserve/floor price in USD */
  reservePriceUsd: number
  /** Block-by-block supply release curve */
  supplyReleaseCurve: 'linear' | 'exponential' | 'step'
  /** Maximum bid size as percentage of total auction supply */
  maxBidPercent: number
  /** Minimum bid size in USD */
  minBidUsd: number
  /** Whether to auto-migrate to Uniswap V4 pool after auction */
  autoMigrateLiquidity: boolean
  /** Fee configuration for auction (if self-deployed) */
  auctionFees?: {
    /** Platform fee in basis points (our protocol fee) */
    platformFeeBps: number
    /** Referral fee in basis points */
    referralFeeBps: number
  }
}

// =============================================================================
// HYPERLANE WARP ROUTES
// =============================================================================

/** Interchain Security Module types */
export type ISMType =
  | 'multisig' // M-of-N multisig validators
  | 'optimistic' // Optimistic with challenge period
  | 'aggregation' // Combines multiple ISMs
  | 'routing' // Routes to different ISMs per origin
  | 'pausable' // Can be paused by owner
  | 'trusted-relayer' // Single trusted relayer

/** Multisig ISM configuration */
export interface MultisigISMConfig {
  type: 'multisig'
  /** Validator addresses (your own nodes) */
  validators: string[]
  /** Threshold for signature verification */
  threshold: number
}

/** Optimistic ISM configuration */
export interface OptimisticISMConfig {
  type: 'optimistic'
  /** Challenge period in seconds */
  challengePeriod: number
  /** Address that can challenge fraudulent messages */
  watchers: string[]
}

export type ISMConfig = MultisigISMConfig | OptimisticISMConfig

/** Warp Route configuration for a chain */
export interface WarpRouteConfig {
  chainId: ChainId
  /** Token type on this chain */
  tokenType: 'native' | 'synthetic' | 'collateral'
  /** For collateral type, the underlying token address */
  collateralAddress?: string
  /** ISM configuration for this chain */
  ism: ISMConfig
  /** Owner of the warp route contracts */
  owner: string
  /** Rate limit per 24 hours (in token units) */
  rateLimitPerDay: bigint
}

/** Complete Hyperlane deployment configuration */
export interface HyperlaneConfig {
  /** Routes configuration per chain */
  routes: WarpRouteConfig[]
  /** Your validator addresses (for running your own) */
  validators: {
    address: string
    chains: ChainId[]
  }[]
  /** Interchain gas payment configuration */
  gasConfig: {
    /** Default gas limit for cross-chain messages */
    defaultGasLimit: bigint
    /** Gas overhead for message processing */
    gasOverhead: bigint
  }
}

// =============================================================================
// DEPLOYMENT CONFIGURATION
// =============================================================================

/** Complete deployment configuration */
export interface DeploymentConfig {
  /** Token economics */
  token: TokenEconomics
  /** Liquidity deployment */
  liquidity: LiquidityConfig
  /** Presale configuration */
  presale: PresaleConfig
  /** CCA auction configuration */
  cca: CCAConfig
  /** Hyperlane warp routes */
  hyperlane: HyperlaneConfig
  /** Chains to deploy on */
  chains: ChainConfig[]
  /** Deployment owner/admin address */
  owner: Address
  /** Timelock delay for admin actions (in seconds) */
  timelockDelay: number
  /** Salt for CREATE2 deterministic deployment */
  deploymentSalt: Hex
}

// =============================================================================
// DEPLOYMENT RESULTS
// =============================================================================

/** Deployed contract addresses per chain */
export interface ChainDeployment {
  chainId: ChainId
  /** Token contract address */
  token: string
  /** Vesting contract address */
  vesting: string
  /** Fee distributor contract address */
  feeDistributor: string
  /** Warp route contract address */
  warpRoute: string
  /** ISM contract address */
  ism: string
  /** Liquidity pool address */
  liquidityPool?: string
  /** Presale contract address */
  presale?: string
  /** CCA auction contract address (if self-deployed) */
  ccaAuction?: string
  /** Transaction hashes for verification */
  deploymentTxHashes: Hex[]
  /** Block number at deployment */
  deployedAtBlock: bigint
}

/** Complete deployment result */
export interface DeploymentResult {
  /** Timestamp of deployment */
  deployedAt: number
  /** Configuration used */
  config: DeploymentConfig
  /** Deployments per chain */
  deployments: ChainDeployment[]
  /** CREATE2 salt used */
  salt: Hex
  /** Computed deterministic addresses (for verification) */
  deterministicAddresses: Record<ChainId, string>
}

// =============================================================================
// RUNTIME TYPES
// =============================================================================

/** Bridge transfer request */
export interface BridgeRequest {
  sourceChain: ChainId
  destinationChain: ChainId
  sender: string
  recipient: string
  amount: bigint
  /** Optional data for destination chain call */
  callData?: Hex
}

/** Bridge transfer status */
export interface BridgeStatus {
  requestId: Hex
  status: 'pending' | 'dispatched' | 'delivered' | 'failed'
  sourceChain: ChainId
  destinationChain: ChainId
  amount: bigint
  /** Source transaction hash */
  sourceTxHash?: Hex
  /** Destination transaction hash */
  destTxHash?: Hex
  /** Error message if failed */
  error?: string
}

/** Fee claim request */
export interface FeeClaimRequest {
  chainId: ChainId
  claimant: Address
  /** Token to claim fees in (if multiple options) */
  claimToken?: Address
}

/** Vesting claim request */
export interface VestingClaimRequest {
  chainId: ChainId
  beneficiary: Address
  /** Claim all available or specific amount */
  amount?: bigint
}
