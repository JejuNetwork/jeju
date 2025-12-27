/**
 * Cache service HTTP API
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import { CacheEngine } from './engine'
import {
  getCacheProvisioningManager,
  initializeCacheProvisioning,
} from './provisioning'
import type { TEECacheProvider } from './tee-provider'
import {
  CacheError,
  CacheErrorCode,
  type CacheTEEAttestation,
  CacheTier,
} from './types'

// Rate limiting: 1000 requests/minute per owner or IP
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 1000
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, record] of rateLimitStore) {
    if (now > record.resetAt) rateLimitStore.delete(key)
  }
}, 60_000)

function getRateLimitKey(request: Request): string {
  const owner = request.headers.get('x-owner-address')
  if (owner) return `owner:${owner.toLowerCase()}`
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  return `ip:${ip}`
}

function checkRateLimit(request: Request): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const key = getRateLimitKey(request)
  const now = Date.now()

  let record = rateLimitStore.get(key)
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitStore.set(key, record)
  }
  record.count++

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - record.count)
  return {
    allowed: record.count <= RATE_LIMIT_MAX_REQUESTS,
    remaining,
    resetAt: record.resetAt,
  }
}

let sharedEngine: CacheEngine | null = null

/**
 * Extract owner address from request headers.
 * WARNING: Header-based auth is spoofable. For production, integrate
 * signature verification via @jejunetwork/auth.
 */
function getOwnerFromHeaders(
  headers: Record<string, string | undefined>,
): Address {
  const ownerHeader = headers['x-owner-address']
  if (!ownerHeader || !isAddress(ownerHeader)) {
    throw new CacheError(
      CacheErrorCode.UNAUTHORIZED,
      'Valid Ethereum address required in x-owner-address header',
    )
  }
  return ownerHeader
}

export function getSharedEngine(): CacheEngine {
  if (!sharedEngine) {
    sharedEngine = new CacheEngine({
      maxMemoryMb: 1024,
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400 * 7,
      evictionPolicy: 'lru',
    })
  }
  return sharedEngine
}

async function getEngineForNamespace(
  namespace: string,
): Promise<CacheEngine | TEECacheProvider> {
  const manager = getCacheProvisioningManager()
  const instance = manager.getInstanceByNamespace(namespace)

  if (instance) {
    const teeProvider = manager.getTEEProviderByNamespace(namespace)
    if (teeProvider) return teeProvider

    const engine = manager.getEngineByNamespace(namespace)
    if (engine) return engine
  }

  return getSharedEngine()
}

const SetRequestSchema = t.Object({
  key: t.String(),
  value: t.String(),
  ttl: t.Optional(t.Number()),
  namespace: t.Optional(t.String()),
  nx: t.Optional(t.Boolean()),
  xx: t.Optional(t.Boolean()),
})

const DelRequestSchema = t.Object({
  keys: t.Array(t.String()),
  namespace: t.Optional(t.String()),
})

const MGetRequestSchema = t.Object({
  keys: t.Array(t.String()),
  namespace: t.Optional(t.String()),
})

const MSetRequestSchema = t.Object({
  entries: t.Array(
    t.Object({
      key: t.String(),
      value: t.String(),
      ttl: t.Optional(t.Number()),
    }),
  ),
  namespace: t.Optional(t.String()),
})

const ExpireRequestSchema = t.Object({
  key: t.String(),
  ttl: t.Number(),
  namespace: t.Optional(t.String()),
})

const HSetRequestSchema = t.Object({
  key: t.String(),
  field: t.String(),
  value: t.String(),
  namespace: t.Optional(t.String()),
})

const HMSetRequestSchema = t.Object({
  key: t.String(),
  fields: t.Record(t.String(), t.String()),
  namespace: t.Optional(t.String()),
})

const ListPushRequestSchema = t.Object({
  key: t.String(),
  values: t.Array(t.String()),
  namespace: t.Optional(t.String()),
})

const ListRangeRequestSchema = t.Object({
  key: t.String(),
  start: t.Number(),
  stop: t.Number(),
  namespace: t.Optional(t.String()),
})

const SetAddRequestSchema = t.Object({
  key: t.String(),
  members: t.Array(t.String()),
  namespace: t.Optional(t.String()),
})

const ZAddRequestSchema = t.Object({
  key: t.String(),
  members: t.Array(
    t.Object({
      member: t.String(),
      score: t.Number(),
    }),
  ),
  namespace: t.Optional(t.String()),
})

