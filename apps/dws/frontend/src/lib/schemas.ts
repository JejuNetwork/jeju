/**
 * Zod Schemas for DWS API Responses
 * Provides runtime validation for all API responses
 */

import { z } from 'zod'

// Base types
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

// Health schemas
export const serviceHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  service: z.string(),
  version: z.string(),
  uptime: z.number(),
})

export const dwsHealthSchema = z.object({
  status: z.string(),
  service: z.string(),
  version: z.string(),
  uptime: z.number(),
  decentralized: z.object({
    identityRegistry: addressSchema,
    registeredNodes: z.number(),
    connectedPeers: z.number(),
    frontendCid: z.string(),
    p2pEnabled: z.boolean(),
  }),
  services: z.record(z.string(), z.object({ status: z.string() })),
  backends: z.object({
    available: z.array(z.string()),
    health: z.record(z.string(), z.boolean()),
  }),
})

export const storageHealthSchema = z.object({
  service: z.string(),
  status: z.string(),
  backends: z.array(z.string()),
})

export const cdnStatsSchema = z.object({
  entries: z.number(),
  sizeBytes: z.number(),
  maxSizeBytes: z.number(),
  hitRate: z.number(),
})

// Compute schemas
export const computeJobSchema = z.object({
  jobId: z.string(),
  command: z.string(),
  shell: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  output: z.string(),
  exitCode: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  duration: z.number().nullable(),
})

export const computeJobsResponseSchema = z.object({
  jobs: z.array(computeJobSchema),
  total: z.number(),
})

export const submitJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
})

export const inferenceResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ),
  usage: z.object({ total_tokens: z.number() }),
})

export const embeddingsResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })),
  model: z.string(),
  usage: z.object({ total_tokens: z.number() }),
})

export const trainingRunSchema = z.object({
  runId: z.string(),
  model: z.string(),
  state: z.number(),
  clients: z.number(),
  step: z.number(),
  totalSteps: z.number(),
  createdAt: z.number(),
})

export const computeNodeSchema = z.object({
  id: z.string(),
  address: addressSchema,
  region: z.string(),
  zone: z.string(),
  status: z.enum(['online', 'offline', 'maintenance']),
  resources: z.object({
    totalCpu: z.number(),
    availableCpu: z.number(),
    totalMemoryMb: z.number(),
    availableMemoryMb: z.number(),
  }),
  containers: z.number(),
  cachedImages: z.number(),
  reputation: z.number(),
  lastHeartbeat: z.number(),
})

export const registerNodeResponseSchema = z.object({
  nodeId: z.string(),
  status: z.string(),
})

// Container schemas
export const containerSchema = z.object({
  executionId: z.string(),
  instanceId: z.string(),
  image: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  submittedAt: z.number(),
  startedAt: z.number().nullable(),
  metrics: z
    .object({
      durationMs: z.number(),
      wasColdStart: z.boolean(),
      cpuUsed: z.number(),
      memoryUsedMb: z.number(),
    })
    .optional(),
})

export const containersResponseSchema = z.object({
  executions: z.array(containerSchema),
})

// Worker schemas
export const workerFunctionSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: addressSchema,
  runtime: z.enum(['bun', 'node', 'deno']),
  handler: z.string(),
  codeCid: z.string(),
  memory: z.number(),
  timeout: z.number(),
  status: z.enum(['active', 'inactive']),
  version: z.number(),
  invocationCount: z.number(),
  avgDurationMs: z.number(),
  errorCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const workersResponseSchema = z.object({
  functions: z.array(workerFunctionSchema),
})

// Storage schemas
export const uploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  contentType: z.string().optional(),
})

// Git schemas
export const repositorySchema = z.object({
  repoId: z.string(),
  owner: addressSchema,
  name: z.string(),
  description: z.string(),
  visibility: z.enum(['public', 'private']),
  starCount: z.number(),
  forkCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean(),
  cloneUrl: z.string(),
})

export const repositoriesResponseSchema = z.object({
  repositories: z.array(repositorySchema),
  total: z.number(),
})

// Package schemas
export const packageSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  owner: addressSchema,
  description: z.string(),
  downloads: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  cid: z.string(),
})

export const packagesResponseSchema = z.object({
  packages: z.array(packageSchema),
  total: z.number(),
})

// CI schemas
export const ciStepSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'skipped']),
  durationMs: z.number().nullable(),
  output: z.string(),
})

