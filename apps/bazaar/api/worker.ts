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
  getCurrentNetwork,
  getEnvVar,
  getIndexerGraphqlUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { createTable, getSQLit, type SQLitClient } from '@jejunetwork/db'

import { expect as expectExists, expectValid } from '@jejunetwork/types'
import { getSqlitPrivateKey } from '../lib/secrets'
import { Elysia } from 'elysia'
import {
  A2ARequestSchema,
  TFMMGetQuerySchema,
  TFMMPostRequestSchema,
} from '../schemas/api'
import { handleA2ARequest, handleAgentCard } from './a2a-server'
import { config, configureBazaar } from './config'
import { createIntelRouter } from './intel'
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

/**
 * Worker Environment Types
 *
 * SECURITY NOTE (TEE Side-Channel Resistance):
 * - This worker does NOT handle private keys for signing
 * - All signing is done by clients (via wallet) or KMS
 * - Database credentials (COVENANTSQL_PRIVATE_KEY) are for DB auth, not blockchain
 * - Never add blockchain private keys to this interface
 */
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

  // Database config (SQLIT_PRIVATE_KEY is DB auth, not blockchain key)
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string
  SQLIT_PRIVATE_KEY: string

  // KV bindings (optional)
  BAZAAR_CACHE?: KVNamespace
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

let dbClient: SQLitClient | null = null

function getDatabase(env: BazaarEnv): SQLitClient {
  if (dbClient) return dbClient

  const blockProducerEndpoint =
    env.SQLIT_NODES.split(',')[0] || getSQLitBlockProducerUrl()
  const databaseId = env.SQLIT_DATABASE_ID

  dbClient = getSQLit({
    blockProducerEndpoint,
    databaseId,
    debug: env.NETWORK === 'localnet',
  })

  return dbClient
}

// Database Schemas

