/**
 * Warm Pool Manager - Manages warm container instances for fast execution
 * Implements intelligent warming, scaling, and cooldown strategies
 */

import type { Address } from 'viem'
import type {
  ContainerEvent,
  ContainerEventHandler,
  ContainerInstance,
  ContainerResources,
  ContainerState,
  WarmPoolStats,
  WarmthConfig,
} from './types'

// Pool state
const warmPools = new Map<string, WarmPool>()
const eventHandlers: ContainerEventHandler[] = []

interface WarmPool {
  imageDigest: string
  config: WarmthConfig
  instances: Map<string, ContainerInstance>
  requestQueue: Array<{
    resolve: (instance: ContainerInstance | null) => void
    timestamp: number
  }>
  stats: {
    totalRequests: number
    coldStarts: number
    warmHits: number
    avgColdStartMs: number
    avgWarmStartMs: number
  }
}

// ============================================================================
// Event Handling
// ============================================================================

export function onContainerEvent(handler: ContainerEventHandler): () => void {
  eventHandlers.push(handler)
  return () => {
    const idx = eventHandlers.indexOf(handler)
    if (idx >= 0) eventHandlers.splice(idx, 1)
  }
}

function emitEvent(event: ContainerEvent): void {
  for (const handler of eventHandlers) {
    handler(event)
  }
}

// ============================================================================
// Pool Management
// ============================================================================

export function getOrCreatePool(
  imageDigest: string,
  config?: Partial<WarmthConfig>,
): WarmPool {
  let pool = warmPools.get(imageDigest)
  if (!pool) {
    const defaultConfig: WarmthConfig = {
      keepWarmMs: 60000,
      minWarmInstances: 0,
      maxWarmInstances: 10,
      scaleUpThreshold: 5,
      scaleDownThreshold: 300000,
    }
    pool = {
      imageDigest,
      config: { ...defaultConfig, ...config },
      instances: new Map(),
      requestQueue: [],
      stats: {
        totalRequests: 0,
        coldStarts: 0,
        warmHits: 0,
        avgColdStartMs: 0,
        avgWarmStartMs: 0,
      },
    }
    warmPools.set(imageDigest, pool)
  }
  return pool
}

export function getPool(imageDigest: string): WarmPool | null {
  return warmPools.get(imageDigest) ?? null
}

export function updatePoolConfig(
  imageDigest: string,
  config: Partial<WarmthConfig>,
): void {
  const pool = warmPools.get(imageDigest)
  if (pool) {
    pool.config = { ...pool.config, ...config }
  }
}

// ============================================================================
// Instance Management
// ============================================================================

export function addInstance(
  imageDigest: string,
  instanceId: string,
  resources: ContainerResources,
  owner: Address,
  nodeId: string,
): ContainerInstance {
  const pool = getOrCreatePool(imageDigest)

  const instance: ContainerInstance = {
    instanceId,
    imageDigest,
    repoId: '', // Set later from image metadata
    state: 'creating',
    resources,
    createdAt: Date.now(),
    startedAt: null,
    lastActivityAt: Date.now(),
    warmUntil: null,
    requestsHandled: 0,
    owner,
    nodeId,
  }

  pool.instances.set(instanceId, instance)
  emitEvent({ type: 'instance_created', instanceId, imageDigest })

  return instance
}

export function getInstance(
  imageDigest: string,
  instanceId: string,
): ContainerInstance | null {
  const pool = warmPools.get(imageDigest)
  return pool?.instances.get(instanceId) ?? null
}

