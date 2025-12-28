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

const MAX_ENTRIES = 50000
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

const rateLimitStore = new Map<string, RateLimitEntry>()

function cleanupExpired(): void {
  const now = Date.now()
  let _cleanedCount = 0

  for (const [key, entry] of rateLimitStore.entries()) {
    const type = key.split(':')[0]
    const config = DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default

    if (now - entry.windowStart > config.windowMs) {
      rateLimitStore.delete(key)
      _cleanedCount++
    }
  }
}

setInterval(cleanupExpired, CLEANUP_INTERVAL_MS)

export function checkRateLimit(
  type: string,
  identifier: string,
  config?: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } {
  const effectiveConfig =
    config ?? DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default
  const key = `${type}:${identifier}`
  const now = Date.now()

  if (rateLimitStore.size >= MAX_ENTRIES * 0.9) {
    cleanupExpired()
  }

  if (rateLimitStore.size >= MAX_ENTRIES) {
    console.error('Rate limit storage full - possible DoS attack')
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + effectiveConfig.windowMs,
    }
  }

  const entry = rateLimitStore.get(key)

  if (!entry || now - entry.windowStart > effectiveConfig.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return {
      allowed: true,
      remaining: effectiveConfig.maxRequests - 1,
      resetAt: now + effectiveConfig.windowMs,
    }
  }

  if (entry.count < effectiveConfig.maxRequests) {
    entry.count++
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
  return ({ request, set }: { request: Request; set: { status: number } }) => {
    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const jejuAddress = request.headers.get('x-jeju-address')

    const identifier =
      jejuAddress ?? forwardedFor?.split(',')[0]?.trim() ?? realIp ?? 'unknown'

    const result = checkRateLimit(type, identifier, config)

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
