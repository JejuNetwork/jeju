/**
 * Open Intents Framework (OIF) types for cross-chain intent execution.
 */

import { z } from 'zod'
import { SupportedChainIdSchema } from './eil'
import {
  AddressSchema,
  MAX_ARRAY_LENGTH,
  MAX_RECORD_KEYS,
  MAX_SHORT_STRING_LENGTH,
  MAX_SMALL_ARRAY_LENGTH,
  MAX_STRING_LENGTH,
} from './validation'

export { SupportedChainIdSchema }
export type { SupportedChainId } from './eil'

export const IntentStatusSchema = z.enum([
  'open',
  'pending',
  'filled',
  'expired',
  'cancelled',
  'failed',
])
export type IntentStatus = z.infer<typeof IntentStatusSchema>

export const IntentInputSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  chainId: SupportedChainIdSchema,
})
export type IntentInput = z.infer<typeof IntentInputSchema>

export const IntentOutputSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  recipient: AddressSchema,
  chainId: SupportedChainIdSchema,
})
export type IntentOutput = z.infer<typeof IntentOutputSchema>

export const FillInstructionSchema = z.object({
  destinationChainId: SupportedChainIdSchema,
  destinationSettler: AddressSchema,
  originData: z.string(),
})
export type FillInstruction = z.infer<typeof FillInstructionSchema>

export const IntentSchema = z.object({
  intentId: z.string().max(MAX_SHORT_STRING_LENGTH),
  user: AddressSchema,
  nonce: z.string().max(MAX_SHORT_STRING_LENGTH),
  sourceChainId: SupportedChainIdSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),

  // What user provides
  inputs: z.array(IntentInputSchema).max(MAX_SMALL_ARRAY_LENGTH),

  // What user receives
  outputs: z.array(IntentOutputSchema).max(MAX_SMALL_ARRAY_LENGTH),

  // Fill instructions for solvers
  fillInstructions: z
    .array(FillInstructionSchema)
    .max(MAX_SMALL_ARRAY_LENGTH)
    .optional(),

  // Signature
  signature: z.string().max(MAX_STRING_LENGTH),

  // Status tracking
  status: IntentStatusSchema,
  createdAt: z.number(),
  filledAt: z.number().optional(),
  cancelledAt: z.number().optional(),

  // Execution details
  solver: AddressSchema.optional(),
  txHash: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),
  inputSettlerTx: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),
  outputSettlerTx: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),
  attestationTx: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),
  fee: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),
  executionTimeMs: z.number().optional(),
})
export type Intent = z.infer<typeof IntentSchema>
export const GaslessCrossChainOrderSchema = z.object({
  originSettler: AddressSchema,
  user: AddressSchema,
  nonce: z.string(),
  originChainId: SupportedChainIdSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),
  orderDataType: z.string(), // bytes32 type identifier
  orderData: z.string(), // Encoded order-specific data
})
export type GaslessCrossChainOrder = z.infer<
  typeof GaslessCrossChainOrderSchema
>

export const ResolvedCrossChainOrderSchema = z.object({
  user: AddressSchema,
  originChainId: SupportedChainIdSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),
  orderId: z.string(),
  maxSpent: z.array(
    z.object({
      token: AddressSchema,
      amount: z.string(),
      recipient: AddressSchema,
      chainId: SupportedChainIdSchema,
    }),
  ),
  minReceived: z.array(
    z.object({
      token: AddressSchema,
      amount: z.string(),
      recipient: AddressSchema,
      chainId: SupportedChainIdSchema,
    }),
  ),
  fillInstructions: z.array(FillInstructionSchema),
})
export type ResolvedCrossChainOrder = z.infer<
  typeof ResolvedCrossChainOrderSchema
>
export const SolverStatusSchema = z.enum([
  'active', // Accepting intents
  'paused', // Temporarily not accepting
  'slashed', // Was slashed for misbehavior
  'inactive', // Not registered or withdrawn
])
export type SolverStatus = z.infer<typeof SolverStatusSchema>

export const SolverLiquiditySchema = z.object({
  chainId: SupportedChainIdSchema,
  token: AddressSchema,
  amount: z.string(),
  lastUpdated: z.number(),
})
export type SolverLiquidity = z.infer<typeof SolverLiquiditySchema>

