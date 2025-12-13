/**
 * Jeju Oracle Network (JON) Types
 * 
 * Type definitions for the decentralized oracle network
 * providing price feeds, FX rates, stablecoin pegs, and market status
 */

import type { Address } from 'viem';

// ============ Core Types ============

/** Feed identifier (keccak256 of baseAsset + quoteAsset) */
export type FeedId = `0x${string}`;

/** Report hash for dispute tracking */
export type ReportHash = `0x${string}`;

/** Committee assignment round */
export type CommitteeRound = bigint;

// ============ Feed Configuration ============

export interface FeedSpec {
  feedId: FeedId;
  symbol: string;
  baseToken: Address;
  quoteToken: Address;
  decimals: number;
  heartbeatSeconds: number;
  twapWindowSeconds: number;
  minLiquidityUSD: bigint;
  maxDeviationBps: number;
  minOracles: number;
  quorumThreshold: number;
  isActive: boolean;
  requiresConfidence: boolean;
  category: FeedCategory;
}

export type FeedCategory = 
  | 'SPOT_PRICE'
  | 'TWAP'
  | 'FX_RATE'
  | 'STABLECOIN_PEG'
  | 'LST_RATE'
  | 'GAS_PRICE'
  | 'SEQUENCER_STATUS'
  | 'MARKET_STATUS';

export interface FeedCreateParams {
  symbol: string;
  baseToken: Address;
  quoteToken: Address;
  decimals?: number;
  heartbeatSeconds?: number;
  twapWindowSeconds?: number;
  minLiquidityUSD?: bigint;
  maxDeviationBps?: number;
  minOracles?: number;
  quorumThreshold?: number;
  requiresConfidence?: boolean;
  category?: FeedCategory;
}

// ============ Price Data ============

export interface PriceReport {
  feedId: FeedId;
  price: bigint;
  confidence: bigint;
  timestamp: bigint;
  round: bigint;
  sources: VenueSource[];
  signatures: OracleSignature[];
}

export interface VenueSource {
  chainId: number;
  venue: Address;
  price: bigint;
  liquidity: bigint;
  timestamp: bigint;
}

