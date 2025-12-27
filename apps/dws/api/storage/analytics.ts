/**
 * Storage Analytics - Comprehensive metrics and monitoring
 *
 * Features:
 * - Real-time bandwidth and request tracking
 * - Content popularity analysis
 * - Storage utilization metrics
 * - Cost tracking and forecasting
 * - Performance analytics
 * - Regional distribution insights
 */

import type { Address } from 'viem'
import type { ContentTier, StorageBackendType } from './types'

// ============ Types ============

export interface StorageAnalytics {
  global: GlobalMetrics
  backends: BackendMetrics[]
  regions: RegionalMetrics[]
  content: ContentMetrics
  costs: CostMetrics
  performance: PerformanceMetrics
  trends: TrendMetrics
  topContent: ContentRanking[]
}

export interface GlobalMetrics {
  totalStorageBytes: number
  totalBandwidthBytes24h: number
  totalRequests24h: number
  totalUploads24h: number
  totalDownloads24h: number
  activeNodes: number
  activeUsers: number
  contentCount: number
  avgResponseTimeMs: number
  errorRate: number
  timestamp: number
}

export interface BackendMetrics {
  backend: StorageBackendType
  storageBytes: number
  contentCount: number
  requests24h: number
  bandwidth24h: number
  avgLatencyMs: number
  successRate: number
  costPerGb: bigint
  status: 'healthy' | 'degraded' | 'down'
}

export interface RegionalMetrics {
  region: string
  nodeCount: number
  storageBytes: number
  bandwidth24h: number
  requests24h: number
  avgLatencyMs: number
  topContent: string[]
  peakHour: number
  peakBandwidth: number
}

export interface ContentMetrics {
  byTier: Record<ContentTier, TierMetrics>
  byCategory: Record<string, CategoryMetrics>
  replicationStats: ReplicationStats
}

export interface TierMetrics {
  tier: ContentTier
  contentCount: number
  totalSize: number
  requests24h: number
  bandwidth24h: number
  avgReplication: number
}

export interface CategoryMetrics {
  category: string
  contentCount: number
  totalSize: number
  requests24h: number
}

export interface ReplicationStats {
  underReplicated: number
  optimallyReplicated: number
  overReplicated: number
  avgReplicationFactor: number
}

export interface CostMetrics {
  storageCost24h: bigint
  bandwidthCost24h: bigint
  totalCost24h: bigint
  storageCost7d: bigint
  bandwidthCost7d: bigint
  totalCost7d: bigint
  projectedMonthlyCost: bigint
  costByBackend: Record<StorageBackendType, bigint>
  costTrend: number // Percentage change from last period
}

export interface PerformanceMetrics {
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  avgThroughputMbps: number
  peakThroughputMbps: number
  cacheHitRate: number
  errorsByType: Record<string, number>
}

export interface TrendMetrics {
  storageGrowthRate: number // Bytes per day
  bandwidthTrend: number // Percentage change
  requestTrend: number // Percentage change
  costTrend: number // Percentage change
  userGrowthRate: number // New users per day
  contentGrowthRate: number // New items per day
}

export interface ContentRanking {
  cid: string
  name: string
  requests24h: number
  bandwidth24h: number
  tier: ContentTier
  category: string
  lastAccessed: number
  trendDirection: 'up' | 'down' | 'stable'
}

export interface TimeSeriesDataPoint {
  timestamp: number
  value: number
}

export interface TimeSeriesMetrics {
  bandwidth: TimeSeriesDataPoint[]
  requests: TimeSeriesDataPoint[]
  storage: TimeSeriesDataPoint[]
  latency: TimeSeriesDataPoint[]
  errors: TimeSeriesDataPoint[]
}

export interface UserAnalytics {
  address: Address
  totalUploads: number
  totalDownloads: number
  storageUsed: number
  bandwidth24h: number
  bandwidth7d: number
  contentCount: number
  lastActive: number
}

export interface AnalyticsEvent {
  eventType: 'upload' | 'download' | 'delete' | 'error'
  timestamp: number
  cid: string
  backend: StorageBackendType
  region: string
  sizeBytes: number
  latencyMs: number
  success: boolean
  userAddress?: Address
  errorCode?: string
  errorMessage?: string
}

export interface AnalyticsConfig {
  retentionDays: number
  aggregationIntervalMs: number
  enableRealTime: boolean
  enablePersistence: boolean
  maxEventsInMemory: number
}

// ============ Default Configuration ============

