/**
 * Container Executor - Executes containers with optimal resource allocation
 * Supports both serverless (ephemeral) and dedicated (persistent) modes
 */

import type { Address } from 'viem';
import type {
  ContainerImage,
  ContainerInstance,
  ContainerResources,
  ExecutionRequest,
  ExecutionResult,
  ExecutionMetrics,
  ComputePricing,
  LayerCache,
  WarmPoolStats,
} from './types';
import * as cache from './image-cache';
import * as warmPool from './warm-pool';

// ============================================================================
// Execution State
// ============================================================================

interface PendingExecution {
  executionId: string;
  request: ExecutionRequest;
  userAddress: Address;
  submittedAt: number;
  status: 'queued' | 'pulling' | 'starting' | 'running';
  instanceId?: string;
  startedAt?: number;
}

const executions = new Map<string, PendingExecution>();
const executionResults = new Map<string, ExecutionResult>();

// Default pricing
const pricing: ComputePricing = {
  basePerSecond: 1000000000n,
  cpuPerCoreSecond: 500000000n,
  memoryPerMbSecond: 100000000n,
  storagePerMbSecond: 10000000n,
  gpuPerSecond: 10000000000n,
  networkPerMb: 1000000000n,
  coldStartPenalty: 5000000000n,
};

// ============================================================================
// Image Resolution
// ============================================================================

interface ResolvedImage {
  image: ContainerImage;
  cached: boolean;
  pullRequired: boolean;
}

async function resolveImage(imageRef: string): Promise<ResolvedImage> {
  // Parse image reference: namespace/name:tag or @sha256:digest
  const [namespaceAndName, tagOrDigest] = imageRef.includes('@')
    ? [imageRef.split('@')[0], imageRef.split('@')[1]]
    : imageRef.includes(':')
    ? [imageRef.split(':')[0], imageRef.split(':')[1]]
    : [imageRef, 'latest'];

  const [namespace, name] = namespaceAndName?.includes('/')
    ? [namespaceAndName.split('/')[0], namespaceAndName.split('/').slice(1).join('/')]
    : ['library', namespaceAndName];

  // Check cache first
  const isDigest = tagOrDigest?.startsWith('sha256:');
  const cacheKey = isDigest ? tagOrDigest! : `${namespace}/${name}:${tagOrDigest}`;

  const cachedImage = cache.getCachedImage(cacheKey);
  if (cachedImage) {
    cache.recordCacheHit();
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
    };
  }

  cache.recordCacheMiss();

  // Would fetch from ContainerRegistry contract in production
  // For now, return a mock image that requires pull
  return {
    image: {
      repoId: crypto.randomUUID(),
      namespace: namespace ?? 'library',
      name: name ?? imageRef,
      tag: tagOrDigest ?? 'latest',
      digest: `sha256:${crypto.randomUUID().replace(/-/g, '')}`,
      manifestCid: `Qm${crypto.randomUUID().replace(/-/g, '').slice(0, 44)}`,
      layerCids: [],
      size: 100 * 1024 * 1024, // 100MB default
      architectures: ['amd64'],
      publishedAt: Date.now(),
    },
    cached: false,
    pullRequired: true,
  };
}

// ============================================================================
// Image Pulling (simulated)
// ============================================================================

async function pullImage(image: ContainerImage): Promise<number> {
  const startTime = Date.now();

  // Simulate layer downloads (in production, fetch from IPFS)
  const layerCount = Math.max(1, Math.floor(image.size / (30 * 1024 * 1024))); // ~30MB per layer

  const cachedLayers: LayerCache[] = [];
  for (let i = 0; i < layerCount; i++) {
    const layerDigest = `sha256:layer${i}-${image.digest.slice(7, 15)}`;
    const layerCid = `Qm${crypto.randomUUID().replace(/-/g, '').slice(0, 44)}`;
    const layerSize = Math.floor(image.size / layerCount);

    // Check if layer is already cached (deduplication)
    let cachedLayer = cache.getCachedLayer(layerDigest);
    if (!cachedLayer) {
      // Simulate download (fast for simulation)
      await new Promise((r) => setTimeout(r, 5));

      cachedLayer = cache.cacheLayer(
        layerDigest,
        layerCid,
        layerSize,
        `/var/cache/containers/layers/${layerDigest}`
      );
    }

    cachedLayers.push(cachedLayer);
  }

  // Cache the full image
  cache.cacheImage(image, cachedLayers);

  return Date.now() - startTime;
}

