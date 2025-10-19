import { z } from 'zod';
import { AddressSchema } from './contracts';

export const BridgeTransferStatusSchema = z.enum([
  'pending',
  'submitted',
  'relaying',
  'completed',
  'failed',
]);
export type BridgeTransferStatus = z.infer<typeof BridgeTransferStatusSchema>;

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
});
export type BridgeTransfer = z.infer<typeof BridgeTransferSchema>;

export const BridgeConfigSchema = z.object({
  standardBridge: AddressSchema,
  crossDomainMessenger: AddressSchema,
  minGasLimit: z.number(),
  estimatedConfirmationTime: z.number(),
  supportedTokens: z.array(AddressSchema),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

export const BridgeEstimateSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  estimatedGas: z.string(),
  estimatedCost: z.string(),
  estimatedTime: z.number(),
  route: z.array(z.string()),
});
export type BridgeEstimate = z.infer<typeof BridgeEstimateSchema>;

export interface BridgeEventLog {
  event: 'ERC20BridgeInitiated' | 'ERC20BridgeFinalized' | 'ETHBridgeInitiated' | 'ETHBridgeFinalized';
  from: string;
  to: string;
  amount: string;
  localToken: string;
  remoteToken: string;
  extraData: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
}

