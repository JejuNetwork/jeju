/**
 * Shared Validation Schemas and Utilities
 * 
 * Provides Zod-based validation for all gateway endpoints with fail-fast patterns
 */

import { z } from 'zod';
import { AddressSchema, type Address } from '@jejunetwork/types/contracts';
import { SupportedChainIdSchema, type SupportedChainId } from '@jejunetwork/types/oif';
import {
  expect as baseExpect,
  expectValid,
  expectAddress as baseExpectAddress,
  expectChainId as baseExpectChainId,
  HexSchema,
  NonEmptyStringSchema,
  PositiveNumberStringSchema,
  NonNegativeNumberStringSchema,
} from '@jejunetwork/types/validation';
import type { Hex } from 'viem';

// ============================================================================
// Common Schemas
// ============================================================================

export const HexStringSchema = HexSchema;
export type HexString = z.infer<typeof HexStringSchema>;

export { NonEmptyStringSchema, PositiveNumberStringSchema, NonNegativeNumberStringSchema };

export const ChainIdSchema = SupportedChainIdSchema;
export type ChainId = SupportedChainId;

// ============================================================================
// Intent Schemas
// ============================================================================

export const CreateIntentRequestSchema = z.object({
  sourceChain: ChainIdSchema,
  destinationChain: ChainIdSchema,
  sourceToken: AddressSchema.transform((val) => val as `0x${string}`),
  destinationToken: AddressSchema.transform((val) => val as `0x${string}`),
  amount: PositiveNumberStringSchema,
  recipient: AddressSchema.transform((val) => val as `0x${string}`).optional(),
  maxFee: NonNegativeNumberStringSchema.optional(),
});
export type CreateIntentRequest = z.infer<typeof CreateIntentRequestSchema>;

export const GetQuoteRequestSchema = z.object({
  sourceChain: ChainIdSchema,
  destinationChain: ChainIdSchema,
  sourceToken: AddressSchema.transform((val) => val as `0x${string}`),
  destinationToken: AddressSchema.transform((val) => val as `0x${string}`),
  amount: PositiveNumberStringSchema,
});
export type GetQuoteRequest = z.infer<typeof GetQuoteRequestSchema>;

export const IntentIdSchema = z.string().min(1);
export type IntentId = z.infer<typeof IntentIdSchema>;

export const ListIntentsQuerySchema = z.object({
  user: AddressSchema.transform((val) => val as `0x${string}`).optional(),
  status: z.enum(['open', 'pending', 'filled', 'expired', 'cancelled', 'failed']).optional(),
  sourceChain: ChainIdSchema.optional(),
  destinationChain: ChainIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});
export type ListIntentsQuery = z.infer<typeof ListIntentsQuerySchema>;

export const CancelIntentRequestSchema = z.object({
  user: AddressSchema,
});
export type CancelIntentRequest = z.infer<typeof CancelIntentRequestSchema>;

// ============================================================================
// Route Schemas
// ============================================================================

export const ListRoutesQuerySchema = z.object({
  sourceChain: ChainIdSchema.optional(),
  destinationChain: ChainIdSchema.optional(),
  active: z.coerce.boolean().optional(),
});
export type ListRoutesQuery = z.infer<typeof ListRoutesQuerySchema>;

export const RouteIdSchema = z.string().min(1);
export type RouteId = z.infer<typeof RouteIdSchema>;

export const GetBestRouteRequestSchema = z.object({
  sourceChain: ChainIdSchema,
  destinationChain: ChainIdSchema,
  prioritize: z.enum(['speed', 'cost']).default('cost'),
});
export type GetBestRouteRequest = z.infer<typeof GetBestRouteRequestSchema>;

export const GetVolumeQuerySchema = z.object({
  routeId: RouteIdSchema.optional(),
  sourceChain: ChainIdSchema.optional(),
  destinationChain: ChainIdSchema.optional(),
  period: z.enum(['24h', '7d', '30d', 'all']).default('24h'),
});
export type GetVolumeQuery = z.infer<typeof GetVolumeQuerySchema>;

// ============================================================================
// Solver Schemas
// ============================================================================

export const ListSolversQuerySchema = z.object({
  chainId: ChainIdSchema.optional(),
  minReputation: z.coerce.number().int().min(0).max(100).optional(),
  active: z.coerce.boolean().default(true),
});
export type ListSolversQuery = z.infer<typeof ListSolversQuerySchema>;

export const SolverAddressSchema = AddressSchema;
export type SolverAddress = Address;

export const SolverLeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['volume', 'fills', 'reputation', 'successRate']).default('volume'),
});
export type SolverLeaderboardQuery = z.infer<typeof SolverLeaderboardQuerySchema>;

// ============================================================================
// Pool Schemas
// ============================================================================

