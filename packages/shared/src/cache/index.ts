/**
 * Decentralized Cache Client
 *
 * Re-exports from @jejunetwork/cache for backwards compatibility.
 * New code should import directly from @jejunetwork/cache.
 *
 * @deprecated Import from @jejunetwork/cache instead
 */

import { getDWSCacheUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import { z } from 'zod'

// Re-export from @jejunetwork/cache with aliases to avoid conflicts
export {
  CacheClient as CachePackageClient,
  type CacheClientConfig as CachePackageConfig,
  CacheError,
  CacheErrorCode,
  type CacheStats as CachePackageStats,
  getCacheClient as getPackageCacheClient,
  resetCacheClients as resetPackageCacheClients,
} from '@jejunetwork/cache'

// Local schemas for response validation
const CacheGetResponseSchema = z.object({
  value: z.string().nullable(),
  found: z.boolean(),
})

const CacheSuccessResponseSchema = z.object({
  success: z.boolean(),
})

const CacheKeysResponseSchema = z.object({
  keys: z.array(z.string()),
})

const CacheTTLResponseSchema = z.object({
  ttl: z.number(),
})

const CacheMGetResponseSchema = z.object({
  entries: z.record(z.string(), z.string().nullable()),
})

const CacheStatsResponseSchema = z.object({
  stats: z.object({
    totalKeys: z.number(),
    namespaces: z.number(),
    usedMemoryMb: z.number(),
    totalMemoryMb: z.number(),
    hits: z.number(),
    misses: z.number(),
    hitRate: z.number(),
    totalInstances: z.number(),
  }),
})

const CacheInstanceSchema = z.object({
  id: z.string(),
  owner: z.string(),
  namespace: z.string(),
  maxMemoryMb: z.number(),
  usedMemoryMb: z.number(),
  keyCount: z.number(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(['creating', 'running', 'stopped', 'expired', 'error']),
})

const CacheRentalPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  maxMemoryMb: z.number(),
  maxKeys: z.number(),
  pricePerHour: z.string(),
  pricePerMonth: z.string(),
  teeRequired: z.boolean(),
})

export interface CacheClientConfig {
  endpoint: string
  namespace: string
  defaultTtl?: number
  timeout?: number
}

export interface CacheClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl?: number): Promise<{ success: boolean }>
  /** Atomic set-if-not-exists for distributed locking */
  setNX(key: string, value: string, ttl: number): Promise<boolean>
  delete(key: string): Promise<boolean>
  mget(...keys: string[]): Promise<Map<string, string | null>>
  mset(
    entries: Array<{ key: string; value: string; ttl?: number }>,
  ): Promise<boolean>
  keys(pattern?: string): Promise<string[]>
  ttl(key: string): Promise<number>
  expire(key: string, ttl: number): Promise<boolean>
  clear(): Promise<void>
  getStats(): Promise<CacheStats>
}

export interface CacheStats {
  totalKeys: number
  namespaces: number
  usedMemoryMb?: number
  totalMemoryMb?: number
  usedMemoryBytes?: number
  maxMemoryBytes?: number
  hits: number
  misses: number
  hitRate: number
  totalInstances?: number
  evictions?: number
  expiredKeys?: number
  avgKeySize?: number
  avgValueSize?: number
  oldestKeyAge?: number
  uptime?: number
}

export interface CacheInstance {
  id: string
  owner: Address
  namespace: string
  maxMemoryMb: number
  usedMemoryMb: number
  keyCount: number
  createdAt: number
  expiresAt: number
  status: 'creating' | 'running' | 'stopped' | 'expired' | 'error'
}

export interface CacheRentalPlan {
  id: string
  name: string
  maxMemoryMb: number
  maxKeys: number
  pricePerHour: string
  pricePerMonth: string
  teeRequired: boolean
}

class DecentralizedCacheClient implements CacheClient {
  private config: Required<CacheClientConfig>

  constructor(config: CacheClientConfig) {
    this.config = {
      defaultTtl: 3600,
      timeout: 5000,
      ...config,
    }
  }

  async get(key: string): Promise<string | null> {
    const url = new URL('/cache/get', this.config.endpoint)
    url.searchParams.set('key', key)
    url.searchParams.set('namespace', this.config.namespace)

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache get failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheGetResponseSchema.parse(json)
    return data.found ? data.value : null
  }

