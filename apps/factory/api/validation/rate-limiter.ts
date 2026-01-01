/**
 * Production-Grade Rate Limiter
 *
 * Implements token bucket algorithm with:
 * - Per-IP rate limiting for unauthenticated requests
 * - Per-address rate limiting for authenticated requests
 * - Configurable limits per endpoint type
 * - Distributed storage via shared cache
 * - DDoS protection with global limits
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'

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
  /** Window size in seconds */
  windowSeconds: number
  /** Block duration when limit exceeded (seconds) */
  blockDurationSeconds: number
}

/** Rate limit tiers for different operation types */
const RATE_LIMIT_TIERS: Record<string, RateLimitConfig> = {
  // Read operations - more permissive
  read: {
    maxRequests: 100,
    windowSeconds: 60, // 1 minute
    blockDurationSeconds: 60, // 1 minute block
  },
  // Write operations - more restrictive
  write: {
    maxRequests: 20,
    windowSeconds: 60, // 1 minute
    blockDurationSeconds: 300, // 5 minute block
  },
  // Authentication operations - very restrictive to prevent brute force
  auth: {
    maxRequests: 5,
    windowSeconds: 60, // 1 minute
    blockDurationSeconds: 900, // 15 minute block
  },
  // Sensitive operations (signer creation, etc.)
  sensitive: {
    maxRequests: 3,
    windowSeconds: 60, // 1 minute
    blockDurationSeconds: 1800, // 30 minute block
  },
}

/** Global rate limit to prevent DDoS */
const GLOBAL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10_000,
  windowSeconds: 60,
  blockDurationSeconds: 60,
}

// ============================================================================
// TYPES
// ============================================================================

type RateLimitTier = keyof typeof RATE_LIMIT_TIERS

// ============================================================================
// DISTRIBUTED RATE LIMIT STORE
// ============================================================================

let rateLimitCache: CacheClient | null = null

function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('factory-ratelimit')
  }
  return rateLimitCache
}

async function incrementAndCheck(
  key: string,
  config: RateLimitConfig,
): Promise<{
  count: number
  blocked: boolean
  blockedUntil: number | null
}> {
  const cache = getRateLimitCache()
  const countKey = `ratelimit:count:${key}`
  const blockKey = `ratelimit:block:${key}`
  const now = Date.now()

  // Check if blocked
  const blockedUntilStr = await cache.get(blockKey)
  if (blockedUntilStr) {
    const blockedUntil = parseInt(blockedUntilStr, 10)
    if (blockedUntil > now) {
      return { count: config.maxRequests + 1, blocked: true, blockedUntil }
    }
  }

  // Increment count
  const currentStr = await cache.get(countKey)
  const count = currentStr ? parseInt(currentStr, 10) + 1 : 1
  await cache.set(countKey, String(count), config.windowSeconds)

  // Check if limit exceeded
  if (count > config.maxRequests) {
    const blockedUntil = now + config.blockDurationSeconds * 1000
    await cache.set(blockKey, String(blockedUntil), config.blockDurationSeconds)
    log.warn('Rate limit exceeded', {
      key: `${key.slice(0, 20)}...`,
      count,
      blockedUntil: new Date(blockedUntil).toISOString(),
    })
    return { count, blocked: true, blockedUntil }
  }

  return { count, blocked: false, blockedUntil: null }
}

async function incrementGlobal(): Promise<{
  count: number
  blocked: boolean
  blockedUntil: number | null
}> {
  const cache = getRateLimitCache()
  const countKey = 'ratelimit:global:count'
  const blockKey = 'ratelimit:global:block'
  const now = Date.now()

  // Check if blocked
  const blockedUntilStr = await cache.get(blockKey)
  if (blockedUntilStr) {
    const blockedUntil = parseInt(blockedUntilStr, 10)
    if (blockedUntil > now) {
      return {
        count: GLOBAL_RATE_LIMIT.maxRequests + 1,
        blocked: true,
        blockedUntil,
      }
    }
  }

  // Increment count
  const currentStr = await cache.get(countKey)
  const count = currentStr ? parseInt(currentStr, 10) + 1 : 1
  await cache.set(countKey, String(count), GLOBAL_RATE_LIMIT.windowSeconds)

  // Check if limit exceeded
  if (count > GLOBAL_RATE_LIMIT.maxRequests) {
    const blockedUntil = now + GLOBAL_RATE_LIMIT.blockDurationSeconds * 1000
    await cache.set(
      blockKey,
      String(blockedUntil),
      GLOBAL_RATE_LIMIT.blockDurationSeconds,
    )
    log.error('GLOBAL RATE LIMIT EXCEEDED - Possible DDoS', { count })
    return { count, blocked: true, blockedUntil }
  }

  return { count, blocked: false, blockedUntil: null }
}

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
export async function checkRateLimit(
  identifier: string,
  tier: RateLimitTier = 'read',
): Promise<RateLimitResult> {
  const config = RATE_LIMIT_TIERS[tier]
  const now = Date.now()

  // Fail-open: if cache is unavailable, allow the request through
  // This prevents the rate limiter from blocking all requests when DWS cache is down
  try {
    // Check global rate limit first
    const globalResult = await incrementGlobal()
    if (globalResult.blocked && globalResult.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: globalResult.blockedUntil,
        retryAfter: Math.ceil((globalResult.blockedUntil - now) / 1000),
      }
    }

    // Check per-identifier rate limit
    const key = `${tier}:${identifier}`
    const result = await incrementAndCheck(key, config)

    if (result.blocked && result.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: result.blockedUntil,
        retryAfter: Math.ceil((result.blockedUntil - now) / 1000),
      }
    }

    return {
      allowed: true,
      remaining: config.maxRequests - result.count,
      resetAt: now + config.windowSeconds * 1000,
    }
  } catch (err) {
    // Cache unavailable - fail open and allow the request
    log.warn('Rate limit check failed, allowing request (fail-open)', {
      identifier: `${identifier.slice(0, 20)}...`,
      tier,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: now + config.windowSeconds * 1000,
    }
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
export async function getRateLimiterStats(): Promise<{
  totalEntries: number
  globalCount: number
}> {
  const cache = getRateLimitCache()
  const globalCountStr = await cache.get('ratelimit:global:count')
  return {
    totalEntries: 0, // Not trackable in distributed mode
    globalCount: globalCountStr ? parseInt(globalCountStr, 10) : 0,
  }
}

/**
 * Shutdown rate limiter (no-op for distributed cache)
 */
export function shutdownRateLimiter(): void {
  log.info('Rate limiter shutdown')
}
