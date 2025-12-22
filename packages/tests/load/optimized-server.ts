#!/usr/bin/env bun
/**
 * Optimized Test Server with Caching
 *
 * Demonstrates how to optimize slow endpoints using:
 * 1. In-memory LRU caching for repeated queries
 * 2. Stale-while-revalidate pattern
 * 3. Computation caching for expensive operations
 * 4. Response memoization
 *
 * This server uses DWS-style caching patterns for API optimization.
 */

import { Elysia } from 'elysia'

const PORT = parseInt(process.env.PORT ?? '4098', 10)

// ============================================================================
// LRU Cache Implementation (DWS-style)
// ============================================================================

interface CacheEntry<T> {
  value: T
  expiresAt: number
  staleAt: number
  createdAt: number
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private accessOrder: string[] = []
  private stats = { hits: 0, misses: 0, staleHits: 0 }

  constructor(
    private readonly maxSize: number,
    private readonly defaultTTL: number = 60000, // 60s
    private readonly staleTTL: number = 30000, // 30s stale-while-revalidate
  ) {}

  get(key: string): { value: T | null; isStale: boolean } {
    const entry = this.cache.get(key)
    const now = Date.now()

    if (!entry) {
      this.stats.misses++
      return { value: null, isStale: false }
    }

    // Check if expired (beyond stale window)
    if (now > entry.expiresAt + this.staleTTL) {
      this.cache.delete(key)
      this.accessOrder = this.accessOrder.filter((k) => k !== key)
      this.stats.misses++
      return { value: null, isStale: false }
    }

    // Move to end (most recently used)
    this.accessOrder = this.accessOrder.filter((k) => k !== key)
    this.accessOrder.push(key)

    // Check if stale but still valid
    if (now > entry.staleAt) {
      this.stats.staleHits++
      return { value: entry.value, isStale: true }
    }

    this.stats.hits++
    return { value: entry.value, isStale: false }
  }

  set(key: string, value: T, ttl?: number): void {
    const now = Date.now()
    const effectiveTTL = ttl ?? this.defaultTTL

    // Evict if at capacity
    while (this.cache.size >= this.maxSize) {
      const lruKey = this.accessOrder.shift()
      if (lruKey) {
        this.cache.delete(lruKey)
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: now + effectiveTTL,
      staleAt: now + effectiveTTL - this.staleTTL,
      createdAt: now,
    })

    this.accessOrder = this.accessOrder.filter((k) => k !== key)
    this.accessOrder.push(key)
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const count = this.cache.size
      this.cache.clear()
      this.accessOrder = []
      return count
    }

    const regex = new RegExp(pattern.replace(/\*/g, '.*'))
    let count = 0
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key)
        count++
      }
    }
    this.accessOrder = this.accessOrder.filter((k) => !regex.test(k))
    return count
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      staleHits: this.stats.staleHits,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0',
    }
  }
}

// ============================================================================
// Caches for Different Data Types
// ============================================================================

// Cache for search results (60s TTL, 30s stale window)
const searchCache = new LRUCache<{ query: string; results: unknown[] }>(
  1000, // Max 1000 search queries
  60000, // 60s TTL
  30000, // 30s stale window
)

// Cache for item lists (120s TTL, 60s stale window)
const itemsCache = new LRUCache<{ items: unknown[]; count: number }>(
  100, // Max 100 item lists
  120000, // 2 min TTL
  60000, // 1 min stale window
)

// Cache for stats (30s TTL, 15s stale window) - frequently changing data
const statsCache = new LRUCache<Record<string, unknown>>(
  50,
  30000,
  15000,
)

// Cache for compute results (5 min TTL) - expensive computation
const computeCache = new LRUCache<{ computed: number }>(
  100,
  300000, // 5 min TTL (compute is expensive)
  60000,
)

// ============================================================================
// Simulated DB & Compute
// ============================================================================

const simulateDbQuery = (ms: number = 10) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const randomDelay = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

// ============================================================================
// Metrics Tracking
// ============================================================================

const metrics = {
  requests: 0,
  errors: 0,
  startTime: Date.now(),
  cacheHits: 0,
  cacheMisses: 0,
  endpoints: new Map<
    string,
    { count: number; totalLatency: number; maxLatency: number; cacheHits: number }
  >(),
}

function trackEndpoint(path: string, latency: number, cached: boolean) {
  const existing = metrics.endpoints.get(path) ?? {
    count: 0,
    totalLatency: 0,
    maxLatency: 0,
    cacheHits: 0,
  }
  existing.count++
  existing.totalLatency += latency
  existing.maxLatency = Math.max(existing.maxLatency, latency)
  if (cached) {
    existing.cacheHits++
    metrics.cacheHits++
  } else {
    metrics.cacheMisses++
  }
  metrics.endpoints.set(path, existing)
}

// ============================================================================
// Optimized Server
// ============================================================================

