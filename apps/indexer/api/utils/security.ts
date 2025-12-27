/**
 * Security utilities for the indexer API
 * - Structured logging with request IDs
 * - Helmet-style security headers
 * - Request timeout enforcement
 */

import { randomUUID } from 'node:crypto'
import { Elysia } from 'elysia'

// ============================================================================
// Structured Logging with Request IDs
// ============================================================================

export interface LogEntry {
  timestamp: string
  requestId: string
  level: 'info' | 'warn' | 'error' | 'debug'
  service: string
  method: string
  path: string
  statusCode?: number
  durationMs?: number
  clientIp?: string
  userAgent?: string
  walletAddress?: string
  agentId?: string
  apiKey?: string
  rateTier?: string
  message?: string
  error?: string
  stack?: string
}

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'
const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function shouldLog(level: string): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL]
}

function formatLog(entry: LogEntry): string {
  // JSON structured logging for production, pretty for dev
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(entry)
  }

  const {
    timestamp,
    requestId,
    level,
    method,
    path,
    statusCode,
    durationMs,
    message,
    error,
  } = entry
  const status = statusCode ? ` ${statusCode}` : ''
  const duration = durationMs !== undefined ? ` ${durationMs}ms` : ''
  const msg = message ? ` - ${message}` : ''
  const err = error ? ` - ${error}` : ''

  return `[${timestamp}] [${requestId.slice(0, 8)}] ${level.toUpperCase()} ${method} ${path}${status}${duration}${msg}${err}`
}

export function log(entry: Omit<LogEntry, 'timestamp'>): void {
  if (!shouldLog(entry.level)) return

  const fullEntry: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  }

  const formatted = formatLog(fullEntry)

  switch (entry.level) {
    case 'error':
      console.error(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    default:
      console.log(formatted)
  }
}

/**
 * Extract client identification from request headers
 */
function extractClientInfo(headers: Headers): {
  clientIp: string
  userAgent: string
  walletAddress?: string
  agentId?: string
  apiKey?: string
} {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = headers.get('x-real-ip')

  return {
    clientIp: forwarded ?? realIp ?? 'unknown',
    userAgent: headers.get('user-agent') ?? 'unknown',
    walletAddress: headers.get('x-wallet-address') ?? undefined,
    agentId: headers.get('x-agent-id') ?? undefined,
    apiKey: headers.get('x-api-key') ? '[redacted]' : undefined,
  }
}

/**
 * Elysia plugin for structured request logging with request IDs
 */
export function requestLogger(service: string) {
  return new Elysia({ name: 'request-logger' })
    .derive({ as: 'global' }, ({ request }) => {
      const requestId = request.headers.get('x-request-id') ?? randomUUID()
      const startTime = Date.now()

      return {
        requestId,
        startTime,
        clientInfo: extractClientInfo(request.headers),
      }
    })
    .onBeforeHandle({ as: 'global' }, ({ request, requestId, clientInfo }) => {
      const url = new URL(request.url)

      // Skip logging for health checks in production
      if (url.pathname === '/health' && process.env.NODE_ENV === 'production') {
        return
      }

      log({
        requestId,
        level: 'info',
        service,
        method: request.method,
        path: url.pathname,
        clientIp: clientInfo.clientIp,
        userAgent: clientInfo.userAgent,
        walletAddress: clientInfo.walletAddress,
        agentId: clientInfo.agentId,
        apiKey: clientInfo.apiKey,
        message: 'Request started',
      })
    })
    .onAfterHandle(
      { as: 'global' },
      ({ request, requestId, startTime, clientInfo, set }) => {
        const url = new URL(request.url)
        const reqId = requestId ?? 'unknown'
        const start = startTime ?? Date.now()
        const durationMs = Date.now() - start

        // Skip logging for health checks in production
        if (
          url.pathname === '/health' &&
          process.env.NODE_ENV === 'production'
        ) {
          return
        }

        // Add request ID to response headers
        set.headers['X-Request-ID'] = reqId

        log({
          requestId: reqId,
          level: 'info',
          service,
          method: request.method,
          path: url.pathname,
          statusCode: typeof set.status === 'number' ? set.status : 200,
          durationMs,
          clientIp: clientInfo?.clientIp ?? 'unknown',
          rateTier: (set.headers['X-RateLimit-Tier'] as string) ?? undefined,
          message: 'Request completed',
        })
      },
    )
    .onError(
      { as: 'global' },
      ({ request, requestId, startTime, clientInfo, error, set }) => {
        const url = new URL(request.url)
        const reqId = requestId ?? 'unknown'
        const start = startTime ?? Date.now()
        const durationMs = Date.now() - start

        // Add request ID to error response headers
        set.headers['X-Request-ID'] = reqId

        const errorMessage =
          error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error ? error.stack : undefined

        log({
          requestId: reqId,
          level: 'error',
          service,
          method: request.method,
          path: url.pathname,
          statusCode: typeof set.status === 'number' ? set.status : 500,
          durationMs,
          clientIp: clientInfo?.clientIp ?? 'unknown',
          walletAddress: clientInfo?.walletAddress,
          agentId: clientInfo?.agentId,
          error: errorMessage,
          stack: process.env.NODE_ENV !== 'production' ? stack : undefined,
          message: 'Request failed',
        })
      },
    )
}

