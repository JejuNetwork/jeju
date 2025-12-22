/**
 * Zod Schemas for Test Infrastructure
 *
 * Provides type-safe validation for:
 * - RPC responses
 * - Infrastructure status
 * - Test configuration
 * - Lock file metadata
 */

import {
  AddressSchema,
  BlockNumberResponseSchema,
  ChainIdResponseSchema,
  GetBalanceResponseSchema,
  GetCodeResponseSchema,
  HashSchema,
  HexSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  JsonRpcSuccessResponseSchema,
  JsonValueSchema,
  parseBlockNumberResponse,
  parseChainIdResponse,
  parseGetCodeResponse,
} from '@jejunetwork/types'
import { z } from 'zod'

// Re-export shared schemas for convenience
export {
  AddressSchema,
  BlockNumberResponseSchema,
  ChainIdResponseSchema,
  GetBalanceResponseSchema,
  GetCodeResponseSchema,
  HexSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  JsonRpcSuccessResponseSchema,
  JsonValueSchema,
  parseBlockNumberResponse,
  parseChainIdResponse,
  parseGetCodeResponse,
}

// Re-export JSON-RPC types from @jejunetwork/types
export type {
  JsonRpcErrorResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from '@jejunetwork/types'

// ============================================================================
// Additional Address & Hash Schemas (extend shared schemas)
// ============================================================================

export const PrivateKeySchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key')
export const TxHashSchema = HashSchema

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

// Local types
export type Address = z.infer<typeof AddressSchema>
export type Hex = z.infer<typeof HexSchema>
export type PrivateKey = z.infer<typeof PrivateKeySchema>
export type TxHash = z.infer<typeof TxHashSchema>

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
