import { cors } from '@elysiajs/cors'
import { getNetworkName } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'
import type { HealthResponse, ServiceStatus } from '../lib/schemas'
import { createA2AServer } from './a2a'
import { createAuthRoutes } from './auth'
import { getDatabase } from './db/client'
import { createMCPServer } from './mcp'
import { banCheckHandler } from './middleware/ban-check'
import { createRESTRoutes } from './rest'
import { getOAuth3Service } from './services/auth'
import { getCache } from './services/cache'
import {
  getCronService,
  handleCleanupWebhook,
  handleReminderWebhook,
} from './services/cron'
import { getKMSService } from './services/kms'
import { getRegistryService } from './services/registry'
import { getStorageService } from './services/storage'
import { expectValid } from './utils/validation'
import { createX402Routes, getX402Middleware } from './x402'

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).default('4500').transform(Number),
  APP_NAME: z.string().default('Decentralized App Template'),
  CORS_ORIGINS: z.string().optional(),
})

type EnvConfig = z.infer<typeof envSchema>

const env: EnvConfig = expectValid(
  envSchema,
  process.env,
  'Environment variables',
)

const PORT = env.PORT
const APP_NAME = env.APP_NAME
const VERSION = '1.0.0'

const network = getNetworkName()
const isLocalnet = network === 'localnet' || network === 'Jeju'

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
  return []
}

const RATE_LIMIT_WINDOW_MS = 60000

const RATE_LIMIT_MAX_REQUESTS = parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || '100',
  10,
)
const rateLimitStore: Map<string, { count: number; resetAt: number }> =
  new Map()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
