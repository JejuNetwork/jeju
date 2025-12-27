/**
 * Serverless Deployment Types
 *
 * Types for serverless worker deployment infrastructure that supports:
 * - Workerd/Cloudflare Workers runtime
 * - Static frontend hosting on IPFS/Arweave
 * - JNS registration and routing
 * - Decentralized worker registry
 */

import { isRecord, JsonValueSchema } from '@jejunetwork/types'
import { z } from 'zod'

// Worker Runtime Configuration

export const WorkerRuntimeSchema = z.enum(['workerd', 'bun', 'node', 'deno'])
export type WorkerRuntime = z.infer<typeof WorkerRuntimeSchema>

export const TEEPlatformSchema = z.enum([
  'dstack',
  'phala',
  'simulator',
  'none',
])
export type TEEPlatform = z.infer<typeof TEEPlatformSchema>

export const StorageProviderSchema = z.enum(['ipfs', 'arweave', 'both', 'none'])
export type StorageProvider = z.infer<typeof StorageProviderSchema>

// Manifest Extensions for Serverless

export const ServerlessWorkerConfigSchema = z.preprocess(
  // Transform field names from manifest format to schema format
  (data) => {
    if (typeof data !== 'object' || data === null) return data
    const obj = data as Record<string, unknown>
    return {
      ...obj,
      // Support both 'memory' and 'memoryMb'
      memoryMb: obj.memoryMb ?? obj.memory ?? 128,
      // Support both 'timeout' and 'timeoutMs'
      timeoutMs: obj.timeoutMs ?? obj.timeout ?? 30000,
    }
  },
  z.object({
    /** Worker name (used for routing) */
    name: z.string(),
    /** Entry point file (relative to app directory) */
    entrypoint: z.string(),
    /** Runtime type */
    runtime: z.enum(['workerd', 'bun', 'node', 'deno']).optional(),
    /** Workerd compatibility date */
    compatibilityDate: z.string().default('2024-01-01'),
    /** Compatibility flags */
    compatibilityFlags: z.array(z.string()).optional(),
    /** Memory limit in MB */
    memoryMb: z.number().default(128),
    /** Request timeout in milliseconds */
    timeoutMs: z.number().default(30000),
    /** Minimum instances to keep warm */
    minInstances: z.number().default(0),
    /** Maximum instances for auto-scaling */
    maxInstances: z.number().default(10),
    /** TEE requirements */
    tee: z
      .object({
        required: z.boolean().default(false),
        preferred: z.boolean().default(false),
        platforms: z.array(TEEPlatformSchema).default(['dstack', 'phala']),
      })
      .optional(),
    /** KV namespace bindings */
    kv: z.record(z.string(), z.string()).optional(),
    /** Bindings (generic) */
    bindings: z.record(z.string(), JsonValueSchema).optional(),
    /** Durable Object bindings */
    durableObjects: z.record(z.string(), z.string()).optional(),
    /** Secret bindings (loaded from environment) */
    secrets: z.array(z.string()).optional(),
    /** Route patterns for this worker */
    routes: z
      .array(
        z.object({
          pattern: z.string(),
          zone: z.string().optional(),
        }),
      )
      .optional(),
    /** Regions to deploy to */
    regions: z.array(z.string()).default(['global']),
  }),
)
export type ServerlessWorkerConfig = z.infer<
  typeof ServerlessWorkerConfigSchema
>

export const ServerlessFrontendConfigSchema = z.object({
  /** Build directory containing static files */
  buildDir: z.string().default('dist'),
  /** Build command to run before deployment */
  buildCommand: z.string().optional(),
  /** Entry HTML file */
  entrypoint: z.string().default('index.html'),
  /** Storage providers to upload to */
  storage: StorageProviderSchema.default('ipfs'),
  /** Enable SPA routing (redirect all 404 to index.html) */
  spa: z.boolean().default(true),
  /** Fallback origins for hybrid hosting */
  fallbackOrigins: z.array(z.string()).optional(),
  /** Cache rules for CDN */
  cacheRules: z
    .array(
      z.object({
        pattern: z.string(),
        ttl: z.number(),
        staleWhileRevalidate: z.number().optional(),
        immutable: z.boolean().optional(),
      }),
    )
    .optional(),
})
export type ServerlessFrontendConfig = z.infer<
  typeof ServerlessFrontendConfigSchema
>

export const ServerlessAppConfigSchema = z.object({
  /** Application name */
  name: z.string(),
  /** JNS name (e.g., "bazaar.jeju") */
  jnsName: z.string(),
  /** Worker configuration */
  worker: ServerlessWorkerConfigSchema.optional(),
  /** Frontend configuration */
  frontend: ServerlessFrontendConfigSchema.optional(),
  /** Database configuration */
  database: z
    .object({
      type: z.enum(['eqlite', 'sqlite', 'postgres']).default('eqlite'),
      name: z.string(),
      consistency: z.enum(['eventual', 'strong']).default('strong'),
      tables: z.array(z.string()).optional(),
    })
    .optional(),
  /** Health check configuration */
  healthCheck: z
    .object({
      endpoint: z.string().default('/health'),
      interval: z.number().default(30000),
    })
    .optional(),
  /** Dependencies on other apps */
  dependencies: z.array(z.string()).optional(),
})
export type ServerlessAppConfig = z.infer<typeof ServerlessAppConfigSchema>

