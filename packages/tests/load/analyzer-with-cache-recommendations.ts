#!/usr/bin/env bun
/**
 * Performance Analyzer with DWS Cache Recommendations
 *
 * Analyzes load test results and provides specific recommendations
 * for integrating DWS caching to optimize slow endpoints.
 */

import { z } from 'zod'

// Metrics response schema
const EndpointMetricsSchema = z.object({
  path: z.string(),
  avgLatency: z.union([z.number(), z.string()]),
  maxLatency: z.union([z.number(), z.string()]),
  count: z.number(),
  cacheHitRate: z.union([z.number(), z.string()]).optional(),
})

const MetricsResponseSchema = z.object({
  slowest: z.array(EndpointMetricsSchema),
  allEndpoints: z.array(EndpointMetricsSchema),
})

interface EndpointMetrics {
  path: string
  avgLatency: number | string
  maxLatency: number | string
  count: number
  cacheHitRate?: number | string
}

interface CacheRecommendation {
  endpoint: string
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  latencyImpact: string
  cacheStrategy:
    | 'lru'
    | 'ttl'
    | 'stale-while-revalidate'
    | 'compute-memoization'
    | 'none'
  suggestedTTL: number
  dwsIntegration: string
  codeExample: string
}

// Thresholds for determining what's "slow"
const LATENCY_THRESHOLDS = {
  critical: 100, // > 100ms
  high: 50, // > 50ms
  medium: 20, // > 20ms
  low: 10, // > 10ms
}

