/**
 * Container Execution Module
 * Decentralized serverless container execution with warmth management
 */

// Executor - public API
export {
  cancelExecution,
  type ExecutorStats,
  estimateCost,
  getExecution,
  getExecutionResult,
  getExecutorStats,
  listExecutions,
} from './executor'

// Image Cache - minimal public API
export {
  analyzeDeduplication,
  type CacheStats,
  getCacheStats,
} from './image-cache'
// Scheduler - public API
export {
  getAllNodes,
  getSchedulerStats,
  registerNode,
  type SchedulerStats,
  type SchedulingStrategy,
} from './scheduler'
// Types - always exported for consumers
export * from './types'
// Warm Pool - minimal public API
export { getAllPoolStats } from './warm-pool'

// High-Level API
import type { Address } from 'viem'
import * as executor from './executor'
import * as cache from './image-cache'
import * as scheduler from './scheduler'
import type { ExecutionRequest, ExecutionResult } from './types'
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
