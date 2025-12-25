/**
 * Ethereum Interop Layer (EIL) types for trustless cross-chain transactions.
 */

import { z } from 'zod'
import type { EVMChainId } from './chain'
import {
  AddressSchema,
  MAX_ARRAY_LENGTH,
  MAX_RECORD_KEYS,
  MAX_SHORT_STRING_LENGTH,
  MAX_SMALL_ARRAY_LENGTH,
} from './validation'

export const SupportedChainIdSchema = z.union([
  z.literal(1),
  z.literal(11155111),
  z.literal(42161),
  z.literal(10),
  z.literal(31337),
  z.literal(420691),
  z.literal(420690),
])
export type SupportedChainId = z.infer<typeof SupportedChainIdSchema>

// Type guard to ensure SupportedChainId is a subset of EVMChainId
const SUPPORTED_CHAIN_IDS: readonly SupportedChainId[] = [
  1, 11155111, 42161, 10, 31337, 420691, 420690,
]

export function isSupportedChainId(
  chainId: EVMChainId,
): chainId is SupportedChainId {
  // includes() works because EVMChainId is a union of numbers
  return SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)
}

export const ChainInfoSchema = z.object({
  chainId: SupportedChainIdSchema,
  name: z.string(),
  rpcUrl: z.string(),
  crossChainPaymaster: AddressSchema,
  entryPoint: AddressSchema,
  isL2: z.boolean(),
  finalityBlocks: z.number(),
})
export type ChainInfo = z.infer<typeof ChainInfoSchema>

export const XLPStatusSchema = z.enum([
  'active',
  'paused',
  'unbonding',
  'slashed',
])
export type XLPStatus = z.infer<typeof XLPStatusSchema>

export const XLPStakeSchema = z.object({
  xlpAddress: AddressSchema,
  stakedAmount: z.string(),
  stakedAt: z.number(),
  unbondingAt: z.number().optional(),
  unbondingComplete: z.number().optional(),
  slashedAmount: z.string(),
  status: XLPStatusSchema,
})
export type XLPStake = z.infer<typeof XLPStakeSchema>

