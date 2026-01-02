/**
 * Cache Helpers - Shared utilities for caching across all apps
 *
 * Provides consistent caching patterns for:
 * - Generic cached operations (withCache)
 * - JSON object caching (withJsonCache)
 * - RPC response caching (cachedRpcCall)
 * - Profile caching (cachedProfile)
 * - Token price caching (cachedTokenPrice)
 */

import { createHash } from 'node:crypto'
import { type CacheClient, getCacheClient } from '@jejunetwork/cache'

/**
 * Cache configuration for different data types
 */
export const CacheTTL = {
  // Very short-lived data (1-5 seconds)
  BLOCK_NUMBER: 2,
  GAS_PRICE: 5,

  // Short-lived data (10-30 seconds)
  BALANCE: 15,
  TOKEN_PRICE: 30,
  RPC_CALL: 15,

  // Medium-lived data (1-5 minutes)
  PROFILE: 300, // 5 minutes
  TOKEN_INFO: 60, // 1 minute
  SEARCH_RESULTS: 120, // 2 minutes

  // Long-lived data (5+ minutes)
  TOKEN_METADATA: 3600, // 1 hour
  CONTRACT_CODE: 3600, // 1 hour
  STATIC_CONFIG: 3600, // 1 hour
} as const

/**
 * Hash a value to create a cache key
 */
export function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/**
 * Hash RPC request parameters for cache key
 */
export function hashRpcParams(params: unknown[]): string {
  return hashKey(JSON.stringify(params))
}

/**
 * Generic cache wrapper - caches string values
 *
 * @example
 * const result = await withCache(
 *   cache,
 *   'user:123',
 *   async () => fetchUser('123'),
 *   300 // 5 min TTL
 * )
 */
export async function withCache<T>(
  cache: CacheClient,
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number,
  options?: {
    serialize?: (value: T) => string
    deserialize?: (cached: string) => T
  },
): Promise<T> {
  const serialize = options?.serialize ?? JSON.stringify
  const deserialize = options?.deserialize ?? JSON.parse

  const cached = await cache.get(key).catch(() => null)
  if (cached !== null) {
    return deserialize(cached) as T
  }

  const result = await fn()

  // Cache in background, don't block
  cache.set(key, serialize(result), ttlSeconds).catch((err) => {
    console.warn(`[Cache] Failed to set ${key}:`, err)
  })

  return result
}

/**
 * JSON cache wrapper with Zod validation
 *
 * @example
 * const user = await withJsonCache(
 *   cache,
 *   'user:123',
 *   UserSchema,
 *   async () => fetchUser('123'),
 *   300
 * )
 */
export async function withJsonCache<T>(
  cache: CacheClient,
  key: string,
  schema: { parse: (data: unknown) => T },
  fn: () => Promise<T>,
  ttlSeconds: number,
): Promise<T> {
  const cached = await cache.get(key).catch(() => null)
  if (cached !== null) {
    const parsed = schema.parse(JSON.parse(cached))
    return parsed
  }

  const result = await fn()
  cache.set(key, JSON.stringify(result), ttlSeconds).catch((err) => {
    console.warn(`[Cache] Failed to set ${key}:`, err)
  })

  return result
}

/**
 * RPC call caching configuration
 */
interface RpcCacheConfig {
  chainId: number
  method: string
  params: unknown[]
  ttl?: number
}

/**
 * Cacheable RPC methods with their TTLs
 */
const CACHEABLE_RPC_METHODS: Record<string, number> = {
  eth_chainId: CacheTTL.STATIC_CONFIG,
  eth_blockNumber: CacheTTL.BLOCK_NUMBER,
  eth_gasPrice: CacheTTL.GAS_PRICE,
  eth_call: CacheTTL.RPC_CALL,
  eth_getBalance: CacheTTL.BALANCE,
  eth_getCode: CacheTTL.CONTRACT_CODE,
  eth_getStorageAt: CacheTTL.RPC_CALL,
  eth_getTransactionCount: CacheTTL.BALANCE,
}