export function updateInstanceState(
  imageDigest: string,
  instanceId: string,
  state: ContainerState,
  extraData?: {
    startedAt?: number
    warmUntil?: number
    endpoint?: string
    port?: number
  },
): ContainerInstance | null {
  const pool = warmPools.get(imageDigest)
  const instance = pool?.instances.get(instanceId)
  if (!instance) return null

  const oldState = instance.state
  instance.state = state
  instance.lastActivityAt = Date.now()

  if (extraData) {
    if (extraData.startedAt !== undefined)
      instance.startedAt = extraData.startedAt
    if (extraData.warmUntil !== undefined)
      instance.warmUntil = extraData.warmUntil
    if (extraData.endpoint !== undefined) instance.endpoint = extraData.endpoint
    if (extraData.port !== undefined) instance.port = extraData.port
  }

  // Emit state change events
  if (state === 'running' && oldState !== 'running') {
    const coldStartMs = instance.startedAt
      ? instance.startedAt - instance.createdAt
      : 0
    emitEvent({ type: 'instance_started', instanceId, coldStartMs })
  } else if (state === 'warm') {
    emitEvent({
      type: 'instance_warmed',
      instanceId,
      warmUntil: instance.warmUntil ?? 0,
    })
  } else if (state === 'cooling') {
    emitEvent({ type: 'instance_cooling', instanceId })
  }

  return instance
}

export function removeInstance(
  imageDigest: string,
  instanceId: string,
  reason: string,
): boolean {
  const pool = warmPools.get(imageDigest)
  if (!pool) return false

  const removed = pool.instances.delete(instanceId)
  if (removed) {
    emitEvent({ type: 'instance_stopped', instanceId, reason })
  }
  return removed
}

// ============================================================================
// Warm Instance Acquisition
// ============================================================================

export async function acquireWarmInstance(
  imageDigest: string,
  timeoutMs: number = 5000,
): Promise<ContainerInstance | null> {
  const pool = getOrCreatePool(imageDigest)
  pool.stats.totalRequests++

  // Try to find a warm instance
  for (const instance of pool.instances.values()) {
    if (instance.state === 'warm' || instance.state === 'running') {
      instance.state = 'running'
      instance.lastActivityAt = Date.now()
      instance.requestsHandled++
      pool.stats.warmHits++

      // Update average warm start time
      const warmStartMs = 5 // Negligible for warm starts
      pool.stats.avgWarmStartMs =
        (pool.stats.avgWarmStartMs * (pool.stats.warmHits - 1) + warmStartMs) /
        pool.stats.warmHits

      return instance
    }
  }

  // No warm instance available - check if we should scale up
  const queueLength = pool.requestQueue.length
  if (queueLength >= pool.config.scaleUpThreshold) {
    emitEvent({
      type: 'scale_up',
      imageDigest,
      newCount: pool.instances.size + 1,
    })
  }

  // Wait for an instance
  return new Promise((resolve) => {
    const entry = { resolve, timestamp: Date.now() }
    pool.requestQueue.push(entry)

    // Timeout
    setTimeout(() => {
      const idx = pool.requestQueue.indexOf(entry)
      if (idx >= 0) {
        pool.requestQueue.splice(idx, 1)
        pool.stats.coldStarts++ // Will need a cold start
        resolve(null)
      }
    }, timeoutMs)
  })
}

export function releaseInstance(
  imageDigest: string,
  instanceId: string,
  keepWarm: boolean = true,
): void {
  const pool = warmPools.get(imageDigest)
  const instance = pool?.instances.get(instanceId)
  if (!instance) return

  instance.lastActivityAt = Date.now()

  // Check if there are waiting requests
  if (pool && pool.requestQueue.length > 0) {
    const waiting = pool.requestQueue.shift()
    if (waiting) {
      instance.requestsHandled++
      waiting.resolve(instance)
      return
    }
  }

  // Keep warm or start cooling
  if (keepWarm && pool) {
    instance.state = 'warm'
    instance.warmUntil = Date.now() + pool.config.keepWarmMs
    emitEvent({
      type: 'instance_warmed',
      instanceId,
      warmUntil: instance.warmUntil,
    })
  } else {
    instance.state = 'cooling'
    emitEvent({ type: 'instance_cooling', instanceId })
  }
}

// ============================================================================
// Pool Statistics
// ============================================================================

export function getPoolStats(imageDigest: string): WarmPoolStats | null {
  const pool = warmPools.get(imageDigest)
  if (!pool) return null

  const instances = [...pool.instances.values()]
  const warmCount = instances.filter(
    (i) => i.state === 'warm' || i.state === 'running',
  ).length
  const coolingCount = instances.filter((i) => i.state === 'cooling').length

  const totalRequests = pool.stats.totalRequests
  const hitRate = totalRequests > 0 ? pool.stats.warmHits / totalRequests : 0

  return {
    imageDigest,
    warmCount,
    coolingCount,
    totalRequests,
    avgColdStartMs: Math.round(pool.stats.avgColdStartMs),
    avgWarmStartMs: Math.round(pool.stats.avgWarmStartMs),
    hitRate: Math.round(hitRate * 10000) / 100,
  }
}

