/**
 * Cache Service API Routes
 *
 * HTTP API for the decentralized cache service:
 * - Redis-compatible operations (GET, SET, DEL, etc.)
 * - Instance management (create, delete, list)
 * - Statistics and health
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { CacheEngine } from './engine'
import {
  getCacheProvisioningManager,
  initializeCacheProvisioning,
} from './provisioning'
import type { TEECacheProvider } from './tee-provider'
import { CacheError, CacheErrorCode, type CacheTEEAttestation } from './types'

// Shared engine for standard tier (multi-tenant)
let sharedEngine: CacheEngine | null = null

export function getSharedEngine(): CacheEngine {
  if (!sharedEngine) {
    sharedEngine = new CacheEngine({
      maxMemoryMb: 1024, // 1GB shared cache
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400 * 7, // 7 days max
      evictionPolicy: 'lru',
      persistenceEnabled: false,
      replicationFactor: 1,
    })
  }
  return sharedEngine
}

/**
 * Get the appropriate engine/provider for a namespace
 */
async function getEngineForNamespace(
  namespace: string,
): Promise<CacheEngine | TEECacheProvider> {
  const manager = getCacheProvisioningManager()

  // Check for dedicated instance
  const instance = manager.getInstanceByNamespace(namespace)
  if (instance) {
    // TEE instance
    const teeProvider = manager.getTEEProviderByNamespace(namespace)
    if (teeProvider) return teeProvider

    // Standard/Premium instance
    const engine = manager.getEngineByNamespace(namespace)
    if (engine) return engine
  }

  // Use shared engine for standard tier
  return getSharedEngine()
}

// Elysia body schemas

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

/**
 * Create cache routes
 */
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

      // ========================================================================
      // Health & Stats
      // ========================================================================

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

      // ========================================================================
      // String Operations
      // ========================================================================

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

      // ========================================================================
      // TTL Operations
      // ========================================================================

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

      // ========================================================================
      // Hash Operations
      // ========================================================================

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

      // ========================================================================
      // List Operations
      // ========================================================================

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

      // ========================================================================
      // Set Operations
      // ========================================================================

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

      // ========================================================================
      // Sorted Set Operations
      // ========================================================================

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

      // ========================================================================
      // Key Operations
      // ========================================================================

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

      // ========================================================================
      // Instance Management
      // ========================================================================

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

          const owner = headers['x-owner-address'] as Address
          if (!owner) {
            throw new CacheError(
              CacheErrorCode.UNAUTHORIZED,
              'Owner address required',
            )
          }

          const success = await manager.deleteInstance(params.id, owner)
          return { success }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      // ========================================================================
      // Node Management (internal)
      // ========================================================================

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
  )
}

/**
 * Create and initialize the cache service app
 */
export async function createCacheService() {
  // Initialize provisioning manager
  await initializeCacheProvisioning()

  const app = new Elysia()
    // Root-level endpoints for Babylon compatibility
    .get('/health', async () => {
      const engine = getSharedEngine()
      const stats = engine.getStats()
      return {
        status: 'healthy',
        uptime: stats.uptime,
        timestamp: Date.now(),
      }
    })
    // Stats endpoint in Babylon-compatible format
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