export const TokenPairSchema = z.object({
  token0: AddressSchema.transform((val) => val as `0x${string}`),
  token1: AddressSchema.transform((val) => val as `0x${string}`),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const SwapQuoteRequestSchema = z.object({
  tokenIn: AddressSchema.transform((val) => val as `0x${string}`),
  tokenOut: AddressSchema.transform((val) => val as `0x${string}`),
  amountIn: PositiveNumberStringSchema,
});
export type SwapQuoteRequest = z.infer<typeof SwapQuoteRequestSchema>;

export const ListPoolsQuerySchema = z.object({
  type: z.enum(['v2']).optional(),
  token0: AddressSchema.optional(),
  token1: AddressSchema.optional(),
});
export type ListPoolsQuery = z.infer<typeof ListPoolsQuerySchema>;

// ============================================================================
// Moderation Schemas
// ============================================================================

export const CheckBanStatusRequestSchema = z.object({
  address: AddressSchema,
});
export type CheckBanStatusRequest = z.infer<typeof CheckBanStatusRequestSchema>;

export const GetModeratorProfileRequestSchema = z.object({
  address: AddressSchema,
});
export type GetModeratorProfileRequest = z.infer<typeof GetModeratorProfileRequestSchema>;

export const GetModerationCasesQuerySchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
  resolvedOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});
export type GetModerationCasesQuery = z.infer<typeof GetModerationCasesQuerySchema>;

export const CaseIdSchema = z.string().min(1);
export type CaseId = z.infer<typeof CaseIdSchema>;

export const GetReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  pendingOnly: z.coerce.boolean().optional(),
});
export type GetReportsQuery = z.infer<typeof GetReportsQuerySchema>;

export const AgentIdSchema = z.coerce.number().int().positive();
export type AgentId = z.infer<typeof AgentIdSchema>;

export const PrepareStakeRequestSchema = z.object({
  amount: PositiveNumberStringSchema,
});
export type PrepareStakeRequest = z.infer<typeof PrepareStakeRequestSchema>;

export const PrepareReportRequestSchema = z.object({
  target: AddressSchema.transform((val) => val as `0x${string}`),
  reason: NonEmptyStringSchema,
  evidenceHash: HexStringSchema.transform((val) => val as Hex),
});
export type PrepareReportRequest = z.infer<typeof PrepareReportRequestSchema>;

export const PrepareVoteRequestSchema = z.object({
  caseId: CaseIdSchema,
  voteYes: z.boolean(),
});
export type PrepareVoteRequest = z.infer<typeof PrepareVoteRequestSchema>;

export const PrepareChallengeRequestSchema = z.object({
  caseId: CaseIdSchema,
  stakeAmount: PositiveNumberStringSchema,
});
export type PrepareChallengeRequest = z.infer<typeof PrepareChallengeRequestSchema>;

export const PrepareAppealRequestSchema = z.object({
  caseId: CaseIdSchema,
  stakeAmount: PositiveNumberStringSchema,
});
export type PrepareAppealRequest = z.infer<typeof PrepareAppealRequestSchema>;

// ============================================================================
// Faucet Schemas
// ============================================================================

export const FaucetStatusRequestSchema = z.object({
  address: AddressSchema.transform((val) => val as `0x${string}`),
});
export type FaucetStatusRequest = z.infer<typeof FaucetStatusRequestSchema>;

export const FaucetClaimRequestSchema = z.object({
  address: AddressSchema.transform((val) => val as `0x${string}`),
});
export type FaucetClaimRequest = z.infer<typeof FaucetClaimRequestSchema>;

// ============================================================================
// RPC Schemas
// ============================================================================

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcBatchRequestSchema = z.array(RpcRequestSchema).min(1).max(100);
export type RpcBatchRequest = z.infer<typeof RpcBatchRequestSchema>;

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().max(100).optional(),
  address: AddressSchema,
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

export const KeyIdSchema = z.string().length(32).regex(/^[a-f0-9]{32}$/);
export type KeyId = z.infer<typeof KeyIdSchema>;

export const PurchaseCreditsRequestSchema = z.object({
  txHash: HexStringSchema,
  amount: z.string().refine(
    (val) => {
      try {
        const num = BigInt(val);
        return num > 0n;
      } catch {
        return false;
      }
    },
    { error: 'Must be a valid positive bigint string' }
  ),
});
export type PurchaseCreditsRequest = z.infer<typeof PurchaseCreditsRequestSchema>;

export const PaymentRequirementQuerySchema = z.object({
  chainId: ChainIdSchema.optional(),
  method: z.string().min(1).optional(),
});
export type PaymentRequirementQuery = z.infer<typeof PaymentRequirementQuerySchema>;