// Deployment State Types

export interface WorkerDeploymentState {
  workerId: string
  name: string
  codeCid: string
  version: number
  status: 'pending' | 'deploying' | 'active' | 'error' | 'stopped'
  agentId?: bigint
  endpoint?: string
  deployedAt: number
  regions: string[]
  error?: string
}

export interface FrontendDeploymentState {
  name: string
  ipfsCid?: string
  arweaveTxId?: string
  version: string
  files: Array<{
    path: string
    cid: string
    size: number
  }>
  totalSize: number
  deployedAt: number
  jnsName?: string
}

export interface AppDeploymentState {
  name: string
  jnsName: string
  worker?: WorkerDeploymentState
  frontend?: FrontendDeploymentState
  jnsNode?: string
  status: 'pending' | 'partial' | 'complete' | 'error'
  deployedAt: number
  verifiedAt?: number
  error?: string
}

export interface DeploymentManifest {
  network: 'localnet' | 'testnet' | 'mainnet'
  version: string
  timestamp: string
  deployer: string
  apps: AppDeploymentState[]
  contracts: {
    jnsRegistry: string
    jnsResolver: string
    jnsRegistrar: string
    identityRegistry: string
    workerRegistry?: string
  }
}

// Build Output Types

export interface WorkerBuildOutput {
  /** Main worker bundle path */
  bundlePath: string
  /** Content hash of the bundle */
  contentHash: string
  /** Size in bytes */
  size: number
  /** Source map path (if generated) */
  sourceMapPath?: string
  /** Dependencies included */
  dependencies: string[]
}

export interface FrontendBuildOutput {
  /** Build directory path */
  buildDir: string
  /** All files with their hashes */
  files: Array<{
    path: string
    relativePath: string
    size: number
    hash: string
    mimeType: string
  }>
  /** Total size */
  totalSize: number
  /** Entry point file */
  entrypoint: string
}

// Local Development Types

export interface LocalServerConfig {
  /** Port for the local server */
  port: number
  /** Enable hot reload */
  hotReload: boolean
  /** Enable HTTPS */
  https: boolean
  /** Proxy configuration for API routes */
  proxy?: Record<string, string>
  /** Workers to run locally */
  workers: Array<{
    name: string
    entrypoint: string
    port: number
    env: Record<string, string>
  }>
}

export interface WorkerdProcessConfig {
  /** Worker name */
  name: string
  /** Port to listen on */
  port: number
  /** Path to worker code */
  codePath: string
  /** Environment bindings */
  env: Record<string, string>
  /** Compatibility date */
  compatibilityDate: string
}

// Verification Types

export interface VerificationResult {
  name: string
  type: 'worker' | 'frontend' | 'jns' | 'health'
  passed: boolean
  message: string
  details?: Record<string, string | number | boolean>
  duration?: number
}

export interface DeploymentVerificationReport {
  network: string
  timestamp: string
  results: VerificationResult[]
  summary: {
    total: number
    passed: number
    failed: number
    duration: number
  }
}

// Helper Functions

/**
 * Parse a serverless app config from a jeju-manifest.json
 */