export interface OracleSignature {
  signer: Address;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export interface ConsensusPrice {
  price: bigint;
  confidence: bigint;
  timestamp: bigint;
  round: bigint;
  oracleCount: number;
  reportHash: ReportHash;
}

export interface PriceFeedData {
  feedId: FeedId;
  spec: FeedSpec;
  latestPrice: ConsensusPrice | null;
  isStale: boolean;
  lastUpdateBlock: bigint;
}

// ============ Oracle Operator ============

export interface OracleOperator {
  operatorId: `0x${string}`;
  owner: Address;
  agentId: bigint;
  stakedToken: Address;
  stakedAmount: bigint;
  stakedValueUSD: bigint;
  delegatedAmount: bigint;
  reputationScore: number;
  accuracyScore: number;
  totalSubmissions: bigint;
  validSubmissions: bigint;
  registrationTime: bigint;
  lastSubmissionTime: bigint;
  status: OperatorStatus;
  workerKeys: Address[];
  supportedFeeds: FeedId[];
}

export type OperatorStatus = 
  | 'ACTIVE'
  | 'UNBONDING'
  | 'INACTIVE'
  | 'SLASHED'
  | 'JAILED';

export interface OperatorRegistrationParams {
  stakingToken: Address;
  stakeAmount: bigint;
  agentId: bigint;
  workerKeys?: Address[];
  supportedFeeds?: FeedId[];
}

export interface OperatorPerformance {
  operatorId: `0x${string}`;
  epochNumber: bigint;
  participationRate: number;
  accuracyRate: number;
  medianDeviation: number;
  reportsSubmitted: number;
  reportsAccepted: number;
  disputesReceived: number;
  slashesIncurred: number;
}

// ============ Committee Management ============

export interface Committee {
  feedId: FeedId;
  round: CommitteeRound;
  members: Address[];
  threshold: number;
  activeUntil: bigint;
  leader: Address;
}

export interface CommitteeAssignment {
  operatorId: `0x${string}`;
  feedId: FeedId;
  round: CommitteeRound;
  isLeader: boolean;
  assignedAt: bigint;
}

// ============ Delegation ============

export interface DelegationPool {
  operatorId: `0x${string}`;
  totalDelegated: bigint;
  totalDelegatedUSD: bigint;
  delegatorCount: number;
  delegationFeeRateBps: number;
  minDelegation: bigint;
  maxCapacity: bigint;
  isAcceptingDelegations: boolean;
}

export interface OracleDelegation {
  delegator: Address;
  operatorId: `0x${string}`;
  amount: bigint;
  stakedToken: Address;
  delegatedAt: bigint;
  lastClaimTime: bigint;
  pendingRewards: bigint;
}

export interface DelegationParams {
  operatorId: `0x${string}`;
  amount: bigint;
  stakingToken: Address;
}

// ============ Disputes ============

export interface Dispute {
  disputeId: `0x${string}`;
  reportHash: ReportHash;
  feedId: FeedId;
  disputer: Address;
  bond: bigint;
  reason: DisputeReason;
  evidence: `0x${string}`;
  status: DisputeStatus;
  createdAt: bigint;
  deadline: bigint;
  resolution: DisputeResolution | null;
  affectedSigners: Address[];
}

export type DisputeReason = 
  | 'PRICE_DEVIATION'
  | 'INVALID_SOURCE'
  | 'LOW_LIQUIDITY'
  | 'STALE_DATA'
  | 'INVALID_SIGNATURE'
  | 'MANIPULATION'
  | 'OTHER';

export type DisputeStatus = 
  | 'OPEN'
  | 'CHALLENGED'
  | 'RESOLVED_VALID'
  | 'RESOLVED_INVALID'
  | 'ESCALATED_TO_FUTARCHY'
  | 'EXPIRED';

export interface DisputeResolution {
  outcome: 'REPORT_VALID' | 'REPORT_INVALID' | 'INCONCLUSIVE';
  resolvedAt: bigint;
  resolvedBy: Address | 'AUTOMATIC' | 'FUTARCHY';
  slashAmount: bigint;
  disputerReward: bigint;
}

export interface DisputeCreateParams {
  reportHash: ReportHash;
  reason: DisputeReason;
  evidence: `0x${string}`;
  bond: bigint;
}

// ============ Fees & Revenue ============

export interface FeeConfig {
  subscriptionFeePerMonth: bigint;
  perReadFee: bigint;
  treasuryShareBps: number;
  operatorShareBps: number;
  delegatorShareBps: number;
  disputerRewardBps: number;
}

export interface Subscription {
  subscriber: Address;
  feedIds: FeedId[];
  startTime: bigint;
  endTime: bigint;
  amountPaid: bigint;
  isActive: boolean;
}

export interface OperatorEarnings {
  operatorId: `0x${string}`;
  totalEarned: bigint;
  totalClaimed: bigint;
  pendingRewards: bigint;
  lastClaimTime: bigint;
  earningsByFeed: Record<string, bigint>;
}

// ============ Network Stats ============

export interface OracleNetworkStats {
  totalOperators: number;
  activeOperators: number;
  totalStakedUSD: bigint;
  totalDelegatedUSD: bigint;
  totalFeeds: number;
  activeFeeds: number;
  totalReports: bigint;
  totalDisputes: bigint;
  avgAccuracy: number;
  avgUptime: number;
}

export interface FeedStats {
  feedId: FeedId;
  symbol: string;
  totalReports: bigint;
  avgUpdateFrequency: number;
  avgConfidence: number;
  lastUpdateTime: bigint;
  subscriberCount: number;
  totalRevenue: bigint;
}

// ============ ERC-8004 Integration ============

export interface OraclePerformanceAttestation {
  agentId: bigint;
  epochNumber: bigint;
  timestamp: bigint;
  participationRate: number;
  accuracyRate: number;
  medianDeviation: number;
  disputesReceived: number;
  slashesIncurred: number;
  attestationHash: `0x${string}`;
}

export interface OracleModerationAction {
  operatorId: `0x${string}`;
  agentId: bigint;
  action: 'JAIL' | 'UNJAIL' | 'BAN' | 'SLASH';
  reason: string;
  evidenceHash: `0x${string}`;
  duration: bigint;
  timestamp: bigint;
  initiatedBy: Address | 'AUTOMATIC' | 'FUTARCHY';
}

// ============ Report Verification ============

export interface ReportVerificationResult {
  isValid: boolean;
  reportHash: ReportHash;
  errors: ReportError[];
  validSignerCount: number;
  quorumMet: boolean;
}

export type ReportError = 
  | { type: 'INVALID_SIGNATURE'; signer: Address }
  | { type: 'NOT_COMMITTEE_MEMBER'; signer: Address }
  | { type: 'PRICE_OUT_OF_BOUNDS'; price: bigint; bounds: { min: bigint; max: bigint } }
  | { type: 'STALE_TIMESTAMP'; timestamp: bigint; maxAge: bigint }
  | { type: 'INSUFFICIENT_QUORUM'; have: number; need: number }
  | { type: 'INVALID_ROUND'; expected: bigint; got: bigint }
  | { type: 'LOW_LIQUIDITY'; venue: Address; liquidity: bigint; required: bigint };

// ============ TWAP Sources ============

export interface TWAPSource {
  chainId: number;
  chainName: string;
  venue: Address;
  venueName: string;
  poolAddress: Address;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  isActive: boolean;
}

export interface TWAPConfig {
  feedId: FeedId;
  sources: TWAPSource[];
  windowSeconds: number;
  minSources: number;
  outlierThresholdBps: number;
}

// ============ Contract Addresses ============

export interface OracleContractAddresses {
  feedRegistry: Address;
  reportVerifier: Address;
  committeeManager: Address;
  oracleStakingManager: Address;
  delegationPool: Address;
  disputeGame: Address;
  feeRouter: Address;
  twapOracle: Address;
}

// ============ Events ============

export interface FeedCreatedEvent {
  feedId: FeedId;
  symbol: string;
  creator: Address;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface ReportSubmittedEvent {
  feedId: FeedId;
  reportHash: ReportHash;
  price: bigint;
  round: bigint;
  signerCount: number;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface OperatorRegisteredEvent {
  operatorId: `0x${string}`;
  owner: Address;
  agentId: bigint;
  stakedAmount: bigint;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface DisputeOpenedEvent {
  disputeId: `0x${string}`;
  reportHash: ReportHash;
  disputer: Address;
  bond: bigint;
  reason: DisputeReason;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface DisputeResolvedEvent {
  disputeId: `0x${string}`;
  outcome: DisputeResolution['outcome'];
  slashAmount: bigint;
  disputerReward: bigint;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface OperatorSlashedEvent {
  operatorId: `0x${string}`;
  amount: bigint;
  reason: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

// ============ Default Values ============

export const DEFAULT_FEED_CONFIG = {
  decimals: 8,
  heartbeatSeconds: 3600,
  twapWindowSeconds: 1800,
  minLiquidityUSD: 100000n * 10n ** 18n,
  maxDeviationBps: 100,
  minOracles: 3,
  quorumThreshold: 2,
  requiresConfidence: true,
  category: 'SPOT_PRICE' as FeedCategory,
} as const;

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  subscriptionFeePerMonth: 100n * 10n ** 18n,
  perReadFee: 1n * 10n ** 15n,
  treasuryShareBps: 1000,
  operatorShareBps: 7000,
  delegatorShareBps: 1500,
  disputerRewardBps: 500,
};

export const DISPUTE_CONSTANTS = {
  MIN_BOND_USD: 100n * 10n ** 18n,
  CHALLENGE_WINDOW_SECONDS: 86400,
  RESOLUTION_WINDOW_SECONDS: 259200,
  SLASH_DEVIATION_BPS: 100,
  MAX_SLASH_BPS: 5000,
} as const;

// ============ Feed Presets ============

export const STANDARD_FEEDS = {
  'ETH-USD': {
    symbol: 'ETH-USD',
    decimals: 8,
    heartbeatSeconds: 3600,
    twapWindowSeconds: 300,
    category: 'SPOT_PRICE' as FeedCategory,
  },
  'BTC-USD': {
    symbol: 'BTC-USD',
    decimals: 8,
    heartbeatSeconds: 3600,
    twapWindowSeconds: 300,
    category: 'SPOT_PRICE' as FeedCategory,
  },
  'USDC-USD': {
    symbol: 'USDC-USD',
    decimals: 8,
    heartbeatSeconds: 86400,
    twapWindowSeconds: 1800,
    maxDeviationBps: 50,
    category: 'STABLECOIN_PEG' as FeedCategory,
  },
  'USDT-USD': {
    symbol: 'USDT-USD',
    decimals: 8,
    heartbeatSeconds: 86400,
    twapWindowSeconds: 1800,
    maxDeviationBps: 50,
    category: 'STABLECOIN_PEG' as FeedCategory,
  },
  'JEJU-ETH': {
    symbol: 'JEJU-ETH',
    decimals: 18,
    heartbeatSeconds: 3600,
    twapWindowSeconds: 1800,
    category: 'SPOT_PRICE' as FeedCategory,
  },
} as const;

// ============ Utility Functions ============

/**
 * Compute feed ID from base and quote tokens
 */
export function computeFeedId(baseToken: Address, quoteToken: Address): FeedId {
  // Placeholder - actual implementation uses keccak256
  throw new Error('Use viem keccak256 implementation');
}

/**
 * Validate a price report
 */
export function validatePriceReport(report: PriceReport, spec: FeedSpec): ReportVerificationResult {
  const errors: ReportError[] = [];
  
  // Check signature count
  if (report.signatures.length < spec.quorumThreshold) {
    errors.push({
      type: 'INSUFFICIENT_QUORUM',
      have: report.signatures.length,
      need: spec.quorumThreshold,
    });
  }
  
  // Check timestamp
  const now = BigInt(Math.floor(Date.now() / 1000));
  const maxAge = BigInt(spec.heartbeatSeconds);
  if (now - report.timestamp > maxAge) {
    errors.push({
      type: 'STALE_TIMESTAMP',
      timestamp: report.timestamp,
      maxAge,
    });
  }
  
  // Check sources liquidity
  for (const source of report.sources) {
    if (source.liquidity < spec.minLiquidityUSD) {
      errors.push({
        type: 'LOW_LIQUIDITY',
        venue: source.venue,
        liquidity: source.liquidity,
        required: spec.minLiquidityUSD,
      });
    }
  }
  
  return {
    isValid: errors.length === 0,
    reportHash: '0x' + '0'.repeat(64) as ReportHash,
    errors,
    validSignerCount: report.signatures.length,
    quorumMet: report.signatures.length >= spec.quorumThreshold,
  };
}

/**
 * Check if a feed price is stale
 */
export function isPriceStale(price: ConsensusPrice, heartbeatSeconds: number): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now - price.timestamp > BigInt(heartbeatSeconds);
}

/**
 * Calculate weighted median from prices
 */
export function calculateWeightedMedian(
  prices: bigint[],
  weights: bigint[]
): bigint {
  if (prices.length !== weights.length || prices.length === 0) {
    throw new Error('Invalid input arrays');
  }
  
  // Create pairs and sort by price
  const pairs = prices.map((price, i) => ({ price, weight: weights[i] }));
  pairs.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  
  // Calculate total weight and find median
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  const halfWeight = totalWeight / 2n;
  
  let cumWeight = 0n;
  for (const { price, weight } of pairs) {
    cumWeight += weight;
    if (cumWeight >= halfWeight) {
      return price;
    }
  }
  
  return pairs[pairs.length - 1].price;
}

/**
 * Format price with decimals
 */
export function formatPrice(price: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = price / divisor;
  const fracPart = price % divisor;
  const fracStr = fracPart.toString().padStart(decimals, '0');
  return `${wholePart}.${fracStr}`;
}
