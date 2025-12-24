/**
 * Container Execution Module
 * Decentralized serverless container execution with warmth management
 */

// Image Cache
export {
  analyzeDeduplication,
  type CacheStats,
  cacheImage,
  cacheLayer,
  clearCache,
  type DeduplicationStats,
  exportCache,
  getCachedImage,
  getCachedLayer,
  getCacheStats,
  getPrewarmQueue,
  invalidateImage,
  invalidateLayer,
  type PrewarmRequest,
  queuePrewarm,
  recordCacheHit,
  recordCacheMiss,
} from './image-cache'
// Types
export * from './types'

// Warm Pool
export {
  acquireWarmInstance,
  addInstance,
  cleanupAllPools,
  cleanupPool,
  getAllPoolStats,
  getInstance,
  getOrCreatePool,
  getPool,
  getPoolStats,
  onContainerEvent,
  prewarmInstances,
  releaseInstance,
  removeInstance,
  startCooldownManager,
  stopCooldownManager,
  updateInstanceState,
  updatePoolConfig,
} from './warm-pool'

// Executor
import { cleanup as executorCleanup } from './executor'

export {
  calculateCost,
  cancelExecution,
  type ExecutorStats,
  estimateCost,
  executeBatch,
  executeContainer,
  getExecution,
  getExecutionResult,
  getExecutorStats,
  listExecutions,
} from './executor'
export const cleanupExecutor = executorCleanup

// Scheduler
export {
  checkNodeHealth,
  cleanupExpiredReservations,
  findNearestRegion,
  getAllNodes,
  getNode,
  getNodesByRegion,
  getRegionsOrderedByDistance,
  getSchedulerStats,
  registerNode,
  releaseReservation,
  removeNode,
  reserveResources,
  type SchedulerStats,
  type SchedulingStrategy,
  scheduleExecution,
  updateNodeResources,
  updateNodeStatus,
} from './scheduler'

// TEE GPU Provider
export {
  type CreateTEEGPUProviderConfig,
  createTEEGPUProvider,
  GPU_SPECS,
  type GPUCapabilities,
  GPUType,
  getAvailableGPUNodes,
  getTEEGPUNode,
  getTEEGPUNodes,
  type TEEAttestation,
  type TEEGPUNode,
  type TEEGPUNodeConfig,
  TEEGPUProvider,
  TEEProvider,
} from './tee-gpu-provider'

// High-Level API

import type { Address } from 'viem'
import * as executor from './executor'
import * as cache from './image-cache'
import * as scheduler from './scheduler'
import type { ComputeNode, ExecutionRequest, ExecutionResult } from './types'
import * as warmPool from './warm-pool'

/**
 * Initialize container execution system
 */
export function initializeContainerSystem(): void {
  warmPool.startCooldownManager()
  console.log('[Containers] System initialized')
}

/**
 * Execute a container with automatic scheduling and warmth management
 */
export async function runContainer(
  request: ExecutionRequest,
  userAddress: Address,
  _options?: {
    preferredRegion?: string
    schedulingStrategy?: scheduler.SchedulingStrategy
  },
): Promise<ExecutionResult> {
  // For now, execute locally (single-node mode)
  // In production, this would schedule to the best node
  return executor.executeContainer(request, userAddress)
}

/**
 * Pre-warm containers for expected traffic
 */
export async function warmContainers(
  imageRef: string,
  _count: number,
  _resources: ExecutionRequest['resources'],
  _owner: Address,
): Promise<void> {
  // Queue for pre-warming
  cache.queuePrewarm({
    imageDigests: [imageRef],
    priority: 'high',
  })
}

/**
 * Get system-wide statistics
 */
export function getSystemStats(): {
  executor: executor.ExecutorStats
  scheduler: scheduler.SchedulerStats
  cache: cache.CacheStats
} {
  return {
    executor: executor.getExecutorStats(),
    scheduler: scheduler.getSchedulerStats(),
    cache: cache.getCacheStats(),
  }
}

/**
 * Register a compute node
 */
export function addComputeNode(node: ComputeNode): void {
  scheduler.registerNode(node)
  console.log(`[Containers] Node registered: ${node.nodeId} in ${node.region}`)
}

/**
 * Cleanup all resources
 */
export function shutdownContainerSystem(): void {
  warmPool.stopCooldownManager()
  warmPool.cleanupAllPools()
  executor.cleanup()
  console.log('[Containers] System shutdown complete')
}