if (!WEBHOOK_SECRET && !isLocalnet) {
  console.error('SECURITY ERROR: WEBHOOK_SECRET must be set in production')
  process.exit(1)
}

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
  .onBeforeHandle(({ set }) => {
    const requestId = `req-${crypto.randomUUID()}`
    set.headers['X-Request-Id'] = requestId
  })
  .onBeforeHandle(
    ({
      path,
      request,
      set,
    }): { error: string; code: string; retryAfter: number } | undefined => {
      if (path === '/health' || path === '/docs' || path === '/') {
        return undefined
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

      return undefined
    },
  )
  .onBeforeHandle(banCheckHandler)
  .get('/health', async ({ set }) => {
    const HEALTH_CHECK_TIMEOUT = 3000
    const services: ServiceStatus[] = []

    const checkWithTimeout = async <T>(
      _name: string,
      check: () => Promise<T>,
    ): Promise<{ result: T | null; latency: number }> => {
      const start = Date.now()
      const result = await Promise.race([
        check().catch(() => null),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), HEALTH_CHECK_TIMEOUT),
        ),
      ])
      return { result, latency: Date.now() - start }
    }

    const [
      dbCheck,
      cacheCheck,
      kmsCheck,
      storageCheck,
      cronCheck,
      registryCheck,
      oauth3Check,
    ] = await Promise.all([
      checkWithTimeout('database', () => getDatabase().isHealthy()),
      checkWithTimeout('cache', () => getCache().isHealthy()),
      checkWithTimeout('kms', () => getKMSService().isHealthy()),
      checkWithTimeout('storage', () => getStorageService().isHealthy()),
      checkWithTimeout('cron', () => getCronService().isHealthy()),
      checkWithTimeout('registry', () => getRegistryService().isHealthy()),
      checkWithTimeout('oauth3', async () => {
        const oauth3Service = getOAuth3Service()
        return oauth3Service.checkInfrastructureHealth()
      }),
    ])

    let unhealthyCount = 0
    let degradedCount = 0

    const dbHealthy = dbCheck.result === true
    services.push({
      name: 'database (CQL)',
      status: dbHealthy ? 'healthy' : 'unhealthy',
      latency: dbCheck.latency,
      details: dbHealthy ? 'Connected' : 'Connection failed - CQL required',
    })
    if (!dbHealthy) unhealthyCount++

    const cacheHealthy = cacheCheck.result === true
    services.push({
      name: 'cache',
      status: cacheHealthy ? 'healthy' : 'unhealthy',
      latency: cacheCheck.latency,
      details: cacheHealthy ? 'Available' : 'Cache service required',
    })
    if (!cacheHealthy) unhealthyCount++

    const kmsHealthy = kmsCheck.result === true
    services.push({
      name: 'kms',
      status: kmsHealthy ? 'healthy' : 'degraded',
      latency: kmsCheck.latency,
      details: kmsHealthy ? 'Available' : 'KMS service unavailable',
    })
    if (!kmsHealthy) degradedCount++

    const storageHealthy = storageCheck.result === true
    services.push({
      name: 'storage (IPFS)',
      status: storageHealthy ? 'healthy' : 'degraded',
      latency: storageCheck.latency,
      details: storageHealthy ? 'Connected' : 'IPFS unavailable',
    })
    if (!storageHealthy) degradedCount++

    const cronHealthy = cronCheck.result === true
    services.push({
      name: 'cron triggers',
      status: cronHealthy ? 'healthy' : 'degraded',
      latency: cronCheck.latency,
      details: cronHealthy ? 'Active' : 'Cron service unavailable',
    })
    if (!cronHealthy) degradedCount++

    const x402 = getX402Middleware()
    services.push({
      name: 'x402 payments',
      status: x402.config.enabled ? 'healthy' : 'degraded',
      details: x402.config.enabled ? 'Enabled' : 'Disabled',
    })

    const registryHealthy = registryCheck.result === true
    services.push({
      name: 'OAuth3 Registry',
      status: registryHealthy ? 'healthy' : 'degraded',
      latency: registryCheck.latency,
      details: registryHealthy ? 'Connected' : 'Registry unavailable',
    })
    if (!registryHealthy) degradedCount++

    // Type guard for OAuth3 health check result
    const isOAuth3Health = (
      value: unknown,
    ): value is { jns: boolean; storage: boolean; teeNode: boolean } => {
      if (!value || typeof value !== 'object') return false
      const obj = value as Record<string, unknown>
      return (
        typeof obj.jns === 'boolean' &&
        typeof obj.storage === 'boolean' &&
        typeof obj.teeNode === 'boolean'
      )
    }

    const oauth3Health = isOAuth3Health(oauth3Check.result)
      ? oauth3Check.result
      : null
    const oauth3Healthy =
      oauth3Health?.jns && oauth3Health?.storage && oauth3Health?.teeNode
    services.push({
      name: 'OAuth3 Infrastructure',
      status: oauth3Healthy ? 'healthy' : 'degraded',
      latency: oauth3Check.latency,
      details: oauth3Healthy
        ? 'All components ready'
        : oauth3Health
          ? `JNS: ${oauth3Health.jns}, Storage: ${oauth3Health.storage}, TEE: ${oauth3Health.teeNode}`
          : 'Check timed out',
    })
    if (!oauth3Healthy) degradedCount++

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
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

    if (!isLocalnet && overallStatus === 'unhealthy') {
      set.status = 503
    }

    return response
  })
  .get('/', () => ({
    name: APP_NAME,
    version: VERSION,
    description: 'A production-ready template for building applications',
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
      'No centralized dependencies',
      'AI-ready with A2A and MCP protocols',
      'Monetizable with x402 payments',
      'Encrypted data with threshold KMS',
      'Human-readable domains with JNS',
      'Scheduled tasks with on-chain cron',
      'OAuth3 decentralized authentication',
    ],
  }))
  .get('/docs', () => ({
    title: 'Decentralized App Template API',
    version: VERSION,
    description: 'An application demonstrating all Jeju network services',

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
      method: 'OAuth3',
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
  }))
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
  .use(createRESTRoutes())
  .use(createA2AServer())
  .use(createMCPServer())
  .use(createX402Routes())
  .use(createAuthRoutes())

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
║  Auth:         OAuth3                                           ║
╚══════════════════════════════════════════════════════════════╝
`

console.log(startupBanner)

app.listen(PORT)

export type App = typeof app