const DEFAULT_CONFIG: AnalyticsConfig = {
  retentionDays: 30,
  aggregationIntervalMs: 60000, // 1 minute
  enableRealTime: true,
  enablePersistence: true,
  maxEventsInMemory: 100000,
}

// ============ Analytics Manager ============

export class StorageAnalyticsManager {
  private config: AnalyticsConfig
  private events: AnalyticsEvent[] = []
  private aggregatedMetrics: Map<string, GlobalMetrics> = new Map()
  private userMetrics: Map<string, UserAnalytics> = new Map()
  private backendStatus: Map<
    StorageBackendType,
    'healthy' | 'degraded' | 'down'
  > = new Map()

  // Hourly buckets for time series
  private hourlyBandwidth: Map<number, number> = new Map()
  private hourlyRequests: Map<number, number> = new Map()
  private hourlyErrors: Map<number, number> = new Map()
  private hourlyLatency: Map<number, number[]> = new Map()

  // Content access tracking
  private contentAccess: Map<
    string,
    { count: number; bandwidth: number; lastAccessed: number }
  > = new Map()

  constructor(config?: Partial<AnalyticsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize backend status
    const backends: StorageBackendType[] = [
      'local',
      'ipfs',
      'arweave',
      'filecoin',
      'webtorrent',
    ]
    for (const backend of backends) {
      this.backendStatus.set(backend, 'healthy')
    }

    // Start aggregation interval
    if (this.config.enableRealTime) {
      setInterval(() => this.aggregate(), this.config.aggregationIntervalMs)
    }

    // Start cleanup interval
    setInterval(() => this.cleanup(), 3600000) // Hourly cleanup
  }

  // ============ Event Recording ============

  recordEvent(event: AnalyticsEvent): void {
    this.events.push(event)

    // Update hourly buckets
    const hourBucket = Math.floor(event.timestamp / 3600000) * 3600000

    // Bandwidth
    const currentBandwidth = this.hourlyBandwidth.get(hourBucket) ?? 0
    this.hourlyBandwidth.set(hourBucket, currentBandwidth + event.sizeBytes)

    // Requests
    const currentRequests = this.hourlyRequests.get(hourBucket) ?? 0
    this.hourlyRequests.set(hourBucket, currentRequests + 1)

    // Errors
    if (!event.success) {
      const currentErrors = this.hourlyErrors.get(hourBucket) ?? 0
      this.hourlyErrors.set(hourBucket, currentErrors + 1)
    }

    // Latency
    const latencies = this.hourlyLatency.get(hourBucket) ?? []
    latencies.push(event.latencyMs)
    this.hourlyLatency.set(hourBucket, latencies)

    // Content access
    const access = this.contentAccess.get(event.cid) ?? {
      count: 0,
      bandwidth: 0,
      lastAccessed: 0,
    }
    access.count++
    access.bandwidth += event.sizeBytes
    access.lastAccessed = event.timestamp
    this.contentAccess.set(event.cid, access)

    // User metrics
    if (event.userAddress) {
      this.updateUserMetrics(event.userAddress, event)
    }

    // Trim events if over limit
    if (this.events.length > this.config.maxEventsInMemory) {
      this.events = this.events.slice(
        -Math.floor(this.config.maxEventsInMemory * 0.8),
      )
    }
  }

  recordUpload(
    cid: string,
    sizeBytes: number,
    backend: StorageBackendType,
    region: string,
    latencyMs: number,
    userAddress?: Address,
  ): void {
    this.recordEvent({
      eventType: 'upload',
      timestamp: Date.now(),
      cid,
      backend,
      region,
      sizeBytes,
      latencyMs,
      success: true,
      userAddress,
    })
  }

  recordDownload(
    cid: string,
    sizeBytes: number,
    backend: StorageBackendType,
    region: string,
    latencyMs: number,
    userAddress?: Address,
  ): void {
    this.recordEvent({
      eventType: 'download',
      timestamp: Date.now(),
      cid,
      backend,
      region,
      sizeBytes,
      latencyMs,
      success: true,
      userAddress,
    })
  }

  recordError(
    cid: string,
    backend: StorageBackendType,
    region: string,
    errorCode: string,
    errorMessage: string,
  ): void {
    this.recordEvent({
      eventType: 'error',
      timestamp: Date.now(),
      cid,
      backend,
      region,
      sizeBytes: 0,
      latencyMs: 0,
      success: false,
      errorCode,
      errorMessage,
    })

    // Update backend status based on error rate
    this.checkBackendHealth(backend)
  }

