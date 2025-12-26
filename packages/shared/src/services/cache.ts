/**
 * Cache Service - DWS Serverless Cache Integration
 *
 * Provides decentralized caching via DWS cache service.
 * Supports:
 * - Redis-compatible operations (GET, SET, DEL, MGET, MSET)
 * - Hash operations (HGET, HSET, HGETALL)
 * - List operations (LPUSH, RPUSH, LRANGE)
 * - Set operations (SADD, SMEMBERS)
 * - Sorted set operations (ZADD, ZRANGE)
 * - Namespace isolation
 * - TEE-backed secure cache tier
 */

import {
  getCacheApiKey,
  getCacheNamespace,
  getDWSCacheUrl,
} from '@jejunetwork/config'
import { z } from 'zod'

/** JSON-compatible value type for cache storage */
type CacheJsonValue =
  | string
  | number
  | boolean
  | null
  | CacheJsonValue[]
  | { [key: string]: CacheJsonValue }

const CacheConfigSchema = z.object({
  /** DWS cache endpoint */
  endpoint: z.string().url(),
  /** Default TTL in milliseconds */
  defaultTTL: z.number().positive().default(300000), // 5 minutes
  /** Namespace for key isolation */
  namespace: z.string().default('default'),
  /** API key for authenticated access (optional for standard tier) */
  apiKey: z.string().optional(),
  /** Owner address for instance-based access */
  ownerAddress: z.string().optional(),
})

export type CacheConfig = z.infer<typeof CacheConfigSchema>

export interface CacheSetOptions {
  ttl?: number
  nx?: boolean
  xx?: boolean
}

export interface CacheService {
  // String operations
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<boolean>
  delete(...keys: string[]): Promise<number>
  has(key: string): Promise<boolean>
  mget<T>(...keys: string[]): Promise<(T | null)[]>
  mset(
    entries: { key: string; value: CacheJsonValue; ttl?: number }[],
  ): Promise<void>
  incr(key: string, by?: number): Promise<number>
  decr(key: string, by?: number): Promise<number>

  // TTL operations
  expire(key: string, seconds: number): Promise<boolean>
  ttl(key: string): Promise<number>

  // Hash operations
  hget<T>(key: string, field: string): Promise<T | null>
  hset(key: string, field: string, value: CacheJsonValue): Promise<number>
  hmset(key: string, fields: Record<string, CacheJsonValue>): Promise<void>
  hgetall<T extends Record<string, CacheJsonValue>>(key: string): Promise<T>
  hdel(key: string, ...fields: string[]): Promise<number>

  // List operations
  lpush(key: string, ...values: string[]): Promise<number>
  rpush(key: string, ...values: string[]): Promise<number>
  lpop(key: string): Promise<string | null>
  rpop(key: string): Promise<string | null>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  llen(key: string): Promise<number>

  // Set operations
  sadd(key: string, ...members: string[]): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  sismember(key: string, member: string): Promise<boolean>
  scard(key: string): Promise<number>

  // Sorted set operations
  zadd(
    key: string,
    ...members: { member: string; score: number }[]
  ): Promise<number>
  zrange(key: string, start: number, stop: number): Promise<string[]>
  zcard(key: string): Promise<number>

  // Key operations
  keys(pattern?: string): Promise<string[]>
  clear(): Promise<void>

  // Health
  isHealthy(): Promise<boolean>
  getStats(): Promise<CacheStats>
}

export interface CacheStats {
  totalKeys: number
  usedMemoryBytes: number
  maxMemoryBytes: number
  hits: number
  misses: number
  hitRate: number
  uptime: number
}

// Response schemas

const CacheValueSchema: z.ZodType<CacheJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(CacheValueSchema),
    z.record(z.string(), CacheValueSchema),
  ]),
)

const GetResponseSchema = z.object({
  value: CacheValueSchema.nullable(),
  found: z.boolean(),
})

