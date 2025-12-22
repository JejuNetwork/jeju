/**
 * Regional Cache Coordinator
 *
 * Coordinates cache state across edge nodes in a region.
 * Features:
 * - Popularity tracking across all nodes
 * - Cross-region prefetching for popular content
 * - Bandwidth-aware content distribution
 * - Node health monitoring
 */

import type { CDNRegion } from '@jejunetwork/types'
import { LRUCache } from 'lru-cache'
import type { EdgeCache } from './edge-cache'

// ============================================================================
// Types
// ============================================================================

export interface PopularityRecord {
  key: string
  cid: string
  accessCount: number
  lastAccessed: number
  size: number
  regions: Set<CDNRegion>
  seeders: number
}

export interface RegionalNode {
  nodeId: string
  region: CDNRegion
  endpoint: string
  capacityBytes: number
  usedBytes: number
  bandwidthMbps: number
  lastSeen: number
  healthy: boolean
}

export interface SyncMessage {
  type: 'popularity' | 'prefetch' | 'invalidate' | 'health'
  source: string
  region: CDNRegion
  timestamp: number
  payload: PopularityUpdate | PrefetchRequest | InvalidateRequest | HealthReport
}

export interface PopularityUpdate {
  entries: Array<{
    key: string
    accessCount: number
    size: number
  }>
}

export interface PrefetchRequest {
  keys: string[]
  priority: 'low' | 'normal' | 'high'
  targetRegions?: CDNRegion[]
}

export interface InvalidateRequest {
  patterns: string[]
  allRegions: boolean
}

export interface HealthReport {
  cacheStats: {
    entries: number
    sizeBytes: number
    hitRate: number
  }
  bandwidthUsed24h: number
  peersConnected: number
}

export interface RegionalCoordinatorConfig {
  nodeId: string
  region: CDNRegion
  syncIntervalMs: number
  popularityThreshold: number
  maxPrefetchBytes: number
  coordinatorEndpoints: string[]
}

// ============================================================================
// Regional Cache Coordinator
// ============================================================================

export class RegionalCacheCoordinator {
  private config: RegionalCoordinatorConfig
  private cache: EdgeCache

  // Popularity tracking
  private globalPopularity: LRUCache<string, PopularityRecord>

  // Node tracking
  private nodes: Map<string, RegionalNode> = new Map()
  private regionNodes: Map<CDNRegion, Set<string>> = new Map()

  // Sync state
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private pendingPrefetches: Map<string, PrefetchRequest> = new Map()

  constructor(cache: EdgeCache, config: Partial<RegionalCoordinatorConfig>) {
    this.cache = cache
    this.config = {
      nodeId:
        config.nodeId ?? `node-${Math.random().toString(36).slice(2, 10)}`,
      region: config.region ?? 'us-east-1',
      syncIntervalMs: config.syncIntervalMs ?? 30000,
      popularityThreshold: config.popularityThreshold ?? 10,
      maxPrefetchBytes: config.maxPrefetchBytes ?? 100 * 1024 * 1024, // 100MB
      coordinatorEndpoints: config.coordinatorEndpoints ?? [],
    }

    this.globalPopularity = new LRUCache({
      max: 100000,
      ttl: 24 * 60 * 60 * 1000, // 24 hours
    })
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  start(): void {
    if (this.syncInterval) return

    // Initial sync
    this.syncPopularity()

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.syncPopularity()
      this.processPrefetchQueue()
    }, this.config.syncIntervalMs)

    console.log(`[RegionalCoordinator] Started in ${this.config.region}`)
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  // ============================================================================
  // Popularity Tracking
  // ============================================================================

  /**
   * Record content access
   */
  recordAccess(key: string, cid: string, size: number): void {
    const existing = this.globalPopularity.get(key)

    if (existing) {
      existing.accessCount++
      existing.lastAccessed = Date.now()
    } else {
      this.globalPopularity.set(key, {
        key,
        cid,
        accessCount: 1,
        lastAccessed: Date.now(),
        size,
        regions: new Set([this.config.region]),
        seeders: 1,
      })
    }
  }

