/**
 * Cache Service - Eden Client
 * Direct cache operations with fail-fast behavior
 */

import { treaty } from '@elysiajs/eden'
import { Elysia, t } from 'elysia'

const COMPUTE_CACHE_ENDPOINT =
  process.env.COMPUTE_CACHE_ENDPOINT || 'http://localhost:4200/cache'
const CACHE_TIMEOUT = 5000

interface CacheService {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  isHealthy(): Promise<boolean>
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

  constructor() {
    this.client = treaty<CacheApp>(COMPUTE_CACHE_ENDPOINT, {
      fetch: { signal: AbortSignal.timeout(CACHE_TIMEOUT) },
    })
  }

  async get<T>(key: string): Promise<T | null> {
    const { data, error } = await this.client.get.post({ key })
    if (error) {
      throw new CacheError(`Cache get failed: ${error}`, 500)
    }
    return data?.value as T | null
  }

  async set<T>(key: string, value: T, ttlMs = 300000): Promise<void> {
    const { error } = await this.client.set.post({ key, value, ttlMs })
    if (error) {
      throw new CacheError(`Cache set failed: ${error}`, 500)
    }
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.delete.post({ key })
    if (error) {
      throw new CacheError(`Cache delete failed: ${error}`, 500)
    }
  }

  async clear(): Promise<void> {
    const { error } = await this.client.clear.post({})
    if (error) {
      throw new CacheError(`Cache clear failed: ${error}`, 500)
    }
  }

  async isHealthy(): Promise<boolean> {
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
}

export const cacheKeys = {
  todoList: (owner: string) => `todos:list:${owner.toLowerCase()}`,
  todoItem: (id: string) => `todos:item:${id}`,
  todoStats: (owner: string) => `todos:stats:${owner.toLowerCase()}`,
  userSession: (address: string) => `session:${address.toLowerCase()}`,
}
