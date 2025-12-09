/**
 * @fileoverview Open Intents Framework (OIF) Types
 * 
 * OIF enables permissionless cross-chain interoperability via intents:
 * - Users express desired outcomes (intents) instead of manual execution
 * - Solvers compete to fulfill intents for fees
 * - Settlement contracts ensure atomic execution with trustless verification
 * 
 * @see https://docs.openintents.xyz
 * @see ERC-7683 for cross-chain intent standard
 */

import { z } from 'zod';
import { AddressSchema } from './contracts';
import { SupportedChainIdSchema } from './eil';
export { SupportedChainIdSchema };
export type { SupportedChainId } from './eil';

// ============ Intent Types (ERC-7683 Compatible) ============

export const IntentStatusSchema = z.enum([
  'open',           // Intent created, awaiting solver
  'pending',        // Solver claimed, awaiting execution
  'filled',         // Successfully fulfilled
  'expired',        // No solver responded in time
  'cancelled',      // User cancelled before fill
  'failed',         // Solver failed to fulfill
]);
export type IntentStatus = z.infer<typeof IntentStatusSchema>;

export const IntentInputSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  chainId: SupportedChainIdSchema,
});
export type IntentInput = z.infer<typeof IntentInputSchema>;

export const IntentOutputSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  recipient: AddressSchema,
  chainId: SupportedChainIdSchema,
});
export type IntentOutput = z.infer<typeof IntentOutputSchema>;

export const FillInstructionSchema = z.object({
  destinationChainId: SupportedChainIdSchema,
  destinationSettler: AddressSchema,
  originData: z.string(), // Encoded execution params
});
export type FillInstruction = z.infer<typeof FillInstructionSchema>;

export const IntentSchema = z.object({
  intentId: z.string(),
  user: AddressSchema,
  nonce: z.string(),
  sourceChainId: SupportedChainIdSchema,
  openDeadline: z.number(),  // Block number when intent expires if unclaimed
  fillDeadline: z.number(),  // Block number when fill must complete
  
  // What user provides
  inputs: z.array(IntentInputSchema),
  
  // What user receives
  outputs: z.array(IntentOutputSchema),
  
  // Fill instructions for solvers
  fillInstructions: z.array(FillInstructionSchema).optional(),
  
  // Signature
  signature: z.string(),
  
  // Status tracking
  status: IntentStatusSchema,
  createdAt: z.number(),
  filledAt: z.number().optional(),
  
  // Execution details
  solver: AddressSchema.optional(),
  inputSettlerTx: z.string().optional(),
  outputSettlerTx: z.string().optional(),
  attestationTx: z.string().optional(),
  fee: z.string().optional(),
  executionTimeMs: z.number().optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

// ============ Gasless Cross-Chain Order (ERC-7683) ============

export const GaslessCrossChainOrderSchema = z.object({
  originSettler: AddressSchema,
  user: AddressSchema,
  nonce: z.string(),
  originChainId: SupportedChainIdSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),
  orderDataType: z.string(), // bytes32 type identifier
  orderData: z.string(),     // Encoded order-specific data
});
export type GaslessCrossChainOrder = z.infer<typeof GaslessCrossChainOrderSchema>;

export const ResolvedCrossChainOrderSchema = z.object({
  user: AddressSchema,
  originChainId: SupportedChainIdSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),
  orderId: z.string(),
  maxSpent: z.array(z.object({
    token: AddressSchema,
    amount: z.string(),
    recipient: AddressSchema,
    chainId: SupportedChainIdSchema,
  })),
  minReceived: z.array(z.object({
    token: AddressSchema,
    amount: z.string(),
    recipient: AddressSchema,
    chainId: SupportedChainIdSchema,
  })),
  fillInstructions: z.array(FillInstructionSchema),
});
export type ResolvedCrossChainOrder = z.infer<typeof ResolvedCrossChainOrderSchema>;

// ============ Solver Types ============

export const SolverStatusSchema = z.enum([
  'active',         // Accepting intents
  'paused',         // Temporarily not accepting
  'slashed',        // Was slashed for misbehavior
  'inactive',       // Not registered or withdrawn
]);
export type SolverStatus = z.infer<typeof SolverStatusSchema>;

export const SolverLiquiditySchema = z.object({
  chainId: SupportedChainIdSchema,
  token: AddressSchema,
  amount: z.string(),
  lastUpdated: z.number(),
});
export type SolverLiquidity = z.infer<typeof SolverLiquiditySchema>;

