/**
 * CDN Cache Integration
 *
 * Integrates the GossipSub coordinator with the edge cache for:
 * - Handling received cache invalidation requests
 * - Propagating local invalidations to the network
 * - Hot content replication handling
 * - Metrics collection and reporting
 */

import { type EdgeCache, getEdgeCache } from '../cache/edge-cache'
import {
  type CDNGossipCoordinator,
  getCDNCoordinator,
} from './gossip-coordinator'
import {
  type CacheInvalidation,
  type CDNCoordinationConfig,
  CDNRegion,
  type ContentReplicate,
  type NodeMetrics,
} from './types'

interface CacheIntegrationConfig {
  /** Edge cache instance (uses singleton if not provided) */
  cache?: EdgeCache

  /** CDN coordinator instance (uses singleton if not provided) */
  coordinator?: CDNGossipCoordinator

  /** Whether to auto-replicate hot content */
  autoReplicateHotContent: boolean

  /** Minimum request count to consider content hot */
  hotContentThreshold: number

  /** Regions to replicate hot content to */
  replicationRegions: string[]
}

const DEFAULT_CONFIG: CacheIntegrationConfig = {
  autoReplicateHotContent: true,
  hotContentThreshold: 100,
  replicationRegions: Object.values(CDNRegion),
}

export class CDNCacheIntegration {
  private cache: EdgeCache
  private coordinator: CDNGossipCoordinator
  private config: CacheIntegrationConfig
  private invalidationLog: Map<string, number> = new Map()
  private initialized = false

  constructor(config: Partial<CacheIntegrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.cache = config.cache ?? getEdgeCache()
    this.coordinator = config.coordinator ?? getCDNCoordinator()
  }

  /**
   * Initialize the integration
   */
  initialize(): void {
    if (this.initialized) return

    // Set up invalidation handler
    this.coordinator.onInvalidation((msg) => {
      this.handleInvalidation(msg)
    })

    // Set up replication handler
    this.coordinator.onReplication((msg) => {
      this.handleReplication(msg)
    })

    // Set up hot content handler
    this.coordinator.onHotContent((msg) => {
      this.handleHotContent(msg)
    })

    this.initialized = true
    console.log('[CDN Integration] Cache integration initialized')
  }

  /**
   * Handle received cache invalidation
   */
  private handleInvalidation(msg: CacheInvalidation): void {
    // Check if we've already processed this invalidation
    if (this.invalidationLog.has(msg.requestId)) {
      return
    }
    this.invalidationLog.set(msg.requestId, Date.now())

    // Clean up old invalidation records (older than 5 minutes)
    const cutoff = Date.now() - 300000
    for (const [id, timestamp] of this.invalidationLog) {
      if (timestamp < cutoff) {
        this.invalidationLog.delete(id)
      }
    }

    console.log(`[CDN Integration] Processing invalidation: ${msg.requestId}`)
    console.log(`  Patterns: ${msg.patterns.join(', ')}`)
    console.log(`  Priority: ${msg.priority}`)

    // Process each pattern
    let totalPurged = 0
    for (const pattern of msg.patterns) {
      const purged = this.cache.purge(pattern)
      totalPurged += purged
      console.log(`  Purged ${purged} entries matching: ${pattern}`)
    }

    console.log(`[CDN Integration] Total purged: ${totalPurged} entries`)
  }

  /**
   * Handle content replication request
   */
  private handleReplication(msg: ContentReplicate): void {
    // In production, this would:
    // 1. Check if we're in a target region
    // 2. Fetch the content from IPFS/origin
    // 3. Cache it locally

    console.log(`[CDN Integration] Replication request: ${msg.contentHash}`)
    console.log(`  Target regions: ${msg.targetRegions.join(', ')}`)
    console.log(`  Size: ${msg.size} bytes`)
    console.log(`  TTL: ${msg.ttl} seconds`)

    // TODO: Implement actual content fetching and caching
    // This would involve:
    // - Checking if this node is in a target region
    // - Fetching content from IPFS/origin
    // - Storing in local cache with specified TTL
  }

  /**
   * Handle hot content notification
   */
  private handleHotContent(msg: {
    contentHash: string
    requestCount: number
    region: string
  }): void {
    if (!this.config.autoReplicateHotContent) return

    // If content is hot in another region, consider replicating locally
    console.log(`[CDN Integration] Hot content detected: ${msg.contentHash}`)
    console.log(`  Requests: ${msg.requestCount} in region ${msg.region}`)

    // TODO: Implement pre-warming logic
    // - Check if we already have this content
    // - If not, fetch and cache it proactively
  }

  /**
   * Invalidate cache locally and propagate to network
   */
  async invalidate(
    patterns: string[],
    options: {
      siteId?: string
      regions?: string[]
      priority?: 'low' | 'normal' | 'high' | 'urgent'
      localOnly?: boolean
    } = {},
  ): Promise<{ local: number; propagated: boolean }> {
    // Purge locally first
    let localPurged = 0
    for (const pattern of patterns) {
      localPurged += this.cache.purge(pattern)
    }

    console.log(`[CDN Integration] Local purge: ${localPurged} entries`)

    // Propagate to network unless localOnly
    if (!options.localOnly) {
      await this.coordinator.invalidateCache(patterns, {
        siteId: options.siteId,
        regions: options.regions,
        priority: options.priority ?? 'normal',
      })
      console.log('[CDN Integration] Invalidation propagated to network')
      return { local: localPurged, propagated: true }
    }

    return { local: localPurged, propagated: false }
  }

  /**
   * Get current cache statistics for metrics reporting
   */
  getMetrics(): NodeMetrics['metrics'] {
    const cacheStats = this.cache.getStats()
    const coordinatorStats = this.coordinator.getStats()

    return {
      cacheSize: cacheStats.entries, // Would be better as bytes
      cacheCapacity: 512 * 1024 * 1024, // 512MB default
      cacheHitRate: cacheStats.hitRate,
      requestsPerSecond: 0, // Would need to track this
      bandwidthUsed: cacheStats.bytesServed,
      bandwidthCapacity: 1000 * 1024 * 1024, // 1Gbps default
      p99Latency: 0, // Would need to track this
      cpuUsage: 0, // Would need to measure this
      memoryUsage: 0, // Would need to measure this
      connections: coordinatorStats.connectedNodes,
      uptime: process.uptime(),
    }
  }

  /**
   * Track a cache request for hot content detection
   */
  trackRequest(contentHash: string): void {
    this.coordinator.trackContentRequest(contentHash)
  }
}

// Factory and singleton
let integration: CDNCacheIntegration | null = null

export function getCDNCacheIntegration(
  config?: Partial<CacheIntegrationConfig>,
): CDNCacheIntegration {
  if (!integration) {
    integration = new CDNCacheIntegration(config)
    integration.initialize()
  }
  return integration
}

export function initializeCDNCacheIntegration(
  _coordinatorConfig: CDNCoordinationConfig,
  integrationConfig?: Partial<CacheIntegrationConfig>,
): CDNCacheIntegration {
  integration = new CDNCacheIntegration(integrationConfig)
  integration.initialize()
  return integration
}
