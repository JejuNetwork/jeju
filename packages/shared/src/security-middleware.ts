/**
 * Security Middleware for Elysia HTTP Servers
 *
 * Provides standard security headers and protections:
 * - Content Security Policy
 * - X-Frame-Options (clickjacking protection)
 * - X-Content-Type-Options (MIME sniffing protection)
 * - Strict-Transport-Security (HTTPS enforcement)
 * - X-XSS-Protection (XSS filter)
 * - Referrer-Policy (referrer leakage protection)
 * - Permissions-Policy (feature restrictions)
 *
 * Usage:
 *   import { securityMiddleware } from '@jejunetwork/shared';
 *   const app = new Elysia().use(securityMiddleware());
 */

import { Elysia } from 'elysia'

export interface SecurityConfig {
  /**
   * Enable Content Security Policy
   * @default true
   */
  csp?: boolean

  /**
   * Custom CSP directives (merged with defaults)
   */
  cspDirectives?: Partial<CSPDirectives>

  /**
   * Enable Strict-Transport-Security header
   * @default true in production
   */
  hsts?: boolean

  /**
   * HSTS max-age in seconds
   * @default 31536000 (1 year)
   */
  hstsMaxAge?: number

  /**
   * Enable X-Frame-Options: DENY
   * @default true
   */
  frameGuard?: boolean

  /**
   * Enable X-Content-Type-Options: nosniff
   * @default true
   */
  noSniff?: boolean

  /**
   * Enable X-XSS-Protection
   * @default true
   */
  xssFilter?: boolean

  /**
   * Referrer-Policy value
   * @default 'strict-origin-when-cross-origin'
   */
  referrerPolicy?: ReferrerPolicy

  /**
   * Skip security headers for specific paths (e.g. /health)
   */
  skipPaths?: string[]
}

type ReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'

interface CSPDirectives {
  defaultSrc: string[]
  scriptSrc: string[]
  styleSrc: string[]
  imgSrc: string[]
  connectSrc: string[]
  fontSrc: string[]
  objectSrc: string[]
  mediaSrc: string[]
  frameSrc: string[]
  childSrc: string[]
  workerSrc: string[]
  frameAncestors: string[]
  formAction: string[]
  baseUri: string[]
  upgradeInsecureRequests: boolean
}

const DEFAULT_CSP: CSPDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"], // inline styles often needed
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'wss:', 'https:'],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  mediaSrc: ["'self'"],
  frameSrc: ["'none'"],
  childSrc: ["'none'"],
  workerSrc: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  baseUri: ["'self'"],
  upgradeInsecureRequests: true,
}

function buildCSPHeader(directives: CSPDirectives): string {
  const parts: string[] = []

  parts.push(`default-src ${directives.defaultSrc.join(' ')}`)
  parts.push(`script-src ${directives.scriptSrc.join(' ')}`)
  parts.push(`style-src ${directives.styleSrc.join(' ')}`)
  parts.push(`img-src ${directives.imgSrc.join(' ')}`)
  parts.push(`connect-src ${directives.connectSrc.join(' ')}`)
  parts.push(`font-src ${directives.fontSrc.join(' ')}`)
  parts.push(`object-src ${directives.objectSrc.join(' ')}`)
  parts.push(`media-src ${directives.mediaSrc.join(' ')}`)
  parts.push(`frame-src ${directives.frameSrc.join(' ')}`)
  parts.push(`child-src ${directives.childSrc.join(' ')}`)
  parts.push(`worker-src ${directives.workerSrc.join(' ')}`)
  parts.push(`frame-ancestors ${directives.frameAncestors.join(' ')}`)
  parts.push(`form-action ${directives.formAction.join(' ')}`)
  parts.push(`base-uri ${directives.baseUri.join(' ')}`)

  if (directives.upgradeInsecureRequests) {
    parts.push('upgrade-insecure-requests')
  }

  return parts.join('; ')
}

const DEFAULT_CONFIG: SecurityConfig = {
  csp: true,
  hsts: process.env.NODE_ENV === 'production',
  hstsMaxAge: 31536000, // 1 year
  frameGuard: true,
  noSniff: true,
  xssFilter: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  skipPaths: ['/health', '/health/live', '/health/ready'],
}

