import { cors } from '@elysiajs/cors'
import { isProductionEnv } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { config, getConfigStatus, validateConfig } from './config'
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

const MAX_BODY_SIZE = 256 * 1024

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = isProductionEnv()

/**
 * SECURITY: In production, if CORS_ORIGINS is empty, reject cross-origin requests
 */
function getX402CorsOrigin(): boolean | string[] {
  if (!isProduction) {
    return true
  }
  if (CORS_ORIGINS?.length) {
    return CORS_ORIGINS
  }
  // SECURITY: In production with no configured origins, return empty array
  // which effectively blocks cross-origin requests
  return []
}

const app = new Elysia()
  .use(
    cors({
      origin: getX402CorsOrigin(),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-Payment',
        'X-Payment-Proof',
        'Authorization',
      ],
      exposeHeaders: ['X-Payment-Requirement', 'WWW-Authenticate'],
    }),
  )
  // Security middleware - body size check and security headers
  .onBeforeHandle(({ request, set }) => {
    const contentLength = request.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      set.status = 413
      return { error: 'Request body too large', maxSize: MAX_BODY_SIZE }
    }
    return undefined
  })
  .onAfterHandle(({ set }) => {
    // SECURITY: Comprehensive security headers
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-XSS-Protection'] = '1; mode=block'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    // SECURITY: CSP to prevent XSS and injection attacks
    set.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    // SECURITY: Prevent MIME sniffing
    set.headers['X-Download-Options'] = 'noopen'
    // SECURITY: Permissions policy to restrict browser features
    set.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
  })
  // Mount routes
  .use(healthRoutes)
  .use(verifyRoutes)
  .use(settleRoutes)
  .use(supportedRoutes)
  .use(metricsRoutes)
  // Error handler
  .onError(({ error, set }) => {
    // Log full error details server-side only
    console.error('[Facilitator] Error:', error)

    // SECURITY: Never expose internal error details to clients in production
    const isProduction = isProductionEnv()
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    const safeMessage = isProduction ? 'Internal server error' : errorMessage

    set.status = 500
    return {
      error: 'Internal server error',
      message: safeMessage,
      timestamp: Date.now(),
    }
  })

// 404 handler - Elysia handles this via a catch-all route
app.all('*', ({ request, set }) => {
  set.status = 404
  return {
    error: 'Not found',
    path: new URL(request.url).pathname,
    timestamp: Date.now(),
  }
})

export type X402App = typeof app

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

  const configStatus = await getConfigStatus()
  const keySource = configStatus.kmsAvailable ? 'kms' : configStatus.signingMode

  console.log(
    `[Facilitator] ${cfg.network} (${cfg.chainId}) | ${cfg.environment} | key:${keySource}`,
  )
  console.log(`[Facilitator] Contract: ${cfg.facilitatorAddress}`)

  const server = app.listen({
    port: cfg.port,
    hostname: cfg.host,
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