export const SolverSchema = z.object({
  address: AddressSchema,
  name: z.string(),
  endpoint: z.string().optional(),       // A2A endpoint for direct communication
  
  // Supported chains and tokens
  supportedChains: z.array(SupportedChainIdSchema),
  supportedTokens: z.record(z.string(), z.array(AddressSchema)), // chainId -> tokens[]
  
  // Liquidity positions
  liquidity: z.array(SolverLiquiditySchema),
  
  // Performance metrics
  reputation: z.number(),                // 0-100 score
  totalFills: z.number(),
  successfulFills: z.number(),
  failedFills: z.number(),
  successRate: z.number(),               // 0-100 percentage
  avgResponseMs: z.number(),
  avgFillTimeMs: z.number(),
  totalVolumeUsd: z.string(),
  totalFeesEarnedUsd: z.string(),
  
  // Registration
  status: SolverStatusSchema,
  stakedAmount: z.string(),
  registeredAt: z.number(),
  lastActiveAt: z.number(),
});
export type Solver = z.infer<typeof SolverSchema>;

// ============ Route Types ============

export const OracleTypeSchema = z.enum([
  'hyperlane',          // Hyperlane messaging protocol
  'optimism-native',    // OP Stack native bridge
  'superchain',         // Superchain native interop
  'layerzero',          // LayerZero messaging
  'custom',             // Custom oracle implementation
]);
export type OracleType = z.infer<typeof OracleTypeSchema>;

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
  avgFeePercent: z.number(),       // Basis points
  avgFillTimeSeconds: z.number(),
  successRate: z.number(),         // 0-100
  
  // Available solvers
  activeSolvers: z.number(),
  totalLiquidity: z.string(),
  
  lastUpdated: z.number(),
});
export type IntentRoute = z.infer<typeof IntentRouteSchema>;

// ============ Quote Types ============

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
  feePercent: z.number(),          // Basis points
  priceImpact: z.number(),         // Basis points
  
  // Timing
  estimatedFillTimeSeconds: z.number(),
  validUntil: z.number(),          // Unix timestamp
  
  // Solver offering this quote
  solver: AddressSchema,
  solverReputation: z.number(),
  
  // Route info
  route: IntentRouteSchema.optional(),
});
export type IntentQuote = z.infer<typeof IntentQuoteSchema>;

// ============ Settlement Types ============

export const SettlementStatusSchema = z.enum([
  'pending',          // Awaiting attestation
  'attested',         // Oracle attested fulfillment
  'settled',          // Funds released to solver
  'disputed',         // Under dispute
  'slashed',          // Solver slashed
]);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

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
});
export type Settlement = z.infer<typeof SettlementSchema>;

// ============ Oracle Types ============

export const OracleAttestationSchema = z.object({
  attestationId: z.string(),
  intentId: z.string(),
  orderId: z.string(),
  
  // Attestation details
  oracleType: OracleTypeSchema,
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  
  // Proof data
  proof: z.string(),              // Encoded proof (Hyperlane message, L1 proof, etc.)
  proofBlockNumber: z.number(),
  proofTimestamp: z.number(),
  
  // Verification
  verified: z.boolean(),
  verifiedAt: z.number().optional(),
  verificationTx: z.string().optional(),
});
export type OracleAttestation = z.infer<typeof OracleAttestationSchema>;

// ============ OIF Configuration ============

export const OIFConfigSchema = z.object({
  // Settlement contract addresses per chain
  inputSettlers: z.record(z.string(), AddressSchema),     // chainId -> address
  outputSettlers: z.record(z.string(), AddressSchema),    // chainId -> address
  solverRegistry: AddressSchema,
  
  // Oracle configuration
  oracles: z.record(z.string(), z.object({
    type: OracleTypeSchema,
    address: AddressSchema,
    config: z.record(z.string(), z.string()).optional(),
  })),
  
  // Fee configuration
  minFee: z.string(),             // Minimum fee in wei
  maxFee: z.string(),             // Maximum fee in wei
  protocolFeePercent: z.number(), // Basis points taken by protocol
  
  // Timing configuration
  defaultOpenDeadline: z.number(),   // Blocks
  defaultFillDeadline: z.number(),   // Blocks
  claimDelay: z.number(),            // Blocks before solver can claim
  
  // Solver requirements
  minSolverStake: z.string(),
  slashingPercent: z.number(),
});
export type OIFConfig = z.infer<typeof OIFConfigSchema>;

// ============ Analytics Types ============

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
});
export type OIFStats = z.infer<typeof OIFStatsSchema>;

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
});
export type SolverLeaderboardEntry = z.infer<typeof SolverLeaderboardEntrySchema>;

// ============ Event Types for Indexer ============

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
]);
export type OIFEventType = z.infer<typeof OIFEventTypeSchema>;

export const OIFEventSchema = z.object({
  id: z.string(),
  type: OIFEventTypeSchema,
  chainId: SupportedChainIdSchema,
  blockNumber: z.number(),
  transactionHash: z.string(),
  logIndex: z.number(),
  timestamp: z.number(),
  data: z.record(z.string(), z.unknown()),
});
export type OIFEvent = z.infer<typeof OIFEventSchema>;

// ============ A2A Skill Types ============

export const OIFSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  inputs: z.record(z.string(), z.object({
    type: z.string(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    description: z.string().optional(),
  })).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
});
export type OIFSkill = z.infer<typeof OIFSkillSchema>;