  async set(
    key: string,
    value: string,
    ttl?: number,
  ): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.endpoint}/cache/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        value,
        ttl: ttl ?? this.config.defaultTtl,
        namespace: this.config.namespace,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache set failed: ${response.statusText}`)
    }

    return { success: true }
  }

  /**
   * Atomic set-if-not-exists for distributed locking
   * Returns true if the key was set, false if it already existed
   */
  async setNX(key: string, value: string, ttl: number): Promise<boolean> {
    const response = await fetch(`${this.config.endpoint}/cache/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        value,
        ttl,
        namespace: this.config.namespace,
        nx: true, // Set if not exists (atomic operation)
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      // 409 Conflict or similar means key already exists
      if (response.status === 409) {
        return false
      }
      throw new Error(`Cache setNX failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheSuccessResponseSchema.parse(json)
    return data.success
  }

  async delete(key: string): Promise<boolean> {
    const url = new URL('/cache/delete', this.config.endpoint)
    url.searchParams.set('key', key)
    url.searchParams.set('namespace', this.config.namespace)

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache delete failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheSuccessResponseSchema.parse(json)
    return data.success
  }

  async mget(...keys: string[]): Promise<Map<string, string | null>> {
    const response = await fetch(`${this.config.endpoint}/cache/mget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keys,
        namespace: this.config.namespace,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache mget failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheMGetResponseSchema.parse(json)
    return new Map(Object.entries(data.entries))
  }

  async mset(
    entries: Array<{ key: string; value: string; ttl?: number }>,
  ): Promise<boolean> {
    const response = await fetch(`${this.config.endpoint}/cache/mset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries,
        namespace: this.config.namespace,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache mset failed: ${response.statusText}`)
    }

    return true
  }

  async keys(pattern?: string): Promise<string[]> {
    const url = new URL('/cache/keys', this.config.endpoint)
    url.searchParams.set('namespace', this.config.namespace)
    if (pattern) {
      url.searchParams.set('pattern', pattern)
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache keys failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheKeysResponseSchema.parse(json)
    return data.keys
  }

  async ttl(key: string): Promise<number> {
    const url = new URL('/cache/ttl', this.config.endpoint)
    url.searchParams.set('key', key)
    url.searchParams.set('namespace', this.config.namespace)

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache ttl failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheTTLResponseSchema.parse(json)
    return data.ttl
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const response = await fetch(`${this.config.endpoint}/cache/expire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        ttl,
        namespace: this.config.namespace,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache expire failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheSuccessResponseSchema.parse(json)
    return data.success
  }

  async clear(): Promise<void> {
    const url = new URL('/cache/clear', this.config.endpoint)
    url.searchParams.set('namespace', this.config.namespace)

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache clear failed: ${response.statusText}`)
    }
  }

  async getStats(): Promise<CacheStats> {
    const response = await fetch(`${this.config.endpoint}/stats`, {
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Cache stats failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = CacheStatsResponseSchema.parse(json)
    return data.stats
  }
}

// Cache for rental management
export class CacheRentalClient {
  private endpoint: string
  private timeout: number

  constructor(endpoint: string, timeout = 5000) {
    this.endpoint = endpoint
    this.timeout = timeout
  }

  async listPlans(): Promise<CacheRentalPlan[]> {
    const response = await fetch(`${this.endpoint}/plans`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`List plans failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z.object({ plans: z.array(CacheRentalPlanSchema) }).parse(json)
    return data.plans
  }

  async createInstance(
    planId: string,
    namespace?: string,
    durationHours = 720,
  ): Promise<CacheInstance> {
    const response = await fetch(`${this.endpoint}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, namespace, durationHours }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Create instance failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z.object({ instance: CacheInstanceSchema }).parse(json)
    return data.instance as CacheInstance
  }

  async getInstance(id: string): Promise<CacheInstance | null> {
    const response = await fetch(`${this.endpoint}/instances/${id}`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Get instance failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z.object({ instance: CacheInstanceSchema }).parse(json)
    return data.instance as CacheInstance
  }

  async listInstances(): Promise<CacheInstance[]> {
    const response = await fetch(`${this.endpoint}/instances`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`List instances failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z
      .object({ instances: z.array(CacheInstanceSchema) })
      .parse(json)
    return data.instances as CacheInstance[]
  }

  async deleteInstance(id: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/instances/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Delete instance failed: ${response.statusText}`)
    }
  }
}

// Singleton cache clients per namespace (using legacy interface)
const legacyCacheClients = new Map<string, CacheClient>()

/**
 * Get a cache client for a namespace (legacy interface for backwards compat)
 * @deprecated Use getCacheClient from @jejunetwork/cache instead
 */
export function getLegacyCacheClient(namespace: string): CacheClient {
  const existing = legacyCacheClients.get(namespace)
  if (existing) return existing

  const endpoint = getDWSCacheUrl()
  const client = new DecentralizedCacheClient({
    endpoint,
    namespace,
    defaultTtl: 3600,
    timeout: 5000,
  })

  legacyCacheClients.set(namespace, client)
  return client
}

export function resetLegacyCacheClients(): void {
  legacyCacheClients.clear()
}

let rentalClient: CacheRentalClient | null = null

export function getCacheRentalClient(): CacheRentalClient {
  if (rentalClient) return rentalClient

  const endpoint = getDWSCacheUrl()
  rentalClient = new CacheRentalClient(endpoint)
  return rentalClient
}

export function resetCacheRentalClient(): void {
  rentalClient = null
}

// Re-export cache helpers
export {
  type CachedFarcasterProfile,
  type CachedTokenInfo,
  CacheTTL,
  cachedRpcCall,
  createHybridCache,
  createRpcCacheKey,
  getCachedProfile,
  getCachedTokenInfo,
  getCachedTokenPrice,
  getCachedTokenPrices,
  getRpcMethodTtl,
  type HybridCache,
  hashKey,
  hashRpcParams,
  invalidateProfile,
  isRpcMethodCacheable,
  resetSharedCaches,
  withCache,
  withJsonCache,
} from './helpers'