// ============================================================================
// Container Creation (simulated)
// ============================================================================

interface ContainerRuntime {
  create(instance: ContainerInstance, image: ContainerImage): Promise<{ endpoint: string; port: number }>;
  start(instanceId: string): Promise<void>;
  stop(instanceId: string): Promise<void>;
  exec(instanceId: string, command: string[], env: Record<string, string>, input?: unknown): Promise<{ output: unknown; exitCode: number; logs: string }>;
}

// Simulated container runtime
// In a real implementation, this would use Docker/containerd/Firecracker
const runtime: ContainerRuntime = {
  async create(_instance, _image) {
    // Simulate container creation: ~10-50ms (fast for simulation)
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
    
    return {
      endpoint: `http://localhost:${8000 + Math.floor(Math.random() * 1000)}`,
      port: 8000 + Math.floor(Math.random() * 1000),
    };
  },

  async start(_instanceId) {
    // Simulate container start
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 15));
  },

  async stop(_instanceId) {
    await new Promise((r) => setTimeout(r, 5));
  },

  async exec(_instanceId, command, _env, input) {
    // Simulate execution
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 45));

    return {
      output: { result: 'success', processed: input },
      exitCode: 0,
      logs: `[${new Date().toISOString()}] Executed command: ${command.join(' ')}`,
    };
  },
};

// ============================================================================
// Main Execution Functions
// ============================================================================

export async function executeContainer(
  request: ExecutionRequest,
  userAddress: Address
): Promise<ExecutionResult> {
  const executionId = crypto.randomUUID();
  const startTime = Date.now();

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
  };

  // Track execution
  const pending: PendingExecution = {
    executionId,
    request,
    userAddress,
    submittedAt: startTime,
    status: 'queued',
  };
  executions.set(executionId, pending);

  // 1. Resolve image
  const { image, pullRequired } = await resolveImage(request.imageRef);

  // 2. Pull image if needed
  if (pullRequired) {
    pending.status = 'pulling';
    metrics.pullTimeMs = await pullImage(image);
  }

  // 3. Try to get a warm instance (quick check, don't wait long)
  pending.status = 'starting';
  let instance = await warmPool.acquireWarmInstance(image.digest, 100);
  const coldStartStart = Date.now();

  if (!instance) {
    // Cold start required
    metrics.wasColdStart = true;

    // Create new instance
    const instanceId = crypto.randomUUID();
    instance = warmPool.addInstance(
      image.digest,
      instanceId,
      request.resources,
      userAddress,
      'local-node'
    );

    // Create and start container
    const { endpoint, port } = await runtime.create(instance, image);
    await runtime.start(instanceId);

    warmPool.updateInstanceState(image.digest, instanceId, 'running', {
      startedAt: Date.now(),
      endpoint,
      port,
    });
  }

  metrics.coldStartMs = Date.now() - coldStartStart;
  pending.instanceId = instance.instanceId;
  pending.status = 'running';
  pending.startedAt = Date.now();

  // 4. Execute
  const execStart = Date.now();
  const { output, exitCode, logs } = await runtime.exec(
    instance.instanceId,
    request.command ?? ['/entrypoint.sh'],
    request.env ?? {},
    request.input
  );
  metrics.executionTimeMs = Date.now() - execStart;

  // 5. Release instance
  const keepWarm = request.mode === 'serverless';
  warmPool.releaseInstance(image.digest, instance.instanceId, keepWarm);

  // 6. Calculate final metrics
  metrics.queueTimeMs = (pending.startedAt ?? startTime) - startTime - metrics.pullTimeMs;
  metrics.totalTimeMs = Date.now() - startTime;
  metrics.cpuUsagePercent = 30 + Math.random() * 40; // Simulated
  metrics.memoryUsedMb = Math.floor(request.resources.memoryMb * (0.3 + Math.random() * 0.4));

  // Build result
  const result: ExecutionResult = {
    executionId,
    instanceId: instance.instanceId,
    status: exitCode === 0 ? 'success' : 'failed',
    output,
    logs,
    exitCode,
    metrics,
  };

  // Store result and cleanup
  executionResults.set(executionId, result);
  executions.delete(executionId);

  return result;
}

