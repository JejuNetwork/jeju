/**
 * @fileoverview Ethereum Interop Layer (EIL) Types
 * 
 * EIL enables trustless cross-chain transactions across L2s with:
 * - One signature for multi-chain operations
 * - Atomic swaps via Cross-chain Liquidity Providers (XLPs)
 * - No trusted bridges or oracles required
 * 
 * @see https://ethresear.ch/t/eil-trust-minimized-cross-l2-interop
 */

import { z } from 'zod';
import { AddressSchema } from './contracts';

// ============ Chain & Network Types ============

export const SupportedChainIdSchema = z.union([
  z.literal(1),        // Ethereum Mainnet
  z.literal(11155111), // Sepolia (Jeju L1 Testnet)
  z.literal(42161),    // Arbitrum One
  z.literal(10),       // Optimism
  z.literal(1337),     // Localnet
  z.literal(420691),   // Jeju Mainnet (L2 on Ethereum)
  z.literal(420690),   // Jeju Testnet (L2 on Sepolia)
]);
export type SupportedChainId = z.infer<typeof SupportedChainIdSchema>;

export const ChainInfoSchema = z.object({
  chainId: SupportedChainIdSchema,
  name: z.string(),
  rpcUrl: z.string(),
  crossChainPaymaster: AddressSchema,
  entryPoint: AddressSchema,
  isL2: z.boolean(),
  finalityBlocks: z.number(),
});
export type ChainInfo = z.infer<typeof ChainInfoSchema>;

// ============ Cross-Chain Liquidity Provider (XLP) Types ============

export const XLPStatusSchema = z.enum([
  'active',           // Accepting requests
  'paused',           // Temporarily not accepting
  'unbonding',        // Stake withdrawal in progress
  'slashed',          // Was slashed for misbehavior
]);
export type XLPStatus = z.infer<typeof XLPStatusSchema>;

export const XLPStakeSchema = z.object({
  xlpAddress: AddressSchema,
  stakedAmount: z.string(),           // ETH staked on L1 (wei)
  stakedAt: z.number(),               // Unix timestamp
  unbondingAt: z.number().optional(), // When unbonding started
  unbondingComplete: z.number().optional(), // When can withdraw (8 days after unbonding)
  slashedAmount: z.string(),          // Total slashed (wei)
  status: XLPStatusSchema,
});
export type XLPStake = z.infer<typeof XLPStakeSchema>;

export const XLPChainLiquiditySchema = z.object({
  chainId: SupportedChainIdSchema,
  ethBalance: z.string(),             // ETH available for gas sponsorship
  tokenBalances: z.record(AddressSchema, z.string()), // token address -> balance
  totalValueUsd: z.string(),
  lastUpdated: z.number(),
});
export type XLPChainLiquidity = z.infer<typeof XLPChainLiquiditySchema>;

export const XLPProfileSchema = z.object({
  address: AddressSchema,
  stake: XLPStakeSchema,
  liquidity: z.array(XLPChainLiquiditySchema),
  totalVouchersIssued: z.number(),
  totalVouchersFulfilled: z.number(),
  totalVouchersFailed: z.number(),
  totalFeesEarned: z.string(),        // Total fees earned (USD)
  averageResponseTimeMs: z.number(),  // Avg time to issue voucher
  reputation: z.number(),             // 0-100 score
  registeredAt: z.number(),
});
export type XLPProfile = z.infer<typeof XLPProfileSchema>;

// ============ Voucher Types ============

export const VoucherStatusSchema = z.enum([
  'pending',          // Request created, waiting for XLP
  'claimed',          // XLP issued voucher, funds locked
  'fulfilled',        // Transfer complete on destination
  'expired',          // No XLP responded in time
  'failed',           // XLP failed to fulfill (slashable)
  'slashed',          // XLP was slashed for this voucher
]);
export type VoucherStatus = z.infer<typeof VoucherStatusSchema>;

export const VoucherRequestSchema = z.object({
  requestId: z.string(),              // Unique identifier (bytes32)
  requester: AddressSchema,           // User requesting the transfer
  sourceChain: SupportedChainIdSchema,
  destinationChain: SupportedChainIdSchema,
  sourceToken: AddressSchema,         // Token locked on source
  destinationToken: AddressSchema,    // Token to receive on destination
  amount: z.string(),                 // Amount to transfer (wei)
  maxFee: z.string(),                 // Max fee willing to pay (wei)
  currentFee: z.string(),             // Current auction fee (increases over time)
  feeIncrement: z.string(),           // Fee increase per block (reverse Dutch auction)
  recipient: AddressSchema,           // Who receives on destination
  gasOnDestination: z.string(),       // ETH needed for gas on destination
  deadline: z.number(),               // Block number when request expires
  createdAt: z.number(),              // Unix timestamp
  createdBlock: z.number(),           // Block number on source chain
  userOpHash: z.string().optional(),  // Associated UserOp hash if part of multi-chain tx
});
export type VoucherRequest = z.infer<typeof VoucherRequestSchema>;

export const VoucherSchema = z.object({
  voucherId: z.string(),              // Unique identifier (bytes32)
  requestId: z.string(),              // The request this voucher fulfills
  xlp: AddressSchema,                 // XLP issuing the voucher
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  amount: z.string(),
  fee: z.string(),                    // Fee taken by XLP
  gasProvided: z.string(),            // Gas provided on destination
  signature: z.string(),              // XLP's signature on the voucher
  issuedAt: z.number(),
  issuedBlock: z.number(),
  expiresAt: z.number(),              // When voucher expires if not used
  status: VoucherStatusSchema,
  sourceClaimTx: z.string().optional(),      // Tx where XLP claimed source funds
  destinationFulfillTx: z.string().optional(), // Tx where user received funds
});
export type Voucher = z.infer<typeof VoucherSchema>;