const CreateInstanceRequestSchema = t.Object({
  planId: t.String(),
  namespace: t.Optional(t.String()),
  durationHours: t.Optional(t.Number()),
})

const IncrRequestSchema = t.Object({
  key: t.String(),
  by: t.Optional(t.Number()),
  namespace: t.Optional(t.String()),
})

export function createCacheRoutes() {
  return (
    new Elysia({ prefix: '/cache' })
      .onError(({ error, set }) => {
        if (error instanceof CacheError) {
          set.status = error.code === CacheErrorCode.UNAUTHORIZED ? 401 : 400
          return { error: error.message, code: error.code }
        }
        set.status = 500
        return { error: 'Internal server error' }
      })
      .onBeforeHandle(
        ({
          request,
          set,
        }): { error: string; retryAfter: number } | undefined => {
          const url = new URL(request.url)
          if (
            url.pathname.endsWith('/health') ||
            url.pathname.endsWith('/metrics')
          ) {
            return undefined
          }

          const { allowed, remaining, resetAt } = checkRateLimit(request)
          set.headers['X-RateLimit-Limit'] = String(RATE_LIMIT_MAX_REQUESTS)
          set.headers['X-RateLimit-Remaining'] = String(remaining)
          set.headers['X-RateLimit-Reset'] = String(Math.ceil(resetAt / 1000))

          if (!allowed) {
            set.status = 429
            return {
              error: 'Rate limit exceeded',
              retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
            }
          }
          return undefined
        },
      )

      .get('/health', async () => {
        const engine = getSharedEngine()
        const stats = engine.getStats()
        return {
          status: 'healthy',
          uptime: stats.uptime,
          timestamp: Date.now(),
        }
      })

      .get('/stats', async () => {
        const manager = getCacheProvisioningManager()
        const globalStats = manager.getGlobalStats()
        const sharedStats = getSharedEngine().getStats()
        return {
          global: globalStats,
          shared: sharedStats,
        }
      })

      .get('/metrics', async ({ set }) => {
        const sharedStats = getSharedEngine().getStats()
        const manager = getCacheProvisioningManager()
        const globalStats = manager.getGlobalStats()

        // Prometheus text format
        const metrics = [
          '# HELP cache_keys_total Total number of keys in cache',
          '# TYPE cache_keys_total gauge',
          `cache_keys_total ${sharedStats.totalKeys}`,
          '# HELP cache_memory_bytes Memory used by cache in bytes',
          '# TYPE cache_memory_bytes gauge',
          `cache_memory_bytes ${sharedStats.usedMemoryBytes}`,
          '# HELP cache_hits_total Total cache hits',
          '# TYPE cache_hits_total counter',
          `cache_hits_total ${sharedStats.hits}`,
          '# HELP cache_misses_total Total cache misses',
          '# TYPE cache_misses_total counter',
          `cache_misses_total ${sharedStats.misses}`,
          '# HELP cache_hit_rate Cache hit rate',
          '# TYPE cache_hit_rate gauge',
          `cache_hit_rate ${sharedStats.hitRate}`,
          '# HELP cache_uptime_seconds Cache uptime in seconds',
          '# TYPE cache_uptime_seconds counter',
          `cache_uptime_seconds ${Math.floor(sharedStats.uptime / 1000)}`,
          '# HELP cache_instances_total Total provisioned cache instances',
          '# TYPE cache_instances_total gauge',
          `cache_instances_total ${globalStats.totalInstances}`,
          '# HELP cache_nodes_total Total cache nodes',
          '# TYPE cache_nodes_total gauge',
          `cache_nodes_total ${globalStats.totalNodes}`,
          '# HELP cache_tee_instances TEE-backed cache instances',
          '# TYPE cache_tee_instances gauge',
          `cache_tee_instances ${globalStats.tierBreakdown[CacheTier.TEE]}`,
        ]

        set.headers['content-type'] = 'text/plain; version=0.0.4'
        return metrics.join('\n')
      })

      .get(
        '/get',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const value = engine.get(namespace, query.key)
            return { value, found: value !== null }
          }

          // TEE provider
          const value = await engine.get(namespace, query.key)
          return { value, found: value !== null }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/set',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          const options = {
            ttl: body.ttl,
            nx: body.nx,
            xx: body.xx,
          }

          if (engine instanceof CacheEngine) {
            const success = engine.set(namespace, body.key, body.value, options)
            return { success }
          }

          // TEE provider
          const success = await engine.set(
            namespace,
            body.key,
            body.value,
            options,
          )
          return { success }
        },
        { body: SetRequestSchema },
      )

      .post(
        '/del',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const deleted = engine.del(namespace, ...body.keys)
            return { deleted }
          }

          // TEE provider
          const deleted = await engine.del(namespace, ...body.keys)
          return { deleted }
        },
        { body: DelRequestSchema },
      )

      .delete(
        '/delete',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const success = engine.del(namespace, query.key) > 0
            return { success }
          }

          const success = (await engine.del(namespace, query.key)) > 0
          return { success }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/mget',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          const entries: Record<string, string | null> = {}

          if (engine instanceof CacheEngine) {
            for (const key of body.keys) {
              entries[key] = engine.get(namespace, key)
            }
          } else {
            for (const key of body.keys) {
              entries[key] = await engine.get(namespace, key)
            }
          }

          return { entries }
        },
        { body: MGetRequestSchema },
      )

      .post(
        '/mset',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            for (const entry of body.entries) {
              engine.set(namespace, entry.key, entry.value, { ttl: entry.ttl })
            }
          } else {
            for (const entry of body.entries) {
              await engine.set(namespace, entry.key, entry.value, {
                ttl: entry.ttl,
              })
            }
          }

          return { success: true }
        },
        { body: MSetRequestSchema },
      )

      .post(
        '/incr',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)
          const by = body.by ?? 1

          if (engine instanceof CacheEngine) {
            const value = engine.incr(namespace, body.key, by)
            return { value }
          }

          const value = await engine.incr(namespace, body.key, by)
          return { value }
        },
        { body: IncrRequestSchema },
      )

      .post(
        '/decr',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)
          const by = body.by ?? 1

          if (engine instanceof CacheEngine) {
            const value = engine.decr(namespace, body.key, by)
            return { value }
          }

          const value = await engine.decr(namespace, body.key, by)
          return { value }
        },
        { body: IncrRequestSchema },
      )

      .get(
        '/ttl',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const ttl = engine.ttl(namespace, query.key)
            return { ttl }
          }

          const ttl = await engine.ttl(namespace, query.key)
          return { ttl }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/expire',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const success = engine.expire(namespace, body.key, body.ttl)
            return { success }
          }

          const success = await engine.expire(namespace, body.key, body.ttl)
          return { success }
        },
        { body: ExpireRequestSchema },
      )

      .get(
        '/hget',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const value = engine.hget(namespace, query.key, query.field)
            return { value, found: value !== null }
          }

          const value = await engine.hget(namespace, query.key, query.field)
          return { value, found: value !== null }
        },
        {
          query: t.Object({
            key: t.String(),
            field: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/hset',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const added = engine.hset(
              namespace,
              body.key,
              body.field,
              body.value,
            )
            return { added }
          }

          const added = await engine.hset(
            namespace,
            body.key,
            body.field,
            body.value,
          )
          return { added }
        },
        { body: HSetRequestSchema },
      )

      .post(
        '/hmset',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            for (const [field, value] of Object.entries(body.fields)) {
              engine.hset(namespace, body.key, field, value)
            }
            return { success: true }
          }

          for (const [field, value] of Object.entries(body.fields)) {
            await engine.hset(namespace, body.key, field, value)
          }
          return { success: true }
        },
        { body: HMSetRequestSchema },
      )

      .get(
        '/hgetall',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const hash = engine.hgetall(namespace, query.key)
            return { hash }
          }

          const hash = await engine.hgetall(namespace, query.key)
          return { hash }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/lpush',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const length = engine.lpush(namespace, body.key, ...body.values)
            return { length }
          }

          const length = await engine.lpush(namespace, body.key, ...body.values)
          return { length }
        },
        { body: ListPushRequestSchema },
      )

      .post(
        '/rpush',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const length = engine.rpush(namespace, body.key, ...body.values)
            return { length }
          }

          const length = await engine.rpush(namespace, body.key, ...body.values)
          return { length }
        },
        { body: ListPushRequestSchema },
      )

      .get(
        '/lpop',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const value = engine.lpop(namespace, query.key)
            return { value }
          }

          const value = await engine.lpop(namespace, query.key)
          return { value }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .get(
        '/rpop',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const value = engine.rpop(namespace, query.key)
            return { value }
          }

          const value = await engine.rpop(namespace, query.key)
          return { value }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/lrange',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const values = engine.lrange(
              namespace,
              body.key,
              body.start,
              body.stop,
            )
            return { values }
          }

          const values = await engine.lrange(
            namespace,
            body.key,
            body.start,
            body.stop,
          )
          return { values }
        },
        { body: ListRangeRequestSchema },
      )

      .get(
        '/llen',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const length = engine.llen(namespace, query.key)
            return { length }
          }

          const length = await engine.llen(namespace, query.key)
          return { length }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/sadd',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const added = engine.sadd(namespace, body.key, ...body.members)
            return { added }
          }

          const added = await engine.sadd(namespace, body.key, ...body.members)
          return { added }
        },
        { body: SetAddRequestSchema },
      )

      .post(
        '/srem',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const removed = engine.srem(namespace, body.key, ...body.members)
            return { removed }
          }

          const removed = await engine.srem(
            namespace,
            body.key,
            ...body.members,
          )
          return { removed }
        },
        { body: SetAddRequestSchema },
      )

      .get(
        '/smembers',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const members = engine.smembers(namespace, query.key)
            return { members }
          }

          const members = await engine.smembers(namespace, query.key)
          return { members }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .get(
        '/sismember',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const isMember = engine.sismember(
              namespace,
              query.key,
              query.member,
            )
            return { isMember }
          }

          const isMember = await engine.sismember(
            namespace,
            query.key,
            query.member,
          )
          return { isMember }
        },
        {
          query: t.Object({
            key: t.String(),
            member: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .get(
        '/scard',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const size = engine.scard(namespace, query.key)
            return { size }
          }

          const size = await engine.scard(namespace, query.key)
          return { size }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/zadd',
        async ({ body }) => {
          const namespace = body.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const added = engine.zadd(
              namespace,
              body.key,
              ...body.members.map((m) => ({
                member: m.member,
                score: m.score,
              })),
            )
            return { added }
          }

          const added = await engine.zadd(
            namespace,
            body.key,
            ...body.members.map((m) => ({ member: m.member, score: m.score })),
          )
          return { added }
        },
        { body: ZAddRequestSchema },
      )

      .get(
        '/zrange',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)
          const start = parseInt(query.start, 10)
          const stop = parseInt(query.stop, 10)

          if (engine instanceof CacheEngine) {
            const members = engine.zrange(namespace, query.key, start, stop)
            return { members }
          }

          const members = await engine.zrange(namespace, query.key, start, stop)
          return { members }
        },
        {
          query: t.Object({
            key: t.String(),
            start: t.String(),
            stop: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .get(
        '/zcard',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const size = engine.zcard(namespace, query.key)
            return { size }
          }

          const size = await engine.zcard(namespace, query.key)
          return { size }
        },
        {
          query: t.Object({
            key: t.String(),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .get(
        '/keys',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const pattern = query.pattern ?? '*'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            const keys = engine.keys(namespace, pattern)
            return { keys }
          }

          const keys = await engine.keys(namespace, pattern)
          return { keys }
        },
        {
          query: t.Object({
            pattern: t.Optional(t.String()),
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .delete(
        '/clear',
        async ({ query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (engine instanceof CacheEngine) {
            engine.flushdb(namespace)
          } else {
            await engine.flushdb(namespace)
          }

          return { success: true }
        },
        {
          query: t.Object({
            namespace: t.Optional(t.String()),
          }),
        },
      )

      // ========================================
      // Pub/Sub Routes
      // ========================================

      .post(
        '/publish',
        async ({ body }) => {
          const engine = getSharedEngine()
          const recipients = engine.publish(
            body.channel,
            body.message,
            body.publisherId,
          )
          return { recipients }
        },
        {
          body: t.Object({
            channel: t.String(),
            message: t.String(),
            publisherId: t.Optional(t.String()),
          }),
        },
      )

      .get(
        '/pubsub/channels',
        async ({ query }) => {
          const engine = getSharedEngine()
          const channels = engine.pubsubChannels(query.pattern)
          return { channels }
        },
        {
          query: t.Object({
            pattern: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/pubsub/numsub',
        async ({ body }) => {
          const engine = getSharedEngine()
          const result = engine.pubsubNumsub(...body.channels)
          const subscribers: Record<string, number> = {}
          for (const [channel, count] of result) {
            subscribers[channel] = count
          }
          return { subscribers }
        },
        {
          body: t.Object({
            channels: t.Array(t.String()),
          }),
        },
      )

      .get('/pubsub/numpat', async () => {
        const engine = getSharedEngine()
        const count = engine.pubsubNumpat()
        return { count }
      })

      .get('/pubsub/stats', async () => {
        const engine = getSharedEngine()
        const stats = engine.getPubSubStats()
        return { stats }
      })

      // ========================================
      // Plans & Instances Routes
      // ========================================

      .get('/plans', async () => {
        const manager = getCacheProvisioningManager()
        const plans = manager.getPlans()
        return {
          plans: plans.map((p) => ({
            ...p,
            pricePerHour: p.pricePerHour.toString(),
            pricePerMonth: p.pricePerMonth.toString(),
          })),
        }
      })

      .post(
        '/instances',
        async ({ body, headers }) => {
          const manager = getCacheProvisioningManager()

          // Get owner from auth header (simplified - should use proper auth)
          const owner = (headers['x-owner-address'] ??
            '0x0000000000000000000000000000000000000000') as Address

          const instance = await manager.createInstance(
            owner,
            body.planId,
            body.namespace,
            body.durationHours,
          )

          return { instance }
        },
        { body: CreateInstanceRequestSchema },
      )

      .get('/instances', async ({ headers }) => {
        const manager = getCacheProvisioningManager()

        const owner = headers['x-owner-address'] as Address | undefined
        if (owner) {
          const instances = manager.getInstancesByOwner(owner)
          return { instances }
        }

        const instances = manager.getAllInstances()
        return { instances }
      })

      .get(
        '/instances/:id',
        async ({ params }) => {
          const manager = getCacheProvisioningManager()
          const instance = manager.getInstance(params.id)

          if (!instance) {
            return { error: 'Instance not found', instance: null }
          }

          return { instance }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      .delete(
        '/instances/:id',
        async ({ params, headers }) => {
          const manager = getCacheProvisioningManager()
          const owner = getOwnerFromHeaders(
            headers as Record<string, string | undefined>,
          )
          const success = await manager.deleteInstance(params.id, owner)
          return { success }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      .get('/nodes', async () => {
        const manager = getCacheProvisioningManager()
        const nodes = manager.getAllNodes()
        return { nodes }
      })

      .post(
        '/nodes/:id/heartbeat',
        async ({ params, body }) => {
          const manager = getCacheProvisioningManager()
          // Attestation is validated externally, pass as typed if present
          const attestation = body?.attestation as
            | CacheTEEAttestation
            | undefined
          const success = await manager.updateNodeHeartbeat(
            params.id,
            attestation,
          )
          return { success }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
          body: t.Optional(
            t.Object({
              attestation: t.Optional(
                t.Object({
                  quote: t.String(),
                  mrEnclave: t.String(),
                  mrSigner: t.String(),
                  reportData: t.String(),
                  timestamp: t.Number(),
                  provider: t.String(),
                  simulated: t.Boolean(),
                }),
              ),
            }),
          ),
        },
      )

      .get('/billing/requirement', async ({ query }) => {
        const { getCacheBillingManager } = await import('./billing')
        const billing = getCacheBillingManager()
        const manager = getCacheProvisioningManager()

        const planId = query.planId
        const billingMode = (query.billingMode || 'hourly') as
          | 'hourly'
          | 'monthly'
        const plan = manager.getPlan(planId)

        if (!plan) {
          throw new CacheError(
            CacheErrorCode.INVALID_OPERATION,
            `Plan ${planId} not found`,
          )
        }

        const requirement = billing.createPaymentRequirement(
          plan,
          billingMode,
          query.instanceId,
        )

        return { requirement }
      })

      .post(
        '/billing/subscribe',
        async ({ body, headers, set }) => {
          const { getCacheBillingManager, parseBillingMode } = await import(
            './billing'
          )
          const billing = getCacheBillingManager()
          const manager = getCacheProvisioningManager()
          const owner = getOwnerFromHeaders(
            headers as Record<string, string | undefined>,
          )

          // Validate billing mode
          const billingMode = parseBillingMode(body.billingMode)

          // Parse payment proof from headers
          const proof = billing.parsePaymentProof(
            headers as Record<string, string>,
          )
          if (!proof) {
            // Return 402 Payment Required
            const plan = manager.getPlan(body.planId)
            if (!plan) {
              throw new CacheError(
                CacheErrorCode.INVALID_OPERATION,
                `Plan ${body.planId} not found`,
              )
            }

            const requirement = billing.createPaymentRequirement(
              plan,
              billingMode,
              body.instanceId,
            )
            set.status = 402
            set.headers['X-Payment-Required'] = 'true'
            return requirement
          }

          const plan = manager.getPlan(body.planId)
          if (!plan) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              `Plan ${body.planId} not found`,
            )
          }

          const subscription = await billing.createSubscription(
            body.instanceId,
            owner,
            plan,
            billingMode,
            proof,
          )

          return { subscription }
        },
        {
          body: t.Object({
            instanceId: t.String(),
            planId: t.String(),
            billingMode: t.String(),
          }),
        },
      )

      .post(
        '/billing/renew',
        async ({ body, headers, set }) => {
          const { getCacheBillingManager } = await import('./billing')
          const billing = getCacheBillingManager()
          const manager = getCacheProvisioningManager()
          const owner = getOwnerFromHeaders(
            headers as Record<string, string | undefined>,
          )

          // Get subscription to determine required amount and validate ownership
          const subscription = billing.getSubscription(body.instanceId)
          if (!subscription) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'No active subscription',
            )
          }

          // Validate ownership
          if (subscription.owner !== owner) {
            throw new CacheError(
              CacheErrorCode.UNAUTHORIZED,
              'Not subscription owner',
            )
          }

          const plan = manager.getPlan(subscription.planId)
          if (!plan) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'Plan not found',
            )
          }

          const proof = billing.parsePaymentProof(
            headers as Record<string, string>,
          )
          if (!proof) {
            const requirement = billing.createPaymentRequirement(
              plan,
              subscription.billingMode,
              body.instanceId,
            )
            set.status = 402
            set.headers['X-Payment-Required'] = 'true'
            return requirement
          }

          const renewed = await billing.processRenewal(
            subscription.id,
            proof,
            plan,
          )

          return { subscription: renewed }
        },
        {
          body: t.Object({
            instanceId: t.String(),
          }),
        },
      )

      .post(
        '/billing/cancel',
        async ({ body, headers }) => {
          const { getCacheBillingManager } = await import('./billing')
          const billing = getCacheBillingManager()
          const owner = getOwnerFromHeaders(
            headers as Record<string, string | undefined>,
          )

          const subscription = billing.getSubscription(body.instanceId)
          if (!subscription) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'No active subscription',
            )
          }

          const cancelled = await billing.cancelSubscription(
            subscription.id,
            owner,
          )

          return { subscription: cancelled }
        },
        {
          body: t.Object({
            instanceId: t.String(),
          }),
        },
      )

      .get('/billing/subscription/:instanceId', async ({ params }) => {
        const { getCacheBillingManager } = await import('./billing')
        const billing = getCacheBillingManager()

        const subscription = billing.getSubscription(params.instanceId)

        return {
          subscription: subscription
            ? {
                ...subscription,
                totalPaid: subscription.totalPaid.toString(),
              }
            : null,
        }
      })

      .get('/billing/payments', async ({ headers }) => {
        const { getCacheBillingManager } = await import('./billing')
        const billing = getCacheBillingManager()
        const owner = getOwnerFromHeaders(
          headers as Record<string, string | undefined>,
        )
        const payments = billing.getPaymentHistory(owner)

        return {
          payments: payments.map((p) => ({
            ...p,
            amount: p.amount.toString(),
          })),
        }
      })

      .get('/billing/invoices', async ({ headers }) => {
        const { getCacheBillingManager } = await import('./billing')
        const billing = getCacheBillingManager()
        const owner = getOwnerFromHeaders(
          headers as Record<string, string | undefined>,
        )
        const invoices = billing.getInvoices(owner)

        return {
          invoices: invoices.map((inv) => ({
            ...inv,
            lineItems: inv.lineItems.map((li) => ({
              ...li,
              unitPrice: li.unitPrice.toString(),
              total: li.total.toString(),
            })),
            subtotal: inv.subtotal.toString(),
            platformFee: inv.platformFee.toString(),
            total: inv.total.toString(),
          })),
        }
      })

      .get('/billing/stats', async () => {
        const { getCacheBillingManager } = await import('./billing')
        const billing = getCacheBillingManager()

        const stats = billing.getBillingStats()

        return {
          stats: {
            ...stats,
            totalRevenue: stats.totalRevenue.toString(),
          },
        }
      })

      // ========================================
      // Upstash-compatible REST API
      // ========================================
      // Accepts Redis commands in array format: ["SET", "key", "value"]
      // Compatible with @upstash/redis client

      .post(
        '/command',
        async ({ body, query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (!(engine instanceof CacheEngine)) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'Command endpoint requires direct engine access',
            )
          }

          // Body is an array of command args: ["SET", "key", "value"]
          const args = body as string[]
          if (!Array.isArray(args) || args.length === 0) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'Invalid command format. Expected array.',
            )
          }

          const cmd = args[0].toUpperCase()
          const cmdArgs = args.slice(1)

          const result = executeRedisCommand(engine, namespace, cmd, cmdArgs)
          return { result }
        },
        {
          body: t.Array(t.String()),
          query: t.Object({
            namespace: t.Optional(t.String()),
          }),
        },
      )

      .post(
        '/pipeline',
        async ({ body, query }) => {
          const namespace = query.namespace ?? 'default'
          const engine = await getEngineForNamespace(namespace)

          if (!(engine instanceof CacheEngine)) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'Pipeline endpoint requires direct engine access',
            )
          }

          // Body is an array of commands: [["SET", "k1", "v1"], ["GET", "k1"]]
          const commands = body as string[][]
          if (!Array.isArray(commands)) {
            throw new CacheError(
              CacheErrorCode.INVALID_OPERATION,
              'Invalid pipeline format. Expected array of commands.',
            )
          }

          const results = commands.map((args) => {
            if (!Array.isArray(args) || args.length === 0) {
              return { error: 'Invalid command format' }
            }
            const cmd = args[0].toUpperCase()
            const cmdArgs = args.slice(1)
            try {
              return {
                result: executeRedisCommand(engine, namespace, cmd, cmdArgs),
              }
            } catch (e) {
              return { error: e instanceof Error ? e.message : 'Unknown error' }
            }
          })

          return results
        },
        {
          body: t.Array(t.Array(t.String())),
          query: t.Object({
            namespace: t.Optional(t.String()),
          }),
        },
      )
  )
}

