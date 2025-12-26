/**
 * Bazaar Cache Layer
 *
 * Uses DWS cache service for distributed caching across instances.
 * Configuration comes from @jejunetwork/config services.json.
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'

// Singleton DWS cache client
let cacheClient: CacheClient | null = null

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('bazaar')
  }
  return cacheClient
}

/**
 * Get a cached value by key
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const cache = getCache()
  const value = await cache.get(key).catch(() => null)
  if (!value) return null

  const parsed = JSON.parse(value) as T
  return parsed
}

/**
 * Set a cached value with optional TTL
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds = 3600,
): Promise<void> {
  const cache = getCache()
  await cache.set(key, JSON.stringify(value), ttlSeconds).catch((err) => {
    console.warn('[Bazaar Cache] Set failed:', err)
  })
}

/**
 * Delete a cached value
 */
export async function cacheDel(key: string): Promise<void> {
  const cache = getCache()
  await cache.delete(key).catch((err) => {
    console.warn('[Bazaar Cache] Delete failed:', err)
  })
}

/**
 * Get multiple cached values
 */
export async function cacheMGet<T>(
  keys: string[],
): Promise<Map<string, T | null>> {
  const cache = getCache()
  const results = await cache.mget(keys).catch(() => new Map())
  const parsed = new Map<string, T | null>()

  for (const [key, value] of results) {
    if (value) {
      parsed.set(key, JSON.parse(value) as T)
    } else {
      parsed.set(key, null)
    }
  }

  return parsed
}

/**
 * Cache key helpers for Bazaar entities
 */
export const bazaarCacheKeys = {
  tfmmPool: (address: string) => `tfmm:pool:${address.toLowerCase()}`,
  tfmmStats: () => 'tfmm:stats',
  tfmmStrategies: () => 'tfmm:strategies',
  oracleStatus: () => 'oracle:status',
  marketPrice: (chainId: number, token: string) =>
    `market:price:${chainId}:${token.toLowerCase()}`,
  userPreferences: (address: string) => `user:prefs:${address.toLowerCase()}`,
}

/**
 * Reset cache client (for testing)
 */
export function resetBazaarCache(): void {
  cacheClient = null
}
