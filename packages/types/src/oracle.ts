/**
 * Oracle Network (JON) types for price feeds and market data.
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  AddressSchema,
  HexSchema,
  MAX_ARRAY_LENGTH,
  MAX_RECORD_KEYS,
  MAX_SHORT_STRING_LENGTH,
  MAX_SMALL_ARRAY_LENGTH,
} from './validation'

// ═══════════════════════════════════════════════════════════════════════════
//                         ORACLE NODE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Configuration for an oracle node operator */
export interface OracleNodeConfig {
  rpcUrl: string
  chainId: number
  // Direct keys (development only - blocked in production)
  operatorPrivateKey?: Hex
  workerPrivateKey?: Hex
  // KMS key IDs (required in production)
  operatorKmsKeyId?: string
  workerKmsKeyId?: string
  feedRegistry: Address
  reportVerifier: Address
  committeeManager: Address
  feeRouter: Address
  networkConnector: Address
  pollIntervalMs: number
  heartbeatIntervalMs: number
  metricsPort: number
  priceSources: PriceSourceConfig[]
}

/** Price source configuration for oracle nodes */
export interface PriceSourceConfig {
  type: 'uniswap_v3' | 'chainlink' | 'manual'
  address: Address
  feedId: Hex
  decimals: number
}

/** Price data from oracle price fetcher */
export interface PriceData {
  price: bigint
  confidence: bigint
  timestamp: bigint
  source: string
}

/** Signed price report from oracle nodes */
export interface SignedReport {
  report: {
    feedId: Hex
    price: bigint
    confidence: bigint
    timestamp: bigint
    round: bigint
    sourcesHash: Hex
  }
  signatures: Hex[]
  signers: Address[]
}

/** Metrics for oracle node monitoring */
export interface NodeMetrics {
  reportsSubmitted: number
  reportsAccepted: number
  reportsRejected: number
  lastReportTime: number
  lastHeartbeat: number
  feedPrices: Map<string, bigint>
  uptime: number
}

// ═══════════════════════════════════════════════════════════════════════════
//                         CORE ORACLE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type FeedId = Hex
export type ReportHash = Hex
export type CommitteeRound = bigint
export const FeedCategorySchema = z.enum([
  'SPOT_PRICE',
  'TWAP',
  'FX_RATE',
  'STABLECOIN_PEG',
  'LST_RATE',
  'GAS_PRICE',
  'SEQUENCER_STATUS',
  'MARKET_STATUS',
])
export type FeedCategory = z.infer<typeof FeedCategorySchema>

export const FeedSpecSchema = z.object({
  feedId: HexSchema,
  symbol: z.string().max(MAX_SHORT_STRING_LENGTH),
  baseToken: AddressSchema,
  quoteToken: AddressSchema,
  decimals: z.number().int().positive(),
  heartbeatSeconds: z.number().int().positive(),
  twapWindowSeconds: z.number().int().positive(),
  minLiquidityUSD: z.bigint(),
  maxDeviationBps: z.number().int().nonnegative(),
  minOracles: z.number().int().positive(),
  quorumThreshold: z.number().int().positive(),
  isActive: z.boolean(),
  requiresConfidence: z.boolean(),
  category: FeedCategorySchema,
})
export type FeedSpec = z.infer<typeof FeedSpecSchema>

export const FeedCreateParamsSchema = z.object({
  symbol: z.string(),
  baseToken: AddressSchema,
  quoteToken: AddressSchema,
  decimals: z.number().int().positive().optional(),
  heartbeatSeconds: z.number().int().positive().optional(),
  twapWindowSeconds: z.number().int().positive().optional(),
  minLiquidityUSD: z.bigint().optional(),
  maxDeviationBps: z.number().int().nonnegative().optional(),
  minOracles: z.number().int().positive().optional(),
  quorumThreshold: z.number().int().positive().optional(),
  requiresConfidence: z.boolean().optional(),
  category: FeedCategorySchema.optional(),
})
export type FeedCreateParams = z.infer<typeof FeedCreateParamsSchema>
export const VenueSourceSchema = z.object({
  chainId: z.number().int().positive(),
  venue: AddressSchema,
  price: z.bigint(),
  liquidity: z.bigint(),
  timestamp: z.bigint(),
})
export type VenueSource = z.infer<typeof VenueSourceSchema>

