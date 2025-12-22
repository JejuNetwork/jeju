/**
 * Zod Schemas for Test Infrastructure
 *
 * Provides type-safe validation for:
 * - RPC responses
 * - Infrastructure status
 * - Test configuration
 * - Lock file metadata
 */

import { z } from 'zod'

// ============================================================================
// JSON Value Schema (replaces z.unknown() for JSON-RPC)
// ============================================================================

/**
 * Represents any valid JSON value - used for JSON-RPC params/results
 * This is a recursive type that covers all JSON primitives and structures
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

// JSON primitive values (non-recursive)
const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

// Full JSON value schema with proper recursion handling for Zod v4
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => {
  const jsonValueUnion: z.ZodType<JsonValue> = z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
  return jsonValueUnion
})

// ============================================================================
// Address & Hash Schemas
// ============================================================================

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
export const HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]*$/, 'Invalid hex string')
export const PrivateKeySchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key')
export const TxHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash')

// ============================================================================
// JSON-RPC Schemas
// ============================================================================

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.array(JsonValueSchema).default([]),
  id: z.union([z.number(), z.string()]),
})

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: JsonValueSchema,
  id: z.union([z.number(), z.string()]),
})

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: JsonValueSchema.optional(),
  }),
  id: z.union([z.number(), z.string(), z.null()]),
})

export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
])

// Chain-specific responses
export const ChainIdResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})

export const BlockNumberResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})

export const GetCodeResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})

export const GetBalanceResponseSchema = JsonRpcSuccessResponseSchema.extend({
  result: HexSchema,
})

// ============================================================================
// Infrastructure Schemas
// ============================================================================

export const DockerServiceConfigSchema = z.object({
  port: z.number().int().positive(),
  healthPath: z.string(),
  name: z.string(),
})

export const DockerServicesSchema = z.record(z.string(), z.boolean())

export const InfraStatusSchema = z.object({
  rpc: z.boolean(),
  dws: z.boolean(),
  docker: DockerServicesSchema,
  rpcUrl: z.string().url(),
  dwsUrl: z.string().url(),
})

// ============================================================================
// Lock Manager Schemas
// ============================================================================

export const LockMetadataSchema = z.object({
  pid: z.number().int().positive(),
  timestamp: z.number().int().positive(),
  hostname: z.string(),
  command: z.string(),
})

export const LockManagerOptionsSchema = z.object({
  lockDir: z.string().optional(),
  ttlMs: z.number().int().positive().optional(),
  force: z.boolean().optional(),
})

// ============================================================================
// Preflight Schemas
// ============================================================================

export const PreflightCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  message: z.string(),
  details: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
})

export const PreflightResultSchema = z.object({
  success: z.boolean(),
  checks: z.array(PreflightCheckSchema),
  duration: z.number().int().nonnegative(),
})

export const PreflightConfigSchema = z.object({
  rpcUrl: z.string().url(),
  chainId: z.number().int().positive(),
  testPrivateKey: PrivateKeySchema,
  minBalance: z.bigint(),
  timeout: z.number().int().positive(),
})

// ============================================================================
// Warmup Schemas
// ============================================================================

export const AppConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  port: z.number().int().positive(),
  routes: z.array(z.string()),
  isNextJs: z.boolean(),
})

export const WarmupOptionsSchema = z.object({
  apps: z.array(z.string()).optional(),
  visitPages: z.boolean().optional(),
  buildApps: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
  headless: z.boolean().optional(),
})

export const AppWarmupResultSchema = z.object({
  name: z.string(),
  success: z.boolean(),
  pagesVisited: z.number().int().nonnegative(),
  buildTime: z.number().int().nonnegative().optional(),
  errors: z.array(z.string()),
})

export const WarmupResultSchema = z.object({
  success: z.boolean(),
  apps: z.array(AppWarmupResultSchema),
  duration: z.number().int().nonnegative(),
})

// ============================================================================
// Test Account Schemas
// ============================================================================

export const TestAccountSchema = z.object({
  address: AddressSchema,
  privateKey: PrivateKeySchema,
})

export const TestWalletSchema = z.object({
  address: AddressSchema,
  privateKey: PrivateKeySchema,
  seed: z.string().optional(),
})

export const TestAccountsSchema = z.object({
  deployer: TestAccountSchema,
  user1: TestAccountSchema,
  user2: TestAccountSchema,
  user3: TestAccountSchema.optional(),
  operator: TestAccountSchema.optional(),
})

// ============================================================================
// Chain Configuration Schemas
// ============================================================================

export const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string(),
  rpcUrl: z.string().url(),
  wsUrl: z.string().url().optional(),
})

export const NetworkConfigSchema = z.object({
  chainId: z.number().int().positive(),
  chainIdHex: HexSchema,
  name: z.string(),
  rpcUrl: z.string().url(),
  symbol: z.string(),
  blockExplorerUrl: z.string().optional(),
})

// ============================================================================
// App Manifest Schema
// ============================================================================

export const AppManifestSchema = z.object({
  ports: z
    .object({
      main: z.number().int().positive(),
    })
    .passthrough(),
  warmupRoutes: z.array(z.string()).optional(),
})

// ============================================================================
// IPFS Response Schemas
// ============================================================================

export const IpfsIdResponseSchema = z.object({
  ID: z.string(),
  PublicKey: z.string().optional(),
  Addresses: z.array(z.string()).optional(),
  AgentVersion: z.string().optional(),
  ProtocolVersion: z.string().optional(),
})

export const IpfsAddResponseSchema = z.object({
  Name: z.string(),
  Hash: z.string(),
  Size: z.string().optional(),
})

// ============================================================================
// Test Environment Schemas
// ============================================================================

export const TestEnvInfoSchema = z.object({
  rpcUrl: z.string().url(),
  chainId: z.number().int().positive(),
  startTime: z.string().datetime(),
  ci: z.boolean(),
})

export const SetupInfoSchema = z.object({
  rpcUrl: z.string().url(),
  dwsUrl: z.string().url(),
  docker: DockerServicesSchema,
  startTime: z.string().datetime(),
  external: z.boolean(),
})

// ============================================================================
// Type Exports
// ============================================================================

export type Address = z.infer<typeof AddressSchema>
export type Hex = z.infer<typeof HexSchema>
export type PrivateKey = z.infer<typeof PrivateKeySchema>
export type TxHash = z.infer<typeof TxHashSchema>

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>
export type JsonRpcSuccessResponse = z.infer<
  typeof JsonRpcSuccessResponseSchema
>
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>

export type InfraStatus = z.infer<typeof InfraStatusSchema>
export type LockMetadata = z.infer<typeof LockMetadataSchema>
export type LockManagerOptions = z.infer<typeof LockManagerOptionsSchema>

export type PreflightCheck = z.infer<typeof PreflightCheckSchema>
export type PreflightResult = z.infer<typeof PreflightResultSchema>
export type PreflightConfig = z.infer<typeof PreflightConfigSchema>

export type AppConfig = z.infer<typeof AppConfigSchema>
export type WarmupOptions = z.infer<typeof WarmupOptionsSchema>
export type AppWarmupResult = z.infer<typeof AppWarmupResultSchema>
export type WarmupResult = z.infer<typeof WarmupResultSchema>

export type TestAccount = z.infer<typeof TestAccountSchema>
export type TestWallet = z.infer<typeof TestWalletSchema>
export type TestAccounts = z.infer<typeof TestAccountsSchema>

export type ChainConfig = z.infer<typeof ChainConfigSchema>
export type NetworkConfig = z.infer<typeof NetworkConfigSchema>
export type AppManifest = z.infer<typeof AppManifestSchema>

export type IpfsIdResponse = z.infer<typeof IpfsIdResponseSchema>
export type IpfsAddResponse = z.infer<typeof IpfsAddResponseSchema>

export type TestEnvInfo = z.infer<typeof TestEnvInfoSchema>
export type SetupInfo = z.infer<typeof SetupInfoSchema>

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
 * Parse and validate lock file metadata
 */
export function parseLockMetadata(data: unknown): LockMetadata {
  return LockMetadataSchema.parse(data)
}

/**
 * Parse and validate app manifest
 */
export function parseAppManifest(data: unknown): AppManifest {
  return AppManifestSchema.parse(data)
}

/**
 * Parse and validate IPFS ID response
 */
export function parseIpfsIdResponse(data: unknown): IpfsIdResponse {
  return IpfsIdResponseSchema.parse(data)
}

/**
 * Parse and validate IPFS add response
 */
export function parseIpfsAddResponse(data: unknown): IpfsAddResponse {
  return IpfsAddResponseSchema.parse(data)
}