// ============ Cross-Chain Transaction Types ============

export const CrossChainOperationTypeSchema = z.enum([
  'transfer',         // Simple token transfer
  'swap',             // Swap on destination DEX
  'mint',             // Mint NFT or token on destination
  'stake',            // Stake on destination protocol
  'custom',           // Custom contract call
]);
export type CrossChainOperationType = z.infer<typeof CrossChainOperationTypeSchema>;

export const CrossChainOperationSchema = z.object({
  chainId: SupportedChainIdSchema,
  type: CrossChainOperationTypeSchema,
  target: AddressSchema,              // Contract to call
  calldata: z.string(),               // Encoded function call
  value: z.string(),                  // ETH value to send
  gasLimit: z.string(),               // Gas limit for this operation
});
export type CrossChainOperation = z.infer<typeof CrossChainOperationSchema>;

export const CrossChainTransactionSchema = z.object({
  id: z.string(),                     // Unique transaction ID
  user: AddressSchema,
  operations: z.array(CrossChainOperationSchema),
  merkleRoot: z.string(),             // Root of UserOp merkle tree
  signature: z.string(),              // User's single signature
  voucherRequests: z.array(z.string()), // Request IDs for cross-chain transfers
  status: z.enum(['pending', 'partial', 'complete', 'failed']),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  totalFees: z.string(),
});
export type CrossChainTransaction = z.infer<typeof CrossChainTransactionSchema>;

// ============ EIL Configuration Types ============

export const EILConfigSchema = z.object({
  // L1 Configuration
  l1StakeManager: AddressSchema,
  minStake: z.string(),               // Minimum stake required (wei)
  unbondingPeriod: z.number(),        // Seconds to unbond (default 8 days = 691200)
  slashingPenalty: z.number(),        // Percentage of stake slashed (0-100)
  
  // Cross-chain paymaster addresses per chain
  paymasters: z.record(z.string(), AddressSchema), // chainId -> address
  
  // Supported tokens per chain
  supportedTokens: z.record(z.string(), z.array(AddressSchema)), // chainId -> tokens[]
  
  // Fee configuration
  minFee: z.string(),                 // Minimum fee per transfer (wei)
  maxFee: z.string(),                 // Maximum fee per transfer (wei)
  defaultFeeIncrement: z.string(),    // Default fee increment per block
  
  // Timing
  requestTimeout: z.number(),         // Blocks until request expires
  voucherTimeout: z.number(),         // Blocks until voucher expires
  claimDelay: z.number(),             // Blocks before XLP can claim source funds
});
export type EILConfig = z.infer<typeof EILConfigSchema>;

// ============ User Operation Types (ERC-4337) ============

export const PackedUserOperationSchema = z.object({
  sender: AddressSchema,
  nonce: z.string(),
  initCode: z.string(),
  callData: z.string(),
  accountGasLimits: z.string(),       // Packed verificationGasLimit + callGasLimit
  preVerificationGas: z.string(),
  gasFees: z.string(),                // Packed maxFeePerGas + maxPriorityFeePerGas
  paymasterAndData: z.string(),
  signature: z.string(),
});
export type PackedUserOperation = z.infer<typeof PackedUserOperationSchema>;

export const MultiChainUserOpBatchSchema = z.object({
  userOps: z.array(z.object({
    chainId: SupportedChainIdSchema,
    userOp: PackedUserOperationSchema,
  })),
  merkleRoot: z.string(),
  merkleProofs: z.array(z.array(z.string())), // Proof for each userOp
  signature: z.string(),              // Single signature over merkle root
});
export type MultiChainUserOpBatch = z.infer<typeof MultiChainUserOpBatchSchema>;

// ============ Event Types for Indexer ============

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
]);
export type EILEventType = z.infer<typeof EILEventTypeSchema>;

export const EILEventSchema = z.object({
  id: z.string(),
  type: EILEventTypeSchema,
  chainId: SupportedChainIdSchema,
  blockNumber: z.number(),
  transactionHash: z.string(),
  logIndex: z.number(),
  timestamp: z.number(),
  data: z.record(z.string(), z.unknown()),
});
export type EILEvent = z.infer<typeof EILEventSchema>;

// ============ Analytics Types ============

export const EILStatsSchema = z.object({
  totalVolumeUsd: z.string(),
  totalTransactions: z.number(),
  totalXLPs: z.number(),
  activeXLPs: z.number(),
  totalStakedEth: z.string(),
  averageFeePercent: z.number(),
  averageTimeSeconds: z.number(),
  successRate: z.number(),            // 0-100
  last24hVolume: z.string(),
  last24hTransactions: z.number(),
});
export type EILStats = z.infer<typeof EILStatsSchema>;

export const XLPLeaderboardEntrySchema = z.object({
  xlp: AddressSchema,
  rank: z.number(),
  totalVolume: z.string(),
  totalFees: z.string(),
  successRate: z.number(),
  avgResponseTime: z.number(),
  reputation: z.number(),
});
export type XLPLeaderboardEntry = z.infer<typeof XLPLeaderboardEntrySchema>;