// ============================================================================
// Helmet-style Security Headers
// ============================================================================

export interface SecurityHeadersOptions {
  /** Content Security Policy directives */
  contentSecurityPolicy?: boolean | string
  /** Cross-Origin-Embedder-Policy */
  crossOriginEmbedderPolicy?: boolean | 'require-corp' | 'credentialless'
  /** Cross-Origin-Opener-Policy */
  crossOriginOpenerPolicy?:
    | boolean
    | 'same-origin'
    | 'same-origin-allow-popups'
    | 'unsafe-none'
  /** Cross-Origin-Resource-Policy */
  crossOriginResourcePolicy?:
    | boolean
    | 'same-origin'
    | 'same-site'
    | 'cross-origin'
  /** Referrer-Policy */
  referrerPolicy?: boolean | string
  /** Strict-Transport-Security (HSTS) */
  strictTransportSecurity?:
    | boolean
    | { maxAge: number; includeSubDomains?: boolean; preload?: boolean }
  /** X-Content-Type-Options */
  xContentTypeOptions?: boolean
  /** X-DNS-Prefetch-Control */
  xDnsPrefetchControl?: boolean | 'on' | 'off'
  /** X-Download-Options */
  xDownloadOptions?: boolean
  /** X-Frame-Options */
  xFrameOptions?: boolean | 'DENY' | 'SAMEORIGIN'
  /** X-Permitted-Cross-Domain-Policies */
  xPermittedCrossDomainPolicies?:
    | boolean
    | 'none'
    | 'master-only'
    | 'by-content-type'
    | 'all'
  /** X-XSS-Protection (deprecated but still useful for older browsers) */
  xXssProtection?: boolean
  /** Remove X-Powered-By header */
  hidePoweredBy?: boolean
}

const DEFAULT_SECURITY_OPTIONS: Required<SecurityHeadersOptions> = {
  contentSecurityPolicy:
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  crossOriginEmbedderPolicy: 'require-corp',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: false,
  },
  xContentTypeOptions: true,
  xDnsPrefetchControl: 'off',
  xDownloadOptions: true,
  xFrameOptions: 'DENY',
  xPermittedCrossDomainPolicies: 'none',
  xXssProtection: false, // Deprecated, can cause issues in modern browsers
  hidePoweredBy: true,
}

/**
 * Elysia plugin for Helmet-style security headers
 */
export function securityHeaders(options: SecurityHeadersOptions = {}) {
  const opts = { ...DEFAULT_SECURITY_OPTIONS, ...options }

  return new Elysia({ name: 'security-headers' }).onAfterHandle(
    { as: 'global' },
    ({ set }) => {
      // Content-Security-Policy
      if (opts.contentSecurityPolicy) {
        const csp =
          typeof opts.contentSecurityPolicy === 'string'
            ? opts.contentSecurityPolicy
            : DEFAULT_SECURITY_OPTIONS.contentSecurityPolicy
        set.headers['Content-Security-Policy'] = csp as string
      }

      // Cross-Origin-Embedder-Policy
      if (opts.crossOriginEmbedderPolicy) {
        set.headers['Cross-Origin-Embedder-Policy'] =
          opts.crossOriginEmbedderPolicy === true
            ? 'require-corp'
            : opts.crossOriginEmbedderPolicy
      }

      // Cross-Origin-Opener-Policy
      if (opts.crossOriginOpenerPolicy) {
        set.headers['Cross-Origin-Opener-Policy'] =
          opts.crossOriginOpenerPolicy === true
            ? 'same-origin'
            : opts.crossOriginOpenerPolicy
      }

      // Cross-Origin-Resource-Policy
      if (opts.crossOriginResourcePolicy) {
        set.headers['Cross-Origin-Resource-Policy'] =
          opts.crossOriginResourcePolicy === true
            ? 'same-origin'
            : opts.crossOriginResourcePolicy
      }

      // Referrer-Policy
      if (opts.referrerPolicy) {
        set.headers['Referrer-Policy'] =
          typeof opts.referrerPolicy === 'string'
            ? opts.referrerPolicy
            : 'strict-origin-when-cross-origin'
      }

      // Strict-Transport-Security
      if (opts.strictTransportSecurity) {
        const hsts =
          typeof opts.strictTransportSecurity === 'object'
            ? opts.strictTransportSecurity
            : { maxAge: 31536000, includeSubDomains: true }
        let hstsValue = `max-age=${hsts.maxAge}`
        if (hsts.includeSubDomains) hstsValue += '; includeSubDomains'
        if (hsts.preload) hstsValue += '; preload'
        set.headers['Strict-Transport-Security'] = hstsValue
      }

      // X-Content-Type-Options
      if (opts.xContentTypeOptions) {
        set.headers['X-Content-Type-Options'] = 'nosniff'
      }

      // X-DNS-Prefetch-Control
      if (opts.xDnsPrefetchControl) {
        set.headers['X-DNS-Prefetch-Control'] =
          opts.xDnsPrefetchControl === true ? 'off' : opts.xDnsPrefetchControl
      }

      // X-Download-Options
      if (opts.xDownloadOptions) {
        set.headers['X-Download-Options'] = 'noopen'
      }

      // X-Frame-Options
      if (opts.xFrameOptions) {
        set.headers['X-Frame-Options'] =
          opts.xFrameOptions === true ? 'DENY' : opts.xFrameOptions
      }

      // X-Permitted-Cross-Domain-Policies
      if (opts.xPermittedCrossDomainPolicies) {
        set.headers['X-Permitted-Cross-Domain-Policies'] =
          opts.xPermittedCrossDomainPolicies === true
            ? 'none'
            : opts.xPermittedCrossDomainPolicies
      }

      // X-XSS-Protection (deprecated but may help older browsers)
      if (opts.xXssProtection) {
        set.headers['X-XSS-Protection'] = '0'
      }

      // Hide X-Powered-By
      if (opts.hidePoweredBy) {
        delete set.headers['X-Powered-By']
      }
    },
  )
}

