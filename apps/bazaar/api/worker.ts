/**
 * Bazaar API Worker
 *
 * DWS-deployable worker using Elysia, compatible with workerd runtime.
 * Can run standalone or as a serverless worker in DWS infrastructure.
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getL2RpcUrl,
} from '@jejunetwork/config/ports'
import {
  type ConsistencyLevel,
  type CovenantSQLClient,
  createCovenantSQLClient,
} from '@jejunetwork/shared'
import { AddressSchema } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { handleA2ARequest, handleAgentCard } from '../lib/a2a-server'
import {
  ClaimRequestSchema,
  claimFromFaucet,
  FaucetClaimResultSchema,
  FaucetInfoSchema,
  FaucetStatusSchema,
  getFaucetInfo,
  getFaucetStatus,
} from '../lib/faucet'
import { handleMCPInfo, handleMCPRequest } from '../lib/mcp-server'
import {
  createTFMMPool,
  getAllTFMMPools,
  getOracleStatus,
  getTFMMPool,
  getTFMMStats,
  getTFMMStrategies,
  triggerPoolRebalance,
  updatePoolStrategy,
} from '../lib/tfmm/utils'
import { expectExists, expectValid } from '../lib/validation'
import {
  A2ARequestSchema,
  type TFMMCreatePoolParams,
  TFMMGetQuerySchema,
  TFMMPostRequestSchema,
  type TFMMTriggerRebalanceParams,
  type TFMMUpdateStrategyParams,
} from '../schemas/api'

// ============================================================================
// Worker Environment Types
// ============================================================================

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

// ============================================================================
// Database Layer
// ============================================================================

// CovenantSQL port - not yet in centralized config (@jejunetwork/config/ports)
const COVENANTSQL_DEFAULT_PORT = 4661

let dbClient: CovenantSQLClient | null = null

function getDatabase(env: BazaarEnv): CovenantSQLClient {
  if (dbClient) return dbClient

  const nodes = env.COVENANTSQL_NODES?.split(',') || [
    `http://localhost:${COVENANTSQL_DEFAULT_PORT}`,
  ]
  const databaseId = env.COVENANTSQL_DATABASE_ID
  const privateKey = env.COVENANTSQL_PRIVATE_KEY

  if (!databaseId || !privateKey) {
    throw new Error('CovenantSQL configuration required')
  }

  dbClient = createCovenantSQLClient({
    nodes,
    databaseId,
    privateKey,
    defaultConsistency: 'strong' as ConsistencyLevel,
    poolSize: 5,
    queryTimeout: 10000,
    retryAttempts: 2,
    logging: env.NETWORK === 'localnet',
  })

  return dbClient
}

// ============================================================================
// Database Schemas
// ============================================================================

async function initializeDatabase(db: CovenantSQLClient): Promise<void> {
  // Faucet claims table
  await db.createTable({
    name: 'faucet_claims',
    columns: [
      { name: 'id', type: 'TEXT', nullable: false },
      { name: 'address', type: 'TEXT', nullable: false },
      { name: 'amount', type: 'TEXT', nullable: false },
      { name: 'tx_hash', type: 'TEXT', nullable: true },
      { name: 'claimed_at', type: 'TIMESTAMP', nullable: false },
      { name: 'ip_hash', type: 'TEXT', nullable: true },
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_faucet_address', columns: ['address'] },
      { name: 'idx_faucet_claimed_at', columns: ['claimed_at'] },
    ],
  })

  // Market cache table
  await db.createTable({
    name: 'market_cache',
    columns: [
      { name: 'key', type: 'TEXT', nullable: false },
      { name: 'value', type: 'JSON', nullable: false },
      { name: 'expires_at', type: 'TIMESTAMP', nullable: false },
      { name: 'updated_at', type: 'TIMESTAMP', nullable: false },
    ],
    primaryKey: ['key'],
    indexes: [{ name: 'idx_cache_expires', columns: ['expires_at'] }],
  })

  // User preferences table
  await db.createTable({
    name: 'user_preferences',
    columns: [
      { name: 'address', type: 'TEXT', nullable: false },
      { name: 'preferences', type: 'JSON', nullable: false },
      { name: 'updated_at', type: 'TIMESTAMP', nullable: false },
    ],
    primaryKey: ['address'],
  })
}

// ============================================================================
// Create Elysia App
// ============================================================================

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
    teeMode: env?.TEE_MODE || 'simulated',
    network: env?.NETWORK || 'localnet',
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
        const endpoint = pathParts.slice(2).join('/') || 'initialize'
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
        const { action, params } = expectValid(
          TFMMPostRequestSchema,
          body,
          'TFMM POST request',
        )

        switch (action) {
          case 'create_pool': {
            const result = await createTFMMPool(params as TFMMCreatePoolParams)
            return { success: true, ...result }
          }

          case 'update_strategy': {
            const result = await updatePoolStrategy(
              params as TFMMUpdateStrategyParams,
            )
            return { success: true, ...result }
          }

          case 'trigger_rebalance': {
            const result = await triggerPoolRebalance(
              params as TFMMTriggerRebalanceParams,
            )
            return { success: true, ...result }
          }

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      }),
  )

  // Agent card endpoint
  app.get('/.well-known/agent-card.json', () => handleAgentCard())

  return app
}

// ============================================================================
// Worker Export (for DWS/workerd)
// ============================================================================

export default {
  async fetch(
    request: Request,
    env: BazaarEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = createBazaarApp(env)
    return app.handle(request)
  },
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

// ============================================================================
// Standalone Server (for local dev)
// ============================================================================

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

if (isMainModule) {
  const PORT = Number(process.env.API_PORT) || CORE_PORTS.COMPUTE.get()

  const app = createBazaarApp({
    NETWORK:
      (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') || 'localnet',
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: process.env.RPC_URL || getL2RpcUrl(),
    DWS_URL: process.env.DWS_URL || getCoreAppUrl('DWS_API'),
    GATEWAY_URL: process.env.GATEWAY_URL || getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: process.env.INDEXER_URL || getCoreAppUrl('NODE_EXPLORER_UI'),
    COVENANTSQL_NODES:
      process.env.COVENANTSQL_NODES ||
      `http://localhost:${COVENANTSQL_DEFAULT_PORT}`,
    COVENANTSQL_DATABASE_ID: process.env.COVENANTSQL_DATABASE_ID || '',
    COVENANTSQL_PRIVATE_KEY: process.env.COVENANTSQL_PRIVATE_KEY || '',
  })

  app.listen(PORT, () => {
    console.log(`Bazaar API Worker running at http://localhost:${PORT}`)
  })
}

export { initializeDatabase, getDatabase }