export const OracleSignatureSchema = z.object({
  signer: AddressSchema,
  v: z.number().int(),
  r: HexSchema,
  s: HexSchema,
})
export type OracleSignature = z.infer<typeof OracleSignatureSchema>

export const PriceReportSchema = z.object({
  feedId: HexSchema,
  price: z.bigint(),
  confidence: z.bigint(),
  timestamp: z.bigint(),
  round: z.bigint(),
  sourcesHash: HexSchema.optional(),
  sources: z.array(VenueSourceSchema).max(MAX_SMALL_ARRAY_LENGTH),
  signatures: z.array(OracleSignatureSchema).max(MAX_SMALL_ARRAY_LENGTH),
})
export type PriceReport = z.infer<typeof PriceReportSchema>

export const ConsensusPriceSchema = z.object({
  price: z.bigint(),
  confidence: z.bigint(),
  timestamp: z.bigint(),
  round: z.bigint(),
  oracleCount: z.number().int().positive(),
  reportHash: HexSchema,
})
export type ConsensusPrice = z.infer<typeof ConsensusPriceSchema>

export const PriceFeedDataSchema = z.object({
  feedId: HexSchema,
  spec: FeedSpecSchema,
  latestPrice: ConsensusPriceSchema.nullable(),
  isStale: z.boolean(),
  lastUpdateBlock: z.bigint(),
})
export type PriceFeedData = z.infer<typeof PriceFeedDataSchema>
export const OperatorStatusSchema = z.enum([
  'ACTIVE',
  'UNBONDING',
  'INACTIVE',
  'SLASHED',
  'JAILED',
])
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>

export const OracleOperatorSchema = z.object({
  operatorId: HexSchema,
  owner: AddressSchema,
  agentId: z.bigint(),
  stakedToken: AddressSchema,
  stakedAmount: z.bigint(),
  stakedValueUSD: z.bigint(),
  delegatedAmount: z.bigint(),
  reputationScore: z.number().nonnegative(),
  accuracyScore: z.number().nonnegative(),
  totalSubmissions: z.bigint(),
  validSubmissions: z.bigint(),
  registrationTime: z.bigint(),
  lastSubmissionTime: z.bigint(),
  status: OperatorStatusSchema,
  workerKeys: z.array(AddressSchema).max(MAX_SMALL_ARRAY_LENGTH),
  supportedFeeds: z.array(HexSchema).max(MAX_ARRAY_LENGTH),
})
export type OracleOperator = z.infer<typeof OracleOperatorSchema>

export const OperatorRegistrationParamsSchema = z.object({
  stakingToken: AddressSchema,
  stakeAmount: z.bigint(),
  agentId: z.bigint(),
  workerKeys: z.array(AddressSchema).max(MAX_SMALL_ARRAY_LENGTH).optional(),
  supportedFeeds: z.array(HexSchema).max(MAX_ARRAY_LENGTH).optional(),
})
export type OperatorRegistrationParams = z.infer<
  typeof OperatorRegistrationParamsSchema
>

export const OperatorPerformanceSchema = z.object({
  operatorId: HexSchema,
  epochNumber: z.bigint(),
  participationRate: z.number().nonnegative(),
  accuracyRate: z.number().nonnegative(),
  medianDeviation: z.number(),
  reportsSubmitted: z.number().int().nonnegative(),
  reportsAccepted: z.number().int().nonnegative(),
  disputesReceived: z.number().int().nonnegative(),
  slashesIncurred: z.number().int().nonnegative(),
})
export type OperatorPerformance = z.infer<typeof OperatorPerformanceSchema>
export const CommitteeSchema = z.object({
  feedId: HexSchema,
  round: z.bigint(),
  members: z.array(AddressSchema).max(MAX_SMALL_ARRAY_LENGTH),
  threshold: z.number().int().positive(),
  activeUntil: z.bigint(),
  leader: AddressSchema,
})
export type Committee = z.infer<typeof CommitteeSchema>

