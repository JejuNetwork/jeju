/**
 * API Caching Middleware
 *
 * DWS-style caching middleware for Elysia/Hono applications.
 * Provides LRU caching with stale-while-revalidate support.
 *
 * Usage:
 *   import { createCacheMiddleware, CacheConfig } from '@jejunetwork/shared/middleware/cache'
 *
 *   const cache = createCacheMiddleware({
 *     maxSize: 1000,
 *     defaultTTL: 60000,
 *     staleTTL: 30000,
 *   })
 *
 *   app.use(cache.middleware)
 *   app.get('/api/items', cache.wrap(async () => fetchItems()))
 */

// ============================================================================
// Types
// ============================================================================

export interface CacheConfig {
  /** Maximum number of entries in cache */
  maxSize: number
  /** Default TTL in milliseconds */
  defaultTTL: number
  /** Time data can be served stale while revalidating (ms) */
  staleTTL: number
  /** Paths to exclude from caching (regex patterns) */
  excludePaths?: RegExp[]
  /** Only cache GET requests by default */
  cacheMethods?: string[]
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
  staleAt: number
  createdAt: number
  key: string
}

interface CacheStats {
  size: number
  maxSize: number
  hits: number
  misses: number
  staleHits: number
  hitRate: string
  avgLatencyWithCache: number
  avgLatencyWithoutCache: number
}

interface CacheResult<T> {
  value: T | null
  isHit: boolean
  isStale: boolean
}

// ============================================================================
// LRU Cache Implementation
// ============================================================================

export class APICache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>()
  private accessOrder: string[] = []
  private stats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    latencyWithCache: 0,
    latencyWithoutCache: 0,
    cacheRequests: 0,
    fetchRequests: 0,
  }

  constructor(private readonly config: CacheConfig) {}

  get(key: string): CacheResult<T> {
    const entry = this.cache.get(key)
    const now = Date.now()

    if (!entry) {
      this.stats.misses++
      return { value: null, isHit: false, isStale: false }
    }

    // Check if completely expired (beyond stale window)
    if (now > entry.expiresAt + this.config.staleTTL) {
      this.cache.delete(key)
      this.accessOrder = this.accessOrder.filter((k) => k !== key)
      this.stats.misses++
      return { value: null, isHit: false, isStale: false }
    }

    // Move to end (most recently used)
    this.accessOrder = this.accessOrder.filter((k) => k !== key)
    this.accessOrder.push(key)

    // Check if stale but still usable
    if (now > entry.staleAt) {
      this.stats.staleHits++
      return { value: entry.value, isHit: true, isStale: true }
    }

    this.stats.hits++
    return { value: entry.value, isHit: true, isStale: false }
  }

  set(key: string, value: T, ttl?: number): void {
    const now = Date.now()
    const effectiveTTL = ttl ?? this.config.defaultTTL

    // Evict LRU entries if at capacity
    while (this.cache.size >= this.config.maxSize) {
      const lruKey = this.accessOrder.shift()
      if (lruKey) {
        this.cache.delete(lruKey)
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: now + effectiveTTL,
      staleAt: now + effectiveTTL - this.config.staleTTL,
      createdAt: now,
      key,
    })

    // Update access order
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

  recordLatency(withCache: boolean, latencyMs: number): void {
    if (withCache) {
      this.stats.latencyWithCache += latencyMs
      this.stats.cacheRequests++
    } else {
      this.stats.latencyWithoutCache += latencyMs
      this.stats.fetchRequests++
    }
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      staleHits: this.stats.staleHits,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0',
      avgLatencyWithCache:
        this.stats.cacheRequests > 0
          ? this.stats.latencyWithCache / this.stats.cacheRequests
          : 0,
      avgLatencyWithoutCache:
        this.stats.fetchRequests > 0
          ? this.stats.latencyWithoutCache / this.stats.fetchRequests
          : 0,
    }
  }

  keys(): string[] {
    return [...this.cache.keys()]
  }
}

// ============================================================================
// Cache Key Generation
// ============================================================================

export function generateCacheKey(
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): string {
  let key = `${method}:${path}`

  if (query && Object.keys(query).length > 0) {
    const sortedQuery = Object.entries(query)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    key += `?${sortedQuery}`
  }

  if (body && method !== 'GET') {
    key += `:${JSON.stringify(body)}`
  }

  return key
}

// ============================================================================
// Middleware Factory
// ============================================================================

export interface CacheMiddlewareResult {
  cache: APICache
  /** Wrap an async function with caching */
  wrap: <R>(
    key: string,
    fn: () => Promise<R>,
    options?: { ttl?: number },
  ) => Promise<R>
  /** Get cache statistics */
  getStats: () => CacheStats
  /** Invalidate cache entries */
  invalidate: (pattern?: string) => number
}

export function createCacheMiddleware(
  config: Partial<CacheConfig> = {},
): CacheMiddlewareResult {
  const fullConfig: CacheConfig = {
    maxSize: config.maxSize ?? 1000,
    defaultTTL: config.defaultTTL ?? 60000,
    staleTTL: config.staleTTL ?? 30000,
    excludePaths: config.excludePaths ?? [/\/health/, /\/metrics/],
    cacheMethods: config.cacheMethods ?? ['GET'],
  }

  const cache = new APICache(fullConfig)

  return {
    cache,

    wrap: async <R>(
      key: string,
      fn: () => Promise<R>,
      options?: { ttl?: number },
    ): Promise<R> => {
      const start = performance.now()
      const cached = cache.get(key) as CacheResult<R>

      if (cached.value !== null) {
        cache.recordLatency(true, performance.now() - start)

        // If stale, trigger background refresh
        if (cached.isStale) {
          fn()
            .then((result) => cache.set(key, result, options?.ttl))
            .catch(console.error)
        }

        return cached.value
      }

      // Cache miss - fetch fresh data
      const result = await fn()
      cache.recordLatency(false, performance.now() - start)
      cache.set(key, result, options?.ttl)
      return result
    },

    getStats: () => cache.getStats(),

    invalidate: (pattern?: string) => cache.invalidate(pattern),
  }
}

// ============================================================================
// Specialized Cache Factories
// ============================================================================

/** Create a cache optimized for search results */
export function createSearchCache(maxQueries = 1000, ttlMs = 60000) {
  return createCacheMiddleware({
    maxSize: maxQueries,
    defaultTTL: ttlMs,
    staleTTL: ttlMs / 2,
  })
}

/** Create a cache optimized for list/pagination */
export function createListCache(maxPages = 100, ttlMs = 120000) {
  return createCacheMiddleware({
    maxSize: maxPages,
    defaultTTL: ttlMs,
    staleTTL: ttlMs / 2,
  })
}

/** Create a cache for expensive computations */
export function createComputeCache(maxResults = 100, ttlMs = 300000) {
  return createCacheMiddleware({
    maxSize: maxResults,
    defaultTTL: ttlMs,
    staleTTL: ttlMs / 5, // Short stale window for compute
  })
}

/** Create a cache for real-time stats (short TTL) */
export function createStatsCache(maxStats = 50, ttlMs = 15000) {
  return createCacheMiddleware({
    maxSize: maxStats,
    defaultTTL: ttlMs,
    staleTTL: ttlMs / 3,
  })
}

// ============================================================================
// Export All
// ============================================================================

export type { CacheEntry, CacheResult, CacheStats }

