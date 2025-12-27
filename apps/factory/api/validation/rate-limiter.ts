/**
 * Production-Grade Rate Limiter
 *
 * Implements token bucket algorithm with:
 * - Per-IP rate limiting for unauthenticated requests
 * - Per-address rate limiting for authenticated requests
 * - Configurable limits per endpoint type
 * - Automatic cleanup of expired entries
 * - DDoS protection with global limits
 */

// Simple logger
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[rate-limiter] ${msg}`, data ?? ''),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[rate-limiter] ${msg}`, data ?? ''),
  debug: (msg: string, data?: Record<string, unknown>) =>
    console.debug(`[rate-limiter] ${msg}`, data ?? ''),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`[rate-limiter] ${msg}`, data ?? ''),
}

// ============================================================================
// CONFIGURATION
// ============================================================================

interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
  /** Block duration when limit exceeded (ms) */
  blockDurationMs: number
}

/** Rate limit tiers for different operation types */
const RATE_LIMIT_TIERS: Record<string, RateLimitConfig> = {
  // Read operations - more permissive
  read: {
    maxRequests: 100,
    windowMs: 60_000, // 1 minute
    blockDurationMs: 60_000, // 1 minute block
  },
  // Write operations - more restrictive
  write: {
    maxRequests: 20,
    windowMs: 60_000, // 1 minute
    blockDurationMs: 300_000, // 5 minute block
  },
  // Authentication operations - very restrictive to prevent brute force
  auth: {
    maxRequests: 5,
    windowMs: 60_000, // 1 minute
    blockDurationMs: 900_000, // 15 minute block
  },
  // Sensitive operations (signer creation, etc.)
  sensitive: {
    maxRequests: 3,
    windowMs: 60_000, // 1 minute
    blockDurationMs: 1_800_000, // 30 minute block
  },
}

/** Global rate limit to prevent DDoS */
const GLOBAL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10_000,
  windowMs: 60_000,
  blockDurationMs: 60_000,
}

// ============================================================================
// TYPES
// ============================================================================

interface RateLimitEntry {
  /** Number of requests in current window */
  count: number
  /** Window start timestamp */
  windowStart: number
  /** If blocked, when the block expires */
  blockedUntil: number | null
}

type RateLimitTier = keyof typeof RATE_LIMIT_TIERS

// ============================================================================
// RATE LIMIT STORE
// ============================================================================

/**
 * In-memory rate limit store with automatic cleanup
 * For production with multiple instances, use Redis instead
 */
class RateLimitStore {
  private store = new Map<string, RateLimitEntry>()
  private globalEntry: RateLimitEntry = {
    count: 0,
    windowStart: Date.now(),
    blockedUntil: null,
  }
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000)
  }

  private cleanup(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.store.entries()) {
      // Remove entries with expired windows and no active block
      const windowExpired = now - entry.windowStart > 300_000 // 5 minutes
      const blockExpired = !entry.blockedUntil || entry.blockedUntil < now

      if (windowExpired && blockExpired) {
        this.store.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      log.debug('Rate limit cleanup', { entriesRemoved: cleaned })
    }
  }

  get(key: string): RateLimitEntry {
    let entry = this.store.get(key)
    if (!entry) {
      entry = {
        count: 0,
        windowStart: Date.now(),
        blockedUntil: null,
      }
      this.store.set(key, entry)
    }
    return entry
  }

  getGlobal(): RateLimitEntry {
    return this.globalEntry
  }

  increment(key: string, config: RateLimitConfig): RateLimitEntry {
    const entry = this.get(key)
    const now = Date.now()

    // Check if window has expired
    if (now - entry.windowStart > config.windowMs) {
      entry.count = 1
      entry.windowStart = now
    } else {
      entry.count++
    }

    // Check if limit exceeded
    if (entry.count > config.maxRequests && !entry.blockedUntil) {
      entry.blockedUntil = now + config.blockDurationMs
      log.warn('Rate limit exceeded', {
        key: `${key.slice(0, 20)}...`,
        count: entry.count,
        blockedUntil: new Date(entry.blockedUntil).toISOString(),
      })
    }

    return entry
  }

  incrementGlobal(): RateLimitEntry {
    const now = Date.now()

    if (now - this.globalEntry.windowStart > GLOBAL_RATE_LIMIT.windowMs) {
      this.globalEntry.count = 1
      this.globalEntry.windowStart = now
    } else {
      this.globalEntry.count++
    }

    if (
      this.globalEntry.count > GLOBAL_RATE_LIMIT.maxRequests &&
      !this.globalEntry.blockedUntil
    ) {
      this.globalEntry.blockedUntil = now + GLOBAL_RATE_LIMIT.blockDurationMs
      log.error('GLOBAL RATE LIMIT EXCEEDED - Possible DDoS', {
        count: this.globalEntry.count,
      })
    }

    return this.globalEntry
  }

  shutdown(): void {
    clearInterval(this.cleanupInterval)
  }

  /** Get current stats for monitoring */
  getStats(): { totalEntries: number; globalCount: number } {
    return {
      totalEntries: this.store.size,
      globalCount: this.globalEntry.count,
    }
  }
}

