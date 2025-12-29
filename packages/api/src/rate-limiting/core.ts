import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import {
  type RateLimitEntry,
  type RateLimiterConfig,
  type RateLimitHeaders,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitTier,
  RateLimitTiers,
} from './types.js'

/**
 * Distributed rate limit store using shared cache
 * Supports horizontal scaling across multiple instances
 */
export class DistributedRateLimitStore implements RateLimitStore {
  private cache: CacheClient
  private keyPrefix: string

  constructor(serviceId: string = 'api-ratelimit', keyPrefix: string = 'rl') {
    this.cache = getCacheClient(serviceId)
    this.keyPrefix = keyPrefix
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    const cached = await this.cache.get(`${this.keyPrefix}:${key}`)
    if (cached) {
      return JSON.parse(cached) as RateLimitEntry
    }
    return undefined
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    const ttl = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000))
    await this.cache.set(`${this.keyPrefix}:${key}`, JSON.stringify(entry), ttl)
  }

  async delete(key: string): Promise<void> {
    await this.cache.delete(`${this.keyPrefix}:${key}`)
  }

  async clear(): Promise<void> {
    // Distributed stores don't support bulk clear - entries expire via TTL
  }
}

/**
 * In-memory rate limit store for testing and single-instance deployments
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private cache = new Map<string, RateLimitEntry>()
  private maxSize: number

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    const entry = this.cache.get(key)
    if (entry && entry.resetAt < Date.now()) {
      this.cache.delete(key)
      return undefined
    }
    return entry
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }
}

export class RateLimiter {
  private config: Required<Omit<RateLimiterConfig, 'tiers'>> & {
    tiers: Record<string, RateLimitTier>
  }
  private store: RateLimitStore

  constructor(config: RateLimiterConfig, store?: RateLimitStore) {
    this.config = {
      defaultTier: config.defaultTier,
      tiers: config.tiers ?? { ...RateLimitTiers },
      maxCacheSize: config.maxCacheSize ?? 100000,
      keyPrefix: config.keyPrefix ?? 'rl',
      skipIps: config.skipIps ?? [],
      skipPaths: config.skipPaths ?? [],
    }

    // Use distributed store by default for horizontal scaling
    this.store =
      store ??
      new DistributedRateLimitStore('api-ratelimit', this.config.keyPrefix)
  }

  async check(
    key: string,
    tier?: RateLimitTier | string,
  ): Promise<RateLimitResult> {
    const tierConfig = this.resolveTier(tier)
    const storeKey = `${this.config.keyPrefix}:${key}`
    const now = Date.now()

    let entry = await this.store.get(storeKey)

    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + tierConfig.windowMs,
      }
    }

    entry.count++

    const allowed = entry.count <= tierConfig.maxRequests
    const remaining = Math.max(0, tierConfig.maxRequests - entry.count)
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000)

    await this.store.set(storeKey, entry)

    return {
      allowed,
      current: entry.count,
      limit: tierConfig.maxRequests,
      remaining,
      resetInSeconds,
      error: allowed ? undefined : 'Rate limit exceeded',
    }
  }

  async reset(key: string): Promise<void> {
    const storeKey = `${this.config.keyPrefix}:${key}`
    await this.store.delete(storeKey)
  }

  async status(
    key: string,
    tier?: RateLimitTier | string,
  ): Promise<RateLimitResult> {
    const tierConfig = this.resolveTier(tier)
    const storeKey = `${this.config.keyPrefix}:${key}`
    const now = Date.now()

    const entry = await this.store.get(storeKey)

    if (!entry || entry.resetAt < now) {
      return {
        allowed: true,
        current: 0,
        limit: tierConfig.maxRequests,
        remaining: tierConfig.maxRequests,
        resetInSeconds: Math.ceil(tierConfig.windowMs / 1000),
      }
    }

    const remaining = Math.max(0, tierConfig.maxRequests - entry.count)
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000)

    return {
      allowed: entry.count < tierConfig.maxRequests,
      current: entry.count,
      limit: tierConfig.maxRequests,
      remaining,
      resetInSeconds,
    }
  }

  private resolveTier(tier?: RateLimitTier | string): RateLimitTier {
    if (!tier) {
      return this.config.defaultTier
    }

    if (typeof tier === 'string') {
      const namedTier = this.config.tiers[tier]
      if (!namedTier) {
        throw new Error(`Unknown rate limit tier: ${tier}`)
      }
      return namedTier
    }

    return tier
  }

  shouldSkipIp(ip: string): boolean {
    return this.config.skipIps.includes(ip)
  }

  shouldSkipPath(path: string): boolean {
    return this.config.skipPaths.some(
      (p) => path === p || path.startsWith(`${p}/`),
    )
  }

  stop(): void {
    // No cleanup needed - distributed cache handles TTL expiration
  }
}

export function extractClientIp(
  headers: Record<string, string | undefined> | Headers,
): string {
  const get = (key: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(key) ?? undefined
    }
    return headers[key] ?? headers[key.toLowerCase()]
  }

  const forwardedFor = get('x-forwarded-for')
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0].trim()
    if (ip) return ip
  }

  const realIp = get('x-real-ip')
  if (realIp) return realIp

  const cfConnectingIp = get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  return 'unknown'
}

export function createRateLimitHeaders(
  result: RateLimitResult,
): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetInSeconds.toString(),
  }

  if (!result.allowed) {
    headers['Retry-After'] = result.resetInSeconds.toString()
  }

  return headers
}

export function createRateLimitKey(
  ip: string,
  userId?: string,
  path?: string,
): string {
  const parts = [ip]
  if (userId) parts.push(userId)
  if (path) parts.push(path.replace(/\//g, '_'))
  return parts.join(':')
}

let defaultRateLimiter: RateLimiter | undefined

export function initRateLimiter(config: RateLimiterConfig): RateLimiter {
  if (defaultRateLimiter) {
    defaultRateLimiter.stop()
  }
  defaultRateLimiter = new RateLimiter(config)
  return defaultRateLimiter
}

export function getRateLimiter(): RateLimiter {
  if (!defaultRateLimiter) {
    throw new Error('Rate limiter not initialized. Call initRateLimiter first.')
  }
  return defaultRateLimiter
}

export function resetRateLimiter(): void {
  if (defaultRateLimiter) {
    defaultRateLimiter.stop()
    defaultRateLimiter = undefined
  }
}
