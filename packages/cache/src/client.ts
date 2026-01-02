/**
 * Cache Client
 *
 * Production-ready client for the Jeju decentralized cache.
 * Works in browser, Node.js, and serverless environments.
 *
 * Features:
 * - Automatic retries with exponential backoff
 * - Connection health monitoring
 * - Namespace isolation
 * - Full Redis-compatible API via DWS cache routes
 *
 * @example
 * ```typescript
 * import { CacheClient, getCacheClient } from '@jejunetwork/cache'
 *
 * // Simple usage with factory function
 * const cache = getCacheClient('my-app')
 * await cache.set('key', 'value')
 * const value = await cache.get('key')
 *
 * // Or direct instantiation
 * const cache = new CacheClient({
 *   serverUrl: 'https://dws.jejunetwork.org',
 *   namespace: 'my-app',
 * })
 *
 * // With TTL
 * await cache.set('key', 'value', { ttl: 3600 })
 * ```
 */

import { getDWSCacheUrl } from '@jejunetwork/config'
import type { CacheClientConfig, CacheSetOptions, CacheStats } from './types'
import { CacheError, CacheErrorCode } from './types'

interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
}

/**
 * Production-ready cache client for Jeju DWS
 */
export class CacheClient {
  private serverUrl: string
  private namespace: string
  private defaultTtlSeconds: number
  private retryConfig: RetryConfig
  private ownerAddress: string | null = null

