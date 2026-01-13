/**
 * Crucible API Worker
 *
 * DWS-deployable worker using Elysia with CloudflareAdapter.
 * Compatible with workerd runtime and DWS infrastructure.
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { createAutonomousRouter } from './autonomous'
import { createBotsRouter } from './bots'
import { config } from './config'

// Worker Environment Types
export interface CrucibleEnv {
  // Standard workerd bindings
  TEE_MODE?: 'real' | 'simulated'
  TEE_PLATFORM?: string
  TEE_REGION?: string
  NETWORK?: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL?: string

  // Service URLs
  DWS_URL?: string
  GATEWAY_URL?: string

  // Database config
  SQLIT_NODES?: string
  SQLIT_DATABASE_ID?: string
  SQLIT_PRIVATE_KEY?: string
}

// Create Elysia App
export function createCrucibleApp(env?: Partial<CrucibleEnv>) {
  const isDev = env?.NETWORK === 'localnet' || !env?.NETWORK

  const app = new Elysia().use(
    cors({
      origin: isDev
        ? true
        : [
            'https://crucible.jejunetwork.org',
            'https://crucible.testnet.jejunetwork.org',
            'https://dws.jejunetwork.org',
            'https://dws.testnet.jejunetwork.org',
          ],
      credentials: true,
    }),
  )

  // Health check
  app.get('/health', () => ({
    status: 'healthy',
    service: 'crucible-api',
    network: env?.NETWORK ?? config.network,
    teeMode: env?.TEE_MODE ?? 'simulated',
  }))

  // API v1 routes
  app.group('/api/v1', (app) => {
    // Autonomous routes
    app.use(createAutonomousRouter())

    // Bots routes
    app.use(createBotsRouter())

    return app
  })

  // Note: Cron routes are in api/cron/index.ts (used by server.ts)
  // Worker deployments use DWS cron triggers directly

  return app
}

// Worker Export (for DWS/workerd)

/**
 * Workerd/Cloudflare Workers execution context
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/**
 * Cached app instance for worker reuse
 * Compiled once, reused across requests for better performance
 */
let cachedApp: ReturnType<typeof createCrucibleApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: CrucibleEnv): ReturnType<typeof createCrucibleApp> {
  // Create a simple hash of the env to detect changes
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createCrucibleApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Default export for workerd/Cloudflare Workers
 *
 * Note: For optimal workerd performance, the build script should generate
 * a worker entry that uses CloudflareAdapter in the Elysia constructor.
 * This export provides the fetch handler pattern.
 */
export default {
  async fetch(
    request: Request,
    env: CrucibleEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)
if (import.meta.main) {
  const app = createCrucibleApp({
    NETWORK: config.network,
    TEE_MODE: 'simulated',
  })

  const server = app.listen(config.apiPort, () => {
    console.log(`[Crucible] API server running on port ${config.apiPort}`)
    console.log(`[Crucible] Network: ${config.network}`)
    console.log(`[Crucible] Health: http://localhost:${config.apiPort}/health`)
  })

  process.on('SIGINT', () => {
    server.stop()
    process.exit(0)
  })
}
