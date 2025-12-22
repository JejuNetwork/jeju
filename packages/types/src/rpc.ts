/**
 * @fileoverview JSON-RPC Types and Schemas
 *
 * Provides Zod schemas for JSON-RPC 2.0 protocol types,
 * including request/response validation and chain-specific schemas.
 */

import { z } from 'zod'
import { HexSchema, type JsonValue } from './validation'

// ============================================================================
// JSON Value Schema
// ============================================================================

/**
 * JSON primitive values (non-recursive)
 */
const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

/**
 * Full JSON value schema with proper recursion handling for Zod
 * Validates any valid JSON value (primitives, arrays, objects)
 */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => {
  const jsonValueUnion: z.ZodType<JsonValue> = z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
  return jsonValueUnion
})

// ============================================================================
// Chain ID Schemas
// ============================================================================

/**
 * Supported EVM chain IDs
 * Use this for strict validation of supported chains
 */
export const EvmChainIdSchema = z.union([
  z.literal(1), // Ethereum Mainnet
  z.literal(10), // Optimism
  z.literal(56), // BSC
  z.literal(137), // Polygon
  z.literal(42161), // Arbitrum One
  z.literal(43114), // Avalanche
  z.literal(8453), // Base
  z.literal(84532), // Base Sepolia
  z.literal(11155111), // Sepolia
  z.literal(11155420), // Optimism Sepolia
  z.literal(421614), // Arbitrum Sepolia
  z.literal(420690), // Jeju Testnet
  z.literal(420691), // Jeju Mainnet
  z.literal(1337), // Localnet
  z.literal(31337), // Local EVM
])
export type EvmChainId = z.infer<typeof EvmChainIdSchema>

/**
 * Supported Solana network IDs
 */
export const SolanaNetworkIdSchema = z.union([
  z.literal(101), // Mainnet
  z.literal(103), // Devnet
])
export type SolanaNetworkId = z.infer<typeof SolanaNetworkIdSchema>

// ============================================================================
// JSON-RPC 2.0 Schemas
// ============================================================================

/**
 * JSON-RPC 2.0 Request schema
 */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.array(JsonValueSchema).default([]),
  id: z.union([z.number(), z.string()]),
})
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>

/**
 * JSON-RPC 2.0 Success Response schema
 */
export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: JsonValueSchema,
  id: z.union([z.number(), z.string()]),
})
export type JsonRpcSuccessResponse = z.infer<
  typeof JsonRpcSuccessResponseSchema
>

/**
 * JSON-RPC 2.0 Error Response schema
 */
export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: JsonValueSchema.optional(),
  }),
  id: z.union([z.number(), z.string(), z.null()]),
})
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>

/**
 * JSON-RPC 2.0 Response (success or error)
 */
export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
])
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>

// ============================================================================
// Chain-Specific Response Schemas
// ============================================================================

/**
 * eth_chainId response schema
 */
export const ChainIdResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})
export type ChainIdResponse = z.infer<typeof ChainIdResponseSchema>

/**
 * eth_blockNumber response schema
 */
export const BlockNumberResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})
export type BlockNumberResponse = z.infer<typeof BlockNumberResponseSchema>

/**
 * eth_getCode response schema
 */
export const GetCodeResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})
export type GetCodeResponse = z.infer<typeof GetCodeResponseSchema>

/**
 * eth_getBalance response schema
 */
export const GetBalanceResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})
export type GetBalanceResponse = z.infer<typeof GetBalanceResponseSchema>

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Parse and validate JSON-RPC chain ID response
 */
export function parseChainIdResponse(data: unknown): number {
  const parsed = ChainIdResponseSchema.parse(data)
  return parseInt(parsed.result, 16)
}

/**
 * Parse and validate JSON-RPC block number response
 */
export function parseBlockNumberResponse(data: unknown): number {
  const parsed = BlockNumberResponseSchema.parse(data)
  return parseInt(parsed.result, 16)
}

/**
 * Parse and validate JSON-RPC get code response
 */
export function parseGetCodeResponse(data: unknown): string {
  const parsed = GetCodeResponseSchema.parse(data)
  return parsed.result
}

/**
 * Parse and validate JSON-RPC get balance response
 */
export function parseGetBalanceResponse(data: unknown): bigint {
  const parsed = GetBalanceResponseSchema.parse(data)
  return BigInt(parsed.result)
}
