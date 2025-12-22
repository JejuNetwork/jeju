/**
 * Cache Service - Eden Client
 */

import { treaty } from '@elysiajs/eden'
import { Elysia, t } from 'elysia'

const COMPUTE_CACHE_ENDPOINT =
  process.env.COMPUTE_CACHE_ENDPOINT || 'http://localhost:4200/cache'
const CACHE_TIMEOUT = 5000
const NETWORK = process.env.NETWORK || 'localnet'

interface CacheService {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  isHealthy(): Promise<boolean>
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const memoryCache: Map<string, CacheEntry> = new Map()

function cleanExpired(): void {
  const now = Date.now()
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt && entry.expiresAt < now) {
      memoryCache.delete(key)
    }
  }
}

export class CacheError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'CacheError'
  }
}

const cacheAppDef = new Elysia()
  .post('/get', () => ({ value: null as unknown }), {
    body: t.Object({ key: t.String() }),
  })
  .post('/set', () => ({ success: true }), {
    body: t.Object({
      key: t.String(),
      value: t.Unknown(),
      ttlMs: t.Optional(t.Number()),
    }),
  })
  .post('/delete', () => ({ success: true }), {
    body: t.Object({ key: t.String() }),
  })
  .post('/clear', () => ({ success: true }))
  .get('/health', () => ({ status: 'ok' as const }))

type CacheApp = typeof cacheAppDef

class ComputeCacheService implements CacheService {
  private client: ReturnType<typeof treaty<CacheApp>>
  private healthLastChecked = 0
  private healthy = false
  private useFallback = false
  private checkedFallback = false

  constructor() {
    this.client = treaty<CacheApp>(COMPUTE_CACHE_ENDPOINT, {
      fetch: { signal: AbortSignal.timeout(CACHE_TIMEOUT) },
    })
  }

  private async checkFallback(): Promise<void> {
    if (this.checkedFallback) return
    this.checkedFallback = true

    const isHealthy = await this.isHealthy()
    if (!isHealthy && (NETWORK === 'localnet' || NETWORK === 'Jeju')) {
      console.log('[Cache] Compute cache unavailable, using in-memory fallback')
      this.useFallback = true
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.checkFallback()

    if (this.useFallback) {
      cleanExpired()
      const entry = memoryCache.get(key)
      if (!entry) return null
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        memoryCache.delete(key)
        return null
      }
      return entry.value as T
    }

    const { data, error } = await this.client.get.post({ key })
    if (error) {
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Get failed, using fallback: ${error}`)
        this.useFallback = true
        return this.get<T>(key)
      }
      console.error(`[Cache] Get failed: ${error}`)
      return null
    }
    return data?.value as T | null
  }

  async set<T>(key: string, value: T, ttlMs = 300000): Promise<void> {
    await this.checkFallback()

    if (this.useFallback) {
      memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs })
      return
    }

    const { error } = await this.client.set.post({ key, value, ttlMs })
    if (error) {
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Set failed, using fallback: ${error}`)
        this.useFallback = true
        memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs })
      } else {
        console.error(`[Cache] Set failed: ${error}`)
      }
    }
  }

  async delete(key: string): Promise<void> {
    await this.checkFallback()

    if (this.useFallback) {
      memoryCache.delete(key)
      return
    }

    const { error } = await this.client.delete.post({ key })
    if (error) {
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Delete failed, using fallback: ${error}`)
        this.useFallback = true
        memoryCache.delete(key)
      } else {
        console.error(`[Cache] Delete failed: ${error}`)
      }
    }
  }

  async clear(): Promise<void> {
    await this.checkFallback()

    if (this.useFallback) {
      memoryCache.clear()
      return
    }

    const { error } = await this.client.clear.post({})
    if (error) {
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Clear failed, using fallback: ${error}`)
        this.useFallback = true
        memoryCache.clear()
      } else {
        console.error(`[Cache] Clear failed: ${error}`)
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    if (this.useFallback) return true

    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    const { error } = await this.client.health.get()
    this.healthy = !error
    this.healthLastChecked = Date.now()
    return this.healthy
  }
}

let cacheService: CacheService | null = null

export function getCache(): CacheService {
  if (!cacheService) {
    cacheService = new ComputeCacheService()
  }
  return cacheService
}

export function resetCache(): void {
  cacheService = null
  memoryCache.clear()
}

export const cacheKeys = {
  todoList: (owner: string) => `todos:list:${owner.toLowerCase()}`,
  todoItem: (id: string) => `todos:item:${id}`,
  todoStats: (owner: string) => `todos:stats:${owner.toLowerCase()}`,
  userSession: (address: string) => `session:${address.toLowerCase()}`,
}