export const XLPChainLiquiditySchema = z.object({
  chainId: SupportedChainIdSchema,
  ethBalance: z.string().max(MAX_SHORT_STRING_LENGTH),
  tokenBalances: z
    .record(
      z.string().max(MAX_SHORT_STRING_LENGTH),
      z.string().max(MAX_SHORT_STRING_LENGTH),
    )
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} token balances`,
    }),
  totalValueUsd: z.string().max(MAX_SHORT_STRING_LENGTH),
  lastUpdated: z.number(),
})
export type XLPChainLiquidity = z.infer<typeof XLPChainLiquiditySchema>

export const XLPProfileSchema = z.object({
  address: AddressSchema,
  stake: XLPStakeSchema,
  liquidity: z.array(XLPChainLiquiditySchema).max(MAX_SMALL_ARRAY_LENGTH),
  totalVouchersIssued: z.number(),
  totalVouchersFulfilled: z.number(),
  totalVouchersFailed: z.number(),
  totalFeesEarned: z.string().max(MAX_SHORT_STRING_LENGTH),
  averageResponseTimeMs: z.number(),
  reputation: z.number(),
  registeredAt: z.number(),
})
export type XLPProfile = z.infer<typeof XLPProfileSchema>
export const VoucherStatusSchema = z.enum([
  'pending', // Request created, waiting for XLP
  'claimed', // XLP issued voucher, funds locked
  'fulfilled', // Transfer complete on destination
  'expired', // No XLP responded in time
  'failed', // XLP failed to fulfill (slashable)
  'slashed', // XLP was slashed for this voucher
])
export type VoucherStatus = z.infer<typeof VoucherStatusSchema>

export const VoucherRequestSchema = z.object({
  requestId: z.string(), // Unique identifier (bytes32)
  requester: AddressSchema, // User requesting the transfer
  sourceChain: SupportedChainIdSchema,
  destinationChain: SupportedChainIdSchema,
  sourceToken: AddressSchema, // Token locked on source
  destinationToken: AddressSchema, // Token to receive on destination
  amount: z.string(), // Amount to transfer (wei)
  maxFee: z.string(), // Max fee willing to pay (wei)
  currentFee: z.string(), // Current auction fee (increases over time)
  feeIncrement: z.string(), // Fee increase per block (reverse Dutch auction)
  recipient: AddressSchema, // Who receives on destination
  gasOnDestination: z.string(), // ETH needed for gas on destination
  deadline: z.number(), // Block number when request expires
  createdAt: z.number(), // Unix timestamp
  createdBlock: z.number(), // Block number on source chain
  userOpHash: z.string().optional(), // Associated UserOp hash if part of multi-chain tx
})
export type VoucherRequest = z.infer<typeof VoucherRequestSchema>

export const VoucherSchema = z.object({
  voucherId: z.string(), // Unique identifier (bytes32)
  requestId: z.string(), // The request this voucher fulfills
  xlp: AddressSchema, // XLP issuing the voucher
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  amount: z.string(),
  fee: z.string(), // Fee taken by XLP
  gasProvided: z.string(), // Gas provided on destination
  signature: z.string(), // XLP's signature on the voucher
  issuedAt: z.number(),
  issuedBlock: z.number(),
  expiresAt: z.number(), // When voucher expires if not used
  status: VoucherStatusSchema,
  sourceClaimTx: z.string().optional(), // Tx where XLP claimed source funds
  destinationFulfillTx: z.string().optional(), // Tx where user received funds
})
export type Voucher = z.infer<typeof VoucherSchema>
export const CrossChainOperationTypeSchema = z.enum([
  'transfer', // Simple token transfer
  'swap', // Swap on destination DEX
  'mint', // Mint NFT or token on destination
  'stake', // Stake on destination protocol
  'custom', // Custom contract call
])
export type CrossChainOperationType = z.infer<
  typeof CrossChainOperationTypeSchema
>

export const CrossChainOperationSchema = z.object({
  chainId: SupportedChainIdSchema,
  type: CrossChainOperationTypeSchema,
  target: AddressSchema, // Contract to call
  calldata: z.string(), // Encoded function call
  value: z.string(), // ETH value to send
  gasLimit: z.string(), // Gas limit for this operation
})
export type CrossChainOperation = z.infer<typeof CrossChainOperationSchema>

export const CrossChainTransactionSchema = z.object({
  id: z.string().max(MAX_SHORT_STRING_LENGTH),
  user: AddressSchema,
  operations: z.array(CrossChainOperationSchema).max(MAX_SMALL_ARRAY_LENGTH),
  merkleRoot: z.string().max(MAX_SHORT_STRING_LENGTH),
  signature: z.string().max(MAX_SHORT_STRING_LENGTH),
  voucherRequests: z
    .array(z.string().max(MAX_SHORT_STRING_LENGTH))
    .max(MAX_ARRAY_LENGTH),
  status: z.enum(['pending', 'partial', 'complete', 'failed']),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  totalFees: z.string().max(MAX_SHORT_STRING_LENGTH),
})
export type CrossChainTransaction = z.infer<typeof CrossChainTransactionSchema>
export const EILConfigSchema = z.object({
  // L1 Configuration
  l1StakeManager: AddressSchema,
  minStake: z.string().max(MAX_SHORT_STRING_LENGTH),
  unbondingPeriod: z.number(),
  slashingPenalty: z.number(),

  // Cross-chain paymaster addresses per chain
  paymasters: z
    .record(z.string().max(MAX_SHORT_STRING_LENGTH), AddressSchema)
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} paymasters`,
    }),

  // Supported tokens per chain
  supportedTokens: z
    .record(
      z.string().max(MAX_SHORT_STRING_LENGTH),
      z.array(AddressSchema).max(MAX_ARRAY_LENGTH),
    )
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} chain entries`,
    }),

  // Fee configuration
  minFee: z.string().max(MAX_SHORT_STRING_LENGTH),
  maxFee: z.string().max(MAX_SHORT_STRING_LENGTH),
  defaultFeeIncrement: z.string().max(MAX_SHORT_STRING_LENGTH),

  // Timing
  requestTimeout: z.number(),
  voucherTimeout: z.number(),
  claimDelay: z.number(),
})
export type EILConfig = z.infer<typeof EILConfigSchema>
export const PackedUserOperationSchema = z.object({
  sender: AddressSchema,
  nonce: z.string(),
  initCode: z.string(),
  callData: z.string(),
  accountGasLimits: z.string(), // Packed verificationGasLimit + callGasLimit
  preVerificationGas: z.string(),
  gasFees: z.string(), // Packed maxFeePerGas + maxPriorityFeePerGas
  paymasterAndData: z.string(),
  signature: z.string(),
})
export type PackedUserOperation = z.infer<typeof PackedUserOperationSchema>

export const MultiChainUserOpBatchSchema = z.object({
  userOps: z
    .array(
      z.object({
        chainId: SupportedChainIdSchema,
        userOp: PackedUserOperationSchema,
      }),
    )
    .max(MAX_SMALL_ARRAY_LENGTH),
  merkleRoot: z.string().max(MAX_SHORT_STRING_LENGTH),
  merkleProofs: z
    .array(
      z
        .array(z.string().max(MAX_SHORT_STRING_LENGTH))
        .max(MAX_SMALL_ARRAY_LENGTH),
    )
    .max(MAX_SMALL_ARRAY_LENGTH),
  signature: z.string().max(MAX_SHORT_STRING_LENGTH),
})
export type MultiChainUserOpBatch = z.infer<typeof MultiChainUserOpBatchSchema>
export const EILEventTypeSchema = z.enum([
  'VoucherRequested',
  'VoucherIssued',
  'VoucherFulfilled',
  'VoucherExpired',
  'VoucherSlashed',
  'XLPRegistered',
  'XLPStakeDeposited',
  'XLPUnbondingStarted',
  'XLPStakeWithdrawn',
  'XLPSlashed',
  'LiquidityDeposited',
  'LiquidityWithdrawn',
])
export type EILEventType = z.infer<typeof EILEventTypeSchema>

/**
 * Strongly typed event data schemas for EIL events
 */
export const VoucherRequestedDataSchema = z.object({
  requestId: z.string(),
  requester: AddressSchema,
  sourceChain: SupportedChainIdSchema,
  destinationChain: SupportedChainIdSchema,
  amount: z.string(),
  maxFee: z.string(),
})

export const VoucherIssuedDataSchema = z.object({
  voucherId: z.string(),
  requestId: z.string(),
  xlp: AddressSchema,
  fee: z.string(),
})

export const VoucherFulfilledDataSchema = z.object({
  voucherId: z.string(),
  recipient: AddressSchema,
  amount: z.string(),
})

export const XLPRegisteredDataSchema = z.object({
  xlpAddress: AddressSchema,
  stakedAmount: z.string(),
})

export const XLPStakeDataSchema = z.object({
  xlpAddress: AddressSchema,
  amount: z.string(),
})

export const LiquidityDataSchema = z.object({
  xlpAddress: AddressSchema,
  chainId: SupportedChainIdSchema,
  token: AddressSchema,
  amount: z.string(),
})

/**
 * Union of all EIL event data types
 */
export const EILEventDataSchema = z.union([
  VoucherRequestedDataSchema,
  VoucherIssuedDataSchema,
  VoucherFulfilledDataSchema,
  XLPRegisteredDataSchema,
  XLPStakeDataSchema,
  LiquidityDataSchema,
])
export type EILEventData = z.infer<typeof EILEventDataSchema>

export const EILEventSchema = z.object({
  id: z.string(),
  type: EILEventTypeSchema,
  chainId: SupportedChainIdSchema,
  blockNumber: z.number(),
  transactionHash: z.string(),
  logIndex: z.number(),
  timestamp: z.number(),
  /** Strongly typed event data */
  data: EILEventDataSchema,
})
export type EILEvent = z.infer<typeof EILEventSchema>
export const EILStatsSchema = z.object({
  totalVolumeUsd: z.string(),
  totalTransactions: z.number(),
  totalXLPs: z.number(),
  activeXLPs: z.number(),
  totalStakedEth: z.string(),
  averageFeePercent: z.number(),
  averageTimeSeconds: z.number(),
  successRate: z.number(), // 0-100
  last24hVolume: z.string(),
  last24hTransactions: z.number(),
})
export type EILStats = z.infer<typeof EILStatsSchema>

export const XLPLeaderboardEntrySchema = z.object({
  xlp: AddressSchema,
  rank: z.number(),
  totalVolume: z.string(),
  totalFees: z.string(),
  successRate: z.number(),
  avgResponseTime: z.number(),
  reputation: z.number(),
})
export type XLPLeaderboardEntry = z.infer<typeof XLPLeaderboardEntrySchema>
