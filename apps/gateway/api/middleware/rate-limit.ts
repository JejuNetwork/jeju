import { Elysia } from 'elysia'
import { RateLimiterMemory } from 'rate-limiter-flexible'

interface RateLimitOptions {
  windowMs?: number
  maxRequests?: number
  keyGenerator?: (
    headers: Record<string, string | undefined>,
    ip: string,
  ) => string
  skipPaths?: string[]
  message?: string
}

const DEFAULT_OPTIONS = {
  windowMs: 60 * 1000,
  maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 1000,
  skipPaths: ['/health', '/.well-known/agent-card.json'],
  message: 'Too many requests, please try again later',
} as const

interface RateLimiterResponse {
  msBeforeNext: number
  remainingPoints: number
}

export const rateLimitPlugin = (options: RateLimitOptions = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options }

  const limiter = new RateLimiterMemory({
    points: config.maxRequests,
    duration: Math.ceil(config.windowMs / 1000),
  })

  return new Elysia({ name: 'rate-limit' })
    .derive(({ headers, request }) => {
      const url = new URL(request.url)
      const forwardedFor = headers['x-forwarded-for']
      const realIp = headers['x-real-ip']

      const clientIp =
        (typeof forwardedFor === 'string'
          ? forwardedFor.split(',')[0]?.trim()
          : undefined) ||
        realIp ||
        'unknown'

      return {
        path: url.pathname,
        clientIp,
      }
    })
    .onBeforeHandle(async ({ path, clientIp, headers, set }) => {
      if (config.skipPaths.some((p) => path.startsWith(p))) {
        return
      }

      const key = config.keyGenerator
        ? config.keyGenerator(
            headers as Record<string, string | undefined>,
            clientIp,
          )
        : clientIp

      try {
        const result = await limiter.consume(key)

        set.headers['X-RateLimit-Limit'] = String(config.maxRequests)
        set.headers['X-RateLimit-Remaining'] = String(result.remainingPoints)
        set.headers['X-RateLimit-Reset'] = String(
          Math.ceil(Date.now() / 1000) + Math.ceil(result.msBeforeNext / 1000),
        )
      } catch (rejRes) {
        const rateLimiterRes = rejRes as RateLimiterResponse
        const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000)

        set.headers['X-RateLimit-Limit'] = String(config.maxRequests)
        set.headers['X-RateLimit-Remaining'] = '0'
        set.headers['X-RateLimit-Reset'] = String(
          Math.ceil(Date.now() / 1000) + retryAfter,
        )
        set.headers['Retry-After'] = String(retryAfter)

        set.status = 429
        return {
          error: 'Too Many Requests',
          message: config.message,
          retryAfter,
        }
      }
    })
}

export const strictRateLimitPlugin = () =>
  rateLimitPlugin({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 200,
    message: 'Rate limit exceeded for write operations',
  })

export const agentRateLimitPlugin = () =>
  rateLimitPlugin({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 500,
    keyGenerator: (headers, ip) => headers['x-agent-id'] || ip,
  })