// ============================================================================
// Batch Execution (for parallel processing)
// ============================================================================

export async function executeBatch(
  requests: ExecutionRequest[],
  userAddress: Address,
  concurrency: number = 5
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  const queue = [...requests];

  const workers = Array(Math.min(concurrency, requests.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const request = queue.shift();
        if (request) {
          const result = await executeContainer(request, userAddress);
          results.push(result);
        }
      }
    });

  await Promise.all(workers);
  return results;
}

// ============================================================================
// Execution Management
// ============================================================================

export function getExecution(executionId: string): PendingExecution | null {
  return executions.get(executionId) ?? null;
}

export function getExecutionResult(executionId: string): ExecutionResult | null {
  return executionResults.get(executionId) ?? null;
}

export function listExecutions(userAddress?: Address): PendingExecution[] {
  const all = [...executions.values()];
  if (userAddress) {
    return all.filter((e) => e.userAddress.toLowerCase() === userAddress.toLowerCase());
  }
  return all;
}

export function cancelExecution(executionId: string): boolean {
  const execution = executions.get(executionId);
  if (!execution || execution.status === 'running') return false;

  executions.delete(executionId);
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
  });

  return true;
}

// ============================================================================
// Cost Calculation
// ============================================================================

export function calculateCost(
  resources: ContainerResources,
  metrics: ExecutionMetrics
): bigint {
  const seconds = BigInt(Math.ceil(metrics.executionTimeMs / 1000));

  let cost = pricing.basePerSecond * seconds;
  cost += pricing.cpuPerCoreSecond * BigInt(resources.cpuCores) * seconds;
  cost += pricing.memoryPerMbSecond * BigInt(resources.memoryMb) * seconds;
  cost += pricing.storagePerMbSecond * BigInt(resources.storageMb) * seconds;

  if (resources.gpuCount) {
    cost += pricing.gpuPerSecond * BigInt(resources.gpuCount) * seconds;
  }

  const networkMb = BigInt(Math.ceil((metrics.networkInBytes + metrics.networkOutBytes) / (1024 * 1024)));
  cost += pricing.networkPerMb * networkMb;

  if (metrics.wasColdStart) {
    cost += pricing.coldStartPenalty;
  }

  return cost;
}

export function estimateCost(
  resources: ContainerResources,
  estimatedDurationMs: number,
  expectColdStart: boolean
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
  };

  return calculateCost(resources, metrics);
}

// ============================================================================
// Health & Stats
// ============================================================================

export interface ExecutorStats {
  pendingExecutions: number;
  completedExecutions: number;
  avgExecutionTimeMs: number;
  avgColdStartMs: number;
  coldStartRate: number;
  cacheStats: cache.CacheStats;
  poolStats: WarmPoolStats[];
}

export function getExecutorStats(): ExecutorStats {
  const completed = [...executionResults.values()];
  const withMetrics = completed.filter((r) => r.metrics);

  const avgExecutionTimeMs =
    withMetrics.length > 0
      ? withMetrics.reduce((sum, r) => sum + r.metrics.executionTimeMs, 0) / withMetrics.length
      : 0;

  const coldStarts = withMetrics.filter((r) => r.metrics.wasColdStart);
  const avgColdStartMs =
    coldStarts.length > 0
      ? coldStarts.reduce((sum, r) => sum + r.metrics.coldStartMs, 0) / coldStarts.length
      : 0;

  return {
    pendingExecutions: executions.size,
    completedExecutions: executionResults.size,
    avgExecutionTimeMs: Math.round(avgExecutionTimeMs),
    avgColdStartMs: Math.round(avgColdStartMs),
    coldStartRate: withMetrics.length > 0 ? Math.round((coldStarts.length / withMetrics.length) * 100) : 0,
    cacheStats: cache.getCacheStats(),
    poolStats: warmPool.getAllPoolStats(),
  };
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanup(): void {
  executions.clear();
  executionResults.clear();
  warmPool.cleanupAllPools();
  cache.clearCache();
}