// ============================================================================
// Leaderboard Schemas
// ============================================================================

export const UsernameSchema = z.string().min(1).max(100);
export type Username = z.infer<typeof UsernameSchema>;

export const GetAttestationQuerySchema = z.object({
  wallet: AddressSchema.transform((val) => val as `0x${string}`).optional(),
  username: UsernameSchema.optional(),
  chainId: z.string().optional(),
});
export type GetAttestationQuery = z.infer<typeof GetAttestationQuerySchema>;

export const CreateAttestationRequestSchema = z.object({
  username: UsernameSchema,
  walletAddress: AddressSchema.transform((val) => val as `0x${string}`),
  chainId: z.string().optional(),
  agentId: z.coerce.number().int().nonnegative().optional(),
});
export type CreateAttestationRequest = z.infer<typeof CreateAttestationRequestSchema>;

export const ConfirmAttestationRequestSchema = z.object({
  attestationHash: HexStringSchema,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash').transform(s => s.toLowerCase() as `0x${string}`),
  walletAddress: AddressSchema,
  chainId: z.string().optional(),
});
export type ConfirmAttestationRequest = z.infer<typeof ConfirmAttestationRequestSchema>;

export const WalletVerifyQuerySchema = z.object({
  username: UsernameSchema,
  wallet: AddressSchema.optional(),
});
export type WalletVerifyQuery = z.infer<typeof WalletVerifyQuerySchema>;

export const WalletVerifyRequestSchema = z.object({
  username: UsernameSchema,
  walletAddress: AddressSchema,
  signature: HexStringSchema,
  message: NonEmptyStringSchema,
  timestamp: z.number().int().positive(),
  chainId: z.string().optional(),
});
export type WalletVerifyRequest = z.infer<typeof WalletVerifyRequestSchema>;

export const AgentLinkQuerySchema = z.object({
  wallet: AddressSchema.optional(),
  username: UsernameSchema.optional(),
  agentId: z.coerce.number().int().positive().optional(),
});
export type AgentLinkQuery = z.infer<typeof AgentLinkQuerySchema>;

export const CreateAgentLinkRequestSchema = z.object({
  username: UsernameSchema,
  walletAddress: AddressSchema,
  agentId: z.coerce.number().int().positive(),
  registryAddress: AddressSchema,
  chainId: z.string().optional(),
  txHash: HexStringSchema.optional(),
});
export type CreateAgentLinkRequest = z.infer<typeof CreateAgentLinkRequestSchema>;

export const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

// ============================================================================
// A2A Request Schemas
// ============================================================================

export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('message/send'),
  id: z.union([z.string(), z.number()]),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      parts: z.array(
        z.object({
          kind: z.string(),
          text: z.string().optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
      ),
    }),
  }),
});
export type A2ARequest = z.infer<typeof A2ARequestSchema>;

// ============================================================================
// MCP Schemas
// ============================================================================

export const McpResourceReadRequestSchema = z.object({
  uri: z.string().min(1),
});
export type McpResourceReadRequest = z.infer<typeof McpResourceReadRequestSchema>;

export const McpToolCallRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
});
export type McpToolCallRequest = z.infer<typeof McpToolCallRequestSchema>;

// ============================================================================
// Validation Utilities (re-exported from @jejunetwork/types/validation)
// ============================================================================

export { expectValid };
export const validateOrThrow = expectValid;

/**
 * Validates data against a Zod schema with an optional context
 * This wrapper maintains the gateway's expected arg order: (value, schema, context)
 */
export function expect<T>(value: unknown, schema: z.ZodSchema<T>, context?: string): T {
  return expectValid(schema, value, context);
}

export const expectAddress = baseExpectAddress;
export const expectChainId = baseExpectChainId;

/**
 * Validates a positive number string and throws if invalid
 */
export function expectPositiveNumber(value: unknown, context?: string): string {
  const result = PositiveNumberStringSchema.safeParse(value);
  if (!result.success) {
    throw new Error(context ? `${context}: Invalid positive number ${value}` : `Invalid positive number: ${value}`);
  }
  return result.data;
}

/**
 * Validates query parameters from Express/Hono request
 */
export function validateQuery<T>(schema: z.ZodSchema<T>, query: Record<string, unknown>, context?: string): T {
  return validateOrThrow(schema, query, context);
}

/**
 * Validates request body from Express/Hono request
 */
export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown, context?: string): T {
  return validateOrThrow(schema, body, context);
}

/**
 * Extracts error message from unknown error values
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Converts a typed object to a generic Record for JSON response data.
 * This provides type safety while allowing typed API responses to be used
 * as generic response data.
 */
export function toResponseData<T extends object>(data: T): Record<string, unknown> {
  return data as Record<string, unknown>;
}
