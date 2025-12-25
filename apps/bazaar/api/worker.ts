/**
 * Bazaar API Worker
 *
 * DWS-deployable worker using Elysia with CloudflareAdapter.
 * Compatible with workerd runtime and DWS infrastructure.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCQLBlockProducerUrl,
  getL2RpcUrl,
} from '@jejunetwork/config'
import { type CQLClient, createTable, getCQL } from '@jejunetwork/db'
import {
  AddressSchema,
  expect as expectExists,
  expectValid,
} from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  A2ARequestSchema,
  TFMMGetQuerySchema,
  TFMMPostRequestSchema,
} from '../schemas/api'
import { handleA2ARequest, handleAgentCard } from './a2a-server'
import {
  ClaimRequestSchema,
  claimFromFaucet,
  FaucetClaimResultSchema,
  FaucetInfoSchema,
  FaucetStatusSchema,
  getFaucetInfo,
  getFaucetStatus,
} from './faucet'
import { handleMCPInfo, handleMCPRequest } from './mcp-server'
import {
  createTFMMPool,
  getAllTFMMPools,
  getOracleStatus,
  getTFMMPool,
  getTFMMStats,
  getTFMMStrategies,
  triggerPoolRebalance,
  updatePoolStrategy,
} from './tfmm/utils'

// Worker Environment Types

export interface BazaarEnv {
  // Standard workerd bindings
  TEE_MODE: 'real' | 'simulated'
  TEE_PLATFORM: string
  TEE_REGION: string
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  GATEWAY_URL: string
  INDEXER_URL: string

  // Database config
  COVENANTSQL_NODES: string
  COVENANTSQL_DATABASE_ID: string
  COVENANTSQL_PRIVATE_KEY: string

  // KV bindings (optional)
  BAZAAR_CACHE?: KVNamespace

  // Secrets
  PRIVATE_KEY?: string
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

// Database Layer

let dbClient: CQLClient | null = null

function getDatabase(env: BazaarEnv): CQLClient {
  if (dbClient) return dbClient

  const blockProducerEndpoint =
    env.COVENANTSQL_NODES?.split(',')[0] || getCQLBlockProducerUrl()
  const databaseId = env.COVENANTSQL_DATABASE_ID

  dbClient = getCQL({
    blockProducerEndpoint,
    databaseId,
    debug: env.NETWORK === 'localnet',
  })

  return dbClient
}

// Database Schemas

async function initializeDatabase(db: CQLClient): Promise<void> {
  // Faucet claims table
  const faucetTable = createTable('faucet_claims', [
    { name: 'id', type: 'TEXT', primaryKey: true, notNull: true },
    { name: 'address', type: 'TEXT', notNull: true },
    { name: 'amount', type: 'TEXT', notNull: true },
    { name: 'tx_hash', type: 'TEXT' },
    { name: 'claimed_at', type: 'TIMESTAMP', notNull: true },
    { name: 'ip_hash', type: 'TEXT' },
  ])
  await db.exec(faucetTable.up)
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_faucet_address ON faucet_claims(address)',
  )
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_faucet_claimed_at ON faucet_claims(claimed_at)',
  )

  // Market cache table
  const cacheTable = createTable('market_cache', [
    { name: 'key', type: 'TEXT', primaryKey: true, notNull: true },
    { name: 'value', type: 'JSON', notNull: true },
    { name: 'expires_at', type: 'TIMESTAMP', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true },
  ])
  await db.exec(cacheTable.up)
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_cache_expires ON market_cache(expires_at)',
  )

  // User preferences table
  const prefsTable = createTable('user_preferences', [
    { name: 'address', type: 'TEXT', primaryKey: true, notNull: true },
    { name: 'preferences', type: 'JSON', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true },
  ])
  await db.exec(prefsTable.up)
}

// Create Elysia App

export function createBazaarApp(env?: Partial<BazaarEnv>) {
  const isDev = env?.NETWORK === 'localnet'

  const app = new Elysia().use(
    cors({
      origin: isDev
        ? true
        : [
            'https://bazaar.jejunetwork.org',
            'https://jeju.network',
            getCoreAppUrl('BAZAAR'),
          ],
      credentials: true,
    }),
  )

  // Health check
  app.get('/health', () => ({
    status: 'ok',
    service: 'bazaar-api',
    teeMode: env?.TEE_MODE ?? 'simulated',
    network: env?.NETWORK ?? 'localnet',
  }))

  // Faucet API
  app.group('/api/faucet', (app) =>
    app
      .get('/info', () => {
        const info = getFaucetInfo()
        return FaucetInfoSchema.parse(info)
      })
      .get('/status/:address', async ({ params }) => {
        const parseResult = AddressSchema.safeParse(params.address)
        if (!parseResult.success) {
          return new Response(
            JSON.stringify({ error: 'Invalid address format' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        const status = await getFaucetStatus(parseResult.data)
        return FaucetStatusSchema.parse(status)
      })
      .post('/claim', async ({ body }) => {
        const parseResult = ClaimRequestSchema.safeParse(body)
        if (!parseResult.success) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Invalid request: ${parseResult.error.issues[0].message}`,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const result = await claimFromFaucet(parseResult.data.address).catch(
          (error: Error) => ({
            success: false as const,
            error: error.message,
          }),
        )

        const validated = FaucetClaimResultSchema.parse(result)

        if (!validated.success) {
          return new Response(JSON.stringify(validated), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return validated
      }),
  )

  // A2A API
  app.group('/api/a2a', (app) =>
    app
      .get('/', ({ query }) => {
        if (query.card === 'true') {
          return handleAgentCard()
        }
        return {
          service: 'bazaar-a2a',
          version: '1.0.0',
          description: 'Network Bazaar A2A Server',
          agentCard: '/api/a2a?card=true',
        }
      })
      .post('/', async ({ body, request }) => {
        const validatedBody = expectValid(A2ARequestSchema, body, 'A2A request')
        return handleA2ARequest(request, validatedBody)
      }),
  )

  // MCP API
  app.group('/api/mcp', (app) =>
    app
      .get('/', () => handleMCPInfo())
      .post('/', async ({ request }) => {
        const url = new URL(request.url)
        const pathParts = url.pathname.split('/').filter(Boolean)
        const endpoint = pathParts.slice(2).join('/') ?? 'initialize'
        return handleMCPRequest(request, endpoint)
      })
      .post('/initialize', async ({ request }) => {
        return handleMCPRequest(request, 'initialize')
      })
      .post('/resources/list', async ({ request }) => {
        return handleMCPRequest(request, 'resources/list')
      })
      .post('/resources/read', async ({ request }) => {
        return handleMCPRequest(request, 'resources/read')
      })
      .post('/tools/list', async ({ request }) => {
        return handleMCPRequest(request, 'tools/list')
      })
      .post('/tools/call', async ({ request }) => {
        return handleMCPRequest(request, 'tools/call')
      })
      .post('/prompts/list', async ({ request }) => {
        return handleMCPRequest(request, 'prompts/list')
      })
      .post('/*', async ({ request }) => {
        const url = new URL(request.url)
        const endpoint = url.pathname.replace('/api/mcp/', '')
        return handleMCPRequest(request, endpoint)
      }),
  )

  // TFMM API
  app.group('/api/tfmm', (app) =>
    app
      .get('/', ({ query }) => {
        const parsedQuery = expectValid(
          TFMMGetQuerySchema,
          {
            pool: query.pool || undefined,
            action: query.action || undefined,
          },
          'TFMM query parameters',
        )

        const { pool, action } = parsedQuery

        if (pool) {
          const foundPool = getTFMMPool(pool)
          expectExists(foundPool, 'Pool not found')
          return { pool: foundPool }
        }

        if (action === 'strategies') {
          return { strategies: getTFMMStrategies() }
        }

        if (action === 'oracles') {
          return { oracles: getOracleStatus() }
        }

        const stats = getTFMMStats()
        return {
          pools: getAllTFMMPools(),
          ...stats,
        }
      })
      .post('/', async ({ body }) => {
        const validated = expectValid(
          TFMMPostRequestSchema,
          body,
          'TFMM POST request',
        )

        switch (validated.action) {
          case 'create_pool': {
            const result = await createTFMMPool(validated.params)
            return { success: true, ...result }
          }

          case 'update_strategy': {
            const result = await updatePoolStrategy(validated.params)
            return { success: true, ...result }
          }

          case 'trigger_rebalance': {
            const result = await triggerPoolRebalance(validated.params)
            return { success: true, ...result }
          }
        }
      }),
  )

  // Agent card endpoint
  app.get('/.well-known/agent-card.json', () => handleAgentCard())

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
let cachedApp: ReturnType<typeof createBazaarApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: BazaarEnv): ReturnType<typeof createBazaarApp> {
  // Create a simple hash of the env to detect changes
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createBazaarApp(env).compile()
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
    env: BazaarEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

if (isMainModule) {
  const PORT = CORE_PORTS.BAZAAR_API.get()

  const app = createBazaarApp({
    NETWORK:
      (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') || 'localnet',
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getL2RpcUrl(),
    DWS_URL: getCoreAppUrl('DWS_API'),
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getCoreAppUrl('NODE_EXPLORER_UI'),
    COVENANTSQL_NODES: getCQLBlockProducerUrl(),
    COVENANTSQL_DATABASE_ID: process.env.COVENANTSQL_DATABASE_ID || '',
    COVENANTSQL_PRIVATE_KEY: process.env.COVENANTSQL_PRIVATE_KEY || '',
  })

  app.listen(PORT, () => {
    console.log(`Bazaar API Worker running at http://localhost:${PORT}`)
  })
}

export { initializeDatabase, getDatabase }
