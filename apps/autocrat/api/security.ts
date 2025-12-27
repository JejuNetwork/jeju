/**
 * Security Middleware for Autocrat API
 *
 * Provides:
 * - API key authentication for operator/admin endpoints
 * - Wallet signature verification for user actions
 * - Rate limiting per IP/address
 * - Request validation and sanitization
 * - Audit logging for sensitive operations (persisted to CQL)
 */

import crypto from 'node:crypto'
import { getCurrentNetwork } from '@jejunetwork/config'
import { type CQLClient, getCQL } from '@jejunetwork/db'
import { Elysia } from 'elysia'
import { type Address, isAddress, verifyMessage } from 'viem'
import { z } from 'zod'

// CQL configuration for audit persistence
const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'autocrat'
let auditCqlClient: CQLClient | null = null
let auditTableInitialized = false

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
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

// In-memory rate limit store (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

// Audit log buffer (flushes to CQL periodically)
const auditBuffer: AuditEntry[] = []
const MAX_AUDIT_BUFFER = 100

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
 * Check rate limit for a key
 */
function checkRateLimit(key: string, tier: RateLimitTier): boolean {
  const now = Date.now()
  const limit = RATE_LIMITS[tier]
  const entry = rateLimitStore.get(key)

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count++
  return true
}

/**
 * Validate API key for operator/admin operations
 * Uses crypto.timingSafeEqual for constant-time comparison to prevent timing attacks
 */
function validateApiKey(apiKey: string): boolean {
  const validKey = process.env.AUTOCRAT_API_KEY
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

  // Use crypto.timingSafeEqual which is truly constant-time
  // First check lengths separately to avoid leaking via timingSafeEqual's length requirement
  if (apiKeyBuf.length !== validKeyBuf.length) {
    // Still do a constant-time comparison against a dummy to avoid timing leak
    // This ensures the function takes the same time regardless of length mismatch
    const dummyBuf = Buffer.alloc(apiKeyBuf.length)
    try {
      crypto.timingSafeEqual(apiKeyBuf, dummyBuf)
    } catch {
      // Ignore - just ensuring constant time
    }
    return false
  }

  try {
    return crypto.timingSafeEqual(apiKeyBuf, validKeyBuf)
  } catch {
    return false
  }
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
 * Initialize CQL client and audit table
 */
async function ensureAuditTable(): Promise<CQLClient> {
  if (!auditCqlClient) {
    auditCqlClient = getCQL({
      databaseId: CQL_DATABASE_ID,
      timeout: 10000,
      debug: false,
    })
  }

  if (!auditTableInitialized) {
    const healthy = await auditCqlClient.isHealthy()
    if (healthy) {
      await auditCqlClient.exec(
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
        CQL_DATABASE_ID,
      )
      await auditCqlClient.exec(
        `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`,
        [],
        CQL_DATABASE_ID,
      )
      await auditCqlClient.exec(
        `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor)`,
        [],
        CQL_DATABASE_ID,
      )
      auditTableInitialized = true
    }
  }

  return auditCqlClient
}

/**
 * Add entry to audit log
 */
function addAuditEntry(entry: AuditEntry): void {
  auditBuffer.push(entry)

  // Flush when buffer is full
  if (auditBuffer.length >= MAX_AUDIT_BUFFER) {
    flushAuditLog()
  }
}

/**
 * Flush audit log to persistent storage (CQL)
 */
async function flushAuditLog(): Promise<void> {
  if (auditBuffer.length === 0) return

  const entries = auditBuffer.splice(0, auditBuffer.length)

  // Always log to console for immediate visibility
  for (const entry of entries) {
    console.log(
      `[Audit] ${entry.action} by ${entry.actor} from ${entry.ip}: ${entry.success ? 'SUCCESS' : 'FAILED'}`,
    )
  }

  // Persist to CQL for long-term audit trail
  try {
    const client = await ensureAuditTable()
    const healthy = await client.isHealthy()
    if (!healthy) {
      console.warn('[Audit] CQL not available, audit entries not persisted')
      return
    }

    for (const entry of entries) {
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
        CQL_DATABASE_ID,
      )
    }
  } catch (err) {
    // Log error but don't fail - audit persistence should not break the app
    console.error(
      '[Audit] Failed to persist audit entries:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

// Flush audit log periodically
setInterval(() => {
  flushAuditLog()
}, 30_000)

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

  // Rate limiting
  .onBeforeHandle(({ request, set }) => {
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
    if (!checkRateLimit(key, tier)) {
      set.status = 429
      return {
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
      }
    }
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
      addAuditEntry({
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
      addAuditEntry({
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
 */
export function auditLog(
  action: string,
  actor: string,
  request: Request,
  success: boolean,
  details: Record<string, string | number | boolean> = {},
): void {
  addAuditEntry({
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

export { getClientIP, checkRateLimit, flushAuditLog }