  private updateUserMetrics(address: Address, event: AnalyticsEvent): void {
    const metrics = this.userMetrics.get(address) ?? {
      address,
      totalUploads: 0,
      totalDownloads: 0,
      storageUsed: 0,
      bandwidth24h: 0,
      bandwidth7d: 0,
      contentCount: 0,
      lastActive: 0,
    }

    if (event.eventType === 'upload') {
      metrics.totalUploads++
      metrics.storageUsed += event.sizeBytes
      metrics.contentCount++
    } else if (event.eventType === 'download') {
      metrics.totalDownloads++
    }

    metrics.bandwidth24h += event.sizeBytes
    metrics.bandwidth7d += event.sizeBytes
    metrics.lastActive = event.timestamp

    this.userMetrics.set(address, metrics)
  }

  private checkBackendHealth(backend: StorageBackendType): void {
    const now = Date.now()
    const hour = 3600000

    // Get recent events for this backend
    const recentEvents = this.events.filter(
      (e) => e.backend === backend && e.timestamp > now - hour,
    )

    const errorCount = recentEvents.filter((e) => !e.success).length
    const totalCount = recentEvents.length

    if (totalCount === 0) {
      this.backendStatus.set(backend, 'healthy')
      return
    }

    const errorRate = errorCount / totalCount

    if (errorRate > 0.5) {
      this.backendStatus.set(backend, 'down')
    } else if (errorRate > 0.1) {
      this.backendStatus.set(backend, 'degraded')
    } else {
      this.backendStatus.set(backend, 'healthy')
    }
  }

  // ============ Aggregation ============

  private aggregate(): void {
    const now = Date.now()
    const hourBucket = Math.floor(now / 3600000) * 3600000

    const metrics = this.calculateGlobalMetrics()
    this.aggregatedMetrics.set(String(hourBucket), metrics)
  }

  // ============ Query Methods ============

  getAnalytics(): StorageAnalytics {
    return {
      global: this.calculateGlobalMetrics(),
      backends: this.calculateBackendMetrics(),
      regions: this.calculateRegionalMetrics(),
      content: this.calculateContentMetrics(),
      costs: this.calculateCostMetrics(),
      performance: this.calculatePerformanceMetrics(),
      trends: this.calculateTrendMetrics(),
      topContent: this.getTopContent(10),
    }
  }

  private calculateGlobalMetrics(): GlobalMetrics {
    const now = Date.now()
    const day = 86400000

    const events24h = this.events.filter((e) => e.timestamp > now - day)

    const totalBandwidth = events24h.reduce((sum, e) => sum + e.sizeBytes, 0)
    const uploads = events24h.filter((e) => e.eventType === 'upload')
    const downloads = events24h.filter((e) => e.eventType === 'download')
    const errors = events24h.filter((e) => !e.success)

    const latencies = events24h.map((e) => e.latencyMs).filter((l) => l > 0)
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0

    // Calculate storage (approximate from events)
    const uploadEvents = this.events.filter((e) => e.eventType === 'upload')
    const totalStorage = uploadEvents.reduce((sum, e) => sum + e.sizeBytes, 0)

    return {
      totalStorageBytes: totalStorage,
      totalBandwidthBytes24h: totalBandwidth,
      totalRequests24h: events24h.length,
      totalUploads24h: uploads.length,
      totalDownloads24h: downloads.length,
      activeNodes: this.getActiveNodeCount(),
      activeUsers: this.getActiveUserCount(),
      contentCount: this.contentAccess.size,
      avgResponseTimeMs: avgLatency,
      errorRate: events24h.length > 0 ? errors.length / events24h.length : 0,
      timestamp: now,
    }
  }

  private calculateBackendMetrics(): BackendMetrics[] {
    const now = Date.now()
    const day = 86400000

    const backends: StorageBackendType[] = [
      'local',
      'ipfs',
      'arweave',
      'filecoin',
      'webtorrent',
    ]
    const metrics: BackendMetrics[] = []

    for (const backend of backends) {
      const events = this.events.filter((e) => e.backend === backend)
      const events24h = events.filter((e) => e.timestamp > now - day)

      const uploads = events.filter((e) => e.eventType === 'upload')
      const storageBytes = uploads.reduce((sum, e) => sum + e.sizeBytes, 0)

      const bandwidth24h = events24h.reduce((sum, e) => sum + e.sizeBytes, 0)
      const successful = events24h.filter((e) => e.success)
      const latencies = events24h.map((e) => e.latencyMs).filter((l) => l > 0)

      metrics.push({
        backend,
        storageBytes,
        contentCount: new Set(uploads.map((e) => e.cid)).size,
        requests24h: events24h.length,
        bandwidth24h,
        avgLatencyMs:
          latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0,
        successRate:
          events24h.length > 0 ? successful.length / events24h.length : 1,
        costPerGb: this.getBackendCostPerGb(backend),
        status: this.backendStatus.get(backend) ?? 'healthy',
      })
    }

    return metrics
  }