async function initializeDatabase(db: SQLitClient): Promise<void> {
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
            'https://jejunetwork.org',
            getCoreAppUrl('BAZAAR'),
          ],
      credentials: true,
    }),
  )

  // Health check (includes TEE info for clients)
  app.get('/health', () => ({
    status: 'ok',
    service: 'bazaar-api',
    teeMode: env?.TEE_MODE ?? 'simulated',
    teePlatform: env?.TEE_PLATFORM ?? 'local',
    teeRegion: env?.TEE_REGION ?? 'local',
    network: env?.NETWORK ?? 'localnet',
  }))

  // TEE Attestation endpoint - allows clients to verify TEE integrity
  app.group('/api/tee', (app) =>
    app
      .get('/attestation', async () => {
        const teeMode = env?.TEE_MODE ?? 'simulated'

        if (teeMode === 'simulated') {
          // In simulated mode, return a mock attestation for testing
          const timestamp = Date.now()
          const mockMeasurement =
            '0x0000000000000000000000000000000000000000000000000000000000000000' as const

          return {
            attestation: {
              quote: `0x${Buffer.from('simulated-quote').toString('hex')}`,
              measurement: mockMeasurement,
              timestamp,
              platform: 'local',
              verified: false,
            },
            mode: 'simulated',
            warning: 'Running in simulated TEE mode - not production safe',
          }
        }

        // In real TEE mode, we would fetch the actual attestation from the TEE provider
        // This requires integration with SGX DCAP or AWS Nitro attestation endpoints
        const platform = env?.TEE_PLATFORM ?? 'unknown'

        // For now, indicate that real attestation needs to be fetched from TEE
        return {
          attestation: null,
          mode: 'real',
          platform,
          message:
            'Real attestation must be fetched from TEE attestation endpoint',
          attestationEndpoint: '/api/tee/quote',
        }
      })
      .get('/info', () => ({
        mode: env?.TEE_MODE ?? 'simulated',
        platform: env?.TEE_PLATFORM ?? 'local',
        region: env?.TEE_REGION ?? 'local',
        attestationAvailable: env?.TEE_MODE === 'real',
      })),
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

  // GraphQL Proxy - proxies indexer requests from browser to avoid CORS issues
  app.post('/api/graphql', async ({ body }) => {
    const indexerUrl = env?.INDEXER_URL || getIndexerGraphqlUrl()

    try {
      const response = await fetch(indexerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      if (response.ok) {
        const data: unknown = await response.json()
        return data
      }

      // Return the error from the indexer
      const errorText = await response.text().catch(() => '')
      console.error(
        `[Bazaar] Indexer error (${indexerUrl}): ${response.status} - ${errorText}`,
      )

      return new Response(
        JSON.stringify({
          errors: [
            {
              message: `Indexer error (${response.status}): ${response.statusText}. ${errorText}`,
            },
          ],
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `[Bazaar] Indexer connection failed (${indexerUrl}): ${message}`,
      )

      return new Response(
        JSON.stringify({
          errors: [
            { message: `Indexer unavailable (${indexerUrl}): ${message}` },
          ],
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  })

  // RPC Proxy - proxies JSON-RPC requests to the L2 RPC endpoint from browser
  app.post('/api/rpc', async ({ body }) => {
    const rpcUrl = env?.RPC_URL || getL2RpcUrl()
    const requestId = (body as { id?: number }).id || 1

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        console.warn(
          `[Bazaar] RPC proxy error: ${response.status} ${response.statusText}`,
        )
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: -32603,
              message: `RPC error: ${response.status} ${response.statusText}`,
            },
          }),
          {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      const data = await response.json()
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Bazaar] RPC proxy fetch failed: ${message}`)
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32603,
            message: `RPC unavailable: ${message}`,
          },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  })

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

  // Intel API - AI-powered market intelligence
  app.group('/api', (apiGroup) => apiGroup.use(createIntelRouter()))

  // User API - referrals, preferences, portfolio
  app.group('/api/users', (usersGroup) =>
    usersGroup
      .get('/:address/referrals', async ({ params }) => {
        const { address } = params
        if (!address || address.length < 10) {
          return new Response(JSON.stringify({ error: 'Invalid address' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Generate deterministic referral code from address
        const referralCode = address.slice(2, 10).toLowerCase()

        // In production, this would query the database for actual referral stats
        // For now, we track via indexer events or SQLit database
        try {
          if (env?.SQLIT_DATABASE_ID) {
            const db = getDatabase(env as BazaarEnv)

            // Create referrals table if not exists
            await db.exec(`
              CREATE TABLE IF NOT EXISTS referrals (
                id TEXT PRIMARY KEY,
                referrer TEXT NOT NULL,
                referee TEXT NOT NULL,
                points_earned INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              )
            `)
            await db.exec(
              'CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer)',
            )

            // Count referrals for this address
            const result = await db.query<{
              count: number
              total_points: number
            }>(
              'SELECT COUNT(*) as count, COALESCE(SUM(points_earned), 0) as total_points FROM referrals WHERE referrer = ?',
              [address.toLowerCase()],
            )

            const stats = result.rows[0]
            return {
              totalReferrals: stats?.count ?? 0,
              totalPointsEarned: stats?.total_points ?? 0,
              referralCode,
            }
          }
        } catch (dbError) {
          console.warn('[Bazaar] Database query failed for referrals:', dbError)
        }

        // Fallback: return code with zero stats if DB is not available
        return {
          totalReferrals: 0,
          totalPointsEarned: 0,
          referralCode,
        }
      })
      .post('/:address/referrals/claim', async ({ params, body }) => {
        const { address } = params
        const { referralCode } = body as { referralCode?: string }

        if (!address || !referralCode) {
          return new Response(
            JSON.stringify({ error: 'Address and referral code required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Validate referral code format (first 8 chars of address, lowercase)
        if (referralCode.length !== 8) {
          return new Response(
            JSON.stringify({ error: 'Invalid referral code format' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Reconstruct referrer address prefix (we only have first 8 chars)
        const referrerPrefix = `0x${referralCode}`

        try {
          if (env?.SQLIT_DATABASE_ID) {
            const db = getDatabase(env as BazaarEnv)

            // Check if this user already claimed a referral
            const existing = await db.query<{ id: string }>(
              'SELECT id FROM referrals WHERE referee = ?',
              [address.toLowerCase()],
            )

            if (existing.rows.length > 0) {
              return new Response(
                JSON.stringify({ error: 'Already claimed a referral' }),
                {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                },
              )
            }

            // Record the referral (we store the code prefix as referrer since we don't have full address)
            const id = `${referrerPrefix}-${address.slice(0, 10)}-${Date.now()}`
            await db.exec(
              `INSERT INTO referrals (id, referrer, referee, points_earned) VALUES (?, ?, ?, ?)`,
              [id, referrerPrefix.toLowerCase(), address.toLowerCase(), 100],
            )

            return { success: true, pointsEarned: 100 }
          }
        } catch (dbError) {
          console.warn('[Bazaar] Database insert failed for referral:', dbError)
        }

        return new Response(
          JSON.stringify({ error: 'Referral system temporarily unavailable' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        )
      })
      .get('/:address/preferences', async ({ params }) => {
        const { address } = params

        try {
          if (env?.SQLIT_DATABASE_ID) {
            const db = getDatabase(env as BazaarEnv)
            const result = await db.query<{ preferences: string }>(
              'SELECT preferences FROM user_preferences WHERE address = ?',
              [address.toLowerCase()],
            )

            if (result.rows[0]) {
              return JSON.parse(result.rows[0].preferences)
            }
          }
        } catch (dbError) {
          console.warn('[Bazaar] Failed to fetch preferences:', dbError)
        }

        // Return default preferences
        return {
          theme: 'system',
          notifications: true,
          slippage: 0.5,
          defaultChain: 420691,
        }
      })
      .post('/:address/preferences', async ({ params, body }) => {
        const { address } = params

        try {
          if (env?.SQLIT_DATABASE_ID) {
            const db = getDatabase(env as BazaarEnv)
            await db.exec(
              `INSERT INTO user_preferences (address, preferences, updated_at) 
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(address) DO UPDATE SET preferences = ?, updated_at = CURRENT_TIMESTAMP`,
              [
                address.toLowerCase(),
                JSON.stringify(body),
                JSON.stringify(body),
              ],
            )
            return { success: true }
          }
        } catch (dbError) {
          console.warn('[Bazaar] Failed to save preferences:', dbError)
        }

        return new Response(
          JSON.stringify({ error: 'Failed to save preferences' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        )
      }),
  )

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
  // Initialize config - secrets retrieved through secrets module
  configureBazaar({
    bazaarApiUrl: getEnvVar('BAZAAR_API_URL'),
    farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL'),
    sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID'),
    // SQLit private key retrieved through secrets module (not raw env var)
    sqlitPrivateKey: getSqlitPrivateKey(),
  })

  const PORT = CORE_PORTS.BAZAAR_API.get()

  const app = createBazaarApp({
    NETWORK: getCurrentNetwork(),
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getL2RpcUrl(),
    DWS_URL: getCoreAppUrl('DWS_API'),
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getIndexerGraphqlUrl(),
    SQLIT_NODES: getSQLitBlockProducerUrl(),
    SQLIT_DATABASE_ID: config.sqlitDatabaseId,
    SQLIT_PRIVATE_KEY: config.sqlitPrivateKey || '',
  })

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(`Bazaar API Worker running at http://${host}:${PORT}`)
  })
}

export { initializeDatabase, getDatabase }