  /**
   * Get most popular content globally
   */
  getPopularContent(limit = 100): PopularityRecord[] {
    const entries = Array.from(this.globalPopularity.values())
    return entries.sort((a, b) => b.accessCount - a.accessCount).slice(0, limit)
  }

  /**
   * Get content that's popular but not cached in target region
   */
  getContentForRegion(targetRegion: CDNRegion, limit = 50): PopularityRecord[] {
    const entries = Array.from(this.globalPopularity.values())

    return entries
      .filter(
        (e) =>
          !e.regions.has(targetRegion) &&
          e.accessCount >= this.config.popularityThreshold,
      )
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
  }

  // ============================================================================
  // Cross-Region Prefetching
  // ============================================================================

  /**
   * Request prefetch of popular content to other regions
   */
  async requestPrefetch(
    keys: string[],
    targetRegions?: CDNRegion[],
  ): Promise<void> {
    const request: PrefetchRequest = {
      keys,
      priority: 'normal',
      targetRegions,
    }

    // Broadcast to coordinators
    await this.broadcastMessage({
      type: 'prefetch',
      source: this.config.nodeId,
      region: this.config.region,
      timestamp: Date.now(),
      payload: request,
    })
  }

  /**
   * Handle incoming prefetch request
   */
  async handlePrefetchRequest(request: PrefetchRequest): Promise<void> {
    // Check if we should handle this request
    if (
      request.targetRegions &&
      !request.targetRegions.includes(this.config.region)
    ) {
      return
    }

    // Add to queue
    for (const key of request.keys) {
      this.pendingPrefetches.set(key, request)
    }
  }

  /**
   * Process prefetch queue
   */
  private async processPrefetchQueue(): Promise<void> {
    if (this.pendingPrefetches.size === 0) return

    let bytesProcessed = 0
    const toRemove: string[] = []

    for (const [key] of this.pendingPrefetches) {
      // Check if already cached
      if (this.cache.has(key)) {
        toRemove.push(key)
        continue
      }

      // Check byte limit
      const popularity = this.globalPopularity.get(key)
      if (
        popularity &&
        bytesProcessed + popularity.size > this.config.maxPrefetchBytes
      ) {
        break
      }

      // Fetch from origin or peer
      const fetched = await this.fetchContent(key)
      if (fetched) {
        bytesProcessed += fetched.length
        toRemove.push(key)
      }
    }

    // Clean up processed entries
    for (const key of toRemove) {
      this.pendingPrefetches.delete(key)
    }

    if (toRemove.length > 0) {
      console.log(
        `[RegionalCoordinator] Prefetched ${toRemove.length} items (${bytesProcessed} bytes)`,
      )
    }
  }

  /**
   * Fetch content from peer or origin
   */
  private async fetchContent(key: string): Promise<Buffer | null> {
    const popularity = this.globalPopularity.get(key)
    if (!popularity) return null

    // Find a node that has this content
    for (const region of popularity.regions) {
      const regionNodeIds = this.regionNodes.get(region)
      if (!regionNodeIds) continue

      for (const nodeId of regionNodeIds) {
        const node = this.nodes.get(nodeId)
        if (!node?.healthy) continue

        try {
          const response = await fetch(
            `${node.endpoint}/cache/${encodeURIComponent(key)}`,
          )
          if (response.ok) {
            const data = Buffer.from(await response.arrayBuffer())
            this.cache.set(key, data, {
              origin: `peer:${nodeId}`,
            })
            return data
          }
        } catch {
          // Continue to next node
        }
      }
    }

    return null
  }

  // ============================================================================
  // Node Management
  // ============================================================================

  /**
   * Register a peer node
   */
  registerNode(node: RegionalNode): void {
    this.nodes.set(node.nodeId, node)

    let regionSet = this.regionNodes.get(node.region)
    if (!regionSet) {
      regionSet = new Set()
      this.regionNodes.set(node.region, regionSet)
    }
    regionSet.add(node.nodeId)
  }

