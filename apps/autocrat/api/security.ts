import { getCurrentNetwork } from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import { type Address, isAddress, verifyMessage } from 'viem'
import { z } from 'zod'

import { config } from './config'

// SQLit configuration for audit persistence
const SQLIT_DATABASE_ID = config.sqlitDatabaseId
let auditSQLitClient: SQLitClient | null = null
let auditTableInitialized = false

// Cache client for distributed rate limiting
let rateLimitCache: CacheClient | null = null

function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('autocrat-security')
  }
  return rateLimitCache
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW_SECONDS = 60 // 1 minute
const RATE_LIMITS = {
  default: 60, // 60 requests per minute
  proposal: 10, // 10 proposal operations per minute
  admin: 30, // 30 admin operations per minute
  ai: 5, // 5 AI operations per minute (expensive)
} as const

type RateLimitTier = keyof typeof RATE_LIMITS

// Audit log entry type
interface AuditEntry {
  timestamp: number
  action: string
  actor: string
  ip: string
  userAgent: string
  success: boolean
  details: Record<string, string | number | boolean>
}

/**
 * Get client IP from request headers
 */
function getClientIP(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    'unknown'
  )
}

/**
 * Check rate limit for a key using distributed cache
 */
async function checkRateLimit(
  key: string,
  tier: RateLimitTier,
): Promise<boolean> {
  const cache = getRateLimitCache()
  const cacheKey = `ratelimit:${key}`
  const limit = RATE_LIMITS[tier]

  const current = await cache.get(cacheKey)
  if (!current) {
    // First request - set count to 1 with TTL
    await cache.set(cacheKey, '1', RATE_LIMIT_WINDOW_SECONDS)
    return true
  }

  const count = parseInt(current, 10)
  if (count >= limit) {
    return false
  }

  // Increment count (maintains original TTL via cache behavior)
  await cache.set(cacheKey, String(count + 1), RATE_LIMIT_WINDOW_SECONDS)
  return true
}

/**
 * Validate API key for operator/admin operations
 * Uses crypto.timingSafeEqual for constant-time comparison to prevent timing attacks
 */
function validateApiKey(apiKey: string): boolean {
  const validKey = config.autocratApiKey
  if (!validKey) {
    // In localnet, allow if no key configured
    const network = getCurrentNetwork()
    if (network === 'localnet') {
      return true
    }
    console.error('[Security] AUTOCRAT_API_KEY not configured')
    return false
  }

  // Convert both keys to buffers
  const apiKeyBuf = Buffer.from(apiKey, 'utf8')
  const validKeyBuf = Buffer.from(validKey, 'utf8')

  // Constant-time comparison using XOR to prevent timing attacks
  // This is workerd-compatible (no Node.js crypto required)
  if (apiKeyBuf.length !== validKeyBuf.length) {
    // Compare against dummy to maintain constant time
    const dummyBuf = Buffer.alloc(apiKeyBuf.length)
    let _dummyResult = 0
    for (let i = 0; i < apiKeyBuf.length; i++) {
      _dummyResult |= apiKeyBuf[i] ^ dummyBuf[i]
    }
    return false
  }

  let result = 0
  for (let i = 0; i < apiKeyBuf.length; i++) {
    result |= apiKeyBuf[i] ^ validKeyBuf[i]
  }
  return result === 0
}

/**
 * Verify wallet signature for user operations
 */
async function verifyWalletSignature(
  address: Address,
  message: string,
  signature: `0x${string}`,
): Promise<boolean> {
  const valid = await verifyMessage({
    address,
    message,
    signature,
  })
  return valid
}

/**
 * Initialize SQLit client and audit table
 */
