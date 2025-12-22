import { z } from 'zod'
import { AddressSchema } from './validation'

// ============ Transfer Status Types ============

/**
 * Bridge transfer status (comprehensive)
 * Used for cross-chain bridge transfers
 */
export const BridgeTransferStatusSchema = z.enum([
  'pending',
  'submitted',
  'relaying',
  'completed',
  'failed',
])
export type BridgeTransferStatus = z.infer<typeof BridgeTransferStatusSchema>

/**
 * Simple transfer status (for basic transfers)
 * Consolidates TransferStatus definitions
 */
export type TransferStatus = 'pending' | 'completed' | 'failed'

export const BridgeTransferSchema = z.object({
  id: z.string(),
  token: AddressSchema,
  tokenSymbol: z.string(),
  amount: z.string(),
  from: AddressSchema,
  to: AddressSchema,
  sourceChain: z.string(),
  destinationChain: z.string(),
  sourceTxHash: z.string().optional(),
  destinationTxHash: z.string().optional(),
  status: BridgeTransferStatusSchema,
  submittedAt: z.number(),
  completedAt: z.number().optional(),
  estimatedCompletionTime: z.number(),
  bridgeContract: AddressSchema,
  messengerContract: AddressSchema,
})
export type BridgeTransfer = z.infer<typeof BridgeTransferSchema>

export const BridgeConfigSchema = z.object({
  standardBridge: AddressSchema,
  crossDomainMessenger: AddressSchema,
  minGasLimit: z.number(),
  estimatedConfirmationTime: z.number(),
  supportedTokens: z.array(AddressSchema),
})
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>

export const BridgeEstimateSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  estimatedGas: z.string(),
  estimatedCost: z.string(),
  estimatedTime: z.number(),
  route: z.array(z.string()),
})
export type BridgeEstimate = z.infer<typeof BridgeEstimateSchema>

export const BridgeEventTypeSchema = z.enum([
  'ERC20BridgeInitiated',
  'ERC20BridgeFinalized',
  'ETHBridgeInitiated',
  'ETHBridgeFinalized',
])
export type BridgeEventType = z.infer<typeof BridgeEventTypeSchema>

export const BridgeEventLogSchema = z.object({
  event: BridgeEventTypeSchema,
  from: AddressSchema,
  to: AddressSchema,
  amount: z.string(),
  localToken: AddressSchema,
  remoteToken: AddressSchema,
  extraData: z.string(),
  transactionHash: z.string(),
  blockNumber: z.number().int().nonnegative(),
  timestamp: z.number(),
})
export type BridgeEventLog = z.infer<typeof BridgeEventLogSchema>
