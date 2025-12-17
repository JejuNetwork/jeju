/**
 * Container Execution Module
 * Decentralized serverless container execution with warmth management
 */

// Types
export * from './types';

// Image Cache
export {
  getCachedLayer,
  cacheLayer,
  invalidateLayer,
  getCachedImage,
  cacheImage,
  invalidateImage,
  getCacheStats,
  recordCacheHit,
  recordCacheMiss,
  analyzeDeduplication,
  queuePrewarm,
  getPrewarmQueue,
  exportCache,
  clearCache,
  type CacheStats,
  type DeduplicationStats,
  type PrewarmRequest,
} from './image-cache';

// Warm Pool
export {
  getOrCreatePool,
  getPool,
  updatePoolConfig,
  addInstance,
  getInstance,
  updateInstanceState,
  removeInstance,
  acquireWarmInstance,
  releaseInstance,
  getPoolStats,
  getAllPoolStats,
  startCooldownManager,
  stopCooldownManager,
  prewarmInstances,
  cleanupPool,
  cleanupAllPools,
  onContainerEvent,
} from './warm-pool';

// Executor
import { cleanup as executorCleanup } from './executor';
export {
  executeContainer,
  executeBatch,
  getExecution,
  getExecutionResult,
  listExecutions,
  cancelExecution,
  calculateCost,
  estimateCost,
  getExecutorStats,
  type ExecutorStats,
} from './executor';
export const cleanupExecutor = executorCleanup;

// Scheduler
export {
  registerNode,
  updateNodeResources,
  updateNodeStatus,
  removeNode,
  getNode,
  getAllNodes,
  getNodesByRegion,
  checkNodeHealth,
  scheduleExecution,
  reserveResources,
  releaseReservation,
  cleanupExpiredReservations,
  findNearestRegion,
  getRegionsOrderedByDistance,
  getSchedulerStats,
  type SchedulingStrategy,
  type SchedulerStats,
} from './scheduler';

// ============================================================================
// High-Level API
// ============================================================================

import type { Address } from 'viem';
import type { ExecutionRequest, ExecutionResult, ComputeNode } from './types';
import * as executor from './executor';
import * as scheduler from './scheduler';
import * as warmPool from './warm-pool';
import * as cache from './image-cache';

/**
 * Initialize container execution system
 */
export function initializeContainerSystem(): void {
  warmPool.startCooldownManager();
  console.log('[Containers] System initialized');
}

/**
 * Execute a container with automatic scheduling and warmth management
 */
export async function runContainer(
  request: ExecutionRequest,
  userAddress: Address,
  _options?: {
    preferredRegion?: string;
    schedulingStrategy?: scheduler.SchedulingStrategy;
  }
): Promise<ExecutionResult> {
  // For now, execute locally (single-node mode)
  // In production, this would schedule to the best node
  return executor.executeContainer(request, userAddress);
}

/**
 * Pre-warm containers for expected traffic
 */
export async function warmContainers(
  imageRef: string,
  _count: number,
  _resources: ExecutionRequest['resources'],
  _owner: Address
): Promise<void> {
  // Queue for pre-warming
  cache.queuePrewarm({
    imageDigests: [imageRef],
    priority: 'high',
  });
}

/**
 * Get system-wide statistics
 */
export function getSystemStats(): {
  executor: executor.ExecutorStats;
  scheduler: scheduler.SchedulerStats;
  cache: cache.CacheStats;
} {
  return {
    executor: executor.getExecutorStats(),
    scheduler: scheduler.getSchedulerStats(),
    cache: cache.getCacheStats(),
  };
}

/**
 * Register a compute node
 */
export function addComputeNode(node: ComputeNode): void {
  scheduler.registerNode(node);
  console.log(`[Containers] Node registered: ${node.nodeId} in ${node.region}`);
}

/**
 * Cleanup all resources
 */
export function shutdownContainerSystem(): void {
  warmPool.stopCooldownManager();
  warmPool.cleanupAllPools();
  executor.cleanup();
  console.log('[Containers] System shutdown complete');
}