async function ensureAuditTable(): Promise<SQLitClient> {
  if (!auditSQLitClient) {
    auditSQLitClient = getSQLit({
      databaseId: SQLIT_DATABASE_ID,
      timeoutMs: 10000,
      debug: false,
    })
  }

  if (!auditTableInitialized) {
    const healthy = await auditSQLitClient.isHealthy()
    if (healthy) {
      await auditSQLitClient.exec(
        `CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          ip TEXT NOT NULL,
          user_agent TEXT,
          success INTEGER NOT NULL,
          details TEXT
        )`,
        [],
        SQLIT_DATABASE_ID,
      )
      await auditSQLitClient.exec(
        `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`,
        [],
        SQLIT_DATABASE_ID,
      )
      await auditSQLitClient.exec(
        `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor)`,
        [],
        SQLIT_DATABASE_ID,
      )
      auditTableInitialized = true
    }
  }

  return auditSQLitClient
}

/**
 * Persist a single audit entry directly to SQLit
 * No in-memory buffering - writes immediately for distributed compatibility
 */
async function persistAuditEntry(entry: AuditEntry): Promise<void> {
  // Always log to console for immediate visibility
  console.log(
    `[Audit] ${entry.action} by ${entry.actor} from ${entry.ip}: ${entry.success ? 'SUCCESS' : 'FAILED'}`,
  )

  // Persist to SQLit for long-term audit trail
  try {
    const client = await ensureAuditTable()
    const healthy = await client.isHealthy()
    if (!healthy) {
      console.warn('[Audit] SQLit not available, audit entry not persisted')
      return
    }

    const id = `audit-${entry.timestamp}-${Math.random().toString(36).slice(2, 10)}`
    await client.exec(
      `INSERT INTO audit_log (id, timestamp, action, actor, ip, user_agent, success, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.timestamp,
        entry.action,
        entry.actor,
        entry.ip,
        entry.userAgent,
        entry.success ? 1 : 0,
        JSON.stringify(entry.details),
      ],
      SQLIT_DATABASE_ID,
    )
  } catch (err) {
    // Log error but don't fail - audit persistence should not break the app
    console.error(
      '[Audit] Failed to persist audit entry:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Schema for signed request body
 */
const SignedRequestSchema = z.object({
  address: z.string().refine(isAddress, 'Invalid address'),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature'),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(1),
})

/**
 * Paths that require API key authentication
 */
const API_KEY_REQUIRED_PATHS = [
  '/api/v1/dao', // DAO management (POST, PATCH, DELETE)
  '/api/v1/orchestrator',
  '/api/v1/moderation',
  '/api/v1/triggers',
  '/api/v1/registry',
]

/**
 * Paths with AI rate limiting
 */
const AI_RATE_LIMITED_PATHS = [
  '/api/v1/proposals/assess',
  '/api/v1/proposals/improve',
  '/api/v1/proposals/generate',
  '/api/v1/research',
  '/a2a',
]

/**
 * Security middleware plugin for Elysia
 */
export const securityMiddleware = new Elysia({ name: 'security' })
  // Add security headers
  .onBeforeHandle(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-XSS-Protection'] = '1; mode=block'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    set.headers['X-DNS-Prefetch-Control'] = 'off'
    set.headers['X-Download-Options'] = 'noopen'
    set.headers['X-Permitted-Cross-Domain-Policies'] = 'none'
    // Content Security Policy - restrictive for API
    const network = getCurrentNetwork()
    if (network === 'mainnet') {
      set.headers['Content-Security-Policy'] =
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      set.headers['Strict-Transport-Security'] =
        'max-age=31536000; includeSubDomains; preload'
    }
  })

  // Rate limiting (distributed via cache)
  .onBeforeHandle(async ({ request, set }) => {
    const ip = getClientIP(request.headers)
    const path = new URL(request.url).pathname

    // Determine rate limit tier
    let tier: RateLimitTier = 'default'
    if (AI_RATE_LIMITED_PATHS.some((p) => path.startsWith(p))) {
      tier = 'ai'
    } else if (path.includes('/proposals')) {
      tier = 'proposal'
    } else if (API_KEY_REQUIRED_PATHS.some((p) => path.startsWith(p))) {
      tier = 'admin'
    }

    const key = `${ip}:${tier}`
    const allowed = await checkRateLimit(key, tier)
    if (!allowed) {
      set.status = 429
      return {
        error: 'Rate limit exceeded',
        retryAfter: RATE_LIMIT_WINDOW_SECONDS,
      }
    }
    return
  })

  // API key validation for admin endpoints
  .onBeforeHandle(({ request, set }) => {
    const path = new URL(request.url).pathname
    const method = request.method

    // Only check for mutating operations on admin paths
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ||
      !API_KEY_REQUIRED_PATHS.some((p) => path.startsWith(p))
    ) {
      return
    }

    const apiKey = request.headers.get('x-api-key')
    if (!apiKey) {
      set.status = 401
      // Fire-and-forget audit persistence (don't await in hot path)
      persistAuditEntry({
        timestamp: Date.now(),
        action: `${method} ${path}`,
        actor: 'unknown',
        ip: getClientIP(request.headers),
        userAgent: request.headers.get('user-agent') ?? 'unknown',
        success: false,
        details: { reason: 'Missing API key' },
      })
      return { error: 'API key required' }
    }

    if (!validateApiKey(apiKey)) {
      set.status = 403
      // Fire-and-forget audit persistence (don't await in hot path)
      persistAuditEntry({
        timestamp: Date.now(),
        action: `${method} ${path}`,
        actor: 'unknown',
        ip: getClientIP(request.headers),
        userAgent: request.headers.get('user-agent') ?? 'unknown',
        success: false,
        details: { reason: 'Invalid API key' },
      })
      return { error: 'Invalid API key' }
    }
    return
  })

/**
 * Verify a signed request body
 * Use this in handlers that require wallet authentication
 */
export async function verifySignedRequest(
  body: Record<string, unknown>,
): Promise<{ valid: boolean; address?: Address; error?: string }> {
  const parsed = SignedRequestSchema.safeParse(body)
  if (!parsed.success) {
    return { valid: false, error: 'Invalid signed request format' }
  }

  const { address, signature, timestamp, nonce } = parsed.data

  // Check timestamp is within 5 minutes
  const now = Date.now()
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return { valid: false, error: 'Request timestamp expired' }
  }

  // Verify signature
  const message = `Autocrat Request\nTimestamp: ${timestamp}\nNonce: ${nonce}`
  const valid = await verifyWalletSignature(
    address as Address,
    message,
    signature as `0x${string}`,
  )

  if (!valid) {
    return { valid: false, error: 'Invalid signature' }
  }

  return { valid: true, address: address as Address }
}

/**
 * Log a sensitive operation for audit trail
 * Fire-and-forget - does not block the caller
 */
export function auditLog(
  action: string,
  actor: string,
  request: Request,
  success: boolean,
  details: Record<string, string | number | boolean> = {},
): void {
  // Fire-and-forget audit persistence (don't await to avoid blocking)
  persistAuditEntry({
    timestamp: Date.now(),
    action,
    actor,
    ip: getClientIP(request.headers),
    userAgent: request.headers.get('user-agent') ?? 'unknown',
    success,
    details,
  })
}

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string, maxLength = 10000): string {
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '')
  // Trim whitespace
  sanitized = sanitized.trim()
  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength)
  }
  return sanitized
}

/**
 * Validate that a string doesn't contain potential injection patterns
 */
export function validateSafeString(input: string): boolean {
  // Check for SQL injection patterns
  const sqlPatterns = /('|"|;|--|\b(union|select|insert|update|delete|drop)\b)/i
  if (sqlPatterns.test(input)) {
    return false
  }

  // Check for script injection
  const scriptPatterns = /<script|javascript:|on\w+=/i
  if (scriptPatterns.test(input)) {
    return false
  }

  return true
}

export { getClientIP, checkRateLimit }
