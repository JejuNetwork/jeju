#!/usr/bin/env bun
/**
 * Distributed Cache Service
 *
 * A Redis-compatible cache service for testing serverless workers.
 * This runs as a separate process and provides distributed caching
 * that works across multiple worker instances.
 *
 * In production, this is replaced by:
 * - DWS SQLit-backed cache
 * - Redis cluster in TEE
 */

import { Elysia, t } from 'elysia'

const PORT = parseInt(process.env.CACHE_SERVICE_PORT ?? '4015', 10)

interface CacheEntry {
  value: string
  expiresAt: number
  createdAt: number
}

// Distributed cache store
const store = new Map<string, CacheEntry>()

// Stats tracking
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now()
  let expired = 0
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt > 0 && entry.expiresAt < now) {
      store.delete(key)
      expired++
    }
  }
  if (expired > 0) {
    console.log(`[CacheService] Cleaned up ${expired} expired entries`)
  }
}, 30000)

const app = new Elysia()
  // Health check
  .get('/health', () => ({
    status: 'healthy',
    service: 'distributed-cache',
    entries: store.size,
    stats,
    timestamp: new Date().toISOString(),
  }))

  // Cache stats
  .get('/stats', () => ({
    stats: {
      totalKeys: store.size,
      namespaces: 1,
      usedMemoryMb: 0,
      totalMemoryMb: 512,
      hits: stats.hits,
      misses: stats.misses,
      hitRate:
        stats.hits + stats.misses > 0
          ? (stats.hits / (stats.hits + stats.misses)) * 100
          : 0,
      totalInstances: 1,
    },
  }))

  // Get value
  .get(
    '/cache/get',
    ({ query }) => {
      const fullKey = `${query.namespace}:${query.key}`

      const entry = store.get(fullKey)
      if (!entry) {
        stats.misses++
        return { value: null, found: false }
      }

      // Check expiry
      if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
        store.delete(fullKey)
        stats.misses++
        return { value: null, found: false }
      }

      stats.hits++
      return { value: entry.value, found: true }
    },
    {
      query: t.Object({
        key: t.String(),
        namespace: t.String({ default: 'default' }),
      }),
    },
  )

  // Set value
  .post(
    '/cache/set',
    ({ body }) => {
      const ttl = body.ttl ?? 3600
      const namespace = body.namespace ?? 'default'
      const fullKey = `${namespace}:${body.key}`
      const now = Date.now()

      store.set(fullKey, {
        value: body.value,
        expiresAt: ttl > 0 ? now + ttl * 1000 : 0,
        createdAt: now,
      })

      stats.sets++
      return { success: true }
    },
    {
      body: t.Object({
        key: t.String(),
        value: t.String(),
        ttl: t.Optional(t.Number()),
        namespace: t.Optional(t.String()),
      }),
    },
  )

  // Delete value
  .delete(
    '/cache/delete',
    ({ query }) => {
      const fullKey = `${query.namespace}:${query.key}`

      const deleted = store.delete(fullKey)
      if (deleted) stats.deletes++

      return { success: deleted }
    },
    {
      query: t.Object({
        key: t.String(),
        namespace: t.String({ default: 'default' }),
      }),
    },
  )

  // Multi-get
  .post(
    '/cache/mget',
    ({ body }) => {
      const namespace = body.namespace ?? 'default'

      const entries: Record<string, string | null> = {}
      const now = Date.now()

      for (const key of body.keys) {
        const fullKey = `${namespace}:${key}`
        const entry = store.get(fullKey)

        if (!entry || (entry.expiresAt > 0 && entry.expiresAt < now)) {
          entries[key] = null
          stats.misses++
        } else {
          entries[key] = entry.value
          stats.hits++
        }
      }

      return { entries }
    },
    {
      body: t.Object({
        keys: t.Array(t.String()),
        namespace: t.Optional(t.String()),
      }),
    },
  )

  // Multi-set
  .post(
    '/cache/mset',
    ({ body }) => {
      const namespace = body.namespace ?? 'default'

      const now = Date.now()

      for (const entry of body.entries) {
        const ttl = entry.ttl ?? 3600
        const fullKey = `${namespace}:${entry.key}`
        store.set(fullKey, {
          value: entry.value,
          expiresAt: ttl > 0 ? now + ttl * 1000 : 0,
          createdAt: now,
        })
        stats.sets++
      }

      return { success: true }
    },
    {
      body: t.Object({
        entries: t.Array(
          t.Object({
            key: t.String(),
            value: t.String(),
            ttl: t.Optional(t.Number()),
          }),
        ),
        namespace: t.Optional(t.String()),
      }),
    },
  )

  // List keys
  .get(
    '/cache/keys',
    ({ query }) => {
      const prefix = `${query.namespace}:`

      const keys: string[] = []
      const regex = query.pattern
        ? new RegExp(query.pattern.replace(/\*/g, '.*'))
        : null

      for (const fullKey of store.keys()) {
        if (fullKey.startsWith(prefix)) {
          const key = fullKey.slice(prefix.length)
          if (!regex || regex.test(key)) {
            keys.push(key)
          }
        }
      }

      return { keys }
    },
    {
      query: t.Object({
        namespace: t.String({ default: 'default' }),
        pattern: t.Optional(t.String()),
      }),
    },
  )

  // Get TTL
  .get(
    '/cache/ttl',
    ({ query }) => {
      const fullKey = `${query.namespace}:${query.key}`

      const entry = store.get(fullKey)
      if (!entry) return { ttl: -2 }

      if (entry.expiresAt === 0) return { ttl: -1 }

      const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000)
      return { ttl: remaining > 0 ? remaining : -1 }
    },
    {
      query: t.Object({
        key: t.String(),
        namespace: t.String({ default: 'default' }),
      }),
    },
  )

  // Set expiry
  .post(
    '/cache/expire',
    ({ body }) => {
      const namespace = body.namespace ?? 'default'
      const fullKey = `${namespace}:${body.key}`
      const entry = store.get(fullKey)

      if (!entry) return { success: false }

      entry.expiresAt = Date.now() + body.ttl * 1000
      return { success: true }
    },
    {
      body: t.Object({
        key: t.String(),
        ttl: t.Number(),
        namespace: t.Optional(t.String()),
      }),
    },
  )

  // Clear namespace
  .delete(
    '/cache/clear',
    ({ query }) => {
      const prefix = `${query.namespace}:`

      let count = 0
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key)
          count++
        }
      }

      return { success: true, deleted: count }
    },
    {
      query: t.Object({
        namespace: t.String({ default: 'default' }),
      }),
    },
  )

console.log(`
══════════════════════════════════════════════════════════════════════
  DISTRIBUTED CACHE SERVICE
══════════════════════════════════════════════════════════════════════
  Port: ${PORT}

  This is a local development cache service that simulates the
  distributed cache infrastructure in DWS production.

  Endpoints:
  ─────────────────────────────────────────────────────────────────────
  GET  /health          - Health check
  GET  /stats           - Cache statistics
  GET  /cache/get       - Get value
  POST /cache/set       - Set value
  DELETE /cache/delete  - Delete value
  POST /cache/mget      - Multi-get
  POST /cache/mset      - Multi-set
  GET  /cache/keys      - List keys
  GET  /cache/ttl       - Get TTL
  POST /cache/expire    - Set expiry
  DELETE /cache/clear   - Clear namespace

══════════════════════════════════════════════════════════════════════
`)

app.listen(PORT, () => {
  console.log(`🚀 Cache service running at http://localhost:${PORT}`)
})