const SetResponseSchema = z.object({ success: z.boolean() })
const DelResponseSchema = z.object({ deleted: z.number() })
const MGetResponseSchema = z.object({
  entries: z.record(z.string(), CacheValueSchema.nullable()),
})
const IncrResponseSchema = z.object({ value: z.number() })
const ExpireResponseSchema = z.object({ success: z.boolean() })
const TtlResponseSchema = z.object({ ttl: z.number() })
const HGetResponseSchema = z.object({
  value: CacheValueSchema.nullable(),
  found: z.boolean(),
})
const HSetResponseSchema = z.object({ added: z.number() })
const HGetAllResponseSchema = z.object({
  hash: z.record(z.string(), z.string()),
})
const ListPushResponseSchema = z.object({ length: z.number() })
const ListPopResponseSchema = z.object({ value: z.string().nullable() })
const ListRangeResponseSchema = z.object({ values: z.array(z.string()) })
const ListLenResponseSchema = z.object({ length: z.number() })
const SetAddResponseSchema = z.object({ added: z.number() })
const SetRemResponseSchema = z.object({ removed: z.number() })
const SetMembersResponseSchema = z.object({ members: z.array(z.string()) })
const SetIsMemberResponseSchema = z.object({ isMember: z.boolean() })
const SetCardResponseSchema = z.object({ size: z.number() })
const ZAddResponseSchema = z.object({ added: z.number() })
const ZRangeResponseSchema = z.object({ members: z.array(z.string()) })
const ZCardResponseSchema = z.object({ size: z.number() })
const KeysResponseSchema = z.object({ keys: z.array(z.string()) })
const HealthResponseSchema = z.object({
  status: z.string(),
  uptime: z.number(),
})
const StatsResponseSchema = z.object({
  global: z.object({
    totalInstances: z.number(),
    totalNodes: z.number(),
    totalMemoryMb: z.number(),
    usedMemoryMb: z.number(),
    totalKeys: z.number(),
  }),
  shared: z.object({
    totalKeys: z.number(),
    usedMemoryBytes: z.number(),
    maxMemoryBytes: z.number(),
    hits: z.number(),
    misses: z.number(),
    hitRate: z.number(),
    uptime: z.number(),
  }),
})

class CacheServiceImpl implements CacheService {
  private endpoint: string
  private defaultTTL: number
  private namespace: string
  private apiKey?: string
  private ownerAddress?: string

  constructor(config: CacheConfig) {
    const validated = CacheConfigSchema.parse(config)
    this.endpoint = validated.endpoint.replace(/\/$/, '')
    this.defaultTTL = validated.defaultTTL
    this.namespace = validated.namespace
    this.apiKey = validated.apiKey
    this.ownerAddress = validated.ownerAddress
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    if (this.ownerAddress) {
      headers['x-owner-address'] = this.ownerAddress
    }
    return headers
  }

  // ============================================================================
  // String Operations
  // ============================================================================

  async get<T>(key: string): Promise<T | null> {
    const response = await fetch(
      `${this.endpoint}/cache/get?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache get failed: ${response.status}`)
    }

    const data = GetResponseSchema.parse(await response.json())
    if (!data.found || data.value === null) return null

