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

/** Context derived by rate limit plugin - index signature required for Elysia derive compatibility */
export interface RateLimitContext extends Record<string, RateLimitResult | string> {
  rateLimit: RateLimitResult
  rateLimitKey: string
}

export function rateLimitPlugin(config: RateLimitPluginConfig) {
  const limiter = new RateLimiter(config)
  const includeHeaders = config.includeHeaders ?? true
  const perPath = config.perPath ?? false
  const skipPaths = new Set(config.skipPaths ?? ['/health', '/', '/docs'])
  const skipIps = new Set(config.skipIps ?? [])

  return new Elysia({ name: 'rate-limit' })
    .derive((): RateLimitContext => {
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

      if (skipPaths.has(path)) {
        return undefined
      }

      const ip = extractClientIp(Object.fromEntries(request.headers.entries()))

      if (skipIps.has(ip)) {
        return undefined
      }

      const userId = config.getUserId?.(ctx as Context)
      const key = createRateLimitKey(ip, userId, perPath ? path : undefined)
      const tier = config.getTier?.(ctx as Context) ?? config.defaultTier
      const result = await limiter.check(key, tier)

      // Update context - RateLimitContext is added by derive above
      const rateLimitCtx = ctx as Context & RateLimitContext
      rateLimitCtx.rateLimit = result
      rateLimitCtx.rateLimitKey = key

      if (includeHeaders) {
        const headers = createRateLimitHeaders(result)
        for (const [name, value] of Object.entries(headers)) {
          set.headers[name] = value
        }
      }

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

export function simpleRateLimit(
  maxRequests: number = 100,
  windowMs: number = 60000,
) {
  return rateLimitPlugin({
    defaultTier: { maxRequests, windowMs },
    skipPaths: ['/health', '/', '/docs'],
  })
}

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
      interface AuthUserContext {
        authUser?: { permissions?: string[] }
      }
      const authContext = ctx as Context & AuthUserContext
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
