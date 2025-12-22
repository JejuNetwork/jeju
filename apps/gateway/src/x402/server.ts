/**
 * x402 Facilitator HTTP Server
 */

import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'
import { config, getPrivateKeyFromKMS, validateConfig } from './config'
import healthRoutes from './routes/health'
import metricsRoutes from './routes/metrics'
import settleRoutes from './routes/settle'
import supportedRoutes from './routes/supported'
import verifyRoutes from './routes/verify'
import {
  initDistributedNonceManager,
  startNonceCleanup,
  stopNonceCleanup,
} from './services/nonce-manager'

const app = new Hono()

// SECURITY: Limit request body size to prevent DoS attacks
const MAX_BODY_SIZE = 256 * 1024 // 256KB for x402 payment data
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_SIZE,
    onError: (c: Context) => {
      return c.json(
        { error: 'Request body too large', maxSize: MAX_BODY_SIZE },
        413,
      )
    },
  }),
)

// SECURITY: Configure CORS based on environment
// In production, restrict to configured origins
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'

app.use(
  '*',
  cors({
    // In production, require explicit origin whitelist; in dev allow any
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'X-Payment',
      'X-Payment-Proof',
      'Authorization',
    ],
    exposeHeaders: ['X-Payment-Requirement', 'WWW-Authenticate'],
  }),
)
app.use('*', secureHeaders())
app.use('*', logger())
app.use('*', prettyJSON())

app.route('/', healthRoutes)
app.route('/verify', verifyRoutes)
app.route('/settle', settleRoutes)
app.route('/supported', supportedRoutes)
app.route('/metrics', metricsRoutes)

app.onError((err, c) => {
  // Log full error details server-side only
  console.error('[Facilitator] Error:', err)

  // SECURITY: Never expose internal error details to clients in production
  // Only return generic error message to prevent information leakage
  const isProduction = process.env.NODE_ENV === 'production'
  const safeMessage = isProduction ? 'Internal server error' : err.message

  return c.json(
    {
      error: 'Internal server error',
      message: safeMessage,
      timestamp: Date.now(),
    },
    500,
  )
})

app.notFound((c) => {
  return c.json(
    { error: 'Not found', path: c.req.path, timestamp: Date.now() },
    404,
  )
})

export function createServer() {
  return app
}

export async function startServer(): Promise<void> {
  const cfg = config()

  const validation = validateConfig()
  if (!validation.valid) {
    console.warn('[Facilitator] Warnings:', validation.errors.join(', '))
  }

  await initDistributedNonceManager()
  startNonceCleanup()

  let keySource = 'env'
  if (cfg.kmsEnabled) {
    const kmsKey = await getPrivateKeyFromKMS()
    keySource = kmsKey ? 'kms' : cfg.privateKey ? 'env' : 'none'
  }

  console.log(
    `[Facilitator] ${cfg.network} (${cfg.chainId}) | ${cfg.environment} | key:${keySource}`,
  )
  console.log(`[Facilitator] Contract: ${cfg.facilitatorAddress}`)

  const server = Bun.serve({
    port: cfg.port,
    hostname: cfg.host,
    fetch: app.fetch,
  })

  console.log(`[Facilitator] Listening on http://${cfg.host}:${cfg.port}`)

  const shutdown = () => {
    console.log('[Facilitator] Shutting down...')
    stopNonceCleanup()
    server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export default app