/**
 * Check if an RPC method is cacheable
 */
export function isRpcMethodCacheable(method: string): boolean {
  return method in CACHEABLE_RPC_METHODS
}

/**
 * Get the TTL for an RPC method
 */
export function getRpcMethodTtl(method: string): number {
  return CACHEABLE_RPC_METHODS[method] ?? 0
}

/**
 * Create a cache key for an RPC call
 */
export function createRpcCacheKey(config: RpcCacheConfig): string {
  return `rpc:${config.chainId}:${config.method}:${hashRpcParams(config.params)}`
}

/**
 * Cached RPC call wrapper
 *
 * @example
 * const balance = await cachedRpcCall(
 *   rpcCache,
 *   { chainId: 1, method: 'eth_getBalance', params: [address, 'latest'] },
 *   () => client.getBalance({ address })
 * )
 */
export async function cachedRpcCall<T>(
  cache: CacheClient,
  config: RpcCacheConfig,
  fn: () => Promise<T>,
): Promise<T> {
  const ttl = config.ttl ?? getRpcMethodTtl(config.method)
  if (ttl === 0) {
    return fn()
  }

  const key = createRpcCacheKey(config)
  return withCache(cache, key, fn, ttl)
}

// Profile cache namespace
let profileCache: CacheClient | null = null

function getProfileCache(): CacheClient {
  if (!profileCache) {
    profileCache = getCacheClient('shared-profiles')
  }
  return profileCache
}

/**
 * Farcaster profile interface
 */
export interface CachedFarcasterProfile {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  followerCount?: number
  followingCount?: number
}

/**
 * Get a cached Farcaster profile
 *
 * @example
 * const profile = await getCachedProfile(12345, () => hubClient.getProfile(12345))
 */
export async function getCachedProfile(
  fid: number,
  fetcher: () => Promise<CachedFarcasterProfile | null>,
): Promise<CachedFarcasterProfile | null> {
  const cache = getProfileCache()
  const key = `profile:${fid}`

  const cached = await cache.get(key).catch(() => null)
  if (cached !== null) {
    return JSON.parse(cached) as CachedFarcasterProfile
  }

  const profile = await fetcher()
  if (profile) {
    cache.set(key, JSON.stringify(profile), CacheTTL.PROFILE).catch(() => {})
  }

  return profile
}

/**
 * Invalidate a cached profile
 */
export async function invalidateProfile(fid: number): Promise<void> {
  const cache = getProfileCache()
  await cache.delete(`profile:${fid}`)
}

// Token price cache namespace
let priceCache: CacheClient | null = null

function getPriceCache(): CacheClient {
  if (!priceCache) {
    priceCache = getCacheClient('shared-prices')
  }
  return priceCache
}

/**
 * Get cached token price
 *
 * @example
 * const price = await getCachedTokenPrice('ETH', () => oracle.getPrice('ETH'))
 */
export async function getCachedTokenPrice(
  symbol: string,
  fetcher: () => Promise<number | null>,
): Promise<number | null> {
  const cache = getPriceCache()
  const key = `price:${symbol.toUpperCase()}`

  const cached = await cache.get(key).catch(() => null)
  if (cached !== null) {
    return parseFloat(cached)
  }

  const price = await fetcher()
  if (price !== null) {
    cache.set(key, price.toString(), CacheTTL.TOKEN_PRICE).catch(() => {})
  }

  return price
}

/**
 * Get multiple cached token prices
 */
