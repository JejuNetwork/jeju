/**
 * Worker Registry Service
 *
 * Provides multi-tier worker lookup and cross-pod synchronization:
 * - Tier 1: In-memory (local pod)
 * - Tier 2: Shared cache (cluster-wide via CacheEngine)
 * - Tier 3: SQLit (persistent storage)
 * - Tier 4: IPFS (code bundles)
 *
 * Eliminates "Function not found" errors by ensuring workers can be
 * discovered and loaded from any tier when not in local memory.
 */

import type { Address } from 'viem'
import { type CacheEngine, getSharedEngine } from '../cache'
import { type DWSWorker, dwsWorkerState } from '../state'
import type { WorkerFunction } from './types'

// Pod identification
const POD_ID =
  process.env.POD_NAME ??
  process.env.HOSTNAME ??
  `pod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const POD_REGION = process.env.POD_REGION ?? process.env.AWS_REGION ?? 'global'

// Cache namespace for worker registry
const CACHE_NAMESPACE = 'dws:worker-registry'

// Cache keys (relative to namespace)
const WORKER_LOCATION_PREFIX = 'location:'
const WORKER_METADATA_PREFIX = 'meta:'
const POD_HEARTBEAT_PREFIX = 'heartbeat:'
const POD_WORKERS_PREFIX = 'workers:'

// TTLs (in seconds for CacheEngine)
const LOCATION_TTL_SEC = 60 // 60 seconds - how long a pod location is valid
const METADATA_TTL_SEC = 300 // 5 minutes - worker metadata cache
const HEARTBEAT_TTL_SEC = 30 // 30 seconds - pod heartbeat

// Retry configuration
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 100
const MAX_RETRY_DELAY_MS = 2000

// Sync interval
const SYNC_INTERVAL_MS = 30_000 // 30 seconds

/**
 * Pod information for worker location tracking
 */
export interface PodInfo {
  podId: string
  region: string
  endpoint: string
  lastHeartbeat: number
  activeInvocations: number
  avgLatencyMs: number
  loadedWorkerCount: number
}

/**
 * Worker location entry stored in shared cache
 */
export interface WorkerLocationEntry {
  workerId: string
  codeCid: string
  warmPods: Array<{
    podId: string
    region: string
    endpoint: string
    lastHeartbeat: number
    activeInvocations: number
  }>
  metadata: {
    name: string
    owner: string
    version: number
    memory: number
    timeout: number
  }
  updatedAt: number
}

/**
 * Result of a worker lookup operation
 */
export interface WorkerLookupResult {
  worker: WorkerFunction
  source: 'memory' | 'cache' | 'sqlit' | 'ipfs'
  loadTimeMs: number
  coldStart: boolean
}

/**
 * Statistics for the registry service
 */
export interface RegistryStats {
  podId: string
  region: string
  localWorkerCount: number
  cacheHits: number
  cacheMisses: number
  sqlitLookups: number
  coldStarts: number
  avgLoadTimeMs: number
  lastSyncAt: number
  syncIntervalMs: number
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * 2 ** attempt
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

/**
 * Convert DWSWorker to WorkerFunction
 */
function databaseWorkerToFunction(worker: DWSWorker): WorkerFunction {
  return {
    id: worker.id,
    name: worker.name,
    owner: worker.owner as Address,
    runtime: worker.runtime,
    handler: worker.handler,
    codeCid: worker.codeCid,
    memory: worker.memory,
    timeout: worker.timeout,
    env: worker.env,
    status: worker.status,
    version: worker.version,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
    invocationCount: worker.invocationCount,
    avgDurationMs: worker.avgDurationMs,
    errorCount: worker.errorCount,
  }
}

/**
 * Worker Registry Service
 *
 * Manages worker discovery and location tracking across the cluster.
 */
export class WorkerRegistryService {
  private localWorkers = new Map<string, WorkerFunction>()
  private cidToWorkerId = new Map<string, string>()
  private stats = {
    cacheHits: 0,
    cacheMisses: 0,
    sqlitLookups: 0,
    coldStarts: 0,
    totalLoadTimeMs: 0,
    loadCount: 0,
  }
  private lastSyncAt = 0
  private syncIntervalId: ReturnType<typeof setInterval> | null = null
  private onWorkerLoaded: ((worker: WorkerFunction) => Promise<void>) | null =
    null

  constructor() {
    console.log(
      `[WorkerRegistry] Initialized for pod ${POD_ID} in region ${POD_REGION}`,
    )
  }

  /**
   * Set callback for when a worker is loaded (for deploying to runtime)
   */
  setWorkerLoadedCallback(
    callback: (worker: WorkerFunction) => Promise<void>,
  ): void {
    this.onWorkerLoaded = callback
  }

  /**
   * Register a worker as loaded in this pod's local memory
   */
  registerLocalWorker(worker: WorkerFunction): void {
    this.localWorkers.set(worker.id, worker)
    this.cidToWorkerId.set(worker.codeCid, worker.id)
    console.log(
      `[WorkerRegistry] Registered local worker: ${worker.name} (${worker.id})`,
    )
  }

  /**
   * Unregister a worker from local memory
   */
  unregisterLocalWorker(workerId: string): void {
    const worker = this.localWorkers.get(workerId)
    if (worker) {
      this.localWorkers.delete(workerId)
      this.cidToWorkerId.delete(worker.codeCid)
      console.log(
        `[WorkerRegistry] Unregistered local worker: ${worker.name} (${workerId})`,
      )
    }
  }

  /**
   * Get a worker from local memory only (no network calls)
   */
  getLocalWorker(workerId: string): WorkerFunction | null {
    return this.localWorkers.get(workerId) ?? null
  }

  /**
   * Get a worker by CID from local memory
   */
  getLocalWorkerByCid(cid: string): WorkerFunction | null {
    const workerId = this.cidToWorkerId.get(cid)
    if (workerId) {
      return this.localWorkers.get(workerId) ?? null
    }
    return null
  }

  /**
   * List all locally loaded workers
   */
  listLocalWorkers(): WorkerFunction[] {
    return Array.from(this.localWorkers.values())
  }

  /**
   * Get worker with multi-tier fallback and retry logic
   *
   * Lookup order:
   * 1. Local memory (Tier 1) - O(1), ~0.01ms
   * 2. Shared cache (Tier 2) - O(1), ~1-5ms
   * 3. SQLit database (Tier 3) - O(1), ~10-50ms
   *
   * On Tier 2/3 hit, the worker is loaded into local memory.
   */
  async getWorker(workerId: string): Promise<WorkerLookupResult | null> {
    const startTime = Date.now()

    // Tier 1: Check local memory first
    const localWorker = this.localWorkers.get(workerId)
    if (localWorker) {
      return {
        worker: localWorker,
        source: 'memory',
        loadTimeMs: Date.now() - startTime,
        coldStart: false,
      }
    }

    // Tier 2: Check shared cache for worker metadata (sync)
    const cachedWorker = this.getWorkerFromCache(workerId)
    if (cachedWorker) {
      this.stats.cacheHits++
      const loadTimeMs = Date.now() - startTime
      this.recordLoadTime(loadTimeMs)

      // Register locally and trigger deployment
      this.registerLocalWorker(cachedWorker)
      if (this.onWorkerLoaded) {
        await this.onWorkerLoaded(cachedWorker)
      }

      return {
        worker: cachedWorker,
        source: 'cache',
        loadTimeMs,
        coldStart: true,
      }
    }

    this.stats.cacheMisses++

    // Tier 3: Load from SQLit with retry
    const dbWorker = await this.getWorkerFromDatabase(workerId)
    if (dbWorker) {
      this.stats.sqlitLookups++
      this.stats.coldStarts++
      const loadTimeMs = Date.now() - startTime
      this.recordLoadTime(loadTimeMs)

      // Cache for future lookups (sync)
      this.cacheWorkerMetadata(dbWorker)

      // Register locally and trigger deployment
      this.registerLocalWorker(dbWorker)
      if (this.onWorkerLoaded) {
        await this.onWorkerLoaded(dbWorker)
      }

      return {
        worker: dbWorker,
        source: 'sqlit',
        loadTimeMs,
        coldStart: true,
      }
    }

    return null
  }

  /**
   * Get worker by CID with multi-tier fallback
   */
  async getWorkerByCid(cid: string): Promise<WorkerLookupResult | null> {
    const startTime = Date.now()

    // Tier 1: Check local memory
    const localWorker = this.getLocalWorkerByCid(cid)
    if (localWorker) {
      return {
        worker: localWorker,
        source: 'memory',
        loadTimeMs: Date.now() - startTime,
        coldStart: false,
      }
    }

    // Tier 2/3: Look up by CID in database
    const dbWorker = await this.getWorkerByCidFromDatabase(cid)
    if (dbWorker) {
      this.stats.sqlitLookups++
      this.stats.coldStarts++
      const loadTimeMs = Date.now() - startTime
      this.recordLoadTime(loadTimeMs)

      // Cache and register (sync)
      this.cacheWorkerMetadata(dbWorker)
      this.registerLocalWorker(dbWorker)
      if (this.onWorkerLoaded) {
        await this.onWorkerLoaded(dbWorker)
      }

      return {
        worker: dbWorker,
        source: 'sqlit',
        loadTimeMs,
        coldStart: true,
      }
    }

    return null
  }

  /**
   * Get cache engine instance
   */
  private getCache(): CacheEngine {
    return getSharedEngine()
  }

  /**
   * Get worker from shared cache (Tier 2)
   */
  private getWorkerFromCache(workerId: string): WorkerFunction | null {
    const cache = this.getCache()
    const cacheKey = `${WORKER_METADATA_PREFIX}${workerId}`

    const cached = cache.get(CACHE_NAMESPACE, cacheKey)
    if (!cached) {
      return null
    }

    return JSON.parse(cached) as WorkerFunction
  }

  /**
   * Cache worker metadata in shared cache (Tier 2)
   */
  private cacheWorkerMetadata(worker: WorkerFunction): void {
    const cache = this.getCache()
    const cacheKey = `${WORKER_METADATA_PREFIX}${worker.id}`

    cache.set(CACHE_NAMESPACE, cacheKey, JSON.stringify(worker), {
      ttl: METADATA_TTL_SEC,
    })
  }

  /**
   * Get worker from SQLit database (Tier 3) with retry logic
   */
  private async getWorkerFromDatabase(
    workerId: string,
  ): Promise<WorkerFunction | null> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const attemptStart = Date.now()

      const worker = await dwsWorkerState.get(workerId)

      if (worker) {
        console.log(
          `[WorkerRegistry] Loaded worker ${worker.name} from SQLit (attempt ${attempt + 1}, ${Date.now() - attemptStart}ms)`,
        )
        return databaseWorkerToFunction(worker)
      }

      // Worker not found in database - no point retrying
      if (worker === null) {
        console.log(
          `[WorkerRegistry] Worker ${workerId} not found in SQLit database`,
        )
        return null
      }

      // If we get here, there was an error - retry
      lastError = new Error('SQLit query returned undefined')
      console.warn(
        `[WorkerRegistry] SQLit lookup failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError.message}`,
      )

      if (attempt < MAX_RETRIES - 1) {
        await sleep(getRetryDelay(attempt))
      }
    }

    console.error(
      `[WorkerRegistry] All ${MAX_RETRIES} attempts failed for worker ${workerId}: ${lastError?.message}`,
    )
    return null
  }

  /**
   * Get worker by CID from SQLit database with retry
   */
  private async getWorkerByCidFromDatabase(
    cid: string,
  ): Promise<WorkerFunction | null> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const worker = await dwsWorkerState.getByCid(cid)

      if (worker) {
        console.log(
          `[WorkerRegistry] Loaded worker ${worker.name} by CID from SQLit (attempt ${attempt + 1})`,
        )
        return databaseWorkerToFunction(worker)
      }

      if (worker === null) {
        return null
      }

      if (attempt < MAX_RETRIES - 1) {
        await sleep(getRetryDelay(attempt))
      }
    }

    return null
  }

  /**
   * Record load time for statistics
   */
  private recordLoadTime(ms: number): void {
    this.stats.totalLoadTimeMs += ms
    this.stats.loadCount++
  }

  /**
   * Update worker location in shared cache
   * Called when this pod has a worker loaded and ready
   */
  updateWorkerLocation(workerId: string): void {
    const worker = this.localWorkers.get(workerId)
    if (!worker) {
      return
    }

    const cache = this.getCache()
    const locationKey = `${WORKER_LOCATION_PREFIX}${workerId}`

    // Get existing location entry or create new
    const existingJson = cache.get(CACHE_NAMESPACE, locationKey)
    let entry: WorkerLocationEntry

    if (existingJson) {
      entry = JSON.parse(existingJson) as WorkerLocationEntry
      // Update or add this pod
      const existingPodIndex = entry.warmPods.findIndex(
        (p) => p.podId === POD_ID,
      )
      const podEntry = {
        podId: POD_ID,
        region: POD_REGION,
        endpoint: this.getPodEndpoint(),
        lastHeartbeat: Date.now(),
        activeInvocations: 0,
      }

      if (existingPodIndex >= 0) {
        entry.warmPods[existingPodIndex] = podEntry
      } else {
        entry.warmPods.push(podEntry)
      }
      entry.updatedAt = Date.now()
    } else {
      entry = {
        workerId,
        codeCid: worker.codeCid,
        warmPods: [
          {
            podId: POD_ID,
            region: POD_REGION,
            endpoint: this.getPodEndpoint(),
            lastHeartbeat: Date.now(),
            activeInvocations: 0,
          },
        ],
        metadata: {
          name: worker.name,
          owner: worker.owner,
          version: worker.version,
          memory: worker.memory,
          timeout: worker.timeout,
        },
        updatedAt: Date.now(),
      }
    }

    // Remove stale pods (no heartbeat in 60s)
    const now = Date.now()
    const locationTtlMs = LOCATION_TTL_SEC * 1000
    entry.warmPods = entry.warmPods.filter(
      (p) => now - p.lastHeartbeat < locationTtlMs,
    )

    cache.set(CACHE_NAMESPACE, locationKey, JSON.stringify(entry), {
      ttl: LOCATION_TTL_SEC,
    })
  }

  /**
   * Find pods that have a specific worker loaded
   */
  findWarmPods(workerId: string, preferredRegion?: string): PodInfo[] {
    const cache = this.getCache()
    const locationKey = `${WORKER_LOCATION_PREFIX}${workerId}`

    const entryJson = cache.get(CACHE_NAMESPACE, locationKey)
    if (!entryJson) {
      return []
    }

    const entry = JSON.parse(entryJson) as WorkerLocationEntry
    const now = Date.now()
    const locationTtlMs = LOCATION_TTL_SEC * 1000

    // Filter out stale pods and convert to PodInfo
    const pods = entry.warmPods
      .filter((p) => now - p.lastHeartbeat < locationTtlMs)
      .map((p) => ({
        podId: p.podId,
        region: p.region,
        endpoint: p.endpoint,
        lastHeartbeat: p.lastHeartbeat,
        activeInvocations: p.activeInvocations,
        avgLatencyMs: 0,
        loadedWorkerCount: 0,
      }))

    // Sort by region preference, then by active invocations (load balancing)
    if (preferredRegion) {
      pods.sort((a, b) => {
        // Prefer same region
        if (a.region === preferredRegion && b.region !== preferredRegion)
          return -1
        if (b.region === preferredRegion && a.region !== preferredRegion)
          return 1
        // Then by active invocations (prefer less loaded)
        return a.activeInvocations - b.activeInvocations
      })
    } else {
      pods.sort((a, b) => a.activeInvocations - b.activeInvocations)
    }

    return pods
  }

  /**
   * Get the endpoint URL for this pod
   */
  private getPodEndpoint(): string {
    const port = process.env.PORT ?? '4030'
    const podIp = process.env.POD_IP ?? '127.0.0.1'
    return `http://${podIp}:${port}`
  }

  /**
   * Send heartbeat to indicate this pod is alive
   */
  heartbeat(): void {
    const cache = this.getCache()

    // Update pod heartbeat
    const heartbeatKey = `${POD_HEARTBEAT_PREFIX}${POD_ID}`
    cache.set(
      CACHE_NAMESPACE,
      heartbeatKey,
      JSON.stringify({
        podId: POD_ID,
        region: POD_REGION,
        endpoint: this.getPodEndpoint(),
        workerCount: this.localWorkers.size,
        timestamp: Date.now(),
      }),
      { ttl: HEARTBEAT_TTL_SEC },
    )

    // Update pod workers list
    const workersKey = `${POD_WORKERS_PREFIX}${POD_ID}`
    const workerIds = Array.from(this.localWorkers.keys())
    cache.set(CACHE_NAMESPACE, workersKey, JSON.stringify(workerIds), {
      ttl: HEARTBEAT_TTL_SEC,
    })

    // Update location entries for all local workers
    for (const workerId of workerIds) {
      this.updateWorkerLocation(workerId)
    }
  }

  /**
   * Sync workers from persistence (SQLit)
   * Loads any workers that should be on this pod but aren't
   */
  async syncFromPersistence(): Promise<{
    loaded: number
    skipped: number
    failed: number
  }> {
    const startTime = Date.now()
    let loaded = 0
    let skipped = 0
    const failed = 0

    const workers = await dwsWorkerState.listActive()

    for (const worker of workers) {
      // Skip if already loaded locally
      if (this.localWorkers.has(worker.id)) {
        skipped++
        continue
      }

      const fn = databaseWorkerToFunction(worker)

      // Register locally
      this.registerLocalWorker(fn)

      // Trigger deployment callback
      if (this.onWorkerLoaded) {
        await this.onWorkerLoaded(fn)
      }

      // Cache metadata (sync)
      this.cacheWorkerMetadata(fn)

      loaded++
    }

    this.lastSyncAt = Date.now()
    console.log(
      `[WorkerRegistry] Sync complete: loaded=${loaded}, skipped=${skipped}, failed=${failed}, duration=${Date.now() - startTime}ms`,
    )

    return { loaded, skipped, failed }
  }

  /**
   * Start background sync task
   */
  startBackgroundSync(): void {
    if (this.syncIntervalId) {
      return // Already running
    }

    console.log(
      `[WorkerRegistry] Starting background sync (interval: ${SYNC_INTERVAL_MS}ms)`,
    )

    // Initial sync
    this.syncFromPersistence().catch((err) => {
      console.error(
        `[WorkerRegistry] Initial sync failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })

    // Periodic sync
    this.syncIntervalId = setInterval(() => {
      this.heartbeat()

      // Periodically re-sync from persistence to catch new deployments
      const timeSinceSync = Date.now() - this.lastSyncAt
      if (timeSinceSync > SYNC_INTERVAL_MS * 2) {
        this.syncFromPersistence().catch((err) => {
          console.error(
            `[WorkerRegistry] Periodic sync failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        })
      }
    }, SYNC_INTERVAL_MS)
  }

  /**
   * Stop background sync task
   */
  stopBackgroundSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId)
      this.syncIntervalId = null
      console.log('[WorkerRegistry] Stopped background sync')
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    return {
      podId: POD_ID,
      region: POD_REGION,
      localWorkerCount: this.localWorkers.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      sqlitLookups: this.stats.sqlitLookups,
      coldStarts: this.stats.coldStarts,
      avgLoadTimeMs:
        this.stats.loadCount > 0
          ? this.stats.totalLoadTimeMs / this.stats.loadCount
          : 0,
      lastSyncAt: this.lastSyncAt,
      syncIntervalMs: SYNC_INTERVAL_MS,
    }
  }

  /**
   * Get pod ID
   */
  getPodId(): string {
    return POD_ID
  }

  /**
   * Get pod region
   */
  getPodRegion(): string {
    return POD_REGION
  }
}

// Singleton instance
let registryInstance: WorkerRegistryService | null = null

/**
 * Get the shared WorkerRegistryService instance
 */
export function getWorkerRegistry(): WorkerRegistryService {
  if (!registryInstance) {
    registryInstance = new WorkerRegistryService()
  }
  return registryInstance
}
