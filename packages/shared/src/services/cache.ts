/**
 * Cache Service - Compute Redis Integration
 *
 * Provides decentralized caching via compute network.
 * NO FALLBACKS - cache service must be available.
 */

import { z } from 'zod'

const CacheConfigSchema = z.object({
  endpoint: z.string().url(),
  defaultTTL: z.number().positive().default(300000), // 5 minutes
})

export type CacheConfig = z.infer<typeof CacheConfigSchema>

export interface CacheService {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
  clear(pattern?: string): Promise<void>
  isHealthy(): Promise<boolean>
}

class CacheServiceImpl implements CacheService {
  private endpoint: string
  private defaultTTL: number

  constructor(config: CacheConfig) {
    const validated = CacheConfigSchema.parse(config)
    this.endpoint = validated.endpoint
    this.defaultTTL = validated.defaultTTL
  }

  async get<T>(key: string): Promise<T | null> {
    return this.remoteGet<T>(key)
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTTL
    await this.remoteSet(key, value, ttl)
  }

  async delete(key: string): Promise<void> {
    await this.remoteDelete(key)
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }

  async clear(pattern?: string): Promise<void> {
    await this.remoteClear(pattern)
  }

  async isHealthy(): Promise<boolean> {
    return this.checkHealth()
  }

  private async remoteGet<T>(key: string): Promise<T | null> {
    const response = await fetch(`${this.endpoint}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    })

    if (!response.ok) {
      console.error(`[Cache] remoteGet failed: ${response.status}`)
      return null
    }
    // Cache values are generic - use safeParse with a loose schema
    // The value is already serialized by our cache service, so we trust it
    const CacheResponseSchema = z.object({ value: z.unknown().nullable() })
    const parseResult = CacheResponseSchema.safeParse(await response.json())
    if (!parseResult.success) {
      console.error(
        '[Cache] Invalid cache response:',
        parseResult.error.message,
      )
      return null
    }
    return parseResult.data.value as T | null
  }

  private async remoteSet<T>(
    key: string,
    value: T,
    ttlMs: number,
  ): Promise<void> {
    await fetch(`${this.endpoint}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, ttlMs }),
      signal: AbortSignal.timeout(2000),
    })
  }

  private async remoteDelete(key: string): Promise<void> {
    await fetch(`${this.endpoint}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    })
  }

  private async remoteClear(pattern?: string): Promise<void> {
    await fetch(`${this.endpoint}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
      signal: AbortSignal.timeout(2000),
    })
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  }
}

let instance: CacheService | null = null

export function createCacheService(config: CacheConfig): CacheService {
  if (!instance) {
    instance = new CacheServiceImpl(config)
  }
  return instance
}

export function getCacheServiceFromEnv(): CacheService {
  const endpoint = process.env.COMPUTE_CACHE_ENDPOINT
  if (!endpoint) {
    throw new Error('COMPUTE_CACHE_ENDPOINT environment variable is required')
  }
  return createCacheService({
    endpoint,
    defaultTTL: 300000,
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