export const SolverSchema = z.object({
  address: AddressSchema,
  name: z.string().max(MAX_SHORT_STRING_LENGTH),
  endpoint: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),

  // Supported chains and tokens
  supportedChains: z.array(SupportedChainIdSchema).max(MAX_SMALL_ARRAY_LENGTH),
  supportedTokens: z
    .record(
      z.string().max(MAX_SHORT_STRING_LENGTH),
      z.array(AddressSchema).max(MAX_ARRAY_LENGTH),
    )
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} chain entries`,
    }),

  // Liquidity positions
  liquidity: z.array(SolverLiquiditySchema).max(MAX_ARRAY_LENGTH),

  // Performance metrics
  reputation: z.number(),
  totalFills: z.number(),
  successfulFills: z.number(),
  failedFills: z.number(),
  successRate: z.number(),
  avgResponseMs: z.number(),
  avgFillTimeMs: z.number(),
  totalVolumeUsd: z.string().max(MAX_SHORT_STRING_LENGTH),
  totalFeesEarnedUsd: z.string().max(MAX_SHORT_STRING_LENGTH),

  // Registration
  status: SolverStatusSchema,
  stakedAmount: z.string().max(MAX_SHORT_STRING_LENGTH),
  registeredAt: z.number(),
  lastActiveAt: z.number().optional(),
})
export type Solver = z.infer<typeof SolverSchema>
export const OracleTypeSchema = z.enum([
  'hyperlane', // Hyperlane messaging protocol
  'optimism-native', // OP Stack native bridge
  'superchain', // Superchain native interop
  'layerzero', // LayerZero messaging
  'custom', // Custom oracle implementation
])
export type OracleType = z.infer<typeof OracleTypeSchema>

export const IntentRouteSchema = z.object({
  routeId: z.string(),
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,

  // Route configuration
  inputSettler: AddressSchema,
  outputSettler: AddressSchema,
  oracle: OracleTypeSchema,
  oracleConfig: z.record(z.string(), z.string()).optional(),

  // Route metrics
  isActive: z.boolean(),
  totalVolume: z.string(),
  totalIntents: z.number(),
  avgFeePercent: z.number(), // Basis points
  avgFillTimeSeconds: z.number(),
  successRate: z.number(), // 0-100

  // Available solvers
  activeSolvers: z.number(),
  totalLiquidity: z.string(),

  lastUpdated: z.number(),
})
export type IntentRoute = z.infer<typeof IntentRouteSchema>
export const IntentQuoteSchema = z.object({
  quoteId: z.string(),
  intentId: z.string().optional(),

  // Input/Output
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  inputAmount: z.string(),
  outputAmount: z.string(),

  // Pricing
  fee: z.string(),
  feePercent: z.number(), // Basis points
  priceImpact: z.number(), // Basis points

  // Timing
  estimatedFillTimeSeconds: z.number(),
  validUntil: z.number(), // Unix timestamp

  // Solver offering this quote
  solver: AddressSchema,
  solverReputation: z.number(),

  // Route info
  route: IntentRouteSchema.optional(),
})
export type IntentQuote = z.infer<typeof IntentQuoteSchema>
export const SettlementStatusSchema = z.enum([
  'pending', // Awaiting attestation
  'attested', // Oracle attested fulfillment
  'settled', // Funds released to solver
  'disputed', // Under dispute
  'slashed', // Solver slashed
])
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>

export const SettlementSchema = z.object({
  settlementId: z.string(),
  intentId: z.string(),
  solver: AddressSchema,

  // Settlement details
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  inputToken: AddressSchema,
  outputToken: AddressSchema,
  inputAmount: z.string(),
  outputAmount: z.string(),
  fee: z.string(),

  // Status
  status: SettlementStatusSchema,

  // Transactions
  inputSettlerTx: z.string(),
  outputSettlerTx: z.string().optional(),
  attestationTx: z.string().optional(),
  claimTx: z.string().optional(),

  // Timing
  createdAt: z.number(),
  attestedAt: z.number().optional(),
  settledAt: z.number().optional(),
})
export type Settlement = z.infer<typeof SettlementSchema>
export const OracleAttestationSchema = z.object({
  attestationId: z.string(),
  intentId: z.string(),
  orderId: z.string(),

  // Attestation details
  oracleType: OracleTypeSchema,
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,

  // Proof data
  proof: z.string(), // Encoded proof (Hyperlane message, L1 proof, etc.)
  proofBlockNumber: z.number(),
  proofTimestamp: z.number(),

  // Verification
  verified: z.boolean(),
  verifiedAt: z.number().optional(),
  verificationTx: z.string().optional(),
})
export type OracleAttestation = z.infer<typeof OracleAttestationSchema>
export const OIFConfigSchema = z.object({
  // Settlement contract addresses per chain
  inputSettlers: z
    .record(z.string().max(MAX_SHORT_STRING_LENGTH), AddressSchema)
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} input settlers`,
    }),
  outputSettlers: z
    .record(z.string().max(MAX_SHORT_STRING_LENGTH), AddressSchema)
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} output settlers`,
    }),
  solverRegistry: AddressSchema,

  // Oracle configuration
  oracles: z
    .record(
      z.string().max(MAX_SHORT_STRING_LENGTH),
      z.object({
        type: OracleTypeSchema,
        address: AddressSchema,
        config: z
          .record(
            z.string().max(MAX_SHORT_STRING_LENGTH),
            z.string().max(MAX_STRING_LENGTH),
          )
          .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
            message: `Cannot have more than ${MAX_RECORD_KEYS} config entries`,
          })
          .optional(),
      }),
    )
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} oracles`,
    }),

  // Fee configuration
  minFee: z.string().max(MAX_SHORT_STRING_LENGTH),
  maxFee: z.string().max(MAX_SHORT_STRING_LENGTH),
  protocolFeePercent: z.number(),

  // Timing configuration
  defaultOpenDeadline: z.number(),
  defaultFillDeadline: z.number(),
  claimDelay: z.number(),

  // Solver requirements
  minSolverStake: z.string().max(MAX_SHORT_STRING_LENGTH),
  slashingPercent: z.number(),
})
export type OIFConfig = z.infer<typeof OIFConfigSchema>
export const OIFStatsSchema = z.object({
  // Global stats
  totalIntents: z.number(),
  totalVolume: z.string(),
  totalVolumeUsd: z.string(),
  totalFees: z.string(),
  totalFeesUsd: z.string(),

  // Solver stats
  totalSolvers: z.number(),
  activeSolvers: z.number(),
  totalSolverStake: z.string(),

  // Route stats
  totalRoutes: z.number(),
  activeRoutes: z.number(),

  // Performance
  avgFillTimeSeconds: z.number(),
  successRate: z.number(),

  // Recent activity
  last24hIntents: z.number(),
  last24hVolume: z.string(),
  last24hFees: z.string(),

  lastUpdated: z.number(),
})
export type OIFStats = z.infer<typeof OIFStatsSchema>