export const CommitteeAssignmentSchema = z.object({
  operatorId: HexSchema,
  feedId: HexSchema,
  round: z.bigint(),
  isLeader: z.boolean(),
  assignedAt: z.bigint(),
})
export type CommitteeAssignment = z.infer<typeof CommitteeAssignmentSchema>
export const DelegationPoolSchema = z.object({
  operatorId: HexSchema,
  totalDelegated: z.bigint(),
  totalDelegatedUSD: z.bigint(),
  delegatorCount: z.number().int().nonnegative(),
  delegationFeeRateBps: z.number().int().nonnegative(),
  minDelegation: z.bigint(),
  maxCapacity: z.bigint(),
  isAcceptingDelegations: z.boolean(),
})
export type DelegationPool = z.infer<typeof DelegationPoolSchema>

export const OracleDelegationSchema = z.object({
  delegator: AddressSchema,
  operatorId: HexSchema,
  amount: z.bigint(),
  stakedToken: AddressSchema,
  delegatedAt: z.bigint(),
  lastClaimTime: z.bigint(),
  pendingRewards: z.bigint(),
})
export type OracleDelegation = z.infer<typeof OracleDelegationSchema>

export const DelegationParamsSchema = z.object({
  operatorId: HexSchema,
  amount: z.bigint(),
  stakingToken: AddressSchema,
})
export type DelegationParams = z.infer<typeof DelegationParamsSchema>
export const DisputeReasonSchema = z.enum([
  'PRICE_DEVIATION',
  'INVALID_SOURCE',
  'LOW_LIQUIDITY',
  'STALE_DATA',
  'INVALID_SIGNATURE',
  'MANIPULATION',
  'OTHER',
])
export type DisputeReason = z.infer<typeof DisputeReasonSchema>

export const DisputeStatusSchema = z.enum([
  'OPEN',
  'CHALLENGED',
  'RESOLVED_VALID',
  'RESOLVED_INVALID',
  'ESCALATED_TO_FUTARCHY',
  'EXPIRED',
])
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>

export const DisputeResolutionOutcomeSchema = z.enum([
  'REPORT_VALID',
  'REPORT_INVALID',
  'INCONCLUSIVE',
])

export const DisputeResolvedBySchema = z.union([
  AddressSchema,
  z.literal('AUTOMATIC'),
  z.literal('FUTARCHY'),
])
export type DisputeResolvedBy = z.infer<typeof DisputeResolvedBySchema>

export const DisputeResolutionSchema = z.object({
  outcome: DisputeResolutionOutcomeSchema,
  resolvedAt: z.bigint(),
  resolvedBy: DisputeResolvedBySchema,
  slashAmount: z.bigint(),
  disputerReward: z.bigint(),
})
export type DisputeResolution = z.infer<typeof DisputeResolutionSchema>

export const DisputeSchema = z.object({
  disputeId: HexSchema,
  reportHash: HexSchema,
  feedId: HexSchema,
  disputer: AddressSchema,
  bond: z.bigint(),
  reason: DisputeReasonSchema,
  evidence: HexSchema,
  status: DisputeStatusSchema,
  createdAt: z.bigint(),
  deadline: z.bigint(),
  resolution: DisputeResolutionSchema.nullable(),
  affectedSigners: z.array(AddressSchema).max(MAX_SMALL_ARRAY_LENGTH),
})
export type Dispute = z.infer<typeof DisputeSchema>

export const DisputeCreateParamsSchema = z.object({
  reportHash: HexSchema,
  reason: DisputeReasonSchema,
  evidence: HexSchema,
  bond: z.bigint(),
})
export type DisputeCreateParams = z.infer<typeof DisputeCreateParamsSchema>
export const FeeConfigSchema = z.object({
  subscriptionFeePerMonth: z.bigint(),
  perReadFee: z.bigint(),
  treasuryShareBps: z.number().int().nonnegative(),
  operatorShareBps: z.number().int().nonnegative(),
  delegatorShareBps: z.number().int().nonnegative(),
  disputerRewardBps: z.number().int().nonnegative(),
})
export type FeeConfig = z.infer<typeof FeeConfigSchema>

export const SubscriptionSchema = z.object({
  subscriber: AddressSchema,
  feedIds: z.array(HexSchema).max(MAX_ARRAY_LENGTH),
  startTime: z.bigint(),
  endTime: z.bigint(),
  amountPaid: z.bigint(),
  isActive: z.boolean(),
})
export type Subscription = z.infer<typeof SubscriptionSchema>

