/**
 * Autocrat API Worker
 *
 * DWS-deployable worker using Elysia with workerd compatibility.
 * Compatible with workerd runtime and DWS infrastructure.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getIndexerGraphqlUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bugBountyRoutes } from './routes/bug-bounty'
import { casualRoutes } from './routes/casual'
import { daoRoutes, directorRoutes } from './routes/dao'
import { feesRoutes } from './routes/fees'
import { fundingRoutes } from './routes/funding'
import { futarchyRoutes } from './routes/futarchy'
import { mcpRoutes } from './routes/mcp'
import { moderationRoutes } from './routes/moderation'
import { orchestratorRoutes } from './routes/orchestrator'
import { proposalsRoutes } from './routes/proposals'
import { registryRoutes } from './routes/registry'
import { researchRoutes } from './routes/research'
import { rlaifRoutes } from './routes/rlaif'
import { triggersRoutes } from './routes/triggers'
import { securityMiddleware } from './security'
import { getTEEMode } from './tee'

/**
 * Worker Environment Types
 *
 * SECURITY NOTE (TEE Side-Channel Resistance):
 * - This worker does NOT handle private keys for signing
 * - All signing is done by clients (via wallet) or KMS
 * - Database credentials are for DB auth, not blockchain
 * - Never add blockchain private keys to this interface
 */
export interface AutocratEnv {
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
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string
  SQLIT_PRIVATE_KEY: string

  // KV bindings (optional)
  AUTOCRAT_CACHE?: KVNamespace
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

/**
 * Create the Autocrat Elysia app
 */
export function createAutocratApp(env?: Partial<AutocratEnv>) {
  const isDev = env?.NETWORK === 'localnet'
  const network = env?.NETWORK ?? getCurrentNetwork()

  const app = new Elysia().use(
    cors({
      origin: isDev
        ? true
        : [
            'https://autocrat.jejunetwork.org',
            'https://autocrat.testnet.jejunetwork.org',
            'https://jejunetwork.org',
            getCoreAppUrl('AUTOCRAT_API'),
          ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true,
    }),
  )

  // Security middleware
  app.use(securityMiddleware)

  // Health check (includes TEE info for clients)
  app.get('/health', () => ({
    status: 'ok',
    service: 'autocrat-api',
    version: '3.0.0',
    teeMode: env?.TEE_MODE ?? 'simulated',
    teePlatform: env?.TEE_PLATFORM ?? 'local',
    teeRegion: env?.TEE_REGION ?? 'local',
    network,
    mode: 'multi-tenant',
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      rest: '/api/v1',
      dao: '/api/v1/dao',
      agents: '/api/v1/agents',
      futarchy: '/api/v1/futarchy',
      moderation: '/api/v1/moderation',
      registry: '/api/v1/registry',
    },
  }))

  // TEE Attestation endpoint
  app.group('/api/tee', (app) =>
    app
      .get('/attestation', async () => {
        const teeMode = env?.TEE_MODE ?? 'simulated'

        if (teeMode === 'simulated') {
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

        const platform = env?.TEE_PLATFORM ?? 'unknown'
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

      const errorText = await response.text().catch(() => '')
      console.error(
        `[Autocrat] Indexer error (${indexerUrl}): ${response.status} - ${errorText}`,
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
        `[Autocrat] Indexer connection failed (${indexerUrl}): ${message}`,
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
          `[Autocrat] RPC proxy error: ${response.status} ${response.statusText}`,
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
      console.warn(`[Autocrat] RPC proxy fetch failed: ${message}`)
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

  // Mount all routes
  app.use(proposalsRoutes)
  app.use(daoRoutes)
  app.use(directorRoutes)
  app.use(futarchyRoutes)
  app.use(agentsRoutes)
  app.use(moderationRoutes)
  app.use(researchRoutes)
  app.use(registryRoutes)
  app.use(orchestratorRoutes)
  app.use(triggersRoutes)
  app.use(casualRoutes)
  app.use(fundingRoutes)
  app.use(feesRoutes)
  app.use(a2aRoutes)
  app.use(mcpRoutes)
  app.use(rlaifRoutes)
  app.use(bugBountyRoutes)

  // Root route - API info
  app.get('/', () => ({
    name: 'Autocrat API',
    version: '3.0.0',
    description:
      'Multi-tenant DAO governance with AI Directors and deep funding',
    runtime: 'workerd',
    network,
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      rest: '/api/v1',
      dao: '/api/v1/dao',
      orchestrator: '/api/v1/orchestrator',
      proposals: '/api/v1/proposals',
      casual: '/api/v1/dao/:daoId/casual',
      funding: '/api/v1/dao/:daoId/funding',
      fees: '/fees',
      research: '/api/v1/research',
      agents: '/api/v1/agents',
      futarchy: '/api/v1/futarchy',
      moderation: '/api/v1/moderation',
      registry: '/api/v1/registry',
      director: '/api/v1/agents/director',
      bugBounty: '/api/v1/bug-bounty',
      rlaif: '/rlaif',
      health: '/health',
    },
  }))

  // Agent card endpoint
  app.get('/.well-known/agent-card.json', () => ({
    name: 'Autocrat',
    description:
      'AI-powered autonomous governance with futarchy and multi-agent decision making',
    version: '3.0.0',
    skills: [
      {
        id: 'list-daos',
        name: 'List DAOs',
        description: 'List all registered DAOs',
      },
      {
        id: 'get-dao',
        name: 'Get DAO',
        description: 'Get details about a specific DAO',
      },
      {
        id: 'list-proposals',
        name: 'List Proposals',
        description: 'List proposals for a DAO',
      },
      {
        id: 'create-proposal',
        name: 'Create Proposal',
        description: 'Submit a new proposal',
      },
      { id: 'vote', name: 'Vote', description: 'Cast a vote on a proposal' },
    ],
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
    },
  }))

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
let cachedApp: ReturnType<typeof createAutocratApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: AutocratEnv): ReturnType<typeof createAutocratApp> {
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createAutocratApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Default export for workerd/Cloudflare Workers
 */
export default {
  async fetch(
    request: Request,
    env: AutocratEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

if (isMainModule) {
  const PORT = CORE_PORTS.AUTOCRAT_API.get()
  const network = getCurrentNetwork()

  const app = createAutocratApp({
    NETWORK: network,
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getL2RpcUrl(),
    DWS_URL: getCoreAppUrl('DWS_API'),
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getIndexerGraphqlUrl(),
    SQLIT_NODES: getSQLitBlockProducerUrl(),
    SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID || '',
    SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY || '',
  })

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(`[Autocrat] Worker running at http://${host}:${PORT}`)
    console.log(`[Autocrat] TEE: ${getTEEMode()} | Network: ${network}`)
  })
}