export const ciPipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  repoId: z.string(),
  status: z.enum(['pending', 'running', 'success', 'failed']),
  triggeredAt: z.number(),
  completedAt: z.number().nullable(),
  steps: z.array(ciStepSchema),
})

export const pipelinesResponseSchema = z.object({
  pipelines: z.array(ciPipelineSchema),
})

// KMS schemas
export const kmsKeySchema = z.object({
  keyId: z.string(),
  publicKey: z.string(),
  address: addressSchema,
  threshold: z.number(),
  totalParties: z.number(),
  version: z.number(),
  createdAt: z.number(),
})

export const kmsKeysResponseSchema = z.object({
  keys: z.array(kmsKeySchema),
})

export const secretSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().nullable(),
})

export const secretsResponseSchema = z.object({
  secrets: z.array(secretSchema),
})

// RPC schemas
export const rpcChainSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  network: z.string(),
  symbol: z.string(),
  explorerUrl: z.string(),
  isTestnet: z.boolean(),
  providers: z.number(),
  avgLatency: z.number().nullable(),
})

export const rpcChainsResponseSchema = z.object({
  chains: z.array(rpcChainSchema),
})

export const rpcKeyResponseSchema = z.object({
  apiKey: z.string(),
  tier: z.string(),
  limits: z.object({
    rps: z.number(),
    daily: z.number(),
  }),
})

// VPN schemas
export const vpnRegionSchema = z.object({
  code: z.string(),
  name: z.string(),
  country: z.string(),
  nodeCount: z.number(),
})

export const vpnRegionsResponseSchema = z.object({
  regions: z.array(vpnRegionSchema),
})

export const vpnSessionSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['active', 'expired', 'terminated']),
  startedAt: z.number(),
  expiresAt: z.number(),
  bytesTransferred: z.number(),
  requestCount: z.number(),
  proxy: z.object({
    host: z.string(),
    port: z.number(),
    protocol: z.string(),
    region: z.string(),
    country: z.string(),
  }),
})

// API Marketplace schemas
export const apiProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  categories: z.array(z.string()),
  defaultPricePerRequest: z.string(),
  supportsStreaming: z.boolean(),
  configured: z.boolean(),
})

export const apiProvidersResponseSchema = z.object({
  providers: z.array(apiProviderSchema),
})

export const apiListingSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  seller: addressSchema,
  pricePerRequest: z.string(),
  active: z.boolean(),
  totalRequests: z.string(),
  totalRevenue: z.string(),
  rating: z.number(),
  createdAt: z.number(),
})

export const apiListingsResponseSchema = z.object({
  listings: z.array(apiListingSchema),
})

export const createListingResponseSchema = z.object({
  listing: apiListingSchema,
})

export const userAccountSchema = z.object({
  address: addressSchema,
  balance: z.string(),
  totalSpent: z.string(),
  totalRequests: z.string(),
  tier: z.enum(['free', 'standard', 'premium']),
  agentId: z.number().nullable(),
  isBanned: z.boolean(),
})

export const depositResponseSchema = z.object({
  success: z.boolean(),
  newBalance: z.string(),
})

// Edge nodes schema
export const edgeNodeSchema = z.object({
  id: z.string(),
  region: z.string(),
  status: z.enum(['online', 'offline', 'maintenance']),
})

export const edgeNodesResponseSchema = z.object({
  nodes: z.array(edgeNodeSchema),
})

// Export type inferences
export type DWSHealth = z.infer<typeof dwsHealthSchema>
export type StorageHealth = z.infer<typeof storageHealthSchema>
export type CDNStats = z.infer<typeof cdnStatsSchema>
export type ComputeJob = z.infer<typeof computeJobSchema>
export type ComputeNode = z.infer<typeof computeNodeSchema>
export type Container = z.infer<typeof containerSchema>
export type WorkerFunction = z.infer<typeof workerFunctionSchema>
export type Repository = z.infer<typeof repositorySchema>
export type Package = z.infer<typeof packageSchema>
export type CIPipeline = z.infer<typeof ciPipelineSchema>
export type KMSKey = z.infer<typeof kmsKeySchema>
export type Secret = z.infer<typeof secretSchema>
export type RPCChain = z.infer<typeof rpcChainSchema>
export type VPNSession = z.infer<typeof vpnSessionSchema>
export type APIProvider = z.infer<typeof apiProviderSchema>
export type APIListing = z.infer<typeof apiListingSchema>
export type UserAccount = z.infer<typeof userAccountSchema>
export type TrainingRun = z.infer<typeof trainingRunSchema>