  constructor(config: CacheClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '')
    this.namespace = config.namespace ?? 'default'
    this.defaultTtlSeconds = config.defaultTtlSeconds ?? 3600
    this.retryConfig = {
      maxRetries: config.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
      baseDelayMs: config.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs,
      maxDelayMs: config.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    }
  }

  /**
   * Set the owner address for authenticated operations
   */
  setOwnerAddress(address: string): void {
    this.ownerAddress = address
  }

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to store
   * @param options - TTL in seconds or CacheSetOptions object
   */
  async set(
    key: string,
    value: string,
    options?: CacheSetOptions | number,
  ): Promise<{ success: boolean }> {
    const opts: CacheSetOptions =
      typeof options === 'number' ? { ttl: options } : (options ?? {})

    return this.request<{ success: boolean }>('/cache/set', 'POST', {
      key,
      value,
      ttl: opts.ttl ?? this.defaultTtlSeconds,
      namespace: this.namespace,
      nx: opts.nx,
      xx: opts.xx,
    })
  }

  /**
   * Get a value from the cache
   */
  async get(key: string): Promise<string | null> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ value: string | null; found: boolean }>(
      `/cache/get?${params}`,
      'GET',
    )
    return result.found ? result.value : null
  }

  /**
   * Delete keys from the cache
   */
  async del(...keys: string[]): Promise<number> {
    const result = await this.request<{ deleted: number }>(
      '/cache/del',
      'POST',
      {
        keys,
        namespace: this.namespace,
      },
    )
    return result.deleted
  }

  /**
   * Delete a single key (alias for del)
   */
  async delete(key: string): Promise<boolean> {
    const deleted = await this.del(key)
    return deleted > 0
  }

  /**
   * Clear all keys in the namespace (alias for flushdb)
   */
  async clear(): Promise<void> {
    await this.flushdb()
  }

  /**
   * Check if a key exists
   */
  async exists(...keys: string[]): Promise<number> {
    let count = 0
    for (const key of keys) {
      const value = await this.get(key)
      if (value !== null) count++
    }
    return count
  }

  /**
   * Get TTL for a key (in seconds)
   */
  async ttl(key: string): Promise<number> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ ttl: number }>(
      `/cache/ttl?${params}`,
      'GET',
    )
    return result.ttl
  }

  /**
   * Set TTL for a key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      '/cache/expire',
      'POST',
      {
        key,
        ttl: seconds,
        namespace: this.namespace,
      },
    )
    return result.success
  }

  /**
   * Get multiple keys at once
   */
  async mget(...keys: string[]): Promise<Map<string, string | null>> {
    const result = await this.request<{
      entries: Record<string, string | null>
    }>('/cache/mget', 'POST', { keys, namespace: this.namespace })
    return new Map(Object.entries(result.entries))
  }

  /**
   * Set multiple keys at once
   */
  async mset(
    entries: Array<{ key: string; value: string; ttl?: number }>,
  ): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      '/cache/mset',
      'POST',
      {
        entries,
        namespace: this.namespace,
      },
    )
    return result.success
  }

  /**
   * Increment a numeric value
   */
  async incr(key: string, by = 1): Promise<number> {
    const result = await this.request<{ value: number }>(
      '/cache/incr',
      'POST',
      {
        key,
        by,
        namespace: this.namespace,
      },
    )
    return result.value
  }

  /**
   * Decrement a numeric value
   */
  async decr(key: string, by = 1): Promise<number> {
    const result = await this.request<{ value: number }>(
      '/cache/decr',
      'POST',
      {
        key,
        by,
        namespace: this.namespace,
      },
    )
    return result.value
  }

  // Hash operations

  /**
   * Set a hash field
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    const result = await this.request<{ added: number }>(
      '/cache/hset',
      'POST',
      {
        key,
        field,
        value,
        namespace: this.namespace,
      },
    )
    return result.added
  }

  /**
   * Set multiple hash fields
   */
  async hmset(key: string, fields: Record<string, string>): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      '/cache/hmset',
      'POST',
      {
        key,
        fields,
        namespace: this.namespace,
      },
    )
    return result.success
  }

  /**
   * Get a hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    const params = new URLSearchParams({
      key,
      field,
      namespace: this.namespace,
    })
    const result = await this.request<{ value: string | null; found: boolean }>(
      `/cache/hget?${params}`,
      'GET',
    )
    return result.found ? result.value : null
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ hash: Record<string, string> }>(
      `/cache/hgetall?${params}`,
      'GET',
    )
    return result.hash
  }

  // List operations

  /**
   * Push to the left of a list
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const result = await this.request<{ length: number }>(
      '/cache/lpush',
      'POST',
      {
        key,
        values,
        namespace: this.namespace,
      },
    )
    return result.length
  }

  /**
   * Push to the right of a list
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    const result = await this.request<{ length: number }>(
      '/cache/rpush',
      'POST',
      {
        key,
        values,
        namespace: this.namespace,
      },
    )
    return result.length
  }

  /**
   * Pop from the left of a list
   */
  async lpop(key: string): Promise<string | null> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ value: string | null }>(
      `/cache/lpop?${params}`,
      'GET',
    )
    return result.value
  }

  /**
   * Pop from the right of a list
   */
  async rpop(key: string): Promise<string | null> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ value: string | null }>(
      `/cache/rpop?${params}`,
      'GET',
    )
    return result.value
  }

  /**
   * Get a range from a list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const result = await this.request<{ values: string[] }>(
      '/cache/lrange',
      'POST',
      {
        key,
        start,
        stop,
        namespace: this.namespace,
      },
    )
    return result.values
  }

  /**
   * Get list length
   */
  async llen(key: string): Promise<number> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ length: number }>(
      `/cache/llen?${params}`,
      'GET',
    )
    return result.length
  }

  // Set operations

  /**
   * Add members to a set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    const result = await this.request<{ added: number }>(
      '/cache/sadd',
      'POST',
      {
        key,
        members,
        namespace: this.namespace,
      },
    )
    return result.added
  }

  /**
   * Remove members from a set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    const result = await this.request<{ removed: number }>(
      '/cache/srem',
      'POST',
      {
        key,
        members,
        namespace: this.namespace,
      },
    )
    return result.removed
  }

  /**
   * Get all members of a set
   */
  async smembers(key: string): Promise<string[]> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ members: string[] }>(
      `/cache/smembers?${params}`,
      'GET',
    )
    return result.members
  }

  /**
   * Check if a member is in a set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const params = new URLSearchParams({
      key,
      member,
      namespace: this.namespace,
    })
    const result = await this.request<{ isMember: boolean }>(
      `/cache/sismember?${params}`,
      'GET',
    )
    return result.isMember
  }

  /**
   * Get set size
   */
  async scard(key: string): Promise<number> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ size: number }>(
      `/cache/scard?${params}`,
      'GET',
    )
    return result.size
  }

  // Sorted set operations

  /**
   * Add members to a sorted set
   */
  async zadd(
    key: string,
    ...members: Array<{ member: string; score: number }>
  ): Promise<number> {
    const result = await this.request<{ added: number }>(
      '/cache/zadd',
      'POST',
      {
        key,
        members,
        namespace: this.namespace,
      },
    )
    return result.added
  }

  /**
   * Get a range from a sorted set
   */
  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const params = new URLSearchParams({
      key,
      start: String(start),
      stop: String(stop),
      namespace: this.namespace,
    })
    const result = await this.request<{ members: string[] }>(
      `/cache/zrange?${params}`,
      'GET',
    )
    return result.members
  }

  /**
   * Get sorted set size
   */
  async zcard(key: string): Promise<number> {
    const params = new URLSearchParams({
      key,
      namespace: this.namespace,
    })
    const result = await this.request<{ size: number }>(
      `/cache/zcard?${params}`,
      'GET',
    )
    return result.size
  }

  // Utility operations

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern = '*'): Promise<string[]> {
    const params = new URLSearchParams({
      pattern,
      namespace: this.namespace,
    })
    const result = await this.request<{ keys: string[] }>(
      `/cache/keys?${params}`,
      'GET',
    )
    return result.keys
  }

  /**
   * Flush all keys in the namespace
   */
  async flushdb(): Promise<boolean> {
    const params = new URLSearchParams({
      namespace: this.namespace,
    })
    const result = await this.request<{ success: boolean }>(
      `/cache/clear?${params}`,
      'DELETE',
    )
    return result.success
  }

  /**
   * Get cache statistics
   */
  async stats(): Promise<CacheStats> {
    const result = await this.request<{ shared: CacheStats }>(
      '/cache/stats',
      'GET',
    )
    return result.shared
  }

  /**
   * Get cache statistics (alias for stats())
   */
  async getStats(): Promise<CacheStats> {
    return this.stats()
  }

  /**
   * Check if cache is healthy
   */
  async health(): Promise<{ status: string; uptime: number }> {
    return this.request<{ status: string; uptime: number }>(
      '/cache/health',
      'GET',
    )
  }

  /**
   * Ping the cache server
   */
  async ping(): Promise<boolean> {
    const health = await this.health()
    return health.status === 'healthy'
  }

  /**
   * Internal request method with retry logic
   */
  private async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(
          this.retryConfig.baseDelayMs * 2 ** (attempt - 1),
          this.retryConfig.maxDelayMs,
        )
        await this.sleep(delay)
      }

      const result = await this.doRequest<T>(path, method, body)
      if (result.success) {
        return result.data
      }

      lastError = result.error

      // Don't retry on client errors (4xx)
      if (result.statusCode >= 400 && result.statusCode < 500) {
        break
      }
    }

    throw (
      lastError ?? new CacheError(CacheErrorCode.SERVER_ERROR, 'Request failed')
    )
  }

  private async doRequest<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
  ): Promise<
    | { success: true; data: T }
    | { success: false; error: Error; statusCode: number }
  > {
    const url = `${this.serverUrl}${path}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.ownerAddress) {
      headers['x-owner-address'] = this.ownerAddress
    }

    const init: RequestInit = { method, headers }

    if (body && method !== 'GET') {
      init.body = JSON.stringify(body)
    }

    const response = await fetch(url, init).catch((err: Error) => {
      return { ok: false, status: 0, error: err } as const
    })

    if ('error' in response) {
      return {
        success: false,
        error: new CacheError(
          CacheErrorCode.SERVER_ERROR,
          `Network error: ${response.error.message}`,
        ),
        statusCode: 0,
      }
    }

    if (!response.ok) {
      if (response.status === 404) {
        // Return null/empty for not found - depends on caller
        return {
          success: true,
          data: { value: null, found: false } as T,
        }
      }

      const errorText = await response.text().catch(() => 'Unknown error')
      return {
        success: false,
        error: new CacheError(
          CacheErrorCode.SERVER_ERROR,
          `Cache request failed: ${response.status} ${errorText}`,
        ),
        statusCode: response.status,
      }
    }

    const data = (await response.json()) as T
    return { success: true, data }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create a cache client with sensible defaults
 */
export function createCacheClient(
  serverUrl: string,
  options?: Partial<CacheClientConfig>,
): CacheClient {
  return new CacheClient({
    serverUrl,
    ...options,
  })
}

// Singleton cache clients per namespace
const cacheClients = new Map<string, CacheClient>()

/**
 * Get a cache client for a namespace (singleton per namespace)
 */
export function getCacheClient(namespace: string): CacheClient {
  const existing = cacheClients.get(namespace)
  if (existing) return existing

  const endpoint = getDWSCacheUrl()
  const client = new CacheClient({
    serverUrl: endpoint,
    namespace,
    defaultTtlSeconds: 3600,
  })

  cacheClients.set(namespace, client)
  return client
}

/**
 * Reset all cached clients (useful for testing)
 */
export function resetCacheClients(): void {
  cacheClients.clear()
}
