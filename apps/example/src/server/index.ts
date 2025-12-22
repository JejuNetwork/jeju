import { cors } from '@elysiajs/cors'
import { getNetworkName } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { getDatabase } from '../db/client'
import { banCheckHandler } from '../middleware/ban-check'
import type { HealthResponse, ServiceStatus } from '../schemas'
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
import { expectValid } from '../utils/validation'
import { createA2AServer } from './a2a'
import { createAuthRoutes } from './auth'
import { createMCPServer } from './mcp'
import { createRESTRoutes } from './rest'
import { createX402Routes, getX402Middleware } from './x402'

// Environment schema with proper defaults
const envSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/)
    .default('4500')
    .transform(Number),
  APP_NAME: z.string().default('Decentralized App Template'),
  CORS_ORIGINS: z.string().optional(),
})

type EnvConfig = z.infer<typeof envSchema>

const env: EnvConfig = expectValid(envSchema, process.env, 'Environment variables')

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

// Simple in-memory rate limiting
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

// Webhook authentication middleware
// SECURITY: Require explicit webhook secret in production
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
if (!WEBHOOK_SECRET && !isLocalnet) {
  console.error('SECURITY ERROR: WEBHOOK_SECRET must be set in production')
  process.exit(1)
}
const webhookSecret = WEBHOOK_SECRET || 'dev-webhook-secret'

// Constant-time string comparison using crypto.subtle
const constantTimeEqual = async (a: string, b: string): Promise<boolean> => {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const [aHash, bHash] = await Promise.all([
    crypto.subtle.sign('HMAC', key, aBytes),
    crypto.subtle.sign('HMAC', key, bBytes),
  ])

  const aView = new Uint8Array(aHash)
  const bView = new Uint8Array(bHash)

  let result = 0
  for (let i = 0; i < aView.length; i++) {
    result |= aView[i] ^ bView[i]
  }

  return result === 0
}

const validateWebhookSecret = async (request: Request): Promise<boolean> => {
  if (isLocalnet && !process.env.WEBHOOK_SECRET) {
    return true
  }

  if (!WEBHOOK_SECRET) {
    console.error('[Webhook] WEBHOOK_SECRET not configured')
    return false
  }

  const providedSecret = request.headers.get('x-webhook-secret')
  if (!providedSecret) {
    console.warn('[Webhook] Missing x-webhook-secret header')
    return false
  }

  return constantTimeEqual(providedSecret, WEBHOOK_SECRET)
}

const app = new Elysia()
  .use(
    cors({
      origin: getAllowedOrigins(),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
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
  // Request ID middleware
  .onBeforeHandle(({ set }) => {
    const requestId = `req-${crypto.randomUUID()}`
    set.headers['X-Request-Id'] = requestId
  })
  // Rate limiting middleware
  .onBeforeHandle(({ path, request, set }) => {
    // Skip rate limiting for health checks and docs
    if (path === '/health' || path === '/docs' || path === '/') {
      return
    }

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const rateLimitKey = `ip:${clientIp}`

    const now = Date.now()
    let entry = rateLimitStore.get(rateLimitKey)

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
      rateLimitStore.set(rateLimitKey, entry)
    }

    entry.count++

    set.headers['X-RateLimit-Limit'] = RATE_LIMIT_MAX_REQUESTS.toString()
    set.headers['X-RateLimit-Remaining'] = Math.max(
      0,
      RATE_LIMIT_MAX_REQUESTS - entry.count,
    ).toString()
    set.headers['X-RateLimit-Reset'] = Math.ceil(
      entry.resetAt / 1000,
    ).toString()

    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
      set.status = 429
      return {
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      }
    }
  })
  // Ban check middleware
  .onBeforeHandle(banCheckHandler)
  // Health check with service status
  .get('/health', async ({ set }) => {
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
    if (!isLocalnet && overallStatus === 'unhealthy') {
      set.status = 503
    }

    return response
  })
  // Root endpoint
  .get('/', () => ({
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
  }))
  // Documentation
  .get('/docs', () => ({
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
  }))
  // Webhook handlers for cron callbacks with authentication
  .post('/webhooks/reminder/:id', async ({ params, request, set }) => {
    if (!(await validateWebhookSecret(request))) {
      set.status = 401
      return { error: 'Unauthorized', code: 'WEBHOOK_AUTH_FAILED' }
    }

    const reminderId = params.id
    if (!reminderId || reminderId.length === 0) {
      set.status = 400
      return { error: 'Reminder ID required' }
    }

    await handleReminderWebhook(reminderId)
    return { success: true }
  })
  .post('/webhooks/cleanup', async ({ request, set }) => {
    if (!(await validateWebhookSecret(request))) {
      set.status = 401
      return { error: 'Unauthorized', code: 'WEBHOOK_AUTH_FAILED' }
    }

    await handleCleanupWebhook()
    return { success: true }
  })
  // Mount routes
  .use(createRESTRoutes())
  .use(createA2AServer())
  .use(createMCPServer())
  .use(createX402Routes())
  .use(createAuthRoutes())

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

app.listen(PORT)

export default app
