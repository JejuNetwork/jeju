/**
 * Decentralized App Template - Main Server
 *
 * A production-ready template demonstrating all decentralized services:
 * - REST API for CRUD operations
 * - A2A (Agent-to-Agent) protocol for AI agents
 * - MCP (Model Context Protocol) for tool integrations
 * - x402 payment protocol for monetization
 * - OAuth3 for decentralized authentication
 * - CQL database for persistent storage
 * - Cache layer for performance
 * - KMS for encrypted data
 * - Cron triggers for scheduled tasks
 * - JNS for decentralized naming
 */

import { getNetworkName } from '@jejunetwork/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { getDatabase } from '../db/client'
import { banCheckMiddleware } from '../middleware/ban-check'
import { getOAuth3Service } from '../services/auth'
import { getCache } from '../services/cache'
import {
  getCronService,
  handleCleanupWebhook,
  handleReminderWebhook,
} from '../services/cron'
import { getKMSService } from '../services/kms'
import { getRegistryService } from '../services/registry'
import { getStorageService } from '../services/storage'
import type { HealthResponse, ServiceStatus } from '../types'
import { expectValid } from '../utils/validation'
import { createA2AServer } from './a2a'
import { createAuthRoutes } from './auth'
import { createMCPServer } from './mcp'
import { createRESTRoutes } from './rest'
import { createX402Routes, getX402Middleware } from './x402'

// Validate environment variables
const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number).default('4500'),
  APP_NAME: z.string().default('Decentralized App Template'),
  CORS_ORIGINS: z.string().optional(),
})

const env = expectValid(envSchema, process.env, 'Environment variables')

const PORT = env.PORT
const APP_NAME = env.APP_NAME
const VERSION = '1.0.0'

// Determine CORS origins based on environment
const network = getNetworkName()
const isLocalnet = network === 'localnet' || network === 'Jeju'

// In production, require explicit CORS origins or restrict to same-origin
// In localnet, allow common development origins
const getAllowedOrigins = (): string | string[] => {
  if (env.CORS_ORIGINS) {
    return env.CORS_ORIGINS.split(',').map((o) => o.trim())
  }
  if (isLocalnet) {
    return [
      'http://localhost:4500',
      'http://localhost:4501',
      'http://localhost:3000',
    ]
  }
  // Production: only same-origin unless explicitly configured
  return []
}

const app = new Hono()

// CORS with environment-aware configuration
app.use(
  '/*',
  cors({
    origin: getAllowedOrigins(),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Payment',
      'x-jeju-address',
      'x-jeju-timestamp',
      'x-jeju-signature',
      'x-oauth3-session',
    ],
    exposeHeaders: ['X-Request-Id', 'X-Payment-Required'],
  }),
)

// Request ID middleware with cryptographically secure random
app.use('/*', async (c, next) => {
  // Use crypto.randomUUID() for cryptographically secure request IDs
  const requestId = `req-${crypto.randomUUID()}`
  c.header('X-Request-Id', requestId)
  await next()
})

// Simple in-memory rate limiting
// In production, use Redis-based rate limiting via the cache service
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || '100',
  10,
)
const rateLimitStore: Map<string, { count: number; resetAt: number }> =
  new Map()

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

// Rate limiting middleware
app.use('/*', async (c, next) => {
  // Skip rate limiting for health checks and docs
  if (
    c.req.path === '/health' ||
    c.req.path === '/docs' ||
    c.req.path === '/'
  ) {
    return next()
  }

  // SECURITY: Only use IP for rate limiting at pre-authentication stage
  // Using x-jeju-address header would allow attackers to spoof addresses
  // and bypass rate limits. Authenticated rate limits can be applied
  // per-address after authentication middleware.
  const clientIp =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  const rateLimitKey = `ip:${clientIp}`

  const now = Date.now()
  let entry = rateLimitStore.get(rateLimitKey)

  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitStore.set(rateLimitKey, entry)
  }

  entry.count++

  // Set rate limit headers
  c.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString())
  c.header(
    'X-RateLimit-Remaining',
    Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count).toString(),
  )
  c.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString())

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return c.json(
      {
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      },
      429,
    )
  }

  return next()
})