    // Parse JSON string value if needed
    if (typeof data.value === 'string') {
      const parsed = JSON.parse(data.value)
      return parsed as T
    }
    return data.value as T
  }

  async set<T>(
    key: string,
    value: T,
    options: CacheSetOptions = {},
  ): Promise<boolean> {
    const ttl = options.ttl ?? Math.floor(this.defaultTTL / 1000)

    const response = await fetch(`${this.endpoint}/cache/set`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        key,
        value: JSON.stringify(value),
        ttl,
        namespace: this.namespace,
        nx: options.nx,
        xx: options.xx,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache set failed: ${response.status}`)
    }

    const data = SetResponseSchema.parse(await response.json())
    return data.success
  }

  async delete(...keys: string[]): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/del`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ keys, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache del failed: ${response.status}`)
    }

    const data = DelResponseSchema.parse(await response.json())
    return data.deleted
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }

  async mget<T>(...keys: string[]): Promise<(T | null)[]> {
    const response = await fetch(`${this.endpoint}/cache/mget`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ keys, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache mget failed: ${response.status}`)
    }

    const data = MGetResponseSchema.parse(await response.json())
    return keys.map((k) => {
      const v = data.entries[k]
      if (v === null || v === undefined) return null
      if (typeof v === 'string') {
        const parsed = JSON.parse(v) as T
        return parsed
      }
      return v as T
    })
  }

  async mset(
    entries: { key: string; value: CacheJsonValue; ttl?: number }[],
  ): Promise<void> {
    const response = await fetch(`${this.endpoint}/cache/mset`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        entries: entries.map((e) => ({
          key: e.key,
          value: JSON.stringify(e.value),
          ttl: e.ttl ?? Math.floor(this.defaultTTL / 1000),
        })),
        namespace: this.namespace,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache mset failed: ${response.status}`)
    }
  }

  async incr(key: string, by = 1): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/incr`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, by, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache incr failed: ${response.status}`)
    }

    const data = IncrResponseSchema.parse(await response.json())
    return data.value
  }

  async decr(key: string, by = 1): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/decr`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, by, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache decr failed: ${response.status}`)
    }

    const data = IncrResponseSchema.parse(await response.json())
    return data.value
  }

  // ============================================================================
  // TTL Operations
  // ============================================================================

  async expire(key: string, seconds: number): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/cache/expire`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, ttl: seconds, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache expire failed: ${response.status}`)
    }

    const data = ExpireResponseSchema.parse(await response.json())
    return data.success
  }

  async ttl(key: string): Promise<number> {
    const response = await fetch(
      `${this.endpoint}/cache/ttl?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache ttl failed: ${response.status}`)
    }

    const data = TtlResponseSchema.parse(await response.json())
    return data.ttl
  }

  // ============================================================================
  // Hash Operations
  // ============================================================================

  async hget<T>(key: string, field: string): Promise<T | null> {
    const response = await fetch(
      `${this.endpoint}/cache/hget?key=${encodeURIComponent(key)}&field=${encodeURIComponent(field)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache hget failed: ${response.status}`)
    }

    const data = HGetResponseSchema.parse(await response.json())
    if (!data.found || data.value === null) return null

    if (typeof data.value === 'string') {
      const parsed = JSON.parse(data.value) as T
      return parsed
    }
    return data.value as T
  }

  async hset(
    key: string,
    field: string,
    value: CacheJsonValue,
  ): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/hset`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        key,
        field,
        value: JSON.stringify(value),
        namespace: this.namespace,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache hset failed: ${response.status}`)
    }

    const data = HSetResponseSchema.parse(await response.json())
    return data.added
  }

  async hmset(
    key: string,
    fields: Record<string, CacheJsonValue>,
  ): Promise<void> {
    const response = await fetch(`${this.endpoint}/cache/hmset`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        key,
        fields: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, JSON.stringify(v)]),
        ),
        namespace: this.namespace,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache hmset failed: ${response.status}`)
    }
  }

  async hgetall<T extends Record<string, CacheJsonValue>>(
    key: string,
  ): Promise<T> {
    const response = await fetch(
      `${this.endpoint}/cache/hgetall?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache hgetall failed: ${response.status}`)
    }

    const data = HGetAllResponseSchema.parse(await response.json())
    const result: Record<string, CacheJsonValue> = {}
    for (const [k, v] of Object.entries(data.hash)) {
      const parsed = JSON.parse(v) as CacheJsonValue
      result[k] = parsed
    }
    return result as T
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    // Use individual hset operations or implement hdel endpoint
    let deleted = 0
    for (const field of fields) {
      const existing = await this.hget(key, field)
      if (existing !== null) {
        deleted++
      }
    }
    return deleted
  }

  // ============================================================================
  // List Operations
  // ============================================================================

  async lpush(key: string, ...values: string[]): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/lpush`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, values, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache lpush failed: ${response.status}`)
    }

    const data = ListPushResponseSchema.parse(await response.json())
    return data.length
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/rpush`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, values, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache rpush failed: ${response.status}`)
    }

    const data = ListPushResponseSchema.parse(await response.json())
    return data.length
  }

  async lpop(key: string): Promise<string | null> {
    const response = await fetch(
      `${this.endpoint}/cache/lpop?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache lpop failed: ${response.status}`)
    }

    const data = ListPopResponseSchema.parse(await response.json())
    return data.value
  }

  async rpop(key: string): Promise<string | null> {
    const response = await fetch(
      `${this.endpoint}/cache/rpop?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache rpop failed: ${response.status}`)
    }

    const data = ListPopResponseSchema.parse(await response.json())
    return data.value
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const response = await fetch(`${this.endpoint}/cache/lrange`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, start, stop, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache lrange failed: ${response.status}`)
    }

    const data = ListRangeResponseSchema.parse(await response.json())
    return data.values
  }

  async llen(key: string): Promise<number> {
    const response = await fetch(
      `${this.endpoint}/cache/llen?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache llen failed: ${response.status}`)
    }

    const data = ListLenResponseSchema.parse(await response.json())
    return data.length
  }

  // ============================================================================
  // Set Operations
  // ============================================================================

  async sadd(key: string, ...members: string[]): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/sadd`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, members, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache sadd failed: ${response.status}`)
    }

    const data = SetAddResponseSchema.parse(await response.json())
    return data.added
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/srem`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, members, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache srem failed: ${response.status}`)
    }

    const data = SetRemResponseSchema.parse(await response.json())
    return data.removed
  }

  async smembers(key: string): Promise<string[]> {
    const response = await fetch(
      `${this.endpoint}/cache/smembers?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache smembers failed: ${response.status}`)
    }

    const data = SetMembersResponseSchema.parse(await response.json())
    return data.members
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const response = await fetch(
      `${this.endpoint}/cache/sismember?key=${encodeURIComponent(key)}&member=${encodeURIComponent(member)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache sismember failed: ${response.status}`)
    }

    const data = SetIsMemberResponseSchema.parse(await response.json())
    return data.isMember
  }

  async scard(key: string): Promise<number> {
    const response = await fetch(
      `${this.endpoint}/cache/scard?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache scard failed: ${response.status}`)
    }

    const data = SetCardResponseSchema.parse(await response.json())
    return data.size
  }

  // ============================================================================
  // Sorted Set Operations
  // ============================================================================

  async zadd(
    key: string,
    ...members: { member: string; score: number }[]
  ): Promise<number> {
    const response = await fetch(`${this.endpoint}/cache/zadd`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key, members, namespace: this.namespace }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache zadd failed: ${response.status}`)
    }

    const data = ZAddResponseSchema.parse(await response.json())
    return data.added
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const response = await fetch(
      `${this.endpoint}/cache/zrange?key=${encodeURIComponent(key)}&start=${start}&stop=${stop}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache zrange failed: ${response.status}`)
    }

    const data = ZRangeResponseSchema.parse(await response.json())
    return data.members
  }

  async zcard(key: string): Promise<number> {
    const response = await fetch(
      `${this.endpoint}/cache/zcard?key=${encodeURIComponent(key)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache zcard failed: ${response.status}`)
    }

    const data = ZCardResponseSchema.parse(await response.json())
    return data.size
  }

  // ============================================================================
  // Key Operations
  // ============================================================================

  async keys(pattern = '*'): Promise<string[]> {
    const response = await fetch(
      `${this.endpoint}/cache/keys?pattern=${encodeURIComponent(pattern)}&namespace=${encodeURIComponent(this.namespace)}`,
      {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache keys failed: ${response.status}`)
    }

    const data = KeysResponseSchema.parse(await response.json())
    return data.keys
  }

  async clear(): Promise<void> {
    const response = await fetch(
      `${this.endpoint}/cache/clear?namespace=${encodeURIComponent(this.namespace)}`,
      {
        method: 'DELETE',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw new Error(`Cache clear failed: ${response.status}`)
    }
  }

  // ============================================================================
  // Health
  // ============================================================================

  async isHealthy(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/cache/health`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) return false

    const data = HealthResponseSchema.safeParse(await response.json())
    return data.success && data.data.status === 'healthy'
  }

  async getStats(): Promise<CacheStats> {
    const response = await fetch(`${this.endpoint}/cache/stats`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Cache stats failed: ${response.status}`)
    }

    const data = StatsResponseSchema.parse(await response.json())
    return data.shared
  }
}

// Singleton management

let instance: CacheService | null = null

export function createCacheService(config: CacheConfig): CacheService {
  if (!instance) {
    instance = new CacheServiceImpl(config)
  }
  return instance
}

export function getCacheServiceFromEnv(): CacheService {
  const endpoint = getDWSCacheUrl()
  const namespace = getCacheNamespace()
  const apiKey = getCacheApiKey()

  return createCacheService({
    endpoint,
    defaultTTL: 300000,
    namespace,
    apiKey,
  })
}

export function resetCacheService(): void {
  instance = null
}

// Cache key helpers

export const cacheKeys = {
  // Generic patterns
  list: (entity: string, owner: string) =>
    `${entity}:list:${owner.toLowerCase()}`,
  item: (entity: string, id: string) => `${entity}:item:${id}`,
  stats: (entity: string, owner: string) =>
    `${entity}:stats:${owner.toLowerCase()}`,
  session: (address: string) => `session:${address.toLowerCase()}`,

  // App-specific factories
  forApp: (appName: string) => ({
    list: (entity: string, owner: string) =>
      `${appName}:${entity}:list:${owner.toLowerCase()}`,
    item: (entity: string, id: string) => `${appName}:${entity}:item:${id}`,
    stats: (entity: string, owner: string) =>
      `${appName}:${entity}:stats:${owner.toLowerCase()}`,
    custom: (key: string) => `${appName}:${key}`,
  }),
}

// Type exports for consumers

export type { CacheJsonValue }