  private calculateRegionalMetrics(): RegionalMetrics[] {
    const now = Date.now()
    const day = 86400000

    const regionMap = new Map<string, AnalyticsEvent[]>()

    for (const event of this.events) {
      const events = regionMap.get(event.region) ?? []
      events.push(event)
      regionMap.set(event.region, events)
    }

    const metrics: RegionalMetrics[] = []

    for (const [region, events] of regionMap) {
      const events24h = events.filter((e) => e.timestamp > now - day)
      const uploads = events.filter((e) => e.eventType === 'upload')

      // Calculate peak hour
      const hourlyBuckets = new Map<number, number>()
      for (const event of events24h) {
        const hour = new Date(event.timestamp).getHours()
        hourlyBuckets.set(
          hour,
          (hourlyBuckets.get(hour) ?? 0) + event.sizeBytes,
        )
      }

      let peakHour = 0
      let peakBandwidth = 0
      for (const [hour, bandwidth] of hourlyBuckets) {
        if (bandwidth > peakBandwidth) {
          peakHour = hour
          peakBandwidth = bandwidth
        }
      }

      // Get top content for region
      const contentCounts = new Map<string, number>()
      for (const event of events24h) {
        contentCounts.set(event.cid, (contentCounts.get(event.cid) ?? 0) + 1)
      }
      const topContent = Array.from(contentCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cid]) => cid)