/**
 * Execute a Redis command on the engine
 */
function executeRedisCommand(
  engine: CacheEngine,
  ns: string,
  cmd: string,
  args: string[],
):
  | string
  | number
  | null
  | string[]
  | (string | null)[]
  | Record<string, string> {
  switch (cmd) {
    // Connection
    case 'PING':
      return 'PONG'
    case 'ECHO':
      return args[0] ?? ''

    // String commands
    case 'GET':
      return engine.get(ns, args[0])
    case 'SET': {
      let ttl: number | undefined
      let nx = false
      let xx = false

      for (let i = 2; i < args.length; i++) {
        const opt = args[i].toUpperCase()
        if (opt === 'EX' && args[i + 1]) {
          ttl = parseInt(args[i + 1], 10)
          i++
        } else if (opt === 'PX' && args[i + 1]) {
          ttl = Math.ceil(parseInt(args[i + 1], 10) / 1000)
          i++
        } else if (opt === 'NX') {
          nx = true
        } else if (opt === 'XX') {
          xx = true
        }
      }

      const result = engine.set(ns, args[0], args[1], { ttl, nx, xx })
      return result ? 'OK' : null
    }
    case 'SETNX':
      return engine.setnx(ns, args[0], args[1]) ? 1 : 0
    case 'SETEX':
      engine.setex(ns, args[0], parseInt(args[1], 10), args[2])
      return 'OK'
    case 'MGET':
      return args.map((key) => engine.get(ns, key) ?? '')
    case 'MSET':
      for (let i = 0; i < args.length; i += 2) {
        engine.set(ns, args[i], args[i + 1])
      }
      return 'OK'
    case 'INCR':
      return engine.incr(ns, args[0])
    case 'INCRBY':
      return engine.incr(ns, args[0], parseInt(args[1], 10))
    case 'DECR':
      return engine.decr(ns, args[0])
    case 'DECRBY':
      return engine.decr(ns, args[0], parseInt(args[1], 10))
    case 'APPEND':
      return engine.append(ns, args[0], args[1])

    // Key commands
    case 'DEL':
      return engine.del(ns, ...args)
    case 'EXISTS':
      return engine.exists(ns, ...args)
    case 'EXPIRE':
      return engine.expire(ns, args[0], parseInt(args[1], 10)) ? 1 : 0
    case 'TTL':
      return engine.ttl(ns, args[0])
    case 'PTTL':
      return engine.pttl(ns, args[0])
    case 'PERSIST':
      return engine.persist(ns, args[0]) ? 1 : 0
    case 'TYPE':
      return engine.type(ns, args[0])
    case 'KEYS':
      return engine.keys(ns, args[0] ?? '*')
    case 'FLUSHDB':
      engine.flushdb(ns)
      return 'OK'

    // Hash commands
    case 'HGET':
      return engine.hget(ns, args[0], args[1])
    case 'HSET': {
      const result = engine.hset(ns, args[0], args[1], args[2])
      return result
    }
    case 'HMGET':
      return engine.hmget(ns, args[0], ...args.slice(1))
    case 'HGETALL':
      return engine.hgetall(ns, args[0])
    case 'HDEL':
      return engine.hdel(ns, args[0], ...args.slice(1))
    case 'HEXISTS':
      return engine.hexists(ns, args[0], args[1]) ? 1 : 0
    case 'HLEN':
      return engine.hlen(ns, args[0])
    case 'HKEYS':
      return engine.hkeys(ns, args[0])
    case 'HVALS':
      return engine.hvals(ns, args[0])
    case 'HINCRBY':
      return engine.hincrby(ns, args[0], args[1], parseInt(args[2], 10))

    // List commands
    case 'LPUSH':
      return engine.lpush(ns, args[0], ...args.slice(1))
    case 'RPUSH':
      return engine.rpush(ns, args[0], ...args.slice(1))
    case 'LPOP':
      return engine.lpop(ns, args[0])
    case 'RPOP':
      return engine.rpop(ns, args[0])
    case 'LLEN':
      return engine.llen(ns, args[0])
    case 'LRANGE':
      return engine.lrange(
        ns,
        args[0],
        parseInt(args[1], 10),
        parseInt(args[2], 10),
      )
    case 'LINDEX':
      return engine.lindex(ns, args[0], parseInt(args[1], 10))

    // Set commands
    case 'SADD':
      return engine.sadd(ns, args[0], ...args.slice(1))
    case 'SREM':
      return engine.srem(ns, args[0], ...args.slice(1))
    case 'SMEMBERS':
      return engine.smembers(ns, args[0])
    case 'SISMEMBER':
      return engine.sismember(ns, args[0], args[1]) ? 1 : 0
    case 'SCARD':
      return engine.scard(ns, args[0])

    // Sorted set commands
    case 'ZADD': {
      const members: Array<{ member: string; score: number }> = []
      for (let i = 1; i < args.length; i += 2) {
        members.push({ score: parseFloat(args[i]), member: args[i + 1] })
      }
      return engine.zadd(ns, args[0], ...members)
    }
    case 'ZRANGE':
      return engine.zrange(
        ns,
        args[0],
        parseInt(args[1], 10),
        parseInt(args[2], 10),
      ) as string[]
    case 'ZSCORE':
      return engine.zscore(ns, args[0], args[1])
    case 'ZCARD':
      return engine.zcard(ns, args[0])
    case 'ZREM':
      return engine.zrem(ns, args[0], ...args.slice(1))

    default:
      throw new CacheError(
        CacheErrorCode.INVALID_OPERATION,
        `Unknown command: ${cmd}`,
      )
  }
}

