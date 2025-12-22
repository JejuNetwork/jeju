/**
 * Elysia Rate Limiter using rate-limiter-flexible
 */

import { Elysia } from 'elysia'
import { RateLimiterMemory } from 'rate-limiter-flexible'

interface RateLimitOptions {
  windowMs?: number
  maxRequests?: number
  skipPaths?: string[]
  message?: string
  keyGenerator?: (headers: Headers, request: Request) => string
}

/**
 * Check if an IP is a private/local address
 */
function isPrivateIp(ip: string): boolean {
  if (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') ||
    ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') ||
    ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') ||
    ip.startsWith('172.25.') ||
    ip.startsWith('172.26.') ||
    ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') ||
    ip.startsWith('172.29.') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip === 'localhost' ||
    ip === '::1'
  ) {
    return true
  }
  return false
}

/**
 * Extracts client IP address from Elysia headers.
 *
 * SECURITY: X-Forwarded-For can be spoofed by clients.
 * When behind a trusted reverse proxy (nginx, cloudflare), the rightmost
 * IP in X-Forwarded-For is typically from our proxy.
 */
function getClientIp(headers: Headers, request: Request): string {
  // X-Real-IP is typically set by nginx and is more trustworthy
  const realIp = headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // For X-Forwarded-For, we take the rightmost non-private IP
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const ips = forwardedFor
      .split(',')
      .map((ip) => ip.trim())
      .reverse()
    for (const ip of ips) {
      if (ip && !isPrivateIp(ip)) {
        return ip
      }
    }
    if (ips[0]) return ips[0]
  }

  // Extract host from request URL as fallback
  const url = new URL(request.url)
  return url.hostname || 'unknown'
}

const DEFAULT_OPTIONS = {
  windowMs: 60 * 1000,
  maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 1000,
  skipPaths: ['/health', '/.well-known/agent-card.json'],
  message: 'Too many requests, please try again later',
  keyGenerator: getClientIp,
} as const satisfies Required<RateLimitOptions>

interface RateLimiterResponse {
  msBeforeNext: number
  remainingPoints: number
}

export const rateLimit = (options: RateLimitOptions = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options }

  const limiter = new RateLimiterMemory({
    points: config.maxRequests,
    duration: Math.ceil(config.windowMs / 1000),
  })

  return new Elysia({ name: 'rateLimit' })
    .derive(({ request, headers }) => {
      const clientIp = config.keyGenerator(headers, request)
      return { clientIp }
    })
    .onBeforeHandle(async ({ clientIp, set, path }) => {
      if (config.skipPaths.some((p) => path.startsWith(p))) {
        return
      }

      try {
        const result = await limiter.consume(clientIp)

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

export const strictRateLimit = () =>
  rateLimit({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 200,
    message: 'Rate limit exceeded for write operations',
  })

export const agentRateLimit = () =>
  rateLimit({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 500,
    keyGenerator: (headers) =>
      headers.get('x-agent-id') ||
      getClientIp(headers, new Request('http://localhost')),
  })