export function securityMiddleware(config: SecurityConfig = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  // Merge CSP directives
  const cspDirectives: CSPDirectives = {
    ...DEFAULT_CSP,
    ...config.cspDirectives,
  }

  const cspHeader = buildCSPHeader(cspDirectives)

  return new Elysia({ name: 'security-middleware' }).onBeforeHandle(
    ({ request, set }) => {
      const url = new URL(request.url)

      // Skip security headers for certain paths if configured
      if (mergedConfig.skipPaths?.some((p) => url.pathname.startsWith(p))) {
        return
      }

      // Content Security Policy
      if (mergedConfig.csp) {
        set.headers['Content-Security-Policy'] = cspHeader
      }

      // HTTP Strict Transport Security
      if (mergedConfig.hsts) {
        set.headers['Strict-Transport-Security'] =
          `max-age=${mergedConfig.hstsMaxAge}; includeSubDomains`
      }

      // X-Frame-Options (clickjacking protection)
      if (mergedConfig.frameGuard) {
        set.headers['X-Frame-Options'] = 'DENY'
      }

      // X-Content-Type-Options (MIME sniffing protection)
      if (mergedConfig.noSniff) {
        set.headers['X-Content-Type-Options'] = 'nosniff'
      }

      // X-XSS-Protection
      if (mergedConfig.xssFilter) {
        set.headers['X-XSS-Protection'] = '1; mode=block'
      }

      // Referrer-Policy
      if (mergedConfig.referrerPolicy) {
        set.headers['Referrer-Policy'] = mergedConfig.referrerPolicy
      }

      // Permissions-Policy (restrict dangerous browser features)
      set.headers['Permissions-Policy'] =
        'camera=(), microphone=(), geolocation=(), payment=()'

      // Prevent caching of sensitive responses
      if (
        url.pathname.includes('/api/') ||
        url.pathname.includes('/a2a') ||
        url.pathname.includes('/mcp')
      ) {
        set.headers['Cache-Control'] =
          'no-store, no-cache, must-revalidate, proxy-revalidate'
        set.headers.Pragma = 'no-cache'
        set.headers.Expires = '0'
      }
    },
  )
}

/**
 * Rate limiter configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  max: number
  /** Window size in milliseconds */
  windowMs: number
  /** Key generator (default: IP address) */
  keyGenerator?: (request: Request) => string
  /** Skip rate limiting for certain paths */
  skipPaths?: string[]
  /** Custom response when rate limited */
  onRateLimit?: () => Response
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  max: 100,
  windowMs: 60000, // 1 minute
  skipPaths: ['/health', '/health/live', '/health/ready'],
}

/**
 * Simple in-memory rate limiter
 *
 * For production with multiple instances, use Redis-based rate limiting.
 */
export function rateLimitMiddleware(
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
) {
  const requests = new Map<string, { count: number; resetAt: number }>()

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now()
    for (const [key, value] of requests) {
      if (value.resetAt < now) {
        requests.delete(key)
      }
    }
  }, config.windowMs * 2)

  const getKey =
    config.keyGenerator ??
    ((request: Request) => {
      // Get IP from various headers (in order of preference)
      const forwarded = request.headers.get('x-forwarded-for')
      if (forwarded) {
        return forwarded.split(',')[0].trim()
      }
      const realIp = request.headers.get('x-real-ip')
      if (realIp) {
        return realIp
      }
      // Fallback to a default key if no IP found
      return 'unknown'
    })

  return new Elysia({ name: 'rate-limit-middleware' }).onBeforeHandle(
    ({
      request,
      set,
    }):
      | undefined
      | Response
      | { error: string; message: string; retryAfter: number } => {
      const url = new URL(request.url)

      // Skip rate limiting for health checks etc
      if (config.skipPaths?.some((p) => url.pathname.startsWith(p))) {
        return
      }

      const key = getKey(request)
      const now = Date.now()

      const record = requests.get(key)

      if (!record || record.resetAt < now) {
        // New window
        requests.set(key, { count: 1, resetAt: now + config.windowMs })
        set.headers['X-RateLimit-Limit'] = String(config.max)
        set.headers['X-RateLimit-Remaining'] = String(config.max - 1)
        set.headers['X-RateLimit-Reset'] = String(
          Math.ceil((now + config.windowMs) / 1000),
        )
        return
      }

      record.count++

      set.headers['X-RateLimit-Limit'] = String(config.max)
      set.headers['X-RateLimit-Remaining'] = String(
        Math.max(0, config.max - record.count),
      )
      set.headers['X-RateLimit-Reset'] = String(
        Math.ceil(record.resetAt / 1000),
      )

      if (record.count > config.max) {
        set.status = 429
        set.headers['Retry-After'] = String(
          Math.ceil((record.resetAt - now) / 1000),
        )

        if (config.onRateLimit) {
          return config.onRateLimit()
        }

        return {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${Math.ceil((record.resetAt - now) / 1000)} seconds.`,
          retryAfter: Math.ceil((record.resetAt - now) / 1000),
        }
      }

      return undefined
    },
  )
}

export default securityMiddleware