      metrics.push({
        region,
        nodeCount: 1, // Would come from node registry
        storageBytes: uploads.reduce((sum, e) => sum + e.sizeBytes, 0),
        bandwidth24h: events24h.reduce((sum, e) => sum + e.sizeBytes, 0),
        requests24h: events24h.length,
        avgLatencyMs: this.calculateAvgLatency(events24h),
        topContent,
        peakHour,
        peakBandwidth,
      })
    }

    return metrics
  }

  private calculateContentMetrics(): ContentMetrics {
    const byTier: Record<ContentTier, TierMetrics> = {
      system: {
        tier: 'system',
        contentCount: 0,
        totalSize: 0,
        requests24h: 0,
        bandwidth24h: 0,
        avgReplication: 3,
      },
      popular: {
        tier: 'popular',
        contentCount: 0,
        totalSize: 0,
        requests24h: 0,
        bandwidth24h: 0,
        avgReplication: 2,
      },
      private: {
        tier: 'private',
        contentCount: 0,
        totalSize: 0,
        requests24h: 0,
        bandwidth24h: 0,
        avgReplication: 1,
      },
    }

    // Aggregate by category
    const byCategory: Record<string, CategoryMetrics> = {}

    // Calculate replication stats
    const replicationStats: ReplicationStats = {
      underReplicated: 0,
      optimallyReplicated: 0,
      overReplicated: 0,
      avgReplicationFactor: 2,
    }

    return { byTier, byCategory, replicationStats }
  }

  private calculateCostMetrics(): CostMetrics {
    const now = Date.now()
    const day = 86400000
    const week = day * 7

    const events24h = this.events.filter((e) => e.timestamp > now - day)
    const events7d = this.events.filter((e) => e.timestamp > now - week)

    // Calculate costs by backend
    const costByBackend: Record<StorageBackendType, bigint> = {
      local: 0n,
      ipfs: 0n,
      arweave: 0n,
      filecoin: 0n,
      webtorrent: 0n,
      http: 0n,
    }

    for (const event of events24h) {
      const costPerGb = this.getBackendCostPerGb(event.backend)
      const costForEvent =
        (costPerGb * BigInt(event.sizeBytes)) / BigInt(1024 * 1024 * 1024)
      costByBackend[event.backend] += costForEvent
    }

    const storageCost24h = Object.values(costByBackend).reduce(
      (a, b) => a + b,
      0n,
    )
    const bandwidthCost24h = this.calculateBandwidthCost(events24h)

    const storageCost7d = storageCost24h * 7n
    const bandwidthCost7d = this.calculateBandwidthCost(events7d)

    return {
      storageCost24h,
      bandwidthCost24h,
      totalCost24h: storageCost24h + bandwidthCost24h,
      storageCost7d,
      bandwidthCost7d,
      totalCost7d: storageCost7d + bandwidthCost7d,
      projectedMonthlyCost: (storageCost24h + bandwidthCost24h) * 30n,
      costByBackend,
      costTrend: 0, // Would calculate from historical data
    }
  }

  private calculatePerformanceMetrics(): PerformanceMetrics {
    const now = Date.now()
    const day = 86400000

    const events24h = this.events.filter(
      (e) => e.timestamp > now - day && e.success,
    )
    const latencies = events24h
      .map((e) => e.latencyMs)
      .filter((l) => l > 0)
      .sort((a, b) => a - b)

    const errorsByType: Record<string, number> = {}
    const errors = this.events.filter(
      (e) => !e.success && e.timestamp > now - day,
    )
    for (const error of errors) {
      const key = error.errorCode ?? 'unknown'
      errorsByType[key] = (errorsByType[key] ?? 0) + 1
    }

    // Calculate throughput
    const bandwidth = events24h.reduce((sum, e) => sum + e.sizeBytes, 0)
    const timeSpanMs =
      events24h.length > 0
        ? Math.max(
            events24h[events24h.length - 1].timestamp - events24h[0].timestamp,
            1,
          )
        : 1
    const avgThroughputMbps = (bandwidth * 8) / (timeSpanMs / 1000) / 1000000

    // Calculate cache hit rate (estimate based on latency)
    const fastRequests = latencies.filter((l) => l < 50).length
    const cacheHitRate =
      latencies.length > 0 ? fastRequests / latencies.length : 0

    return {
      p50LatencyMs: this.percentile(latencies, 50),
      p95LatencyMs: this.percentile(latencies, 95),
      p99LatencyMs: this.percentile(latencies, 99),
      avgThroughputMbps,
      peakThroughputMbps: avgThroughputMbps * 2, // Estimate
      cacheHitRate,
      errorsByType,
    }
  }

  private calculateTrendMetrics(): TrendMetrics {
    const now = Date.now()
    const day = 86400000

    const events24h = this.events.filter((e) => e.timestamp > now - day)
    const events48h = this.events.filter(
      (e) => e.timestamp > now - 2 * day && e.timestamp <= now - day,
    )

    const bandwidth24h = events24h.reduce((sum, e) => sum + e.sizeBytes, 0)
    const bandwidth48h = events48h.reduce((sum, e) => sum + e.sizeBytes, 0)

    const requests24h = events24h.length
    const requests48h = events48h.length

    return {
      storageGrowthRate: bandwidth24h - bandwidth48h,
      bandwidthTrend:
        bandwidth48h > 0
          ? ((bandwidth24h - bandwidth48h) / bandwidth48h) * 100
          : 0,
      requestTrend:
        requests48h > 0 ? ((requests24h - requests48h) / requests48h) * 100 : 0,
      costTrend: 0, // Would calculate from cost history
      userGrowthRate: 0, // Would calculate from user data
      contentGrowthRate: 0, // Would calculate from content data
    }
  }

  getTopContent(limit: number): ContentRanking[] {
    const now = Date.now()
    const day = 86400000
    const twoDays = day * 2

    const rankings: ContentRanking[] = []

    for (const [cid, access] of this.contentAccess) {
      // Get events for this content
      const events24h = this.events.filter(
        (e) => e.cid === cid && e.timestamp > now - day,
      )
      const eventsPrev = this.events.filter(
        (e) =>
          e.cid === cid &&
          e.timestamp > now - twoDays &&
          e.timestamp <= now - day,
      )

      const requests24h = events24h.length
      const requestsPrev = eventsPrev.length

      let trendDirection: 'up' | 'down' | 'stable' = 'stable'
      if (requests24h > requestsPrev * 1.1) {
        trendDirection = 'up'
      } else if (requests24h < requestsPrev * 0.9) {
        trendDirection = 'down'
      }

      rankings.push({
        cid,
        name: `${cid.slice(0, 12)}...`, // Would look up actual name
        requests24h: access.count,
        bandwidth24h: access.bandwidth,
        tier: 'popular', // Would look up actual tier
        category: 'user-content', // Would look up actual category
        lastAccessed: access.lastAccessed,
        trendDirection,
      })
    }

    return rankings
      .sort((a, b) => b.requests24h - a.requests24h)
      .slice(0, limit)
  }

  getTimeSeries(
    metric: 'bandwidth' | 'requests' | 'errors' | 'latency',
    hours = 24,
  ): TimeSeriesDataPoint[] {
    const now = Date.now()
    const points: TimeSeriesDataPoint[] = []

    for (let i = hours - 1; i >= 0; i--) {
      const hourBucket = Math.floor((now - i * 3600000) / 3600000) * 3600000

      let value = 0
      switch (metric) {
        case 'bandwidth':
          value = this.hourlyBandwidth.get(hourBucket) ?? 0
          break
        case 'requests':
          value = this.hourlyRequests.get(hourBucket) ?? 0
          break
        case 'errors':
          value = this.hourlyErrors.get(hourBucket) ?? 0
          break
        case 'latency': {
          const latencies = this.hourlyLatency.get(hourBucket) ?? []
          value =
            latencies.length > 0
              ? latencies.reduce((a, b) => a + b, 0) / latencies.length
              : 0
          break
        }
      }

      points.push({ timestamp: hourBucket, value })
    }

    return points
  }

  getUserAnalytics(address: Address): UserAnalytics | undefined {
    return this.userMetrics.get(address)
  }

  getTopUsers(limit: number): UserAnalytics[] {
    return Array.from(this.userMetrics.values())
      .sort((a, b) => b.bandwidth24h - a.bandwidth24h)
      .slice(0, limit)
  }

  // ============ Helper Methods ============

  private calculateAvgLatency(events: AnalyticsEvent[]): number {
    const latencies = events.map((e) => e.latencyMs).filter((l) => l > 0)
    return latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0
  }

  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0
    const index = Math.ceil((p / 100) * sortedArray.length) - 1
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))]
  }

  private getBackendCostPerGb(backend: StorageBackendType): bigint {
    // Approximate costs per GB in wei (1 ETH = 10^18 wei)
    const costs: Record<StorageBackendType, bigint> = {
      local: 0n, // Free
      ipfs: 100000000000000n, // 0.0001 ETH
      arweave: 1000000000000000n, // 0.001 ETH (permanent)
      filecoin: 500000000000000n, // 0.0005 ETH
      webtorrent: 0n, // Free P2P
      http: 200000000000000n, // 0.0002 ETH
    }
    return costs[backend]
  }

  private calculateBandwidthCost(events: AnalyticsEvent[]): bigint {
    const downloads = events.filter((e) => e.eventType === 'download')
    const totalBytes = downloads.reduce((sum, e) => sum + e.sizeBytes, 0)

    // Cost per GB of bandwidth (0.0001 ETH)
    const costPerGb = 100000000000000n
    return (costPerGb * BigInt(totalBytes)) / BigInt(1024 * 1024 * 1024)
  }

  private getActiveNodeCount(): number {
    // Would query node registry
    return 5
  }

  private getActiveUserCount(): number {
    const now = Date.now()
    const day = 86400000

    let count = 0
    for (const metrics of this.userMetrics.values()) {
      if (metrics.lastActive > now - day) {
        count++
      }
    }
    return count
  }

  // ============ Cleanup ============

  private cleanup(): void {
    const now = Date.now()
    const retention = this.config.retentionDays * 86400000

    // Clean up old events
    this.events = this.events.filter((e) => e.timestamp > now - retention)

    // Clean up old hourly buckets
    const cutoff = now - retention
    for (const [bucket] of this.hourlyBandwidth) {
      if (bucket < cutoff) {
        this.hourlyBandwidth.delete(bucket)
        this.hourlyRequests.delete(bucket)
        this.hourlyErrors.delete(bucket)
        this.hourlyLatency.delete(bucket)
      }
    }

    // Clean up old aggregated metrics
    for (const [key] of this.aggregatedMetrics) {
      if (Number.parseInt(key, 10) < cutoff) {
        this.aggregatedMetrics.delete(key)
      }
    }
  }
}

// ============ Singleton Factory ============

let analyticsManager: StorageAnalyticsManager | null = null

export function getStorageAnalyticsManager(
  config?: Partial<AnalyticsConfig>,
): StorageAnalyticsManager {
  if (!analyticsManager) {
    analyticsManager = new StorageAnalyticsManager(config)
  }
  return analyticsManager
}
