/**
 * Zod Schemas for Test Infrastructure
 *
 * Provides type-safe validation for:
 * - RPC responses
 * - Infrastructure status
 * - Test configuration
 * - Lock file metadata
 */

import { AddressSchema, HashSchema, HexSchema } from '@jejunetwork/types'
import { z } from 'zod'

// Import JSON-RPC types directly from @jejunetwork/types
export type {
  JsonRpcErrorResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from '@jejunetwork/types'

// Additional Address & Hash Schemas (extend shared schemas)

export const PrivateKeySchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key')
export const TxHashSchema = HashSchema

// Infrastructure Schemas

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

// Lock Manager Schemas

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

// Preflight Schemas

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

// Warmup Schemas

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

// Test Account Schemas

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

// Chain Configuration Schemas

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

// App Manifest Schema

export const AppManifestSchema = z.object({
  ports: z
    .object({
      main: z.number().int().positive(),
    })
    .passthrough(),
  warmupRoutes: z.array(z.string()).optional(),
})

// IPFS Response Schemas

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

// Test Environment Schemas

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

// Type Exports

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

// Validation Helpers

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

// RPC Response schemas
export const BlockNumberResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: HexSchema,
})

export const ChainIdResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: HexSchema,
})

export const GetCodeResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: HexSchema,
})

export type BlockNumberResponse = z.infer<typeof BlockNumberResponseSchema>
export type ChainIdResponse = z.infer<typeof ChainIdResponseSchema>
export type GetCodeResponse = z.infer<typeof GetCodeResponseSchema>

/**
 * Parse and validate eth_blockNumber response
 */
export function parseBlockNumberResponse(data: unknown): BlockNumberResponse {
  return BlockNumberResponseSchema.parse(data)
}

/**
 * Parse and validate eth_chainId response
 */
export function parseChainIdResponse(data: unknown): ChainIdResponse {
  return ChainIdResponseSchema.parse(data)
}

/**
 * Parse and validate eth_getCode response
 */
export function parseGetCodeResponse(data: unknown): GetCodeResponse {
  return GetCodeResponseSchema.parse(data)
}

// Messaging Test Schemas

export const HubInfoResponseSchema = z.object({
  version: z.string(),
  isSyncing: z.boolean(),
  nickname: z.string().optional(),
  rootHash: z.string().optional(),
  dbStats: z.record(z.string(), z.number()).optional(),
  peerId: z.string().optional(),
})

export const FarcasterMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      data: z
        .object({
          fid: z.number(),
          userDataBody: z.object({ value: z.string() }).optional(),
          castAddBody: z.object({ text: z.string() }).optional(),
        })
        .passthrough(),
      hash: z.string().optional(),
    }),
  ),
})

export const CastResultSchema = z.object({
  hash: z.string(),
})

export const RelayHealthSchema = z.object({
  status: z.string(),
  nodeId: z.string(),
})

export const RelayStatsSchema = z.object({
  nodeId: z.string(),
  totalMessagesRelayed: z.number(),
  totalBytesRelayed: z.number(),
})

export const RelayMessageResultSchema = z.object({
  success: z.boolean(),
  messageId: z.string(),
  cid: z.string().optional(),
})

export const RelayMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      content: z.string().optional(),
      from: z.string().optional(),
    }),
  ),
  count: z.number().optional(),
})

export const CountResponseSchema = z.object({
  count: z.number(),
})

export const GraphQLResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
})

export const RpcResultResponseSchema = z.object({
  result: z.string(),
  error: z.object({ message: z.string() }).optional(),
})

// Type exports for new schemas
export type HubInfoResponse = z.infer<typeof HubInfoResponseSchema>
export type FarcasterMessagesResponse = z.infer<
  typeof FarcasterMessagesResponseSchema
>
export type CastResult = z.infer<typeof CastResultSchema>
export type RelayHealth = z.infer<typeof RelayHealthSchema>
export type RelayStats = z.infer<typeof RelayStatsSchema>
export type RelayMessageResult = z.infer<typeof RelayMessageResultSchema>
export type RelayMessagesResponse = z.infer<typeof RelayMessagesResponseSchema>
export type CountResponse = z.infer<typeof CountResponseSchema>
export type GraphQLResponse = z.infer<typeof GraphQLResponseSchema>
export type RpcResultResponse = z.infer<typeof RpcResultResponseSchema>