export function getAllPoolStats(): WarmPoolStats[] {
  return [...warmPools.keys()]
    .map((digest) => getPoolStats(digest))
    .filter((stats): stats is WarmPoolStats => stats !== null)
}

// ============================================================================
// Cooldown Manager
// ============================================================================

let cooldownInterval: ReturnType<typeof setInterval> | null = null

export function startCooldownManager(): void {
  if (cooldownInterval) return

  cooldownInterval = setInterval(() => {
    const now = Date.now()

    for (const [imageDigest, pool] of warmPools) {
      const instancesToRemove: string[] = []

      for (const [instanceId, instance] of pool.instances) {
        // Check if warm period expired
        if (
          instance.state === 'warm' &&
          instance.warmUntil &&
          now > instance.warmUntil
        ) {
          // Check if we should keep minimum warm instances
          const warmCount = [...pool.instances.values()].filter(
            (i) => i.state === 'warm' || i.state === 'running',
          ).length

          if (warmCount > pool.config.minWarmInstances) {
            instance.state = 'cooling'
            emitEvent({ type: 'instance_cooling', instanceId })
          } else {
            // Extend warm period for minimum instances
            instance.warmUntil = now + pool.config.keepWarmMs
          }
        }

        // Check if cooling period expired
        if (instance.state === 'cooling') {
          const coolingTime = now - instance.lastActivityAt
          if (coolingTime > pool.config.scaleDownThreshold) {
            instancesToRemove.push(instanceId)
          }
        }
      }

      // Remove cooled instances
      for (const instanceId of instancesToRemove) {
        pool.instances.delete(instanceId)
        emitEvent({ type: 'instance_stopped', instanceId, reason: 'cooldown' })
      }

      // Emit scale down event if instances were removed
      if (instancesToRemove.length > 0) {
        emitEvent({
          type: 'scale_down',
          imageDigest,
          newCount: pool.instances.size,
        })
      }
    }
  }, 10000) // Check every 10 seconds
}

export function stopCooldownManager(): void {
  if (cooldownInterval) {
    clearInterval(cooldownInterval)
    cooldownInterval = null
  }
}

// ============================================================================
// Pre-warming
// ============================================================================

export async function prewarmInstances(
  imageDigest: string,
  count: number,
  resources: ContainerResources,
  owner: Address,
  nodeId: string,
  createFn: (instance: ContainerInstance) => Promise<void>,
): Promise<ContainerInstance[]> {
  const pool = getOrCreatePool(imageDigest)
  const currentWarm = [...pool.instances.values()].filter(
    (i) => i.state === 'warm' || i.state === 'running',
  ).length

  const toCreate = Math.min(count, pool.config.maxWarmInstances - currentWarm)

  const instances: ContainerInstance[] = []

  for (let i = 0; i < toCreate; i++) {
    const instanceId = crypto.randomUUID()
    const instance = addInstance(
      imageDigest,
      instanceId,
      resources,
      owner,
      nodeId,
    )

    await createFn(instance)

    instance.state = 'warm'
    instance.startedAt = Date.now()
    instance.warmUntil = Date.now() + pool.config.keepWarmMs

    instances.push(instance)
  }

  return instances
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanupPool(imageDigest: string): void {
  const pool = warmPools.get(imageDigest)
  if (!pool) return

  for (const [instanceId] of pool.instances) {
    emitEvent({ type: 'instance_stopped', instanceId, reason: 'cleanup' })
  }

  pool.instances.clear()
  pool.requestQueue.forEach((r) => r.resolve(null))
  pool.requestQueue = []
}

export function cleanupAllPools(): void {
  for (const imageDigest of warmPools.keys()) {
    cleanupPool(imageDigest)
  }
  warmPools.clear()
}

// Auto-start cooldown manager
startCooldownManager()
