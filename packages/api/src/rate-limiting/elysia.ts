/**
 * Elysia Rate Limiting Adapter
 *
 * Provides Elysia plugins for rate limiting using the framework-agnostic core.
 */

import { type Context, Elysia } from 'elysia'
import {
  createRateLimitHeaders,
  createRateLimitKey,
  extractClientIp,
  RateLimiter,
} from './core.js'
import {
  type RateLimiterConfig,
  type RateLimitResult,
  type RateLimitTier,
  RateLimitTiers,
} from './types.js'

// ============ Types ============

export interface RateLimitPluginConfig extends RateLimiterConfig {
  /** Function to extract user identifier from context */
  getUserId?: (ctx: Context) => string | undefined
  /** Function to determine tier from context */
  getTier?: (ctx: Context) => RateLimitTier | string | undefined
  /** Whether to include rate limit headers in response */
  includeHeaders?: boolean
  /** Whether to rate limit by path as well as IP */
  perPath?: boolean
}

export interface RateLimitContext {
  rateLimit: RateLimitResult
  rateLimitKey: string
  /** Index signature for Elysia derive compatibility */
  [key: string]: RateLimitResult | string
}

// ============ Elysia Plugin ============

/**
 * Create an Elysia plugin for rate limiting
 */
export function rateLimitPlugin(config: RateLimitPluginConfig) {
  const limiter = new RateLimiter(config)
  const includeHeaders = config.includeHeaders ?? true
  const perPath = config.perPath ?? false
  const skipPaths = new Set(config.skipPaths ?? ['/health', '/', '/docs'])
  const skipIps = new Set(config.skipIps ?? [])

  return new Elysia({ name: 'rate-limit' })
    .derive((): RateLimitContext => {
      // Create placeholder - will be populated in onBeforeHandle
      return {
        rateLimit: {
          allowed: true,
          current: 0,
          limit: config.defaultTier.maxRequests,
          remaining: config.defaultTier.maxRequests,
          resetInSeconds: Math.ceil(config.defaultTier.windowMs / 1000),
        },
        rateLimitKey: '',
      }
    })
    .onBeforeHandle(async (ctx) => {
      const { path, request, set } = ctx

      // Skip rate limiting for specified paths
      if (skipPaths.has(path)) {
        return undefined
      }

      // Extract client IP
      const ip = extractClientIp(Object.fromEntries(request.headers.entries()))

      // Skip rate limiting for specified IPs
      if (skipIps.has(ip)) {
        return undefined
      }

      // Get user ID if available
      const userId = config.getUserId?.(ctx)

      // Create rate limit key
      const key = createRateLimitKey(ip, userId, perPath ? path : undefined)

      // Determine tier
      const tier = config.getTier?.(ctx) ?? config.defaultTier

      // Check rate limit
      const result = await limiter.check(key, tier)

      // Update context
      ;(ctx as unknown as { rateLimit: RateLimitResult }).rateLimit = result
      ;(ctx as unknown as { rateLimitKey: string }).rateLimitKey = key

      // Add headers if enabled
      if (includeHeaders) {
        const headers = createRateLimitHeaders(result)
        for (const [name, value] of Object.entries(headers)) {
          set.headers[name] = value
        }
      }

      // Return error if rate limited
      if (!result.allowed) {
        set.status = 429
        return {
          error: 'Too Many Requests',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: result.resetInSeconds,
          limit: result.limit,
          remaining: result.remaining,
        }
      }

      return undefined
    })
    .onStop(() => {
      limiter.stop()
    })
}

/**
 * Simple rate limit plugin with sensible defaults
 */
export function simpleRateLimit(
  maxRequests: number = 100,
  windowMs: number = 60000,
) {
  return rateLimitPlugin({
    defaultTier: { maxRequests, windowMs },
    skipPaths: ['/health', '/', '/docs'],
  })
}

/**
 * Tiered rate limit plugin that uses auth context
 */
export function tieredRateLimit(options?: {
  skipPaths?: string[]
  includeHeaders?: boolean
}) {
  return rateLimitPlugin({
    defaultTier: RateLimitTiers.FREE,
    tiers: { ...RateLimitTiers },
    skipPaths: options?.skipPaths ?? ['/health', '/', '/docs'],
    includeHeaders: options?.includeHeaders ?? true,
    getTier: (ctx) => {
      // Check for authUser in context (set by auth plugin)
      const authContext = ctx as unknown as {
        authUser?: { permissions?: string[] }
      }
      const permissions = authContext.authUser?.permissions ?? []

      if (permissions.includes('unlimited')) {
        return RateLimitTiers.UNLIMITED
      }
      if (permissions.includes('premium')) {
        return RateLimitTiers.PREMIUM
      }
      if (permissions.includes('basic')) {
        return RateLimitTiers.BASIC
      }

      return RateLimitTiers.FREE
    },
  })
}

/**
 * Per-route rate limit decorator
 * Use this to set custom rate limits on specific routes
 */
export function withRateLimit(tier: RateLimitTier, limiter: RateLimiter) {
  return async ({
    request,
    set,
  }: Context): Promise<
    { error: string; code: string; retryAfter: number } | undefined
  > => {
    const ip = extractClientIp(Object.fromEntries(request.headers.entries()))
    const result = await limiter.check(ip, tier)

    const headers = createRateLimitHeaders(result)
    for (const [name, value] of Object.entries(headers)) {
      set.headers[name] = value
    }

    if (!result.allowed) {
      set.status = 429
      return {
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: result.resetInSeconds,
      }
    }

    return undefined
  }
}