// Ban check middleware - blocks banned users
app.use('/*', banCheckMiddleware())

// Health check with service status
app.get('/health', async (c) => {
  const services: ServiceStatus[] = []
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
  let degradedCount = 0
  let unhealthyCount = 0

  // Check database (required)
  const dbStart = Date.now()
  const db = getDatabase()
  const dbHealthy = await db.isHealthy()
  services.push({
    name: 'database (CQL)',
    status: dbHealthy ? 'healthy' : 'unhealthy',
    latency: Date.now() - dbStart,
    details: dbHealthy ? 'Connected' : 'Connection failed - CQL required',
  })
  if (!dbHealthy) unhealthyCount++

  // Check cache (required)
  const cacheStart = Date.now()
  const cache = getCache()
  const cacheHealthy = await cache.isHealthy()
  services.push({
    name: 'cache',
    status: cacheHealthy ? 'healthy' : 'unhealthy',
    latency: Date.now() - cacheStart,
    details: cacheHealthy ? 'Available' : 'Cache service required',
  })
  if (!cacheHealthy) unhealthyCount++

  // Check KMS (required)
  const kmsStart = Date.now()
  const kms = getKMSService()
  const kmsHealthy = await kms.isHealthy()
  services.push({
    name: 'kms',
    status: kmsHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - kmsStart,
    details: kmsHealthy ? 'Available' : 'KMS service unavailable',
  })
  if (!kmsHealthy) degradedCount++

  // Check storage (required)
  const storageStart = Date.now()
  const storage = getStorageService()
  const storageHealthy = await storage.isHealthy()
  services.push({
    name: 'storage (IPFS)',
    status: storageHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - storageStart,
    details: storageHealthy ? 'Connected' : 'IPFS unavailable',
  })
  if (!storageHealthy) degradedCount++

  // Check cron
  const cronStart = Date.now()
  const cron = getCronService()
  const cronHealthy = await cron.isHealthy()
  services.push({
    name: 'cron triggers',
    status: cronHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - cronStart,
    details: cronHealthy ? 'Active' : 'Cron service unavailable',
  })
  if (!cronHealthy) degradedCount++

  // Check x402
  const x402 = getX402Middleware()
  services.push({
    name: 'x402 payments',
    status: x402.config.enabled ? 'healthy' : 'degraded',
    details: x402.config.enabled ? 'Enabled' : 'Disabled',
  })

  // Check OAuth3 Registry
  const registryStart = Date.now()
  const registry = getRegistryService()
  const registryHealthy = await registry.isHealthy()
  services.push({
    name: 'OAuth3 Registry',
    status: registryHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - registryStart,
    details: registryHealthy ? 'Connected' : 'Registry unavailable',
  })
  if (!registryHealthy) degradedCount++

  // Check OAuth3 Infrastructure
  const oauth3Start = Date.now()
  const oauth3Service = getOAuth3Service()
  let oauth3Health = { jns: false, storage: false, teeNode: false }
  let oauth3Error: string | undefined
  try {
    oauth3Health = await oauth3Service.checkInfrastructureHealth()
  } catch (error) {
    // OAuth3 not initialized - log the error for debugging
    oauth3Error =
      error instanceof Error ? error.message : 'Unknown OAuth3 error'
    console.warn('[Health] OAuth3 infrastructure check failed:', oauth3Error)
  }
  const oauth3Healthy =
    oauth3Health.jns && oauth3Health.storage && oauth3Health.teeNode
  services.push({
    name: 'OAuth3 Infrastructure',
    status: oauth3Healthy ? 'healthy' : 'degraded',
    latency: Date.now() - oauth3Start,
    details: oauth3Error
      ? `Error: ${oauth3Error}`
      : oauth3Healthy
        ? 'All components ready'
        : `JNS: ${oauth3Health.jns}, Storage: ${oauth3Health.storage}, TEE: ${oauth3Health.teeNode}`,
  })
  if (!oauth3Healthy) degradedCount++

  // Determine overall status
  if (unhealthyCount > 0) {
    overallStatus = 'unhealthy'
  } else if (degradedCount > 0) {
    overallStatus = 'degraded'
  }

  const response: HealthResponse = {
    status: overallStatus,
    version: VERSION,
    services,
    timestamp: Date.now(),
  }

  // In localnet, always return 200 to allow testing even without all services
  const statusCode = isLocalnet
    ? 200
    : overallStatus === 'unhealthy'
      ? 503
      : 200
  return c.json(response, statusCode)
})

