import {
  type RateLimitEntry,
  type RateLimiterConfig,
  type RateLimitHeaders,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitTier,
  RateLimitTiers,
} from './types.js'

const DEFAULT_MAX_CACHE_SIZE = 100000

export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>()
  private maxSize: number

  constructor(maxSize: number = DEFAULT_MAX_CACHE_SIZE) {
    this.maxSize = maxSize
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    return this.store.get(key)
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evictOldest()
    }
    this.store.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  private evictOldest(): void {
    const now = Date.now()

    for (const [key, entry] of this.store) {
      if (entry.resetAt < now) {
        this.store.delete(key)
      }
    }

    if (this.store.size >= this.maxSize) {
      const entries = Array.from(this.store.entries()).sort(
        (a, b) => a[1].resetAt - b[1].resetAt,
      )
      const toRemove = Math.ceil(entries.length * 0.1)
      for (let i = 0; i < toRemove; i++) {
        this.store.delete(entries[i][0])
      }
    }
  }

  cleanup(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.store) {
      if (entry.resetAt < now) {
        this.store.delete(key)
        removed++
      }
    }
    return removed
  }

  get size(): number {
    return this.store.size
  }
}

export class RateLimiter {
  private config: Required<Omit<RateLimiterConfig, 'tiers'>> & {
    tiers: Record<string, RateLimitTier>
  }
  private store: RateLimitStore
  private cleanupInterval?: ReturnType<typeof setInterval>

  constructor(config: RateLimiterConfig, store?: RateLimitStore) {
    this.config = {
      defaultTier: config.defaultTier,
      tiers: config.tiers ?? { ...RateLimitTiers },
      maxCacheSize: config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
      keyPrefix: config.keyPrefix ?? 'rl',
      skipIps: config.skipIps ?? [],
      skipPaths: config.skipPaths ?? [],
    }

    this.store = store ?? new InMemoryRateLimitStore(this.config.maxCacheSize)

    if (this.store instanceof InMemoryRateLimitStore) {
      this.cleanupInterval = setInterval(
        () => {
          ;(this.store as InMemoryRateLimitStore).cleanup()
        },
        60000, // Cleanup every minute
      )
    }
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
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
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
    const ip = forwardedFor.split(',')[0]?.trim()
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
