#!/usr/bin/env bun
/**
 * Distributed Cache Service
 *
 * A Redis-compatible cache service for Jeju infrastructure.
 * Provides distributed caching that works across multiple worker instances.
 */

import { Elysia, t } from 'elysia'

const PORT = parseInt(process.env.CACHE_SERVICE_PORT ?? '4015', 10)
const MAX_MEMORY_MB = parseInt(process.env.CACHE_MAX_MEMORY_MB ?? '512', 10)
const DEFAULT_TTL = parseInt(process.env.CACHE_DEFAULT_TTL ?? '3600', 10)

interface CacheEntry {
  value: string
  expiresAt: number
  createdAt: number
  size: number
}

const store = new Map<string, CacheEntry>()

const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  memoryUsedBytes: 0,
}

function estimateSize(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

setInterval(() => {
  const now = Date.now()
  let expired = 0
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt > 0 && entry.expiresAt < now) {
      stats.memoryUsedBytes -= entry.size
      store.delete(key)
      expired++
    }
  }
  if (expired > 0) {
    console.log(`[CacheService] Cleaned up ${expired} expired entries`)
  }
}, 30000)

const app = new Elysia()
  .get('/health', () => ({
    status: 'healthy',
    service: 'distributed-cache',
    entries: store.size,
    stats,
    timestamp: new Date().toISOString(),
  }))

  .get('/stats', () => ({
    stats: {
      totalKeys: store.size,
      namespaces: 1,
      usedMemoryMb: Math.round(stats.memoryUsedBytes / 1024 / 1024 * 100) / 100,
      totalMemoryMb: MAX_MEMORY_MB,
      hits: stats.hits,
      misses: stats.misses,
      hitRate:
        stats.hits + stats.misses > 0
          ? (stats.hits / (stats.hits + stats.misses)) * 100
          : 0,
      totalInstances: 1,
    },
  }))

  .get(
    '/cache/get',
    ({ query }) => {
      const fullKey = `${query.namespace}:${query.key}`

      const entry = store.get(fullKey)
      if (!entry) {
        stats.misses++
        return { value: null, found: false }
      }

      if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
        stats.memoryUsedBytes -= entry.size
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

  .post(
    '/cache/set',
    ({ body }) => {
      const ttl = body.ttl ?? DEFAULT_TTL
      const namespace = body.namespace ?? 'default'
      const fullKey = `${namespace}:${body.key}`
      const now = Date.now()
      const size = estimateSize(body.value)

      const existing = store.get(fullKey)
      if (existing) {
        stats.memoryUsedBytes -= existing.size
      }

      store.set(fullKey, {
        value: body.value,
        expiresAt: ttl > 0 ? now + ttl * 1000 : 0,
        createdAt: now,
        size,
      })

      stats.memoryUsedBytes += size
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

  .delete(
    '/cache/delete',
    ({ query }) => {
      const fullKey = `${query.namespace}:${query.key}`

      const entry = store.get(fullKey)
      if (entry) {
        stats.memoryUsedBytes -= entry.size
        store.delete(fullKey)
        stats.deletes++
        return { success: true }
      }

      return { success: false }
    },
    {
      query: t.Object({
        key: t.String(),
        namespace: t.String({ default: 'default' }),
      }),
    },
  )

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

  .post(
    '/cache/mset',
    ({ body }) => {
      const namespace = body.namespace ?? 'default'
      const now = Date.now()

      for (const entry of body.entries) {
        const ttl = entry.ttl ?? DEFAULT_TTL
        const fullKey = `${namespace}:${entry.key}`
        const size = estimateSize(entry.value)

        const existing = store.get(fullKey)
        if (existing) {
          stats.memoryUsedBytes -= existing.size
        }

        store.set(fullKey, {
          value: entry.value,
          expiresAt: ttl > 0 ? now + ttl * 1000 : 0,
          createdAt: now,
          size,
        })
        stats.memoryUsedBytes += size
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

  .delete(
    '/cache/clear',
    ({ query }) => {
      const prefix = `${query.namespace}:`

      let count = 0
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          const entry = store.get(key)
          if (entry) {
            stats.memoryUsedBytes -= entry.size
          }
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

console.log(`[CacheService] Starting on port ${PORT}`)

app.listen(PORT, () => {
  console.log(`[CacheService] Ready at http://localhost:${PORT}`)
})