// Root endpoint
app.get('/', (c) =>
  c.json({
    name: APP_NAME,
    version: VERSION,
    description:
      'A production-ready template for building fully decentralized applications',
    network: getNetworkName(),
    endpoints: {
      rest: '/api/v1',
      a2a: '/a2a',
      mcp: '/mcp',
      x402: '/x402',
      auth: '/auth',
      health: '/health',
      docs: '/docs',
      agentCard: '/a2a/.well-known/agent-card.json',
    },
    services: {
      database: 'CQL (CovenantSQL)',
      cache: 'Compute-based Redis',
      storage: 'IPFS via Storage Marketplace',
      secrets: 'KMS with MPC',
      triggers: 'On-chain Cron',
      names: 'JNS (Jeju Name Service)',
      payments: 'x402 Protocol',
      authentication: 'OAuth3 (TEE-backed)',
    },
    features: [
      'Fully decentralized - no centralized dependencies',
      'AI-ready with A2A and MCP protocols',
      'Monetizable with x402 payments',
      'Encrypted data with threshold KMS',
      'Human-readable domains with JNS',
      'Scheduled tasks with on-chain cron',
      'OAuth3 decentralized authentication',
    ],
  }),
)

// Documentation
app.get('/docs', (c) =>
  c.json({
    title: 'Decentralized App Template API',
    version: VERSION,
    description:
      'A fully decentralized application demonstrating all Jeju network services',

    restEndpoints: {
      'GET /api/v1/todos': 'List all todos for the authenticated user',
      'POST /api/v1/todos': 'Create a new todo',
      'GET /api/v1/todos/:id': 'Get a specific todo',
      'PATCH /api/v1/todos/:id': 'Update a todo',
      'DELETE /api/v1/todos/:id': 'Delete a todo',
      'POST /api/v1/todos/:id/encrypt': 'Encrypt todo with KMS',
      'POST /api/v1/todos/:id/decrypt': 'Decrypt todo with KMS',
      'POST /api/v1/todos/:id/attach': 'Upload attachment to IPFS',
      'GET /api/v1/stats': 'Get statistics',
      'POST /api/v1/todos/bulk/complete': 'Bulk complete todos',
      'POST /api/v1/todos/bulk/delete': 'Bulk delete todos',
    },

    a2aSkills: {
      'list-todos': 'List all todos',
      'create-todo': 'Create a new todo',
      'complete-todo': 'Mark a todo as complete',
      'delete-todo': 'Delete a todo',
      'get-summary': 'Get todo summary statistics',
      'set-reminder': 'Schedule a reminder for a todo',
      prioritize: 'AI-suggested task prioritization',
    },

    mcpTools: {
      list_todos: 'List all todos with optional filters',
      create_todo: 'Create a new todo item',
      update_todo: 'Update an existing todo',
      delete_todo: 'Delete a todo',
      get_stats: 'Get todo statistics',
      schedule_reminder: 'Schedule a reminder',
      bulk_complete: 'Mark multiple todos as complete',
    },

    x402: {
      infoEndpoint: 'GET /x402/info',
      verifyEndpoint: 'POST /x402/verify',
      headerFormat:
        'X-Payment: token:amount:payer:payee:nonce:deadline:signature',
      priceTiers: {
        free: 'Health checks, info endpoints',
        basic: '0.001 USDC - Standard operations',
        premium: '0.01 USDC - Priority operations',
        ai: '0.1 USDC - AI-powered features',
      },
    },

    authentication: {
      methods: ['OAuth3 (recommended)', 'Legacy wallet signature'],
      oauth3: {
        sessionHeader: 'x-oauth3-session',
        endpoints: {
          providers: 'GET /auth/providers',
          login: 'POST /auth/login/wallet or GET /auth/login/:provider',
          callback: 'GET /auth/callback',
          session: 'GET /auth/session',
          logout: 'POST /auth/logout',
          health: 'GET /auth/health',
        },
      },
      legacy: {
        headers: {
          'x-jeju-address': 'Wallet address',
          'x-jeju-timestamp': 'Unix timestamp in milliseconds',
          'x-jeju-signature': 'Signature of "jeju-dapp:{timestamp}"',
        },
        validity: '5 minutes',
      },
    },
  }),
)