function analyzeEndpoint(metrics: EndpointMetrics): CacheRecommendation | null {
  const { path, avgLatency, maxLatency } = metrics

  // Skip already well-cached endpoints
  if (metrics.cacheHitRate && metrics.cacheHitRate > 90) {
    return null
  }

  // Determine severity
  let severity: CacheRecommendation['severity']
  if (avgLatency > LATENCY_THRESHOLDS.critical) {
    severity = 'critical'
  } else if (avgLatency > LATENCY_THRESHOLDS.high) {
    severity = 'high'
  } else if (avgLatency > LATENCY_THRESHOLDS.medium) {
    severity = 'medium'
  } else if (avgLatency > LATENCY_THRESHOLDS.low) {
    severity = 'low'
  } else {
    return null // Fast enough
  }

  // Determine cache strategy based on endpoint type
  let cacheStrategy: CacheRecommendation['cacheStrategy'] = 'lru'
  let suggestedTTL = 60000 // 1 minute default
  let dwsIntegration = ''
  let codeExample = ''
  let issue = ''

  // Analyze endpoint path to determine appropriate strategy
  if (path.includes('/search') || path.includes('/query')) {
    cacheStrategy = 'lru'
    suggestedTTL = 60000 // 1 minute
    issue = 'Search queries are expensive - repeated searches can be cached'
    dwsIntegration =
      'Use DWS EdgeCache with query-based keys for search result caching'
    codeExample = `
// packages/shared/src/cache/search-cache.ts
import { LRUCache } from 'lru-cache'

const searchCache = new LRUCache<string, SearchResult>({
  max: 1000,
  ttl: 60000, // 1 minute
  updateAgeOnGet: true,
})

export async function cachedSearch(query: string): Promise<SearchResult> {
  const cacheKey = \`search:\${query.toLowerCase().trim()}\`
  const cached = searchCache.get(cacheKey)
  if (cached) return cached

  const result = await performSearch(query)
  searchCache.set(cacheKey, result)
  return result
}`
  } else if (path.includes('/items') || path.includes('/list')) {
    cacheStrategy = 'stale-while-revalidate'
    suggestedTTL = 120000 // 2 minutes
    issue =
      'List queries hit database frequently - cache with SWR for freshness'
    dwsIntegration =
      'Use DWS EdgeCache with stale-while-revalidate for list data'
    codeExample = `
// packages/shared/src/cache/list-cache.ts
import { getEdgeCache } from '@jejunetwork/dws'

const cache = getEdgeCache({
  defaultTTL: 120,
  staleWhileRevalidate: 60,
})

export async function cachedListItems(page: number): Promise<ListResult> {
  const cacheKey = \`items:page:\${page}\`
  const { entry, status } = cache.get(cacheKey)

  if (entry) {
    if (status === 'STALE') {
      // Revalidate in background
      revalidateItems(page).catch(console.error)
    }
    return JSON.parse(entry.data.toString())
  }

  const result = await fetchItems(page)
  cache.set(cacheKey, Buffer.from(JSON.stringify(result)), { ttl: 120 })
  return result
}`
  } else if (path.includes('/stats') || path.includes('/metrics')) {
    cacheStrategy = 'ttl'
    suggestedTTL = 15000 // 15 seconds - real-time data
    issue = 'Stats are computed frequently but change slowly - short TTL cache'
    dwsIntegration =
      'Use DWS with short TTL for real-time data that updates periodically'
    codeExample = `
// packages/shared/src/cache/stats-cache.ts
interface CachedStats {
  data: Stats
  expiresAt: number
}

let statsCache: CachedStats | null = null

export async function cachedStats(): Promise<Stats> {
  const now = Date.now()
  if (statsCache && statsCache.expiresAt > now) {
    return statsCache.data
  }

  const stats = await computeStats()
  statsCache = { data: stats, expiresAt: now + 15000 } // 15s TTL
  return stats
}`
  } else if (path.includes('/compute') || path.includes('/calculate')) {
    cacheStrategy = 'compute-memoization'
    suggestedTTL = 300000 // 5 minutes
    issue = 'Computation is CPU-intensive - must memoize results'
    dwsIntegration = 'Use DWS compute cache for expensive calculations'
    codeExample = `
// packages/shared/src/cache/compute-cache.ts
import { LRUCache } from 'lru-cache'

const computeCache = new LRUCache<string, ComputeResult>({
  max: 100,
  ttl: 300000, // 5 minutes
})

export async function cachedCompute(params: ComputeParams): Promise<ComputeResult> {
  const cacheKey = \`compute:\${JSON.stringify(params)}\`
  const cached = computeCache.get(cacheKey)
  if (cached) return cached

  const result = await expensiveComputation(params)
  computeCache.set(cacheKey, result)
  return result
}`
  } else if (maxLatency / avgLatency > 5) {
    // High variance - variable latency
    cacheStrategy = 'stale-while-revalidate'
    suggestedTTL = 30000 // 30 seconds
    issue = `High latency variance (${avgLatency.toFixed(1)}ms avg, ${maxLatency.toFixed(1)}ms max) - normalize with caching`
    dwsIntegration = 'Use DWS EdgeCache with SWR to reduce variance'
    codeExample = `
// Reduce latency variance with short-TTL SWR cache
const cache = new LRUCache<string, CachedValue>({
  max: 500,
  ttl: 30000, // 30 seconds
})

// SWR: Return stale data immediately, refresh in background
export async function cachedEndpoint(): Promise<Response> {
  const cached = cache.get('key')
  if (cached) {
    if (cached.isStale) {
      refreshInBackground().catch(console.error)
    }
    return cached.value
  }
  // ... fetch fresh data
}`
  } else {
    // Generic slow endpoint
    cacheStrategy = 'lru'
    suggestedTTL = 60000
    issue = `Slow response (${avgLatency.toFixed(1)}ms avg) - standard LRU caching recommended`
    dwsIntegration = 'Use DWS EdgeCache or in-memory LRU cache'
    codeExample = `
// Generic LRU caching pattern
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, ResponseData>({
  max: 1000,
  ttl: 60000,
})

export async function cachedHandler(key: string): Promise<ResponseData> {
  const cached = cache.get(key)
  if (cached) return cached

  const data = await slowOperation(key)
  cache.set(key, data)
  return data
}`
  }

  return {
    endpoint: path,
    issue,
    severity,
    latencyImpact: `${avgLatency.toFixed(1)}ms avg → <1ms with cache (${((1 - 1 / avgLatency) * 100).toFixed(0)}% improvement)`,
    cacheStrategy,
    suggestedTTL,
    dwsIntegration,
    codeExample,
  }
}

