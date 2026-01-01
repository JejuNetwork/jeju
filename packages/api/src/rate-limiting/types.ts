/**
 * Framework-Agnostic Rate Limiting Types
 */

import { z } from 'zod'

/**
 * Rate limit tier configuration
 */
export interface RateLimitTier {
  /** Maximum requests allowed in the window */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
}

/**
 * Built-in rate limit tiers
 */
export const RateLimitTiers = {
  /** Free tier - 60 requests per minute */
  FREE: { maxRequests: 60, windowMs: 60000 },
  /** Basic tier - 300 requests per minute */
  BASIC: { maxRequests: 300, windowMs: 60000 },
  /** Premium tier - 1000 requests per minute */
  PREMIUM: { maxRequests: 1000, windowMs: 60000 },
  /** Unlimited - for internal services */
  UNLIMITED: { maxRequests: Number.MAX_SAFE_INTEGER, windowMs: 60000 },
} as const satisfies Record<string, RateLimitTier>

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Current request count in the window */
  current: number
  /** Maximum requests allowed */
  limit: number
  /** Remaining requests in the window */
  remaining: number
  /** Time in seconds until the window resets */
  resetInSeconds: number
  /** Error message if not allowed */
  error?: string
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Default tier for unauthenticated requests */
  defaultTier: RateLimitTier
  /** Map of tier names to configurations */
  tiers?: Record<string, RateLimitTier>
  /** Maximum cache size (to prevent memory exhaustion) */
  maxCacheSize?: number
  /** Key prefix for distributed rate limiting */
  keyPrefix?: string
  /** Skip rate limiting for these IPs */
  skipIps?: string[]
  /** Skip rate limiting for these paths */
  skipPaths?: string[]
}

/**
 * Rate limit entry schema for validation
 */
export const RateLimitEntrySchema = z.object({
  count: z.number().int().nonnegative(),
  resetAt: z.number().int().positive(),
})

/**
 * Rate limit entry in the store
 */
export type RateLimitEntry = z.infer<typeof RateLimitEntrySchema>

/**
 * Rate limit store interface (for custom backends)
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | undefined>
  set(key: string, entry: RateLimitEntry): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/**
 * Rate limit headers to include in responses
 */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': string
  'X-RateLimit-Remaining': string
  'X-RateLimit-Reset': string
  'Retry-After'?: string
}