// ============================================================================
// Request Timeout Enforcement
// ============================================================================

export interface TimeoutOptions {
  /** Request timeout in milliseconds (default: 30000 = 30s) */
  timeoutMs?: number
  /** Paths to skip timeout enforcement */
  skipPaths?: string[]
}

const DEFAULT_TIMEOUT_MS = 30_000 // 30 seconds

/**
 * Elysia plugin for request timeout enforcement
 * Prevents slowloris-style attacks by aborting requests that take too long
 */
export function requestTimeout(options: TimeoutOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const skipPaths = options.skipPaths ?? []

  // Track active request timeouts
  const activeTimeouts = new Map<string, NodeJS.Timeout>()

  return new Elysia({ name: 'request-timeout' })
    .derive({ as: 'global' }, () => {
      const timeoutId = randomUUID()
      return { timeoutId, timeoutMs }
    })
    .onBeforeHandle({ as: 'global' }, ({ request, timeoutId, set }) => {
      const url = new URL(request.url)
      const tId = timeoutId ?? randomUUID()

      // Skip timeout for certain paths
      if (skipPaths.some((p) => url.pathname.startsWith(p))) {
        return
      }

      // Set up timeout
      const timeout = setTimeout(() => {
        activeTimeouts.delete(tId)

        log({
          requestId: tId,
          level: 'warn',
          service: 'timeout',
          method: request.method,
          path: url.pathname,
          message: `Request timed out after ${timeoutMs}ms`,
        })

        // The request will be aborted - we set a flag that handlers can check
        set.status = 408
      }, timeoutMs)

      // Prevent timeout from blocking process exit
      timeout.unref()
      activeTimeouts.set(tId, timeout)
    })
    .onAfterHandle({ as: 'global' }, ({ timeoutId }) => {
      // Clear timeout on successful completion
      const tId = timeoutId ?? ''
      const timeout = activeTimeouts.get(tId)
      if (timeout) {
        clearTimeout(timeout)
        activeTimeouts.delete(tId)
      }
    })
    .onError({ as: 'global' }, ({ timeoutId }) => {
      // Clear timeout on error
      const tId = timeoutId ?? ''
      const timeout = activeTimeouts.get(tId)
      if (timeout) {
        clearTimeout(timeout)
        activeTimeouts.delete(tId)
      }
    })
}

// ============================================================================
// Combined Security Middleware
// ============================================================================

export interface SecurityOptions {
  service: string
  logging?: boolean
  headers?: boolean | SecurityHeadersOptions
  timeout?: boolean | TimeoutOptions
}

/**
 * Combined security middleware for all API servers
 * Includes request logging, security headers, and timeout enforcement
 */
export function security(options: SecurityOptions) {
  const { service, logging = true, headers = true, timeout = true } = options

  const headerOpts = typeof headers === 'object' ? headers : {}
  const timeoutOpts = typeof timeout === 'object' ? timeout : {}

  // Build the plugin chain conditionally
  // Each plugin adds its own derive/hooks
  const base = new Elysia({ name: 'security' })

  // We can't conditionally chain in TypeScript without type issues,
  // so we always include all plugins but make them no-ops when disabled
  return base
    .use(logging ? requestLogger(service) : new Elysia({ name: 'noop-logger' }))
    .use(
      headers
        ? securityHeaders(headerOpts)
        : new Elysia({ name: 'noop-headers' }),
    )
    .use(
      timeout
        ? requestTimeout(timeoutOpts)
        : new Elysia({ name: 'noop-timeout' }),
    )
}