async function analyzeServer(baseUrl: string): Promise<CacheRecommendation[]> {
  const response = await fetch(`${baseUrl}/metrics`)
  if (!response.ok) {
    throw new Error(`Failed to fetch metrics from ${baseUrl}`)
  }

  const metrics = MetricsResponseSchema.parse(await response.json())

  const recommendations: CacheRecommendation[] = []

  for (const endpoint of metrics.allEndpoints) {
    // Parse numeric fields which may come as strings from JSON
    const avgLatency =
      typeof endpoint.avgLatency === 'string'
        ? parseFloat(endpoint.avgLatency)
        : endpoint.avgLatency
    const maxLatency =
      typeof endpoint.maxLatency === 'string'
        ? parseFloat(endpoint.maxLatency)
        : endpoint.maxLatency
    const cacheHitRate = endpoint.cacheHitRate
      ? typeof endpoint.cacheHitRate === 'string'
        ? parseFloat(endpoint.cacheHitRate)
        : endpoint.cacheHitRate
      : undefined
    const recommendation = analyzeEndpoint({
      path: endpoint.path,
      avgLatency,
      maxLatency,
      count: endpoint.count,
      cacheHitRate,
    })

    if (recommendation) {
      recommendations.push(recommendation)
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  return recommendations.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  )
}

async function main() {
  const serverUrl = process.argv[2] ?? 'http://localhost:4099'

  console.log(`
══════════════════════════════════════════════════════════════════════════════════
  PERFORMANCE ANALYSIS & DWS CACHE RECOMMENDATIONS
══════════════════════════════════════════════════════════════════════════════════
  Server: ${serverUrl}
  Analyzing endpoint performance...
══════════════════════════════════════════════════════════════════════════════════
`)

  const recommendations = await analyzeServer(serverUrl)

  if (recommendations.length === 0) {
    console.log(
      '✅ All endpoints performing well - no caching recommendations needed.',
    )
    return
  }

  console.log(`Found ${recommendations.length} endpoints that could benefit from caching:
`)

  for (const rec of recommendations) {
    const severityColors = {
      critical: '🔴 CRITICAL',
      high: '🟠 HIGH',
      medium: '🟡 MEDIUM',
      low: '🟢 LOW',
    }

    console.log(`
────────────────────────────────────────────────────────────────────────────────
${severityColors[rec.severity]}: ${rec.endpoint}
────────────────────────────────────────────────────────────────────────────────
Issue: ${rec.issue}

Impact: ${rec.latencyImpact}

Strategy: ${rec.cacheStrategy.toUpperCase()}
  - TTL: ${rec.suggestedTTL / 1000}s
  - ${rec.dwsIntegration}

Implementation:
${rec.codeExample}
`)
  }

  // Summary
  const critical = recommendations.filter(
    (r) => r.severity === 'critical',
  ).length
  const high = recommendations.filter((r) => r.severity === 'high').length
  const medium = recommendations.filter((r) => r.severity === 'medium').length
  const low = recommendations.filter((r) => r.severity === 'low').length

  console.log(`
══════════════════════════════════════════════════════════════════════════════════
  SUMMARY
══════════════════════════════════════════════════════════════════════════════════
  Critical: ${critical}
  High: ${high}
  Medium: ${medium}
  Low: ${low}

  Total endpoints needing optimization: ${recommendations.length}

  DWS Integration Points:
  ─────────────────────────────────────────────────────────────────────────────────
  1. packages/shared/src/services/cache.ts - Centralized cache service
  2. apps/dws/src/cdn/cache/edge-cache.ts - EdgeCache for CDN-style caching
  3. apps/dws/src/server/routes/prices.ts - Example of price caching

  Next Steps:
  ─────────────────────────────────────────────────────────────────────────────────
  1. Apply LRU caching to high-traffic endpoints first
  2. Use stale-while-revalidate for data that can be slightly stale
  3. Memoize expensive computations
  4. Set up cache invalidation on write operations
  5. Monitor cache hit rates via /cache/stats endpoints
══════════════════════════════════════════════════════════════════════════════════
`)
}

main().catch(console.error)
