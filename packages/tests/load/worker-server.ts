#!/usr/bin/env bun

/**
 * Worker-Compatible Test Server
 *
 * A serverless-compatible test server that uses distributed caching.
 * Unlike cached-server.ts which uses in-memory cache, this server:
 *
 * 1. Uses CacheClient for distributed caching (works across workers)
 * 2. Has no in-memory state that would break with multiple instances
 * 3. Simulates real database operations
 * 4. Can be deployed as a Cloudflare Worker or DWS worker
 *
 * REQUIREMENTS:
 * - Cache service must be running at CACHE_SERVICE_URL (default: http://localhost:4015)
 * - Start cache service: bun packages/tests/load/cache-service.ts
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { Elysia, t } from 'elysia'

const PORT = parseInt(process.env.PORT ?? '4097', 10)
const CACHE_NAMESPACE = 'worker-test'

// Get distributed cache client
const cache: CacheClient = getCacheClient(CACHE_NAMESPACE)

// Simulate database query with real I/O
async function simulateDbQuery(ms: number = 10): Promise<void> {
  // In production this would be EQLite or other DB
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Request tracking (in distributed cache for cross-worker visibility)
async function trackRequest(path: string): Promise<void> {
  const key = `metrics:${path}`
  const current = await cache.get(key)
  const count = current ? parseInt(current, 10) + 1 : 1
  await cache.set(key, count.toString(), 3600)
}

// ============================================================================
// Worker-Compatible Server
// ============================================================================

const app = new Elysia()
  // Health check - fails if cache is unavailable
  .get('/health', async ({ set }) => {
    // Check cache connectivity - fail fast if unavailable
    await cache.set('health-check', Date.now().toString(), 60)
    const val = await cache.get('health-check')

    if (!val) {
      set.status = 503
      throw new Error('Cache service not responding correctly')
    }

    return {
      status: 'healthy',
      service: 'worker-test-server',
      cache: 'connected',
      timestamp: new Date().toISOString(),
      mode: 'distributed',
    }
  })

  // Root info
  .get('/', () => ({
    name: 'Worker-Compatible Test Server',
    version: '1.0.0',
    description: 'Serverless-compatible test server with distributed caching',
    features: [
      'distributed-cache',
      'worker-compatible',
      'no-in-memory-state',
      'cross-instance-sharing',
    ],
    endpoints: {
      health: '/health',
      api: '/api/*',
      metrics: '/metrics',
      cache: '/cache/stats',
    },
  }))

  // ============================================================================
  // Cached Endpoints (using distributed cache)
  // ============================================================================

  // Fast endpoint - distributed cache
  .get('/api/fast', async () => {
    const cacheKey = 'fast'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/fast')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    await simulateDbQuery(randomDelay(1, 5))
    const result = {
      data: 'fast response',
      latency: 'low',
      timestamp: Date.now(),
    }
    await cache.set(cacheKey, JSON.stringify(result), 30)
    await trackRequest('/api/fast')
    return { ...result, cached: false, source: 'origin' }
  })

  // Medium endpoint - distributed cache
  .get('/api/medium', async () => {
    const cacheKey = 'medium'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/medium')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    await simulateDbQuery(randomDelay(10, 50))
    const result = {
      data: 'medium response',
      latency: 'medium',
      timestamp: Date.now(),
    }
    await cache.set(cacheKey, JSON.stringify(result), 60)
    await trackRequest('/api/medium')
    return { ...result, cached: false, source: 'origin' }
  })

  // Slow endpoint - aggressive caching
  .get('/api/slow', async () => {
    const cacheKey = 'slow'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/slow')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    await simulateDbQuery(randomDelay(50, 200))
    const result = {
      data: 'slow response',
      latency: 'high',
      timestamp: Date.now(),
    }
    await cache.set(cacheKey, JSON.stringify(result), 120)
    await trackRequest('/api/slow')
    return { ...result, cached: false, source: 'origin' }
  })

  // Variable endpoint - normalized with distributed cache
  .get('/api/variable', async () => {
    const cacheKey = 'variable'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/variable')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    // Without caching: 5% chance of 100-500ms delay
    const dice = Math.random()
    if (dice < 0.7) {
      await simulateDbQuery(randomDelay(5, 20))
    } else if (dice < 0.95) {
      await simulateDbQuery(randomDelay(20, 100))
    } else {
      await simulateDbQuery(randomDelay(100, 500))
    }

    const result = { data: 'variable response', timestamp: Date.now() }
    await cache.set(cacheKey, JSON.stringify(result), 60)
    await trackRequest('/api/variable')
    return { ...result, cached: false, source: 'origin' }
  })

  // Reliable endpoint - simple cached response
  .get('/api/reliable', async () => {
    const cacheKey = 'reliable'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/reliable')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    const result = { message: 'Always reliable', timestamp: Date.now() }
    await cache.set(cacheKey, JSON.stringify(result), 30)
    await trackRequest('/api/reliable')
    return { ...result, cached: false, source: 'origin' }
  })

  // Compute endpoint - cached computation
  .get('/api/compute', async () => {
    const cacheKey = 'compute'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/compute')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    // Expensive computation
    let sum = 0
    for (let i = 0; i < 100000; i++) {
      sum += Math.sqrt(i)
    }

    const result = { computed: sum }
    await cache.set(cacheKey, JSON.stringify(result), 300)
    await trackRequest('/api/compute')
    return { ...result, cached: false, source: 'origin' }
  })

  // Items endpoint - paginated with cache
  .get(
    '/api/items',
    async ({ query }) => {
      const page = query.page ?? 1
      const cacheKey = `items:${page}`
      const cached = await cache.get(cacheKey)

      if (cached) {
        await trackRequest('/api/items')
        return { ...JSON.parse(cached), cached: true, source: 'distributed' }
      }

      await simulateDbQuery(randomDelay(20, 80))
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: (page - 1) * 50 + i + 1,
        name: `Item ${(page - 1) * 50 + i + 1}`,
        value: Math.random() * 1000,
      }))

      const result = { items, count: items.length, page }
      await cache.set(cacheKey, JSON.stringify(result), 60)
      await trackRequest('/api/items')
      return { ...result, cached: false, source: 'origin' }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number({ default: 1 })),
      }),
    },
  )

  // Search endpoint - query-based cache
  .get(
    '/api/search',
    async ({ query }) => {
      const q = query.q ?? ''
      const cacheKey = `search:${q.toLowerCase().trim()}`
      const cached = await cache.get(cacheKey)

      if (cached) {
        await trackRequest('/api/search')
        return { ...JSON.parse(cached), cached: true, source: 'distributed' }
      }

      await simulateDbQuery(randomDelay(30, 100))
      const results = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        title: `Result ${i + 1} for "${q}"`,
        score: Math.random(),
      }))

      const result = { query: q, results }
      await cache.set(cacheKey, JSON.stringify(result), 60)
      await trackRequest('/api/search')
      return { ...result, cached: false, source: 'origin' }
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ default: '' })),
      }),
    },
  )

  // Stats endpoint - short TTL for frequently changing data
  .get('/api/stats', async () => {
    const cacheKey = 'stats'
    const cached = await cache.get(cacheKey)

    if (cached) {
      await trackRequest('/api/stats')
      return { ...JSON.parse(cached), cached: true, source: 'distributed' }
    }

    await simulateDbQuery(randomDelay(10, 30))
    const result = {
      users: Math.floor(Math.random() * 10000) + 1000,
      transactions: Math.floor(Math.random() * 100000) + 10000,
      volume: Math.random() * 1000000,
      timestamp: Date.now(),
    }

    await cache.set(cacheKey, JSON.stringify(result), 15)
    await trackRequest('/api/stats')
    return { ...result, cached: false, source: 'origin' }
  })

  // ============================================================================
  // Cache Management
  // ============================================================================

  .get('/cache/stats', async () => {
    const stats = await cache.getStats()
    return { cache: 'distributed', ...stats }
  })

  .post('/cache/invalidate', async () => {
    await cache.clear()
    return { success: true, message: 'Cache cleared' }
  })

  // ============================================================================
  // Metrics (from distributed cache)
  // ============================================================================

  .get('/metrics', async () => {
    const keys = await cache.keys('metrics:*')
    const endpoints: Array<{ path: string; count: number }> = []

    for (const key of keys) {
      const count = await cache.get(key)
      if (count) {
        endpoints.push({
          path: key.replace('metrics:', ''),
          count: parseInt(count, 10),
        })
      }
    }

    const stats = await cache.getStats()

    return {
      mode: 'distributed',
      cacheStats: stats,
      endpoints: endpoints.sort((a, b) => b.count - a.count),
      timestamp: new Date().toISOString(),
    }
  })

console.log(`
══════════════════════════════════════════════════════════════════════
  WORKER-COMPATIBLE TEST SERVER (Distributed Cache)
══════════════════════════════════════════════════════════════════════
  Port: ${PORT}
  Cache: ${process.env.CACHE_SERVICE_URL ?? 'http://localhost:4015'}
  Namespace: ${CACHE_NAMESPACE}

  This server uses distributed caching and has NO in-memory state.
  It can run as multiple instances (workers) sharing the same cache.

  REQUIREMENTS:
  ─────────────────────────────────────────────────────────────────────
  1. Start cache service first:
     bun packages/tests/load/cache-service.ts

  2. Then start this server:
     bun packages/tests/load/worker-server.ts

══════════════════════════════════════════════════════════════════════
`)

app.listen(PORT, () => {
  console.log(`🚀 Worker server running at http://localhost:${PORT}`)
})
