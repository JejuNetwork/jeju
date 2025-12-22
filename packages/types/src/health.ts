/**
 * @fileoverview Network Standard Health Check API
 *
 * All decentralized apps should implement this standard health check API
 * to enable automatic monitoring and recovery via the KeepaliveRegistry.
 *
 * Endpoints:
 * - GET /health - Basic health check
 * - GET /health/ready - Readiness check (dependencies available)
 * - GET /health/live - Liveness check (app is running)
 * - GET /health/resources - Resource-level health details
 */

import { z } from 'zod'
import { AddressSchema } from './validation'

// ============ Health Status ============

export const HealthStatusSchema = z.enum([
  'healthy',
  'degraded',
  'unhealthy',
  'unfunded',
  'unknown',
])
export type HealthStatus = z.infer<typeof HealthStatusSchema>

// ============ Basic Health Response ============

/**
 * Response from GET /health
 */
export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string(),
  version: z.string(),
  timestamp: z.string(),
  uptime: z.number(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

// ============ Readiness Check ============

export const DependencyTypeSchema = z.enum([
  'database',
  'cache',
  'api',
  'blockchain',
  'ipfs',
  'storage',
  'compute',
  'trigger',
])
export type DependencyType = z.infer<typeof DependencyTypeSchema>

export const DependencyHealthSchema = z.object({
  name: z.string(),
  type: DependencyTypeSchema,
  status: HealthStatusSchema,
  latencyMs: z.number().optional(),
  error: z.string().optional(),
})
export type DependencyHealth = z.infer<typeof DependencyHealthSchema>

/**
 * Response from GET /health/ready
 */
export const ReadinessResponseSchema = z.object({
  ready: z.boolean(),
  status: HealthStatusSchema,
  dependencies: z.array(DependencyHealthSchema),
})
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>

// ============ Liveness Check ============

export const MemoryUsageSchema = z.object({
  heapUsed: z.number(),
  heapTotal: z.number(),
  rss: z.number(),
})
export type MemoryUsage = z.infer<typeof MemoryUsageSchema>

/**
 * Response from GET /health/live
 */
export const LivenessResponseSchema = z.object({
  alive: z.boolean(),
  pid: z.number().optional(),
  memoryUsage: MemoryUsageSchema.optional(),
})
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>

// ============ Resource Health ============

export const HealthResourceTypeSchema = z.enum([
  'ipfs_content',
  'compute_endpoint',
  'trigger',
  'storage',
  'agent',
  'custom',
])
export type HealthResourceType = z.infer<typeof HealthResourceTypeSchema>

/**
 * Strongly typed resource health details
 * Replaces Record<string, unknown> with specific schemas
 */
export const ResourceHealthDetailsSchema = z.object({
  /** Size in bytes for storage/content resources */
  sizeBytes: z.number().optional(),
  /** Number of replicas for distributed resources */
  replicas: z.number().optional(),
  /** Region/location information */
  region: z.string().optional(),
  /** Last successful operation timestamp */
  lastSuccess: z.number().optional(),
  /** Failure count since last success */
  failureCount: z.number().optional(),
  /** Custom metrics as key-value pairs (string values only) */
  metrics: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})
export type ResourceHealthDetails = z.infer<typeof ResourceHealthDetailsSchema>

export const ResourceHealthSchema = z.object({
  type: HealthResourceTypeSchema,
  identifier: z.string(),
  status: HealthStatusSchema,
  required: z.boolean(),
  lastCheck: z.string(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
  /** Strongly typed resource details */
  details: ResourceHealthDetailsSchema.optional(),
})
export type ResourceHealth = z.infer<typeof ResourceHealthSchema>

/**
 * Response from GET /health/resources
 */
export const FundingStatusSchema = z.object({
  funded: z.boolean(),
  balance: z.string(),
  minRequired: z.string(),
  vaultAddress: AddressSchema,
  autoFundEnabled: z.boolean(),
  estimatedRuntime: z.number().optional(),
})
export type FundingStatus = z.infer<typeof FundingStatusSchema>

export const ResourceHealthResponseSchema = z.object({
  status: HealthStatusSchema,
  resources: z.array(ResourceHealthSchema),
  funding: FundingStatusSchema,
})
export type ResourceHealthResponse = z.infer<
  typeof ResourceHealthResponseSchema
>

// ============ Keepalive Types ============

export const KeepaliveResourceSchema = z.object({
  type: HealthResourceTypeSchema,
  identifier: z.string(),
  healthEndpoint: z.string().url(),
  minBalance: z.bigint(),
  required: z.boolean(),
})
export type KeepaliveResource = z.infer<typeof KeepaliveResourceSchema>

export const KeepaliveConfigSchema = z.object({
  keepaliveId: z.string(),
  jnsName: z.string().optional(),
  agentId: z.bigint().optional(),
  vaultAddress: AddressSchema,
  minBalance: z.bigint(),
  checkInterval: z.number().int().positive(),
  autoFundAmount: z.bigint(),
  autoFundEnabled: z.boolean(),
  resources: z.array(KeepaliveResourceSchema),
  dependencies: z.array(z.string()),
})
export type KeepaliveConfig = z.infer<typeof KeepaliveConfigSchema>

export const KeepaliveStatusSchema = z.object({
  keepaliveId: z.string(),
  status: HealthStatusSchema,
  funded: z.boolean(),
  balance: z.bigint(),
  lastCheck: z.number(),
  healthyResources: z.number().int().nonnegative(),
  totalResources: z.number().int().nonnegative(),
  failedResources: z.array(z.string()),
})
export type KeepaliveStatus = z.infer<typeof KeepaliveStatusSchema>

// ============ Health Check Executor ============

export const KeepaliveHealthCheckRequestSchema = z.object({
  keepaliveId: z.string(),
  resources: z.array(KeepaliveResourceSchema),
  timeout: z.number().int().positive(),
})
export type KeepaliveHealthCheckRequest = z.infer<
  typeof KeepaliveHealthCheckRequestSchema
>

export const ResourceCheckResultSchema = z.object({
  type: HealthResourceTypeSchema,
  identifier: z.string(),
  status: HealthStatusSchema,
  latencyMs: z.number(),
  error: z.string().optional(),
  response: z
    .union([HealthResponseSchema, ResourceHealthResponseSchema])
    .optional(),
})
export type ResourceCheckResult = z.infer<typeof ResourceCheckResultSchema>

export const KeepaliveHealthCheckResultSchema = z.object({
  keepaliveId: z.string(),
  status: HealthStatusSchema,
  timestamp: z.number(),
  balance: z.bigint(),
  healthyResources: z.number().int().nonnegative(),
  totalResources: z.number().int().nonnegative(),
  failedResources: z.array(z.string()),
  resourceResults: z.array(ResourceCheckResultSchema),
})
export type KeepaliveHealthCheckResult = z.infer<
  typeof KeepaliveHealthCheckResultSchema
>

// ============ Wake Page Data ============

export const WakePageDataSchema = z.object({
  jnsName: z.string(),
  appName: z.string(),
  description: z.string(),
  owner: AddressSchema,
  vaultAddress: AddressSchema,
  currentBalance: z.bigint(),
  minRequired: z.bigint(),
  fundingNeeded: z.bigint(),
  lastHealthy: z.number(),
  agentId: z.bigint().optional(),
  avatar: z.string().optional(),
})
export type WakePageData = z.infer<typeof WakePageDataSchema>

// ============ ENS Mirror Types ============

export const ENSMirrorConfigSchema = z.object({
  ensName: z.string(),
  jnsName: z.string(),
  syncInterval: z.number().int().positive(),
  enabled: z.boolean(),
})
export type ENSMirrorConfig = z.infer<typeof ENSMirrorConfigSchema>

export const ENSMirrorStatusSchema = z.object({
  ensName: z.string(),
  jnsName: z.string(),
  lastSync: z.number(),
  synced: z.boolean(),
  ensContenthash: z.string().optional(),
  jnsContenthash: z.string().optional(),
  error: z.string().optional(),
})
export type ENSMirrorStatus = z.infer<typeof ENSMirrorStatusSchema>

// ============ Helper Functions ============

/**
 * Check if health response indicates healthy status
 */
export function isHealthy(
  response: HealthResponse | ResourceHealthResponse,
): boolean {
  return response.status === 'healthy'
}

/**
 * Check if health response indicates funded status
 */
export function isFunded(status: HealthStatus): boolean {
  return status !== 'unfunded'
}

/**
 * Calculate overall status from resource statuses
 */
export function aggregateStatus(resources: ResourceHealth[]): HealthStatus {
  if (resources.length === 0) return 'unknown'

  const required = resources.filter((r) => r.required)
  const requiredUnhealthy = required.filter(
    (r) => r.status === 'unhealthy' || r.status === 'unfunded',
  )

  if (requiredUnhealthy.some((r) => r.status === 'unfunded')) return 'unfunded'
  if (requiredUnhealthy.length > 0) return 'unhealthy'

  const anyDegraded = resources.some((r) => r.status === 'degraded')
  if (anyDegraded) return 'degraded'

  return 'healthy'
}

/**
 * Format balance for display
 */
export function formatBalance(wei: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals)
  const whole = wei / divisor
  const remainder = wei % divisor
  const fraction = remainder.toString().padStart(decimals, '0').slice(0, 4)
  return `${whole}.${fraction}`
}