// Webhook authentication middleware
// Webhooks must include a secret header that matches the configured webhook secret
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || (isLocalnet ? 'dev-webhook-secret' : '')

// Constant-time string comparison using crypto.subtle
// This prevents timing attacks by ensuring comparison takes the same time
// regardless of where the strings differ
const constantTimeEqual = async (a: string, b: string): Promise<boolean> => {
  // Convert strings to Uint8Arrays
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  // Create fixed-size buffers to prevent length leakage
  // Use HMAC with both values and compare digests
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const [aHash, bHash] = await Promise.all([
    crypto.subtle.sign('HMAC', key, aBytes),
    crypto.subtle.sign('HMAC', key, bBytes),
  ])

  // Compare the hashes in constant time
  const aView = new Uint8Array(aHash)
  const bView = new Uint8Array(bHash)

  let result = 0
  for (let i = 0; i < aView.length; i++) {
    result |= aView[i] ^ bView[i]
  }

  return result === 0
}

const validateWebhookSecret = async (
  c: Parameters<Parameters<typeof app.post>[1]>[0],
): Promise<boolean> => {
  // In localnet without configured secret, allow all webhooks
  if (isLocalnet && !process.env.WEBHOOK_SECRET) {
    return true
  }

  // Require webhook secret in production
  if (!WEBHOOK_SECRET) {
    console.error('[Webhook] WEBHOOK_SECRET not configured')
    return false
  }

  const providedSecret = c.req.header('x-webhook-secret')
  if (!providedSecret) {
    console.warn('[Webhook] Missing x-webhook-secret header')
    return false
  }

  // Use constant-time comparison that doesn't leak length
  return constantTimeEqual(providedSecret, WEBHOOK_SECRET)
}

// Webhook handlers for cron callbacks with authentication
app.post('/webhooks/reminder/:id', async (c) => {
  if (!(await validateWebhookSecret(c))) {
    return c.json({ error: 'Unauthorized', code: 'WEBHOOK_AUTH_FAILED' }, 401)
  }

  const reminderId = c.req.param('id')
  if (!reminderId || reminderId.length === 0) {
    return c.json({ error: 'Reminder ID required' }, 400)
  }

  await handleReminderWebhook(reminderId)
  return c.json({ success: true })
})

app.post('/webhooks/cleanup', async (c) => {
  if (!(await validateWebhookSecret(c))) {
    return c.json({ error: 'Unauthorized', code: 'WEBHOOK_AUTH_FAILED' }, 401)
  }

  await handleCleanupWebhook()
  return c.json({ success: true })
})

// Mount routes
app.route('/api/v1', createRESTRoutes())
app.route('/a2a', createA2AServer())
app.route('/mcp', createMCPServer())
app.route('/x402', createX402Routes())
app.route('/auth', createAuthRoutes())

// Start server
const startupBanner = `
╔══════════════════════════════════════════════════════════════╗
║              DECENTRALIZED APP TEMPLATE                       ║
╠══════════════════════════════════════════════════════════════╣
║  REST API:     http://localhost:${PORT}/api/v1                  ║
║  A2A:          http://localhost:${PORT}/a2a                     ║
║  MCP:          http://localhost:${PORT}/mcp                     ║
║  x402:         http://localhost:${PORT}/x402                    ║
║  Auth:         http://localhost:${PORT}/auth                    ║
║  Health:       http://localhost:${PORT}/health                  ║
║  Agent Card:   http://localhost:${PORT}/a2a/.well-known/agent-card.json
╠══════════════════════════════════════════════════════════════╣
║  Network:      ${getNetworkName().padEnd(44)}║
║  Version:      ${VERSION.padEnd(44)}║
║  Auth:         OAuth3 + Legacy Wallet                          ║
╚══════════════════════════════════════════════════════════════╝
`

console.log(startupBanner)

export default {
  port: PORT,
  fetch: app.fetch,
}