// Singleton store instance
const store = new RateLimitStore()

// ============================================================================
// PUBLIC API
// ============================================================================

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number
}

/**
 * Check rate limit for a request
 *
 * @param identifier - IP address or wallet address
 * @param tier - Rate limit tier (read, write, auth, sensitive)
 * @returns Whether the request is allowed and rate limit info
 */
export function checkRateLimit(
  identifier: string,
  tier: RateLimitTier = 'read',
): RateLimitResult {
  const config = RATE_LIMIT_TIERS[tier]
  const now = Date.now()

  // Check global rate limit first
  const globalEntry = store.incrementGlobal()
  if (globalEntry.blockedUntil && globalEntry.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: globalEntry.blockedUntil,
      retryAfter: Math.ceil((globalEntry.blockedUntil - now) / 1000),
    }
  }

  // Check per-identifier rate limit
  const key = `${tier}:${identifier}`
  const entry = store.increment(key, config)

  // If blocked
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.blockedUntil,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    }
  }

  // If over limit but not yet blocked (shouldn't happen with current logic)
  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + config.windowMs,
      retryAfter: Math.ceil((entry.windowStart + config.windowMs - now) / 1000),
    }
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.windowStart + config.windowMs,
  }
}

/**
 * Determine rate limit tier from HTTP method and path
 */
export function getRateLimitTier(method: string, path: string): RateLimitTier {
  // Sensitive operations
  if (
    path.includes('/signer') ||
    path.includes('/connect') ||
    path.includes('/link')
  ) {
    return 'sensitive'
  }

  // Auth operations
  if (path.includes('/auth') || path.includes('/activate')) {
    return 'auth'
  }

  // Write operations
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    return 'write'
  }

  // Default to read
  return 'read'
}

/**
 * Extract client identifier from request
 * Uses X-Forwarded-For for proxied requests, falls back to connection IP
 */
export function getClientIdentifier(
  headers: Record<string, string | undefined>,
  connectionIp?: string,
): string {
  // Check for authenticated user first
  const walletAddress = headers['x-jeju-address'] || headers['x-wallet-address']
  if (walletAddress) {
    return `addr:${walletAddress.toLowerCase()}`
  }

  // Use forwarded IP if behind proxy
  const forwardedFor = headers['x-forwarded-for']
  if (forwardedFor) {
    // Take the first IP (original client)
    const clientIp = forwardedFor.split(',')[0]?.trim()
    if (clientIp) {
      return `ip:${clientIp}`
    }
  }

  // Use real IP header (set by some proxies)
  const realIp = headers['x-real-ip']
  if (realIp) {
    return `ip:${realIp}`
  }

  // Fall back to connection IP
  return `ip:${connectionIp ?? 'unknown'}`
}

/**
 * Generate rate limit headers for response
 */
export function getRateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
  }

  if (result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter)
  }

  return headers
}

/**
 * Get rate limiter stats for health checks
 */
export function getRateLimiterStats(): {
  totalEntries: number
  globalCount: number
} {
  return store.getStats()
}

/**
 * Shutdown rate limiter (cleanup intervals)
 */
export function shutdownRateLimiter(): void {
  store.shutdown()
}
