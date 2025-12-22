/**
 * Workers (serverless functions) service schemas
 * Supports workerd-based serverless execution with scale-to-zero and regional deployment
 */

import { z } from 'zod'
import { JSONValueSchema, nonEmptyStringSchema } from '../validation'

// ============================================================================
// CDN Regions - Global edge locations
// ============================================================================

export const CDNRegionSchema = z.enum([
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'af-south-1',
  'me-south-1',
  'global',
])

export type CDNRegion = z.infer<typeof CDNRegionSchema>

// ============================================================================
// Regional Scaling Configuration
// ============================================================================

export const RegionalScalingConfigSchema = z.object({
  /** Region identifier */
  region: CDNRegionSchema,
  /** Whether this region is enabled */
  enabled: z.boolean().default(true),
  /** Minimum instances in this region (0 for scale-to-zero) */
  minInstances: z.number().int().nonnegative().default(0),
  /** Maximum instances in this region */
  maxInstances: z.number().int().positive().default(10),
  /** Target CPU utilization for scaling (0-100) */
  targetCpuUtilization: z.number().min(0).max(100).default(70),
  /** Target requests per instance for scaling */
  targetRequestsPerInstance: z.number().positive().default(100),
  /** Cooldown period before scaling down (ms) */
  scaleDownCooldownMs: z.number().int().positive().default(300000), // 5 min
  /** Cooldown period before scaling up (ms) */
  scaleUpCooldownMs: z.number().int().nonnegative().default(30000), // 30 sec
  /** Enable scale-to-zero when no traffic */
  scaleToZero: z.boolean().default(true),
  /** Idle timeout before scaling to zero (ms) */
  idleTimeoutMs: z.number().int().positive().default(600000), // 10 min
})

export type RegionalScalingConfig = z.infer<typeof RegionalScalingConfigSchema>

// ============================================================================
// Global Scaling Configuration
// ============================================================================

export const ScalingConfigSchema = z.object({
  /** Global minimum instances across all regions */
  globalMinInstances: z.number().int().nonnegative().default(0),
  /** Global maximum instances across all regions */
  globalMaxInstances: z.number().int().positive().default(100),
  /** Default target concurrency per instance */
  targetConcurrency: z.number().int().positive().default(10),
  /** Enable scale-to-zero globally */
  scaleToZero: z.boolean().default(true),
  /** Global idle timeout (ms) */
  idleTimeoutMs: z.number().int().positive().default(600000),
  /** Cooldown between scaling events (ms) */
  cooldownMs: z.number().int().positive().default(60000),
  /** Regional overrides */
  regions: z.array(RegionalScalingConfigSchema).default([]),
  /** Preferred regions (traffic routing priority) */
  preferredRegions: z.array(CDNRegionSchema).default(['global']),
  /** Enable geo-routing */
  geoRouting: z.boolean().default(true),
})

export type ScalingConfig = z.infer<typeof ScalingConfigSchema>

// ============================================================================
// Worker Deployment Request
// ============================================================================

export const deployWorkerRequestSchema = z.object({
  name: nonEmptyStringSchema,
  runtime: z.enum(['workerd', 'bun', 'node', 'deno']).default('workerd'),
  handler: z.string().default('index.handler'),
  code: z.union([
    z.string(), // base64 encoded or IPFS CID
    z.instanceof(Buffer).optional(),
    z.instanceof(ArrayBuffer).optional(),
  ]),
  /** Memory limit in MB */
  memory: z.number().int().positive().default(256),
  /** Request timeout in ms */
  timeout: z.number().int().positive().default(30000),
  /** Environment variables */
  env: z.record(z.string(), z.string()).default({}),
  /** Secrets (KMS references) */
  secrets: z.array(z.string()).default([]),
  /** Scaling configuration */
  scaling: ScalingConfigSchema.optional(),
  /** Require TEE execution */
  teeRequired: z.boolean().default(false),
  /** Preferred TEE platform */
  teePlatform: z
    .enum(['dstack', 'phala', 'intel_sgx', 'intel_tdx', 'amd_sev'])
    .optional(),
  /** KV namespace bindings */
  kvBindings: z.record(z.string(), z.string()).default({}),
  /** D1 database bindings */
  d1Bindings: z.record(z.string(), z.string()).default({}),
  /** Route patterns */
  routes: z
    .array(
      z.object({
        pattern: z.string(),
        zone: z.string().optional(),
      }),
    )
    .default([]),
})

export type DeployWorkerRequest = z.infer<typeof deployWorkerRequestSchema>

// ============================================================================
// Worker Invocation
// ============================================================================

export const invokeWorkerRequestSchema = z.object({
  payload: JSONValueSchema.optional(),
  async: z.boolean().default(false),
  /** Preferred region for execution */
  region: CDNRegionSchema.optional(),
  /** x402 payment header */
  x402Header: z.string().optional(),
})

export type InvokeWorkerRequest = z.infer<typeof invokeWorkerRequestSchema>

// ============================================================================
// Worker Params
// ============================================================================

export const workerParamsSchema = z.object({
  functionId: z.string().uuid(),
})

export const workerListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
  region: CDNRegionSchema.optional(),
  status: z.enum(['active', 'idle', 'stopped', 'error']).optional(),
})

export const workerInvocationParamsSchema = z.object({
  functionId: z.string().uuid(),
  invocationId: z.string().uuid(),
})

// ============================================================================
// Worker Instance Status
// ============================================================================

export const WorkerInstanceStatusSchema = z.object({
  instanceId: z.string(),
  workerId: z.string(),
  region: CDNRegionSchema,
  nodeId: z.string(),
  status: z.enum(['starting', 'warm', 'busy', 'draining', 'stopped', 'error']),
  startedAt: z.number(),
  lastRequestAt: z.number(),
  activeRequests: z.number(),
  totalRequests: z.number(),
  cpuUsagePercent: z.number().min(0).max(100),
  memoryUsedMb: z.number().nonnegative(),
})

export type WorkerInstanceStatus = z.infer<typeof WorkerInstanceStatusSchema>

// ============================================================================
// Regional Stats
// ============================================================================

export const RegionalStatsSchema = z.object({
  region: CDNRegionSchema,
  activeInstances: z.number().int().nonnegative(),
  warmInstances: z.number().int().nonnegative(),
  totalRequests: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
  coldStartRate: z.number().min(0).max(1),
})

export type RegionalStats = z.infer<typeof RegionalStatsSchema>

// ============================================================================
// Worker Stats Response
// ============================================================================

export const WorkerStatsSchema = z.object({
  workerId: z.string(),
  name: z.string(),
  status: z.enum(['active', 'idle', 'stopped', 'error']),
  globalInstances: z.number().int().nonnegative(),
  totalInvocations: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  coldStarts: z.number().int().nonnegative(),
  regions: z.array(RegionalStatsSchema),
  scalingConfig: ScalingConfigSchema,
})

export type WorkerStats = z.infer<typeof WorkerStatsSchema>
