/** Rate limiting utilities using distributed cache */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'

interface RateLimitEntry {
  count: number
  windowStart: number
}

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 60 * 1000, maxRequests: 10 },
  proxy: { windowMs: 60 * 1000, maxRequests: 100 },
  session: { windowMs: 60 * 1000, maxRequests: 20 },
  default: { windowMs: 60 * 1000, maxRequests: 60 },
}

// Distributed cache for rate limiting
let rateCache: CacheClient | null = null

function getRateCache(): CacheClient {
  if (!rateCache) {
    rateCache = getCacheClient('vpn-ratelimit')
  }
  return rateCache
}

export async function checkRateLimit(
  type: string,
  identifier: string,
  config?: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const effectiveConfig =
    config ?? DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default
  const key = `vpn-rl:${type}:${identifier}`
  const now = Date.now()
  const cache = getRateCache()

  // Get current entry from cache
  const cached = await cache.get(key)
  let entry: RateLimitEntry | null = cached ? JSON.parse(cached) : null

  if (!entry || now - entry.windowStart > effectiveConfig.windowMs) {
    // New window
    entry = { count: 1, windowStart: now }
    const ttl = Math.ceil(effectiveConfig.windowMs / 1000)
    await cache.set(key, JSON.stringify(entry), ttl)
    return {
      allowed: true,
      remaining: effectiveConfig.maxRequests - 1,
      resetAt: now + effectiveConfig.windowMs,
    }
  }

  if (entry.count < effectiveConfig.maxRequests) {
    entry.count++
    const ttl = Math.max(
      1,
      Math.ceil((entry.windowStart + effectiveConfig.windowMs - now) / 1000),
    )
    await cache.set(key, JSON.stringify(entry), ttl)
    return {
      allowed: true,
      remaining: effectiveConfig.maxRequests - entry.count,
      resetAt: entry.windowStart + effectiveConfig.windowMs,
    }
  }

  return {
    allowed: false,
    remaining: 0,
    resetAt: entry.windowStart + effectiveConfig.windowMs,
  }
}

export function createRateLimitMiddleware(
  type: string,
  config?: RateLimitConfig,
) {
  return async ({
    request,
    set,
  }: {
    request: Request
    set: { status: number }
  }) => {
    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const jejuAddress = request.headers.get('x-jeju-address')

    const identifier =
      jejuAddress ?? forwardedFor?.split(',')[0]?.trim() ?? realIp ?? 'unknown'

    const result = await checkRateLimit(type, identifier, config)

    if (!result.allowed) {
      set.status = 429
      return {
        error: 'Too many requests',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      }
    }
    return undefined
  }
}

export function getRateLimitConfig(type: string): RateLimitConfig {
  return DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default
}
