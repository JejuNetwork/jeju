/**
 * Bazaar API Server
 *
 * Standalone API server using Elysia - handles API routes while
 * Bun's native HTML bundler serves the frontend
 */

import { cors } from '@elysiajs/cors'
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

const PORT = Number(process.env.API_PORT) || 4007
const isDev = process.env.NODE_ENV !== 'production'

const app = new Elysia().use(
  cors({
    origin: isDev
      ? true
      : [
          'https://bazaar.jejunetwork.org',
          'https://jeju.network',
          'http://localhost:4006',
        ],
    credentials: true,
  }),
)

// Health check
app.get('/health', () => ({ status: 'ok', service: 'bazaar-api' }))

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

// Start server
app.listen(PORT, () => {
  console.log(`🔌 Bazaar API running at http://localhost:${PORT}`)
})

export type App = typeof app
