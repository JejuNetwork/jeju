/**
 * Container Executor - Executes containers with optimal resource allocation
 * Supports both serverless (ephemeral) and dedicated (persistent) modes
 */

import { getRpcUrl } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import type { Address, PublicClient } from 'viem'
import { createPublicClient, http } from 'viem'
import { z } from 'zod'
import type { JSONValue } from '../shared/validation'
import {
  DockerCreateResponseSchema,
  DockerExecCreateResponseSchema,
  DockerExecInspectSchema,
  type DockerNetworkSettings,
  DockerNetworkSettingsSchema,
} from '../types'
import * as cache from './image-cache'
import type {
  ComputePricing,
  ContainerImage,
  ContainerInstance,
  ContainerResources,
  ExecutionMetrics,
  ExecutionRequest,
  ExecutionResult,
  LayerCache,
  WarmPoolStats,
} from './types'
import * as warmPool from './warm-pool'

// Contract configuration
const CONTAINER_REGISTRY_ADDRESS = process.env.CONTAINER_REGISTRY_ADDRESS as
  | Address
  | undefined
const RPC_URL = process.env.RPC_URL || getRpcUrl()

// Container Registry ABI (minimal)
const CONTAINER_REGISTRY_ABI = [
  {
    name: 'getRepoByName',
    type: 'function',
    inputs: [
      { name: 'namespace', type: 'string' },
      { name: 'name', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'namespace', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'ownerAgentId', type: 'uint256' },
          { name: 'description', type: 'string' },
          { name: 'visibility', type: 'uint8' },
          { name: 'tags', type: 'string[]' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'pullCount', type: 'uint256' },
          { name: 'starCount', type: 'uint256' },
          { name: 'isVerified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getManifestByTag',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'manifestId', type: 'bytes32' },
          { name: 'repoId', type: 'bytes32' },
          { name: 'tag', type: 'string' },
          { name: 'digest', type: 'string' },
          { name: 'manifestUri', type: 'string' },
          { name: 'manifestHash', type: 'bytes32' },
          { name: 'size', type: 'uint256' },
          { name: 'architectures', type: 'string[]' },
          { name: 'layers', type: 'string[]' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'publisher', type: 'address' },
          { name: 'buildInfo', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

let publicClient: PublicClient | null = null

function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({ transport: http(RPC_URL) })
  }
  return publicClient
}

// Execution State

interface PendingExecution {
  executionId: string
  request: ExecutionRequest
  userAddress: Address
  submittedAt: number
  status: 'queued' | 'pulling' | 'starting' | 'running'
  instanceId?: string
  startedAt?: number
}

const executions = new Map<string, PendingExecution>()
const executionResults = new Map<string, ExecutionResult>()

// Default pricing
const pricing: ComputePricing = {
  basePerSecond: 1000000000n,
  cpuPerCoreSecond: 500000000n,
  memoryPerMbSecond: 100000000n,
  storagePerMbSecond: 10000000n,
  gpuPerSecond: 10000000000n,
  networkPerMb: 1000000000n,
  coldStartPenalty: 5000000000n,
}

// Image Resolution

interface ResolvedImage {
  image: ContainerImage
  cached: boolean
  pullRequired: boolean
}

async function resolveImage(imageRef: string): Promise<ResolvedImage> {
  // Parse image reference: namespace/name:tag or @sha256:digest
  const [namespaceAndName, tagOrDigest] = imageRef.includes('@')
    ? [imageRef.split('@')[0], imageRef.split('@')[1]]
    : imageRef.includes(':')
      ? [imageRef.split(':')[0], imageRef.split(':')[1]]
      : [imageRef, 'latest']

  const [namespace, name] = namespaceAndName?.includes('/')
    ? [
        namespaceAndName.split('/')[0],
        namespaceAndName.split('/').slice(1).join('/'),
      ]
    : ['library', namespaceAndName]

  // Check cache first
  const isDigest = tagOrDigest?.startsWith('sha256:')
  const cacheKey = isDigest
    ? tagOrDigest
    : `${namespace}/${name}:${tagOrDigest}`

  const cachedImage = cache.getCachedImage(cacheKey)
  if (cachedImage) {
    cache.recordCacheHit()
    return {
      image: {
        repoId: cachedImage.repoId,
        namespace: namespace ?? 'library',
        name: name ?? imageRef,
        tag: tagOrDigest ?? 'latest',
        digest: cachedImage.digest,
        manifestCid: '', // From cached data
        layerCids: cachedImage.layers.map((l) => l.cid),
        size: cachedImage.totalSize,
        architectures: ['amd64'],
        publishedAt: cachedImage.cachedAt,
      },
      cached: true,
      pullRequired: false,
    }
  }

  cache.recordCacheMiss()

  // Fetch from ContainerRegistry contract
  if (!CONTAINER_REGISTRY_ADDRESS) {
    throw new Error(
      'CONTAINER_REGISTRY_ADDRESS not configured - cannot resolve image',
    )
  }

  const client = getPublicClient()

  // Get repository
  const repo = await client.readContract({
    address: CONTAINER_REGISTRY_ADDRESS,
    abi: CONTAINER_REGISTRY_ABI,
    functionName: 'getRepoByName',
    args: [namespace ?? 'library', name ?? imageRef],
  })

  if (
    !repo ||
    repo.repoId ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    throw new Error(`Image not found: ${namespace}/${name}`)
  }

  // Get manifest for tag
  const manifest = await client.readContract({
    address: CONTAINER_REGISTRY_ADDRESS,
    abi: CONTAINER_REGISTRY_ABI,
    functionName: 'getManifestByTag',
    args: [repo.repoId, tagOrDigest ?? 'latest'],
  })

  if (
    !manifest ||
    manifest.manifestId ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    throw new Error(
      `Tag not found: ${tagOrDigest ?? 'latest'} in ${namespace}/${name}`,
    )
  }

  return {
    image: {
      repoId: repo.repoId,
      namespace: repo.namespace,
      name: repo.name,
      tag: manifest.tag,
      digest: manifest.digest,
      manifestCid: manifest.manifestUri,
      layerCids: [...manifest.layers],
      size: Number(manifest.size),
      architectures: [...manifest.architectures],
      publishedAt: Number(manifest.publishedAt),
    },
    cached: false,
    pullRequired: true,
  }
}

// Image Pulling

const STORAGE_ENDPOINT =
  process.env.DWS_STORAGE_URL || 'http://localhost:4030/storage'

async function pullImage(image: ContainerImage): Promise<number> {
  const startTime = Date.now()

  // Fetch layers from IPFS via storage endpoint
  const cachedLayers: LayerCache[] = []

  for (const layerCid of image.layerCids) {
    // Check if layer is already cached (deduplication)
    let cachedLayer = cache.getCachedLayer(layerCid)
    if (!cachedLayer) {
      // Fetch layer from storage
      const response = await fetch(`${STORAGE_ENDPOINT}/download/${layerCid}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch layer ${layerCid}: ${response.status}`)
      }

      const layerData = await response.arrayBuffer()
      const layerSize = layerData.byteLength

      cachedLayer = cache.cacheLayer(
        layerCid,
        layerCid,
        layerSize,
        `/var/cache/containers/layers/${layerCid}`,
      )
    }

    cachedLayers.push(cachedLayer)
  }

  // Cache the full image
  cache.cacheImage(image, cachedLayers)

  return Date.now() - startTime
}

// Container Runtime

interface ContainerRuntime {
  create(
    instance: ContainerInstance,
    image: ContainerImage,
    request: ExecutionRequest,
  ): Promise<{ endpoint: string; port: number }>
  start(instanceId: string): Promise<void>
  stop(instanceId: string): Promise<void>
  exec(
    instanceId: string,
    command: string[],
    env: Record<string, string>,
    input?: JSONValue,
  ): Promise<{ output: JSONValue; exitCode: number; logs: string }>
}

// Container runtime using Docker HTTP API
const DOCKER_HOST = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock'
const DOCKER_API_URL = DOCKER_HOST.startsWith('unix://')
  ? 'http://localhost' // Unix socket will be handled separately
  : DOCKER_HOST

async function dockerRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${DOCKER_API_URL}${path}`

  if (DOCKER_HOST.startsWith('unix://')) {
    // For unix sockets, use Bun's native fetch with unix socket
    return fetch(url, {
      ...options,
      unix: DOCKER_HOST.replace('unix://', ''),
    } as RequestInit)
  }

  return fetch(url, options)
}

const runtime: ContainerRuntime = {
  async create(instance, image, request) {
    const containerConfig = {
      Image: `${image.namespace}/${image.name}:${image.tag}`,
      Cmd: request.command ?? [],
      Env: Object.entries(request.env ?? {}).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        Memory: instance.resources.memoryMb * 1024 * 1024,
        NanoCpus: instance.resources.cpuCores * 1e9,
        PortBindings: {
          '8080/tcp': [{ HostPort: '0' }], // Dynamic port assignment
        },
      },
      ExposedPorts: {
        '8080/tcp': {},
      },
      Labels: {
        'dws.instance.id': instance.instanceId,
      },
    }

    const createResponse = await dockerRequest('/v1.44/containers/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerConfig),
    })

    if (!createResponse.ok) {
      const error = await createResponse.text()
      throw new Error(`Failed to create container: ${error}`)
    }

    const { Id: containerId } = expectValid(
      DockerCreateResponseSchema,
      await createResponse.json(),
      'Docker create response',
    )

    // Start the container
    const startResponse = await dockerRequest(
      `/v1.44/containers/${containerId}/start`,
      {
        method: 'POST',
      },
    )

    if (!startResponse.ok) {
      throw new Error(
        `Failed to start container: ${await startResponse.text()}`,
      )
    }

    // Get the assigned port
    const inspectResponse = await dockerRequest(
      `/v1.44/containers/${containerId}/json`,
    )
    const inspectData = DockerNetworkSettingsSchema.parse(
      await inspectResponse.json(),
    ) as DockerNetworkSettings

    const portBindings = inspectData.NetworkSettings.Ports['8080/tcp']
    if (!portBindings?.[0]) {
      throw new Error('Container port binding not found')
    }
    const hostPort = parseInt(portBindings[0].HostPort, 10)

    return {
      endpoint: `http://localhost:${hostPort}`,
      port: hostPort,
    }
  },

  async start(instanceId) {
    const response = await dockerRequest(
      `/v1.44/containers/${instanceId}/start`,
      {
        method: 'POST',
      },
    )
    if (!response.ok) {
      throw new Error(`Failed to start container: ${await response.text()}`)
    }
  },

  async stop(instanceId) {
    const response = await dockerRequest(
      `/v1.44/containers/${instanceId}/stop`,
      {
        method: 'POST',
      },
    )
    if (!response.ok && response.status !== 304) {
      // 304 = already stopped
      throw new Error(`Failed to stop container: ${await response.text()}`)
    }
  },

  async exec(instanceId, command, env, input) {
    // Create exec instance
    const execConfig = {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: command,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    }

    const createExecResponse = await dockerRequest(
      `/v1.44/containers/${instanceId}/exec`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(execConfig),
      },
    )

    if (!createExecResponse.ok) {
      throw new Error(
        `Failed to create exec: ${await createExecResponse.text()}`,
      )
    }

    const { Id: execId } = DockerExecCreateResponseSchema.parse(
      await createExecResponse.json(),
    )

    // Start exec with detach=false to get output
    const startExecResponse = await dockerRequest(
      `/v1.44/exec/${execId}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Detach: false }),
      },
    )

    if (!startExecResponse.ok) {
      throw new Error(`Failed to start exec: ${await startExecResponse.text()}`)
    }

    const logs = await startExecResponse.text()

    // Get exec info for exit code
    const inspectExecResponse = await dockerRequest(
      `/v1.44/exec/${execId}/json`,
    )
    const execInfo = DockerExecInspectSchema.parse(
      await inspectExecResponse.json(),
    )

    const execOutput: JSONValue =
      input !== undefined
        ? { result: 'processed', input }
        : { result: 'success' }
    return {
      output: execOutput,
      exitCode: execInfo.ExitCode,
      logs,
    }
  },
}

// Container Stats

interface ContainerStats {
  cpuPercent: number
  memoryUsedMb: number
}

const ContainerStatsResponseSchema = z.object({
  cpu_stats: z.object({
    cpu_usage: z.object({
      total_usage: z.number(),
    }),
    system_cpu_usage: z.number().optional(),
    online_cpus: z.number().optional(),
  }),
  precpu_stats: z.object({
    cpu_usage: z.object({
      total_usage: z.number(),
    }),
    system_cpu_usage: z.number().optional(),
  }),
  memory_stats: z.object({
    usage: z.number(),
    limit: z.number(),
  }),
})

async function getContainerStats(instanceId: string): Promise<ContainerStats> {
  const response = await dockerRequest(
    `/v1.44/containers/${instanceId}/stats?stream=false`,
  )

  if (!response.ok) {
    // Return zeros if stats unavailable
    return { cpuPercent: 0, memoryUsedMb: 0 }
  }

  const data = ContainerStatsResponseSchema.parse(await response.json())

  // Calculate CPU percentage
  const cpuDelta =
    data.cpu_stats.cpu_usage.total_usage -
    data.precpu_stats.cpu_usage.total_usage
  const systemDelta =
    (data.cpu_stats.system_cpu_usage ?? 0) -
    (data.precpu_stats.system_cpu_usage ?? 0)
  const cpuCount = data.cpu_stats.online_cpus ?? 1

  let cpuPercent = 0
  if (systemDelta > 0 && cpuDelta > 0) {
    cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100
  }

  // Calculate memory in MB
  const memoryUsedMb = Math.round(data.memory_stats.usage / (1024 * 1024))

  return { cpuPercent: Math.round(cpuPercent), memoryUsedMb }
}

// Main Execution Functions

export async function executeContainer(
  request: ExecutionRequest,
  userAddress: Address,
): Promise<ExecutionResult> {
  const executionId = crypto.randomUUID()
  const startTime = Date.now()

  // Initialize metrics
  const metrics: ExecutionMetrics = {
    queueTimeMs: 0,
    pullTimeMs: 0,
    coldStartMs: 0,
    executionTimeMs: 0,
    totalTimeMs: 0,
    cpuUsagePercent: 0,
    memoryUsedMb: 0,
    networkInBytes: 0,
    networkOutBytes: 0,
    wasColdStart: false,
  }

  // Track execution
  const pending: PendingExecution = {
    executionId,
    request,
    userAddress,
    submittedAt: startTime,
    status: 'queued',
  }
  executions.set(executionId, pending)

  // 1. Resolve image
  const { image, pullRequired } = await resolveImage(request.imageRef)

  // 2. Pull image if needed
  if (pullRequired) {
    pending.status = 'pulling'
    metrics.pullTimeMs = await pullImage(image)
  }

  // 3. Try to get a warm instance (quick check, don't wait long)
  pending.status = 'starting'
  let instance = await warmPool.acquireWarmInstance(image.digest, 100)
  const coldStartStart = Date.now()

  if (!instance) {
    // Cold start required
    metrics.wasColdStart = true

    // Create new instance
    const instanceId = crypto.randomUUID()
    instance = warmPool.addInstance(
      image.digest,
      instanceId,
      request.resources,
      userAddress,
      'local-node',
    )

    // Create and start container
    const { endpoint, port } = await runtime.create(instance, image, request)
    await runtime.start(instanceId)

    warmPool.updateInstanceState(image.digest, instanceId, 'running', {
      startedAt: Date.now(),
      endpoint,
      port,
    })
  }

  metrics.coldStartMs = Date.now() - coldStartStart
  pending.instanceId = instance.instanceId
  pending.status = 'running'
  pending.startedAt = Date.now()

  // 4. Execute
  const execStart = Date.now()
  const { output, exitCode, logs } = await runtime.exec(
    instance.instanceId,
    request.command ?? ['/entrypoint.sh'],
    request.env ?? {},
    request.input,
  )
  metrics.executionTimeMs = Date.now() - execStart

  // 5. Release instance
  const keepWarm = request.mode === 'serverless'
  warmPool.releaseInstance(image.digest, instance.instanceId, keepWarm)

  // 6. Calculate final metrics
  metrics.queueTimeMs =
    (pending.startedAt ?? startTime) - startTime - metrics.pullTimeMs
  metrics.totalTimeMs = Date.now() - startTime

  // Get real container stats from Docker
  const containerStats = await getContainerStats(instance.instanceId)
  metrics.cpuUsagePercent = containerStats.cpuPercent
  metrics.memoryUsedMb = containerStats.memoryUsedMb

  // Build result
  const result: ExecutionResult = {
    executionId,
    instanceId: instance.instanceId,
    status: exitCode === 0 ? 'success' : 'failed',
    output,
    logs,
    exitCode,
    metrics,
  }

  // Store result and cleanup
  executionResults.set(executionId, result)
  executions.delete(executionId)

  return result
}

// Batch Execution (for parallel processing)

export async function executeBatch(
  requests: ExecutionRequest[],
  userAddress: Address,
  concurrency: number = 5,
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = []
  const queue = [...requests]

  const workers = Array(Math.min(concurrency, requests.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const request = queue.shift()
        if (request) {
          const result = await executeContainer(request, userAddress)
          results.push(result)
        }
      }
    })

  await Promise.all(workers)
  return results
}

// Execution Management

export function getExecution(executionId: string): PendingExecution | null {
  return executions.get(executionId) ?? null
}

export function getExecutionResult(
  executionId: string,
): ExecutionResult | null {
  return executionResults.get(executionId) ?? null
}

export function listExecutions(userAddress?: Address): PendingExecution[] {
  const all = [...executions.values()]
  if (userAddress) {
    return all.filter(
      (e) => e.userAddress.toLowerCase() === userAddress.toLowerCase(),
    )
  }
  return all
}

export function cancelExecution(executionId: string): boolean {
  const execution = executions.get(executionId)
  if (!execution || execution.status === 'running') return false

  executions.delete(executionId)
  executionResults.set(executionId, {
    executionId,
    instanceId: execution.instanceId ?? '',
    status: 'cancelled',
    output: null,
    exitCode: null,
    metrics: {
      queueTimeMs: Date.now() - execution.submittedAt,
      pullTimeMs: 0,
      coldStartMs: 0,
      executionTimeMs: 0,
      totalTimeMs: Date.now() - execution.submittedAt,
      cpuUsagePercent: 0,
      memoryUsedMb: 0,
      networkInBytes: 0,
      networkOutBytes: 0,
      wasColdStart: false,
    },
  })

  return true
}

// Cost Calculation

export function calculateCost(
  resources: ContainerResources,
  metrics: ExecutionMetrics,
): bigint {
  const seconds = BigInt(Math.ceil(metrics.executionTimeMs / 1000))

  let cost = pricing.basePerSecond * seconds
  cost += pricing.cpuPerCoreSecond * BigInt(resources.cpuCores) * seconds
  cost += pricing.memoryPerMbSecond * BigInt(resources.memoryMb) * seconds
  cost += pricing.storagePerMbSecond * BigInt(resources.storageMb) * seconds

  if (resources.gpuCount) {
    cost += pricing.gpuPerSecond * BigInt(resources.gpuCount) * seconds
  }

  const networkMb = BigInt(
    Math.ceil(
      (metrics.networkInBytes + metrics.networkOutBytes) / (1024 * 1024),
    ),
  )
  cost += pricing.networkPerMb * networkMb

  if (metrics.wasColdStart) {
    cost += pricing.coldStartPenalty
  }

  return cost
}

export function estimateCost(
  resources: ContainerResources,
  estimatedDurationMs: number,
  expectColdStart: boolean,
): bigint {
  const metrics: ExecutionMetrics = {
    queueTimeMs: 0,
    pullTimeMs: 0,
    coldStartMs: 0,
    executionTimeMs: estimatedDurationMs,
    totalTimeMs: estimatedDurationMs,
    cpuUsagePercent: 50,
    memoryUsedMb: resources.memoryMb,
    networkInBytes: 10 * 1024 * 1024, // Estimate 10MB
    networkOutBytes: 10 * 1024 * 1024,
    wasColdStart: expectColdStart,
  }

  return calculateCost(resources, metrics)
}

// Health & Stats

export interface ExecutorStats {
  pendingExecutions: number
  completedExecutions: number
  avgExecutionTimeMs: number
  avgColdStartMs: number
  coldStartRate: number
  cacheStats: cache.CacheStats
  poolStats: WarmPoolStats[]
}

export function getExecutorStats(): ExecutorStats {
  const completed = [...executionResults.values()]
  const withMetrics = completed.filter((r) => r.metrics)

  const avgExecutionTimeMs =
    withMetrics.length > 0
      ? withMetrics.reduce((sum, r) => sum + r.metrics.executionTimeMs, 0) /
        withMetrics.length
      : 0

  const coldStarts = withMetrics.filter((r) => r.metrics.wasColdStart)
  const avgColdStartMs =
    coldStarts.length > 0
      ? coldStarts.reduce((sum, r) => sum + r.metrics.coldStartMs, 0) /
        coldStarts.length
      : 0

  return {
    pendingExecutions: executions.size,
    completedExecutions: executionResults.size,
    avgExecutionTimeMs: Math.round(avgExecutionTimeMs),
    avgColdStartMs: Math.round(avgColdStartMs),
    coldStartRate:
      withMetrics.length > 0
        ? Math.round((coldStarts.length / withMetrics.length) * 100)
        : 0,
    cacheStats: cache.getCacheStats(),
    poolStats: warmPool.getAllPoolStats(),
  }
}

// Cleanup

export function cleanup(): void {
  executions.clear()
  executionResults.clear()
  warmPool.cleanupAllPools()
  cache.clearCache()
}
