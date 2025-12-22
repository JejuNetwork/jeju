/**
 * Common Type Definitions
 *
 * Shared types for A2A protocol that replace 'unknown' and 'any'
 */

import { z } from 'zod'

/**
 * JSON-serializable value types
 * Note: undefined is NOT included as it's not valid JSON - use optional properties instead
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Zod schema for JSON-serializable values
 * Used in validation schemas for metadata and flexible data fields
 */
export type JsonValueSchemaType = z.ZodType<JsonValue>

export const JsonValueSchema: JsonValueSchemaType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

/**
 * Generic key-value record with string keys
 */
export type StringRecord<T = JsonValue> = Record<string, T>

/**
 * Parameters for JSON-RPC requests
 */
export type JsonRpcParams = StringRecord<JsonValue> | JsonValue[]

/**
 * Result type for JSON-RPC responses
 */
export type JsonRpcResult = JsonValue | StringRecord<JsonValue> | JsonValue[]

/**
 * Ethereum wallet address validation schema
 */
export const WalletAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum wallet address')

export type WalletAddress = z.infer<typeof WalletAddressSchema>

/**
 * Transaction hash validation schema
 */
export const TransactionHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash')

export type TransactionHash = z.infer<typeof TransactionHashSchema>

/**
 * Game network information for multi-chain support
 */
export const GameNetworkInfoSchema = z.object({
  chainId: z.number(),
  registryAddress: z.string(),
  reputationAddress: z.string().optional(),
  marketAddress: z.string().optional(),
})
export type GameNetworkInfo = z.infer<typeof GameNetworkInfoSchema>

/**
 * Agent capabilities schema
 */
export const AgentCapabilitiesSchema = z.object({
  strategies: z.array(z.string()).optional().default([]),
  markets: z.array(z.string()).optional().default([]),
  actions: z.array(z.string()).optional().default([]),
  version: z.string().optional().default('1.0.0'),
  x402Support: z.boolean().optional(),
  platform: z.string().optional(),
  userType: z.string().optional(),
  gameNetwork: GameNetworkInfoSchema.optional(),
  // OASF Taxonomy Support
  skills: z.array(z.string()).optional().default([]),
  domains: z.array(z.string()).optional().default([]),
  // A2A Communication Endpoints
  a2aEndpoint: z.string().optional(),
  mcpEndpoint: z.string().optional(),
})
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>

/**
 * Payment request schema
 */
export const PaymentRequestSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  from: WalletAddressSchema.describe('Sender wallet address'),
  to: WalletAddressSchema.describe('Receiver wallet address'),
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string (in wei)'),
  service: z.string().min(1, 'Service identifier is required'),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
  expiresAt: z
    .number()
    .int()
    .positive('Expiration timestamp must be a positive integer'),
})
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>

/**
 * Payment verification parameters
 */
export interface PaymentVerificationParams {
  requestId: string
  txHash: string
  from: string
  to: string
  amount: string
  timestamp: number
  confirmed: boolean
}

/**
 * Payment verification result
 */
export interface PaymentVerificationResult {
  verified: boolean
  error?: string
}
