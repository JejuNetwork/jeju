/**
 * Cache Service for Example App
 *
 * Uses the DWS serverless cache service for distributed caching.
 */

import { getDWSUrl } from '@jejunetwork/config'

const DWS_CACHE_ENDPOINT =
  process.env.DWS_CACHE_URL || `${getDWSUrl()}/cache`
const CACHE_NAMESPACE = process.env.CACHE_NAMESPACE || 'example'
const CACHE_TIMEOUT = 5000

type CacheValue =
  | string
  | number
  | boolean
  | null
  | CacheValue[]
  | { [key: string]: CacheValue }

interface CacheService {
  get(key: string): Promise<CacheValue | null>
  set(key: string, value: CacheValue, ttlMs?: number): Promise<void>
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

class DWSCacheService implements CacheService {
  private healthLastChecked = 0
  private healthy = false

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${DWS_CACHE_ENDPOINT}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(CACHE_TIMEOUT),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new CacheError(`Cache request failed: ${text}`, response.status)
    }

    return response.json() as Promise<T>
  }

  async get(key: string): Promise<CacheValue | null> {
    const params = new URLSearchParams({
      key,
      namespace: CACHE_NAMESPACE,
    })
    const result = await this.fetch<{ value: string | null; found: boolean }>(
      `/get?${params}`,
    )

    if (!result.found || result.value === null) {
      return null
    }

    // Parse JSON if stored as JSON string
    if (typeof result.value === 'string') {
      try {
        return JSON.parse(result.value) as CacheValue
      } catch {
        return result.value
      }
    }

    return result.value
  }

  async set(key: string, value: CacheValue, ttlMs = 300000): Promise<void> {
    const ttlSeconds = Math.ceil(ttlMs / 1000)
    const stringValue =
      typeof value === 'string' ? value : JSON.stringify(value)

    await this.fetch<{ success: boolean }>('/set', {
      method: 'POST',
      body: JSON.stringify({
        key,
        value: stringValue,
        ttl: ttlSeconds,
        namespace: CACHE_NAMESPACE,
      }),
    })
  }

  async delete(key: string): Promise<void> {
    await this.fetch<{ success: boolean }>(
      `/delete?key=${encodeURIComponent(key)}&namespace=${CACHE_NAMESPACE}`,
      { method: 'DELETE' },
    )
  }

  async clear(): Promise<void> {
    await this.fetch<{ success: boolean }>(
      `/clear?namespace=${CACHE_NAMESPACE}`,
      { method: 'DELETE' },
    )
  }

  async isHealthy(): Promise<boolean> {
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    try {
      await this.fetch<{ status: string }>('/health')
      this.healthy = true
    } catch {
      this.healthy = false
    }

    this.healthLastChecked = Date.now()
    return this.healthy
  }
}

let cacheService: CacheService | null = null

export function getCache(): CacheService {
  if (!cacheService) {
    cacheService = new DWSCacheService()
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