export const SolverLeaderboardEntrySchema = z.object({
  rank: z.number(),
  solver: AddressSchema,
  name: z.string(),
  totalVolume: z.string(),
  totalFills: z.number(),
  successRate: z.number(),
  avgFillTimeMs: z.number(),
  reputation: z.number(),
  totalFeesEarned: z.string(),
})
export type SolverLeaderboardEntry = z.infer<
  typeof SolverLeaderboardEntrySchema
>
export const OIFEventTypeSchema = z.enum([
  // Intent events
  'IntentCreated',
  'IntentClaimed',
  'IntentFilled',
  'IntentExpired',
  'IntentCancelled',

  // Settlement events
  'OrderOpened',
  'OrderFilled',
  'OrderRefunded',
  'FundsSettled',

  // Solver events
  'SolverRegistered',
  'SolverStakeDeposited',
  'SolverSlashed',
  'SolverWithdrawn',

  // Oracle events
  'AttestationReceived',
  'AttestationVerified',
])
export type OIFEventType = z.infer<typeof OIFEventTypeSchema>

/**
 * Strongly typed event data schemas for OIF events
 */
export const IntentCreatedDataSchema = z.object({
  intentId: z.string(),
  user: AddressSchema,
  sourceChainId: SupportedChainIdSchema,
  inputAmount: z.string(),
  outputAmount: z.string(),
})

export const IntentFilledDataSchema = z.object({
  intentId: z.string(),
  solver: AddressSchema,
  fee: z.string(),
  executionTimeMs: z.number().optional(),
})

export const IntentCancelledDataSchema = z.object({
  intentId: z.string(),
  reason: z.string().optional(),
})

export const OrderEventDataSchema = z.object({
  orderId: z.string(),
  user: AddressSchema,
  amount: z.string().optional(),
})

export const SolverEventDataSchema = z.object({
  solver: AddressSchema,
  stake: z.string().optional(),
  reason: z.string().optional(),
})

export const AttestationDataSchema = z.object({
  attestationId: z.string(),
  intentId: z.string(),
  oracleType: OracleTypeSchema,
})

/**
 * Union of all OIF event data types
 */
export const OIFEventDataSchema = z.union([
  IntentCreatedDataSchema,
  IntentFilledDataSchema,
  IntentCancelledDataSchema,
  OrderEventDataSchema,
  SolverEventDataSchema,
  AttestationDataSchema,
])
export type OIFEventData = z.infer<typeof OIFEventDataSchema>

export const OIFEventSchema = z.object({
  id: z.string(),
  type: OIFEventTypeSchema,
  chainId: SupportedChainIdSchema,
  blockNumber: z.number(),
  transactionHash: z.string(),
  logIndex: z.number(),
  timestamp: z.number(),
  /** Strongly typed event data */
  data: OIFEventDataSchema,
})
export type OIFEvent = z.infer<typeof OIFEventSchema>
/**
 * Skill input parameter schema - no unknown types
 */
export const SkillInputParamSchema = z.object({
  type: z.string(),
  required: z.boolean().optional(),
  /** Default value as JSON-serializable types */
  default: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
      z.record(z.string(), z.string()),
    ])
    .optional(),
  description: z.string().optional(),
})
export type SkillInputParam = z.infer<typeof SkillInputParamSchema>

export const OIFSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  inputs: z.record(z.string(), SkillInputParamSchema).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
})
export type OIFSkill = z.infer<typeof OIFSkillSchema>
