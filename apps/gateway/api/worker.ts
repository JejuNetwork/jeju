/**
 * Gateway API Worker
 *
 * DWS-deployable worker using Elysia with workerd compatibility.
 * Compatible with workerd runtime and DWS infrastructure.
 *
 * Architecture:
 * - Faucet routes: Directly implemented in this worker
 * - RPC/x402/leaderboard/oracle: Mounted as sub-apps for unified deployment
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
  getRpcUrl,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { config } from './config'
import { leaderboardApp } from './leaderboard'

// Import sub-apps for unified deployment
// These are mounted at their respective prefixes
import { rpcApp } from './rpc/server'
import {
  claimFromFaucet,
  claimGasGrant,
  getFaucetInfo,
  getFaucetStatus,
} from './services/faucet-service'
import x402App from './x402/server'

/**
 * Worker Environment Types
 *
 * SECURITY: All signing operations use KMS via service IDs.
 * No private keys are passed through environment variables.
 */
export interface GatewayEnv {
  // Standard workerd bindings
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // KV bindings (optional)
  GATEWAY_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

/**
 * Create the Gateway Elysia app
 */
export function createGatewayApp(env?: Partial<GatewayEnv>) {
  const isDev = env?.NETWORK === 'localnet'
  const network = env?.NETWORK ?? getCurrentNetwork()

  const app = new Elysia().use(
    cors({
      origin: isDev
        ? true
        : [
            'https://gateway.jejunetwork.org',
            'https://jejunetwork.org',
            getCoreAppUrl('GATEWAY'),
          ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true,
    }),
  )

  // Health check
  app.get('/health', () => ({
    status: 'ok',
    service: 'gateway-api',
    version: '1.0.0',
    network,
    runtime: 'workerd',
    endpoints: {
      faucet: '/api/faucet',
      rpc: '/rpc',
      x402: '/x402',
      oracle: '/oracle',
      leaderboard: '/leaderboard',
    },
  }))

  // Faucet routes
  app.group('/api/faucet', (app) =>
    app
      .get('/info', () => getFaucetInfo())
      .get('/status/:address', async ({ params }) => {
        const parsed = AddressSchema.safeParse(params.address)
        if (!parsed.success) {
          return { error: 'Invalid address format' }
        }
        return getFaucetStatus(parsed.data as `0x${string}`)
      })
      .post('/claim', async ({ body }) => {
        const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
        if (!bodyParsed.success) {
          return { success: false, error: 'Invalid address format' }
        }
        return claimFromFaucet(bodyParsed.data.address as `0x${string}`)
      })
      .post('/gas-grant', async ({ body }) => {
        const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
        if (!bodyParsed.success) {
          return { success: false, error: 'Invalid address format' }
        }
        return claimGasGrant(bodyParsed.data.address as `0x${string}`)
      }),
  )

  // Root route - API info
  app.get('/', () => ({
    name: 'Gateway API',
    version: '1.0.0',
    description: 'Jeju Gateway - Faucet, RPC Proxy, x402 Payments, Oracle',
    runtime: 'workerd',
    network,
    endpoints: {
      health: '/health',
      faucet: '/api/faucet',
      rpc: '/rpc',
      x402: '/x402',
      oracle: '/oracle',
      leaderboard: '/leaderboard',
    },
  }))

  // Agent card endpoint
  app.get('/.well-known/agent-card.json', () => ({
    name: 'Gateway',
    description: 'Jeju Gateway - Faucet, RPC Proxy, x402 Payments, Oracle',
    version: '1.0.0',
    skills: [
      {
        id: 'faucet-claim',
        name: 'Claim Faucet',
        description: 'Claim testnet tokens from faucet',
      },
      {
        id: 'faucet-status',
        name: 'Faucet Status',
        description: 'Check faucet claim status',
      },
      {
        id: 'rpc-proxy',
        name: 'RPC Proxy',
        description: 'Proxy JSON-RPC requests',
      },
      {
        id: 'x402-verify',
        name: 'Verify Payment',
        description: 'Verify x402 payments',
      },
    ],
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
    },
  }))

  // Mount sub-apps at their respective prefixes
  // RPC Gateway - handles multi-chain RPC proxying
  app.mount('/rpc', rpcApp.handle)

  // X402 Payment Facilitator
  app.mount('/x402', x402App.handle)

  // Leaderboard API
  app.mount('/leaderboard', leaderboardApp.handle)

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
 */
let cachedApp: ReturnType<typeof createGatewayApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: GatewayEnv): ReturnType<typeof createGatewayApp> {
  const envHash = `${env.NETWORK}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createGatewayApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Worker handler for workerd/Cloudflare Workers
 * Exported as named export to avoid Bun auto-serving
 */
export const workerHandler = {
  async fetch(
    request: Request,
    env: GatewayEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Workerd-compatible fetch export (DWS runtime autodetects this)
export async function fetch(
  request: Request,
  env: GatewayEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  return workerHandler.fetch(request, env, ctx)
}

// Standalone Server (for local dev and production mode with Bun)
// Only starts if this is the main module being run directly

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

// Start server when running the source file directly
if (isMainModule) {
  const PORT =
    Number(process.env.PORT) ||
    config.gatewayApiPort ||
    CORE_PORTS.NODE_EXPLORER_API.get()
  const network = getCurrentNetwork()

  const app = createGatewayApp({
    NETWORK: network,
    RPC_URL:
      process.env.JEJU_RPC_URL ?? process.env.RPC_URL ?? getRpcUrl(network),
  })

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(`[Gateway] Worker running at http://${host}:${PORT}`)
    console.log(`[Gateway] Network: ${network}`)
  })
}