export const OperatorEarningsSchema = z.object({
  operatorId: HexSchema,
  totalEarned: z.bigint(),
  totalClaimed: z.bigint(),
  pendingRewards: z.bigint(),
  lastClaimTime: z.bigint(),
  earningsByFeed: z
    .record(z.string().max(MAX_SHORT_STRING_LENGTH), z.bigint())
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} feed earnings entries`,
    }),
})
export type OperatorEarnings = z.infer<typeof OperatorEarningsSchema>
export const OracleNetworkStatsSchema = z.object({
  totalOperators: z.number().int().nonnegative(),
  activeOperators: z.number().int().nonnegative(),
  totalStakedUSD: z.bigint(),
  totalDelegatedUSD: z.bigint(),
  totalFeeds: z.number().int().nonnegative(),
  activeFeeds: z.number().int().nonnegative(),
  totalReports: z.bigint(),
  totalDisputes: z.bigint(),
  avgAccuracy: z.number().nonnegative(),
  avgUptime: z.number().nonnegative(),
})
export type OracleNetworkStats = z.infer<typeof OracleNetworkStatsSchema>

export const FeedStatsSchema = z.object({
  feedId: HexSchema,
  symbol: z.string().max(MAX_SHORT_STRING_LENGTH),
  totalReports: z.bigint(),
  avgUpdateFrequency: z.number().nonnegative(),
  avgConfidence: z.number().nonnegative(),
  lastUpdateTime: z.bigint(),
  subscriberCount: z.number().int().nonnegative(),
  totalRevenue: z.bigint(),
})
export type FeedStats = z.infer<typeof FeedStatsSchema>
export const OraclePerformanceAttestationSchema = z.object({
  agentId: z.bigint(),
  epochNumber: z.bigint(),
  timestamp: z.bigint(),
  participationRate: z.number().nonnegative(),
  accuracyRate: z.number().nonnegative(),
  medianDeviation: z.number(),
  disputesReceived: z.number().int().nonnegative(),
  slashesIncurred: z.number().int().nonnegative(),
  attestationHash: HexSchema,
})
export type OraclePerformanceAttestation = z.infer<
  typeof OraclePerformanceAttestationSchema
>

export const OracleModerationActionTypeSchema = z.enum([
  'JAIL',
  'UNJAIL',
  'BAN',
  'SLASH',
])

export const OracleModerationActionSchema = z.object({
  operatorId: HexSchema,
  agentId: z.bigint(),
  action: OracleModerationActionTypeSchema,
  reason: z.string().max(MAX_SHORT_STRING_LENGTH),
  evidenceHash: HexSchema,
  duration: z.bigint(),
  timestamp: z.bigint(),
  initiatedBy: z.union([
    AddressSchema,
    z.literal('AUTOMATIC'),
    z.literal('FUTARCHY'),
  ]),
})
export type OracleModerationAction = z.infer<
  typeof OracleModerationActionSchema
>
export const ReportErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('INVALID_SIGNATURE'), signer: AddressSchema }),
  z.object({ type: z.literal('NOT_COMMITTEE_MEMBER'), signer: AddressSchema }),
  z.object({
    type: z.literal('PRICE_OUT_OF_BOUNDS'),
    price: z.bigint(),
    bounds: z.object({ min: z.bigint(), max: z.bigint() }),
  }),
  z.object({
    type: z.literal('STALE_TIMESTAMP'),
    timestamp: z.bigint(),
    maxAge: z.bigint(),
  }),
  z.object({
    type: z.literal('INSUFFICIENT_QUORUM'),
    have: z.number().int(),
    need: z.number().int(),
  }),
  z.object({
    type: z.literal('INVALID_ROUND'),
    expected: z.bigint(),
    got: z.bigint(),
  }),
  z.object({
    type: z.literal('LOW_LIQUIDITY'),
    venue: AddressSchema,
    liquidity: z.bigint(),
    required: z.bigint(),
  }),
])
export type ReportError = z.infer<typeof ReportErrorSchema>

export const ReportVerificationResultSchema = z.object({
  isValid: z.boolean(),
  reportHash: HexSchema,
  errors: z.array(ReportErrorSchema).max(MAX_SMALL_ARRAY_LENGTH),
  validSignerCount: z.number().int().nonnegative(),
  quorumMet: z.boolean(),
})
export type ReportVerificationResult = z.infer<
  typeof ReportVerificationResultSchema
>
export const TWAPSourceSchema = z.object({
  chainId: z.number().int().positive(),
  chainName: z.string().max(MAX_SHORT_STRING_LENGTH),
  venue: AddressSchema,
  venueName: z.string().max(MAX_SHORT_STRING_LENGTH),
  poolAddress: AddressSchema,
  token0: AddressSchema,
  token1: AddressSchema,
  fee: z.number().int().nonnegative(),
  liquidity: z.bigint(),
  isActive: z.boolean(),
})
export type TWAPSource = z.infer<typeof TWAPSourceSchema>

export const TWAPConfigSchema = z.object({
  feedId: HexSchema,
  sources: z.array(TWAPSourceSchema).max(MAX_SMALL_ARRAY_LENGTH),
  windowSeconds: z.number().int().positive(),
  minSources: z.number().int().positive(),
  outlierThresholdBps: z.number().int().nonnegative(),
})
export type TWAPConfig = z.infer<typeof TWAPConfigSchema>
export const OracleContractAddressesSchema = z.object({
  feedRegistry: AddressSchema,
  reportVerifier: AddressSchema,
  committeeManager: AddressSchema,
  oracleStakingManager: AddressSchema,
  delegationPool: AddressSchema,
  disputeGame: AddressSchema,
  feeRouter: AddressSchema,
  twapOracle: AddressSchema,
})
export type OracleContractAddresses = z.infer<
  typeof OracleContractAddressesSchema
>
export const FeedCreatedEventSchema = z.object({
  feedId: HexSchema,
  symbol: z.string(),
  creator: AddressSchema,
  transactionHash: HexSchema,
  blockNumber: z.bigint(),
})
export type FeedCreatedEvent = z.infer<typeof FeedCreatedEventSchema>

export const ReportSubmittedEventSchema = z.object({
  feedId: HexSchema,
  reportHash: HexSchema,
  price: z.bigint(),
  round: z.bigint(),
  signerCount: z.number().int().positive(),
  transactionHash: HexSchema,
  blockNumber: z.bigint(),
})
export type ReportSubmittedEvent = z.infer<typeof ReportSubmittedEventSchema>

export const OperatorRegisteredEventSchema = z.object({
  operatorId: HexSchema,
  owner: AddressSchema,
  agentId: z.bigint(),
  stakedAmount: z.bigint(),
  transactionHash: HexSchema,
  blockNumber: z.bigint(),
})
export type OperatorRegisteredEvent = z.infer<
  typeof OperatorRegisteredEventSchema
>

export const DisputeOpenedEventSchema = z.object({
  disputeId: HexSchema,
  reportHash: HexSchema,
  disputer: AddressSchema,
  bond: z.bigint(),
  reason: DisputeReasonSchema,
  transactionHash: HexSchema,
  blockNumber: z.bigint(),
})
export type DisputeOpenedEvent = z.infer<typeof DisputeOpenedEventSchema>

export const DisputeResolvedEventSchema = z.object({
  disputeId: HexSchema,
  outcome: DisputeResolutionOutcomeSchema,
  slashAmount: z.bigint(),
  disputerReward: z.bigint(),
  transactionHash: HexSchema,
  blockNumber: z.bigint(),
})
export type DisputeResolvedEvent = z.infer<typeof DisputeResolvedEventSchema>

export const OperatorSlashedEventSchema = z.object({
  operatorId: HexSchema,
  amount: z.bigint(),
  reason: z.string().max(MAX_SHORT_STRING_LENGTH),
  transactionHash: HexSchema,
  blockNumber: z.bigint(),
})
export type OperatorSlashedEvent = z.infer<typeof OperatorSlashedEventSchema>
// Helper to avoid BigInt exponentiation transpilation issues
const E18 = 1000000000000000000n // 10^18
const E15 = 1000000000000000n // 10^15

export const DEFAULT_FEED_CONFIG = {
  decimals: 8,
  heartbeatSeconds: 3600,
  twapWindowSeconds: 1800,
  minLiquidityUSD: 100000n * E18,
  maxDeviationBps: 100,
  minOracles: 3,
  quorumThreshold: 2,
  requiresConfidence: true,
  category: 'SPOT_PRICE' as FeedCategory,
} as const

export const DEFAULT_ORACLE_FEE_CONFIG: FeeConfig = {
  subscriptionFeePerMonth: 100n * E18,
  perReadFee: 1n * E15,
  treasuryShareBps: 1000,
  operatorShareBps: 7000,
  delegatorShareBps: 1500,
  disputerRewardBps: 500,
}

export const DISPUTE_CONSTANTS = {
  MIN_BOND_USD: 100n * E18,
  CHALLENGE_WINDOW_SECONDS: 86400,
  RESOLUTION_WINDOW_SECONDS: 259200,
  SLASH_DEVIATION_BPS: 100,
  MAX_SLASH_BPS: 5000,
} as const
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
} as const
/**
 * Compute feed ID from base and quote tokens
 * @param _baseToken - The base token address
 * @param _quoteToken - The quote token address
 * @returns The feed ID (use viem keccak256 implementation)
 */
export function computeFeedId(
  _baseToken: Address,
  _quoteToken: Address,
): FeedId {
  // Placeholder - actual implementation uses keccak256
  throw new Error('Use viem keccak256 implementation')
}

/**
 * Validate a price report
 */
export function validatePriceReport(
  report: PriceReport,
  spec: FeedSpec,
): ReportVerificationResult {
  const errors: ReportError[] = []

  // Check signature count
  const signatures = report.signatures ?? []
  if (signatures.length < spec.quorumThreshold) {
    errors.push({
      type: 'INSUFFICIENT_QUORUM',
      have: signatures.length,
      need: spec.quorumThreshold,
    })
  }

  // Check timestamp
  const now = BigInt(Math.floor(Date.now() / 1000))
  const maxAge = BigInt(spec.heartbeatSeconds)
  if (now - report.timestamp > maxAge) {
    errors.push({
      type: 'STALE_TIMESTAMP',
      timestamp: report.timestamp,
      maxAge,
    })
  }

  // Check sources liquidity
  const sources = report.sources ?? []
  for (const source of sources) {
    if (source.liquidity < spec.minLiquidityUSD) {
      errors.push({
        type: 'LOW_LIQUIDITY',
        venue: source.venue,
        liquidity: source.liquidity,
        required: spec.minLiquidityUSD,
      })
    }
  }

  return {
    isValid: errors.length === 0,
    reportHash: `0x${'0'.repeat(64)}` as ReportHash,
    errors,
    validSignerCount: signatures.length,
    quorumMet: signatures.length >= spec.quorumThreshold,
  }
}

/**
 * Check if a feed price is stale
 */
export function isPriceStale(
  price: ConsensusPrice,
  heartbeatSeconds: number,
): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000))
  return now - price.timestamp > BigInt(heartbeatSeconds)
}

/**
 * Calculate weighted median from prices
 */
export function calculateWeightedMedian(
  prices: bigint[],
  weights: bigint[],
): bigint {
  if (prices.length !== weights.length || prices.length === 0) {
    throw new Error('Invalid input arrays')
  }

  // Create pairs and sort by price
  const pairs = prices.map((price, i) => ({ price, weight: weights[i] ?? 0n }))
  pairs.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))

  // Calculate total weight and find median
  const totalWeight = weights.reduce((a, b) => a + b, 0n)
  const halfWeight = totalWeight / 2n

  let cumWeight = 0n
  for (const pair of pairs) {
    cumWeight += pair.weight
    if (cumWeight >= halfWeight) {
      return pair.price
    }
  }

  const lastPair = pairs[pairs.length - 1]
  if (!lastPair) throw new Error('No pairs to calculate median')
  return lastPair.price
}

/**
 * Format price with decimals
 */
export function formatPrice(price: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals)
  const wholePart = price / divisor
  const fracPart = price % divisor
  const fracStr = fracPart.toString().padStart(decimals, '0')
  return `${wholePart}.${fracStr}`
}