export function parseServerlessConfig(
  manifest: Record<string, unknown>,
): ServerlessAppConfig | null {
  if (typeof manifest.name !== 'string') return null

  const name: string = manifest.name
  const jns = isRecord(manifest.jns) ? manifest.jns : undefined
  if (!jns || typeof jns.name !== 'string') return null

  // Check for serverless configuration in either location
  const dws = isRecord(manifest.dws) ? manifest.dws : undefined
  const decentralization = isRecord(manifest.decentralization)
    ? manifest.decentralization
    : undefined

  // Must have at least one serverless config source
  if (!dws && !decentralization) return null

  const config: ServerlessAppConfig = {
    name,
    jnsName: jns.name,
  }

  // Parse worker config - prefer decentralization.worker over dws.worker
  const decentralizationWorker = isRecord(decentralization?.worker)
    ? decentralization.worker
    : undefined
  const dwsWorker = isRecord(dws?.worker) ? dws.worker : undefined
  const worker = decentralizationWorker || dwsWorker

  if (worker) {
    const parsed = ServerlessWorkerConfigSchema.safeParse(worker)
    if (parsed.success) {
      config.worker = parsed.data
    }
  }

  // Parse backend config (legacy format) - only if no worker already set
  const backend = isRecord(dws?.backend) ? dws.backend : undefined
  if (backend && !config.worker) {
    config.worker = {
      name: `${name}-api`,
      entrypoint:
        typeof backend.entrypoint === 'string'
          ? backend.entrypoint
          : 'api/server.ts',
      memoryMb: typeof backend.memory === 'number' ? backend.memory : 128,
      timeoutMs: typeof backend.timeout === 'number' ? backend.timeout : 30000,
      minInstances:
        typeof backend.minInstances === 'number' ? backend.minInstances : 0,
      maxInstances:
        typeof backend.maxInstances === 'number' ? backend.maxInstances : 10,
      tee: {
        required:
          typeof backend.teeRequired === 'boolean'
            ? backend.teeRequired
            : false,
        preferred: true,
        platforms: ['dstack', 'phala'],
      },
      regions: Array.isArray(backend.regions)
        ? backend.regions.filter((r): r is string => typeof r === 'string')
        : ['global'],
      compatibilityDate: '2024-01-01',
    }
  }

  // Parse frontend config - prefer decentralization.frontend
  const frontend = isRecord(decentralization?.frontend)
    ? decentralization.frontend
    : undefined
  if (frontend) {
    config.frontend = {
      buildDir:
        typeof frontend.buildDir === 'string' ? frontend.buildDir : 'dist',
      entrypoint:
        typeof frontend.entrypoint === 'string'
          ? frontend.entrypoint
          : 'index.html',
      spa: typeof frontend.spa === 'boolean' ? frontend.spa : true,
      storage:
        frontend.ipfs && frontend.arweave
          ? 'both'
          : frontend.arweave
            ? 'arweave'
            : 'ipfs',
      fallbackOrigins: Array.isArray(frontend.fallbackOrigins)
        ? frontend.fallbackOrigins.filter(
            (o): o is string => typeof o === 'string',
          )
        : undefined,
    }
  }

  // Parse CDN config as frontend if not already present
  const cdn = isRecord(dws?.cdn) ? dws.cdn : undefined
  if (cdn && !config.frontend) {
    config.frontend = {
      buildDir: typeof cdn.staticDir === 'string' ? cdn.staticDir : 'dist',
      entrypoint:
        typeof cdn.entrypoint === 'string' ? cdn.entrypoint : 'index.html',
      spa: true,
      storage: 'ipfs',
      cacheRules: Array.isArray(cdn.cacheRules)
        ? (cdn.cacheRules as ServerlessFrontendConfig['cacheRules'])
        : undefined,
    }
  }

  // Parse database config
  const database = isRecord(dws?.database) ? dws.database : undefined
  if (database) {
    config.database = {
      type:
        typeof database.type === 'string' &&
        (database.type === 'eqlite' ||
          database.type === 'sqlite' ||
          database.type === 'postgres')
          ? database.type
          : 'eqlite',
      name: typeof database.name === 'string' ? database.name : `${name}-db`,
      consistency:
        typeof database.consistency === 'string' &&
        (database.consistency === 'eventual' ||
          database.consistency === 'strong')
          ? database.consistency
          : 'strong',
      tables: Array.isArray(database.tables)
        ? database.tables.filter((t): t is string => typeof t === 'string')
        : undefined,
    }
  }

  // Parse health check
  const healthCheck = isRecord(manifest.healthCheck)
    ? manifest.healthCheck
    : undefined
  if (healthCheck) {
    const apiHealth = isRecord(healthCheck.api) ? healthCheck.api : undefined
    const healthUrl =
      (typeof apiHealth?.url === 'string' ? apiHealth.url : null) ||
      (typeof healthCheck.url === 'string' ? healthCheck.url : null) ||
      '/health'
    config.healthCheck = {
      endpoint: healthUrl.replace(/^http:\/\/[^/]+/, ''),
      interval:
        typeof healthCheck.interval === 'number' ? healthCheck.interval : 30000,
    }
  }

  // Parse dependencies
  const deps = Array.isArray(manifest.dependencies)
    ? manifest.dependencies.filter((d): d is string => typeof d === 'string')
    : undefined
  if (deps) {
    config.dependencies = deps
  }

  return config
}

/**
 * Validate a serverless config
 */
export function validateServerlessConfig(config: ServerlessAppConfig): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!config.name) {
    errors.push('App name is required')
  }

  if (!config.jnsName) {
    errors.push('JNS name is required')
  }

  if (!config.worker && !config.frontend) {
    errors.push('At least one of worker or frontend config is required')
  }

  if (config.worker) {
    if (!config.worker.entrypoint) {
      errors.push('Worker entrypoint is required')
    }
    // Allow up to 2GB for heavy workloads like indexers
    if (config.worker.memoryMb > 2048) {
      errors.push('Worker memory cannot exceed 2048MB')
    }
    // Allow up to 10 minutes for long-running indexer operations
    if (config.worker.timeoutMs > 600000) {
      errors.push('Worker timeout cannot exceed 10 minutes')
    }
  }

  return { valid: errors.length === 0, errors }
}