/**
 * Create and initialize the cache service app
 */
export async function createCacheService() {
  // Initialize provisioning manager
  await initializeCacheProvisioning()

  // Initialize billing manager
  const { initializeCacheBilling } = await import('./billing')
  await initializeCacheBilling()

  const app = new Elysia()
    // Health check endpoint
    .get('/health', async () => {
      const engine = getSharedEngine()
      const stats = engine.getStats()
      return {
        status: 'healthy',
        uptime: stats.uptime,
        timestamp: Date.now(),
      }
    })
    // Stats endpoint
    .get('/stats', async () => {
      const sharedStats = getSharedEngine().getStats()
      return {
        stats: {
          totalKeys: sharedStats.totalKeys,
          usedMemoryMb: Math.round(sharedStats.usedMemoryBytes / (1024 * 1024)),
          hits: sharedStats.hits,
          misses: sharedStats.misses,
          hitRate: sharedStats.hitRate,
        },
      }
    })
    .use(createCacheRoutes())
    .get('/', () => ({
      service: 'Jeju Cache Service',
      version: '1.0.0',
      endpoints: [
        '/health',
        '/stats',
        '/cache/health',
        '/cache/stats',
        '/cache/get',
        '/cache/set',
        '/cache/del',
        '/cache/mget',
        '/cache/mset',
        '/cache/ttl',
        '/cache/expire',
        '/cache/hget',
        '/cache/hset',
        '/cache/hgetall',
        '/cache/lpush',
        '/cache/rpush',
        '/cache/lrange',
        '/cache/sadd',
        '/cache/smembers',
        '/cache/zadd',
        '/cache/zrange',
        '/cache/keys',
        '/cache/clear',
        '/cache/plans',
        '/cache/instances',
        '/cache/nodes',
      ],
    }))

  return app
}