const app = new Elysia()
  .onRequest(() => {
    metrics.requests++
  })

  // Health check
  .get('/health', () => ({
    status: 'healthy',
    service: 'optimized-load-test-server',
    timestamp: new Date().toISOString(),
    caching: 'enabled',
  }))

  // Root info
  .get('/', () => ({
    name: 'Optimized Load Test Server',
    version: '1.0.0',
    description: 'Test server with DWS-style caching for performance optimization',
    features: ['LRU caching', 'stale-while-revalidate', 'computation memoization'],
    endpoints: {
      health: '/health',
      api: '/api/*',
      metrics: '/metrics',
      cache: '/cache/stats',
    },
  }))

  // ============================================================================
  // Optimized Endpoints with Caching
  // ============================================================================

  // Fast endpoint - no caching needed (already fast)
  .get('/api/fast', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(1, 5))
    trackEndpoint('/api/fast', performance.now() - start, false)
    return { data: 'fast response', latency: 'low' }
  })

  // Medium endpoint - cache for repeated requests
  .get('/api/medium', async () => {
    const start = performance.now()
    const cacheKey = 'medium'
    const cached = statsCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/medium', performance.now() - start, true)
      return { ...cached.value, cached: true, stale: cached.isStale }
    }

    await simulateDbQuery(randomDelay(10, 50))
    const result = { data: 'medium response', latency: 'medium', timestamp: Date.now() }
    statsCache.set(cacheKey, result)
    trackEndpoint('/api/medium', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Slow endpoint - aggressive caching with stale-while-revalidate
  .get('/api/slow', async () => {
    const start = performance.now()
    const cacheKey = 'slow'
    const cached = statsCache.get(cacheKey)

    if (cached.value) {
      // If stale, trigger background revalidation
      if (cached.isStale) {
        // Fire and forget revalidation
        setTimeout(async () => {
          await simulateDbQuery(randomDelay(50, 200))
          statsCache.set(cacheKey, {
            data: 'slow response (revalidated)',
            latency: 'high',
            timestamp: Date.now(),
          })
        }, 0)
      }
      trackEndpoint('/api/slow', performance.now() - start, true)
      return { ...cached.value, cached: true, stale: cached.isStale }
    }

    await simulateDbQuery(randomDelay(50, 200))
    const result = { data: 'slow response', latency: 'high', timestamp: Date.now() }
    statsCache.set(cacheKey, result, 120000) // 2 min cache for slow endpoint
    trackEndpoint('/api/slow', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Variable endpoint - normalize and cache
  .get('/api/variable', async () => {
    const start = performance.now()
    const cacheKey = 'variable'
    const cached = statsCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/variable', performance.now() - start, true)
      return { ...cached.value, cached: true }
    }

    // Without caching: 5% chance of 100-500ms delay
    // With caching: this expensive path is avoided for repeated requests
    const dice = Math.random()
    if (dice < 0.7) {
      await simulateDbQuery(randomDelay(5, 20))
    } else if (dice < 0.95) {
      await simulateDbQuery(randomDelay(20, 100))
    } else {
      await simulateDbQuery(randomDelay(100, 500))
    }

    const result = { data: 'variable response', timestamp: Date.now() }
    statsCache.set(cacheKey, result, 10000) // Short 10s cache to reduce variance
    trackEndpoint('/api/variable', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Compute endpoint - MUST cache expensive computation
  .get('/api/compute', () => {
    const start = performance.now()
    const cacheKey = 'compute:default'
    const cached = computeCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/compute', performance.now() - start, true)
      return { ...cached.value, cached: true }
    }

    // Expensive computation
    let sum = 0
    for (let i = 0; i < 100000; i++) {
      sum += Math.sqrt(i)
    }

    const result = { computed: sum }
    computeCache.set(cacheKey, result)
    trackEndpoint('/api/compute', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Items endpoint - cache list with short TTL
  .get('/api/items', async ({ query }) => {
    const start = performance.now()
    const page = parseInt((query.page as string) ?? '1', 10)
    const cacheKey = `items:${page}`
    const cached = itemsCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/items', performance.now() - start, true)
      return { ...cached.value, cached: true, stale: cached.isStale }
    }

    await simulateDbQuery(randomDelay(20, 80))
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: (page - 1) * 50 + i + 1,
      name: `Item ${(page - 1) * 50 + i + 1}`,
      value: Math.random() * 1000,
    }))

    const result = { items, count: items.length, page }
    itemsCache.set(cacheKey, result)
    trackEndpoint('/api/items', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Search endpoint - cache with query as key
  .get('/api/search', async ({ query }) => {
    const start = performance.now()
    const q = (query.q as string) ?? ''
    const cacheKey = `search:${q.toLowerCase().trim()}`
    const cached = searchCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/search', performance.now() - start, true)
      return { ...cached.value, cached: true, stale: cached.isStale }
    }

    await simulateDbQuery(randomDelay(30, 100))
    const results = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      title: `Result ${i + 1} for "${q}"`,
      score: Math.random(),
    }))

    const result = { query: q, results }
    searchCache.set(cacheKey, result)
    trackEndpoint('/api/search', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Stats endpoint - short cache for frequently changing data
  .get('/api/stats', async () => {
    const start = performance.now()
    const cacheKey = 'stats'
    const cached = statsCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/stats', performance.now() - start, true)
      return { ...cached.value, cached: true }
    }

    await simulateDbQuery(randomDelay(10, 30))
    const result = {
      totalUsers: 12345,
      activeUsers: 567,
      transactions: 89012,
      volume: '1234567.89',
      timestamp: Date.now(),
    }
    statsCache.set(cacheKey, result, 15000) // 15s cache for real-time stats
    trackEndpoint('/api/stats', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // Reliable endpoint
  .get('/api/reliable', async () => {
    const start = performance.now()
    const cacheKey = 'reliable'
    const cached = statsCache.get(cacheKey)

    if (cached.value) {
      trackEndpoint('/api/reliable', performance.now() - start, true)
      return { ...cached.value, cached: true }
    }

    await simulateDbQuery(randomDelay(10, 50))
    const result = { status: 'ok', reliable: true }
    statsCache.set(cacheKey, result)
    trackEndpoint('/api/reliable', performance.now() - start, false)
    return { ...result, cached: false }
  })

  // POST endpoint (not cached - mutations)
  .post('/api/submit', async ({ body }) => {
    await simulateDbQuery(randomDelay(20, 60))
    // Invalidate related caches on write
    itemsCache.invalidate('items:*')
    statsCache.invalidate('stats')
    return {
      received: body,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
  })

  // ============================================================================
  // Cache Management Endpoints
  // ============================================================================

  .get('/cache/stats', () => ({
    search: searchCache.getStats(),
    items: itemsCache.getStats(),
    stats: statsCache.getStats(),
    compute: computeCache.getStats(),
    global: {
      hits: metrics.cacheHits,
      misses: metrics.cacheMisses,
      hitRate:
        metrics.cacheHits + metrics.cacheMisses > 0
          ? (
              (metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)) *
              100
            ).toFixed(1)
          : '0',
    },
  }))

  .post('/cache/invalidate', () => {
    const purged =
      searchCache.invalidate() +
      itemsCache.invalidate() +
      statsCache.invalidate() +
      computeCache.invalidate()
    return { success: true, entriesPurged: purged }
  })

  // ============================================================================
  // Metrics
  // ============================================================================

  .get('/metrics', () => {
    const uptime = (Date.now() - metrics.startTime) / 1000

    const endpointStats = Array.from(metrics.endpoints.entries())
      .map(([path, stats]) => ({
        path,
        count: stats.count,
        avgLatency:
          stats.count > 0 ? (stats.totalLatency / stats.count).toFixed(2) : '0',
        maxLatency: stats.maxLatency.toFixed(2),
        hitRate: ((stats.count / metrics.requests) * 100).toFixed(1),
        cacheHitRate:
          stats.count > 0
            ? ((stats.cacheHits / stats.count) * 100).toFixed(1)
            : '0',
      }))
      .sort((a, b) => b.count - a.count)

    const slowest = [...endpointStats].sort(
      (a, b) => parseFloat(b.avgLatency) - parseFloat(a.avgLatency),
    ).slice(0, 5)

    const hottest = endpointStats.slice(0, 5)

    return {
      summary: {
        requests: metrics.requests,
        errors: metrics.errors,
        uptime: `${uptime.toFixed(1)}s`,
        rps: (metrics.requests / uptime).toFixed(2),
        cacheHitRate:
          metrics.cacheHits + metrics.cacheMisses > 0
            ? (
                (metrics.cacheHits /
                  (metrics.cacheHits + metrics.cacheMisses)) *
                100
              ).toFixed(1)
            : '0',
      },
      hottest,
      slowest,
      allEndpoints: endpointStats,
      cacheStats: {
        search: searchCache.getStats(),
        items: itemsCache.getStats(),
        stats: statsCache.getStats(),
        compute: computeCache.getStats(),
      },
    }
  })

console.log(`
══════════════════════════════════════════════════════════════════════
  OPTIMIZED LOAD TEST SERVER (with DWS-style caching)
══════════════════════════════════════════════════════════════════════
  Port: ${PORT}

  OPTIMIZATIONS APPLIED:
  ─────────────────────────────────────────────────────────────────────
  /api/slow       → Aggressive caching + stale-while-revalidate
  /api/search     → Query-based LRU cache (1000 entries)
  /api/items      → Page-based LRU cache (100 entries)
  /api/stats      → Short TTL cache (15s) for real-time data
  /api/compute    → Computation memoization (5 min TTL)
  /api/variable   → Short TTL to reduce variance

  CACHE MANAGEMENT:
  ─────────────────────────────────────────────────────────────────────
  /cache/stats    → View cache statistics
  /cache/invalidate → Purge all caches
  /metrics        → Endpoint metrics + cache hit rates

══════════════════════════════════════════════════════════════════════
`)

app.listen(PORT, () => {
  console.log(`🚀 Optimized server running at http://localhost:${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health`)
  console.log(`   Cache Stats: http://localhost:${PORT}/cache/stats`)
})

export { app }

