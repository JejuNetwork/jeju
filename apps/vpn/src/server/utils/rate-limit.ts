/**
 * SECURITY: Rate limiting utilities to prevent abuse
 *
 * This module provides a simple in-memory rate limiter for:
 * - Authentication attempts
 * - Proxy requests
 * - Session creation
 */

// Rate limit entry tracking request counts and timestamps
interface RateLimitEntry {
  count: number
  windowStart: number
}

// Rate limit configuration
interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
}

// Default rate limit configurations
const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 60 * 1000, maxRequests: 10 }, // 10 auth attempts per minute
  proxy: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 proxy requests per minute
  session: { windowMs: 60 * 1000, maxRequests: 20 }, // 20 session creates per minute
  default: { windowMs: 60 * 1000, maxRequests: 60 }, // 60 requests per minute default
}

// Maximum entries before forced cleanup
const MAX_ENTRIES = 50000

// Cleanup interval (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

// Store rate limit data per endpoint type
// Key format: `${type}:${identifier}`
const rateLimitStore = new Map<string, RateLimitEntry>()

// Cleanup expired entries
function cleanupExpired(): void {
  const now = Date.now()
  let cleanedCount = 0

  for (const [key, entry] of rateLimitStore.entries()) {
    // Get the window from the key's type
    const type = key.split(':')[0]
    const config = DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default

    if (now - entry.windowStart > config.windowMs) {
      rateLimitStore.delete(key)
      cleanedCount++
    }
  }

  if (cleanedCount > 0) {
    console.log(
      `Rate limiter: cleaned ${cleanedCount} expired entries. Remaining: ${rateLimitStore.size}`,
    )
  }
}

// Start periodic cleanup
setInterval(cleanupExpired, CLEANUP_INTERVAL_MS)

/**
 * Check if a request should be rate limited
 *
 * @param type - The endpoint type (auth, proxy, session, etc.)
 * @param identifier - Unique identifier (IP address or wallet address)
 * @param config - Optional custom rate limit config
 * @returns Object with allowed status and retry info
 */
export function checkRateLimit(
  type: string,
  identifier: string,
  config?: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } {
  const effectiveConfig =
    config ?? DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default
  const key = `${type}:${identifier}`
  const now = Date.now()

  // Force cleanup if approaching capacity
  if (rateLimitStore.size >= MAX_ENTRIES * 0.9) {
    cleanupExpired()
  }

  // Reject if still at capacity (under attack)
  if (rateLimitStore.size >= MAX_ENTRIES) {
    console.error('SECURITY: Rate limit storage full - possible DoS attack')
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + effectiveConfig.windowMs,
    }
  }

  const entry = rateLimitStore.get(key)

  // No entry or window expired - create new entry
  if (!entry || now - entry.windowStart > effectiveConfig.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return {
      allowed: true,
      remaining: effectiveConfig.maxRequests - 1,
      resetAt: now + effectiveConfig.windowMs,
    }
  }

  // Check if within limit
  if (entry.count < effectiveConfig.maxRequests) {
    entry.count++
    return {
      allowed: true,
      remaining: effectiveConfig.maxRequests - entry.count,
      resetAt: entry.windowStart + effectiveConfig.windowMs,
    }
  }

  // Rate limited
  return {
    allowed: false,
    remaining: 0,
    resetAt: entry.windowStart + effectiveConfig.windowMs,
  }
}

/**
 * Create a rate limit middleware for Hono
 */
export function createRateLimitMiddleware(
  type: string,
  config?: RateLimitConfig,
) {
  return async (
    c: {
      req: { header: (name: string) => string | undefined }
      json: (body: object, status: number) => Response
    },
    next: () => Promise<void>,
  ) => {
    // Get identifier from request (prefer X-Forwarded-For, then X-Real-IP, then connection)
    const forwardedFor = c.req.header('x-forwarded-for')
    const realIp = c.req.header('x-real-ip')
    const jejuAddress = c.req.header('x-jeju-address')

    // Use wallet address if authenticated, otherwise IP
    const identifier =
      jejuAddress ?? forwardedFor?.split(',')[0]?.trim() ?? realIp ?? 'unknown'

    const result = checkRateLimit(type, identifier, config)

    if (!result.allowed) {
      return c.json(
        {
          error: 'Too many requests',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        429,
      )
    }

    return next()
  }
}

/**
 * Get rate limit configuration for an endpoint type
 */
export function getRateLimitConfig(type: string): RateLimitConfig {
  return DEFAULT_CONFIGS[type] ?? DEFAULT_CONFIGS.default
}