export async function getCachedTokenPrices(
  symbols: string[],
  fetcher: (symbols: string[]) => Promise<Map<string, number>>,
): Promise<Map<string, number>> {
  const cache = getPriceCache()
  const result = new Map<string, number>()
  const missingSymbols: string[] = []

  // Check cache for each symbol
  for (const symbol of symbols) {
    const cached = await cache
      .get(`price:${symbol.toUpperCase()}`)
      .catch(() => null)
    if (cached !== null) {
      result.set(symbol, parseFloat(cached))
    } else {
      missingSymbols.push(symbol)
    }
  }

  // Fetch missing prices
  if (missingSymbols.length > 0) {
    const fetched = await fetcher(missingSymbols)
    for (const [symbol, price] of fetched) {
      result.set(symbol, price)
      cache
        .set(
          `price:${symbol.toUpperCase()}`,
          price.toString(),
          CacheTTL.TOKEN_PRICE,
        )
        .catch(() => {})
    }
  }

  return result
}

// Token info cache namespace
let tokenInfoCache: CacheClient | null = null

function getTokenInfoCache(): CacheClient {
  if (!tokenInfoCache) {
    tokenInfoCache = getCacheClient('shared-tokens')
  }
  return tokenInfoCache
}

/**
 * Token info interface
 */
export interface CachedTokenInfo {
  address: string
  chainId: number
  symbol: string
  name: string
  decimals: number
  logoUrl?: string
  price?: number
  priceChange24h?: number
}

/**
 * Get cached token info
 */
export async function getCachedTokenInfo(
  chainId: number,
  addressOrSymbol: string,
  fetcher: () => Promise<CachedTokenInfo | null>,
): Promise<CachedTokenInfo | null> {
  const cache = getTokenInfoCache()
  const key = `token:${chainId}:${addressOrSymbol.toLowerCase()}`

  const cached = await cache.get(key).catch(() => null)
  if (cached !== null) {
    return JSON.parse(cached) as CachedTokenInfo
  }

  const token = await fetcher()
  if (token) {
    cache.set(key, JSON.stringify(token), CacheTTL.TOKEN_INFO).catch(() => {})
  }

  return token
}

/**
 * Hybrid cache interface with cleanup function
 */
export interface HybridCache {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, ttl: number) => Promise<void>
  delete: (key: string) => Promise<void>
  /** Call this to stop the cleanup interval when cache is no longer needed */
  destroy: () => void
}

/**
 * Create a hybrid cache that checks local memory first, then DWS
 */
export function createHybridCache(
  namespace: string,
  localMaxSize = 1000,
  localTtlMs = 5000,
): HybridCache {
  const localCache = new Map<string, { value: string; expiresAt: number }>()
  const dwsCache = getCacheClient(namespace)

  // Periodic cleanup of local cache
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of localCache) {
      if (entry.expiresAt < now) {
        localCache.delete(key)
      }
    }
    // Limit size
    if (localCache.size > localMaxSize) {
      const entries = Array.from(localCache.entries())
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      const toDelete = entries.slice(0, localCache.size - localMaxSize)
      for (const [key] of toDelete) {
        localCache.delete(key)
      }
    }
  }, 60000)

  return {
    async get(key: string): Promise<string | null> {
      // Check local first
      const local = localCache.get(key)
      if (local && local.expiresAt > Date.now()) {
        return local.value
      }
      localCache.delete(key)

      // Check DWS
      const remote = await dwsCache.get(key).catch(() => null)
      if (remote !== null) {
        // Store locally for fast access
        localCache.set(key, {
          value: remote,
          expiresAt: Date.now() + localTtlMs,
        })
      }
      return remote
    },

    async set(key: string, value: string, ttl: number): Promise<void> {
      // Set in local cache
      localCache.set(key, {
        value,
        expiresAt: Date.now() + Math.min(ttl * 1000, localTtlMs),
      })
      // Set in DWS
      await dwsCache.set(key, value, ttl)
    },

    async delete(key: string): Promise<void> {
      localCache.delete(key)
      await dwsCache.delete(key)
    },

    destroy(): void {
      clearInterval(cleanupInterval)
      localCache.clear()
    },
  }
}

/**
 * Reset all shared cache clients (for testing)
 */
export function resetSharedCaches(): void {
  profileCache = null
  priceCache = null
  tokenInfoCache = null
}