  /**
   * Get nodes in a region
   */
  getRegionNodes(region: CDNRegion): RegionalNode[] {
    const nodeIds = this.regionNodes.get(region)
    if (!nodeIds) return []

    return Array.from(nodeIds)
      .map((id) => this.nodes.get(id))
      .filter((n): n is RegionalNode => n !== undefined && n.healthy === true)
  }

  /**
   * Update node health
   */
  updateNodeHealth(nodeId: string, healthy: boolean): void {
    const node = this.nodes.get(nodeId)
    if (node) {
      node.healthy = healthy
      node.lastSeen = Date.now()
    }
  }

  // ============================================================================
  // Synchronization
  // ============================================================================

  /**
   * Sync popularity data with other coordinators
   */
  private async syncPopularity(): Promise<void> {
    // Get local popular content
    const localPopular = this.cache.getPopularContent(100)

    const update: PopularityUpdate = {
      entries: localPopular,
    }

    // Broadcast to coordinators
    await this.broadcastMessage({
      type: 'popularity',
      source: this.config.nodeId,
      region: this.config.region,
      timestamp: Date.now(),
      payload: update,
    })
  }

  /**
   * Handle incoming popularity update
   */
  handlePopularityUpdate(
    update: PopularityUpdate,
    sourceRegion: CDNRegion,
  ): void {
    for (const entry of update.entries) {
      const existing = this.globalPopularity.get(entry.key)

      if (existing) {
        existing.accessCount += entry.accessCount
        existing.regions.add(sourceRegion)
      } else {
        this.globalPopularity.set(entry.key, {
          key: entry.key,
          cid: '', // Will be filled when content is fetched
          accessCount: entry.accessCount,
          lastAccessed: Date.now(),
          size: entry.size,
          regions: new Set([sourceRegion]),
          seeders: 1,
        })
      }
    }
  }

  /**
   * Broadcast message to all coordinators
   */
  private async broadcastMessage(message: SyncMessage): Promise<void> {
    for (const endpoint of this.config.coordinatorEndpoints) {
      try {
        await fetch(`${endpoint}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        })
      } catch {
        // Log but don't fail
        console.warn(`[RegionalCoordinator] Failed to sync with ${endpoint}`)
      }
    }
  }

  // ============================================================================
  // Cache Invalidation
  // ============================================================================

  /**
   * Invalidate content across all regions
   */
  async invalidateGlobal(patterns: string[]): Promise<void> {
    // Invalidate locally
    for (const pattern of patterns) {
      this.cache.purge(pattern)
    }

    // Broadcast to all regions
    await this.broadcastMessage({
      type: 'invalidate',
      source: this.config.nodeId,
      region: this.config.region,
      timestamp: Date.now(),
      payload: {
        patterns,
        allRegions: true,
      },
    })
  }

  /**
   * Handle incoming invalidation request
   */
  handleInvalidation(request: InvalidateRequest): void {
    for (const pattern of request.patterns) {
      this.cache.purge(pattern)
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getStats(): {
    region: CDNRegion
    nodesTotal: number
    nodesHealthy: number
    popularItems: number
    pendingPrefetches: number
    regionBreakdown: Record<CDNRegion, number>
  } {
    let healthyCount = 0
    for (const node of this.nodes.values()) {
      if (node.healthy) healthyCount++
    }

    const regionBreakdown: Record<string, number> = {}
    for (const [region, nodes] of this.regionNodes) {
      regionBreakdown[region] = nodes.size
    }

    return {
      region: this.config.region,
      nodesTotal: this.nodes.size,
      nodesHealthy: healthyCount,
      popularItems: this.globalPopularity.size,
      pendingPrefetches: this.pendingPrefetches.size,
      regionBreakdown: regionBreakdown as Record<CDNRegion, number>,
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let coordinatorInstance: RegionalCacheCoordinator | null = null

export function getRegionalCoordinator(
  cache: EdgeCache,
  config?: Partial<RegionalCoordinatorConfig>,
): RegionalCacheCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new RegionalCacheCoordinator(cache, config ?? {})
  }
  return coordinatorInstance
}
