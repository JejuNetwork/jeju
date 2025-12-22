/**
 * MEV Bot API Server
 *
 * Provides REST, A2A, and MCP APIs for the MEV + LP Bot:
 * - REST API for basic operations and monitoring
 * - A2A (Agent-to-Agent) protocol for autonomous agent communication
 * - MCP (Model Context Protocol) for LLM integration
 *
 * Endpoints:
 * - GET /health - Health check
 * - GET /stats - Bot statistics
 * - GET /opportunities - Current arbitrage opportunities
 * - GET /positions - Liquidity positions
 * - GET /pools - Pool recommendations
 * - GET /rebalance - Pending rebalance actions
 * - POST /rebalance/:actionId - Execute rebalance action
 * - POST /liquidity/add - Add liquidity
 * - POST /liquidity/remove - Remove liquidity
 * - GET /quotes/:inputMint/:outputMint/:amount - Get Solana swap quotes
 * - POST /swap - Execute swap
 * - GET /trades - Trade history
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  AddLiquidityRequestSchema,
  BotA2ARequestSchema,
  expect,
  JsonObjectSchema,
  parseOrThrow,
  QuotesParamsSchema,
  RebalanceActionIdParamSchema,
  SwapRequestSchema,
  YieldVerifyParamSchema,
} from '../schemas'
import type { ChainId } from './autocrat-types-source'
import { MevBot, type MevBotConfig } from './mev-bot'

// ============ Security Configuration ============

// Rate limiting configuration
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = parseInt(
  process.env.BOT_RATE_LIMIT_MAX_REQUESTS ?? '100',
  10,
)

// CORS configuration - restrict to allowed origins
const ALLOWED_ORIGINS = (
  process.env.BOT_CORS_ALLOWED_ORIGINS ??
  process.env.CORS_ALLOWED_ORIGINS ??
  'http://localhost:3000,http://localhost:4000'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// API key for authenticated endpoints
const BOT_API_KEY = process.env.BOT_API_KEY ?? process.env.API_KEY
const REQUIRE_AUTH =
  process.env.BOT_REQUIRE_AUTH === 'true' || process.env.REQUIRE_AUTH === 'true'

// Get network from env
const NETWORK = process.env.NETWORK ?? 'localnet'

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are identical.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid timing leak on length check
    let xor = 0
    for (let i = 0; i < a.length; i++) {
      xor |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0)
    }
    return xor === 0 && false // Always false for length mismatch, but use xor to prevent optimization
  }
  let xor = 0
  for (let i = 0; i < a.length; i++) {
    xor |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return xor === 0
}

// ============ Types ============

interface APIConfig {
  restPort: number
  a2aPort: number
  mcpPort: number
  bot: MevBot
}

interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: string[]
  endpoints: {
    a2a: string
    mcp: string
    rest: string
  }
}

interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

interface MCPResource {
  uri: string
  name: string
  description: string
  mimeType: string
}

// ============ REST API ============

function createRestAPI(bot: MevBot): Elysia {
  const app = new Elysia()

  // CORS - restrict to configured origins in production
  // SECURITY: Wildcard '*' is ONLY honored in localnet to prevent misconfiguration
  app.use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        // In development (localnet), allow all origins
        if (NETWORK === 'localnet') return true
        // In production/testnet, NEVER allow wildcard - explicit origins only
        if (!origin) return false
        if (ALLOWED_ORIGINS.includes(origin)) return true
        return false
      },
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Wallet-Address',
      ],
      maxAge: 86400,
    }),
  )

  // Rate limiting middleware with atomic increment pattern
  app.onBeforeHandle(({ request, set }): { error: string } | undefined => {
    const url = new URL(request.url)
    const path = url.pathname

    // Skip rate limiting for health check
    if (path === '/health') return undefined

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown'
    const key = `rest:${clientIp}`

    const now = Date.now()
    let record = rateLimitStore.get(key)

    // Clean up old entries periodically
    if (rateLimitStore.size > 10000) {
      const keysToDelete: string[] = []
      for (const [k, v] of rateLimitStore) {
        if (v.resetAt < now) keysToDelete.push(k)
        if (keysToDelete.length >= 5000) break
      }
      for (const k of keysToDelete) {
        rateLimitStore.delete(k)
      }
    }

    if (!record || record.resetAt < now) {
      record = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
      rateLimitStore.set(key, record)
    } else {
      record.count++
      if (record.count > RATE_LIMIT_MAX_REQUESTS) {
        set.status = 429
        return { error: 'Rate limit exceeded' }
      }
    }
    return undefined
  })

  // API Key authentication middleware (when enabled)
  app.onBeforeHandle(({ request, set }): { error: string } | undefined => {
    const url = new URL(request.url)
    const path = url.pathname

    // Skip auth for health check
    if (path === '/health') return undefined

    // Skip auth if not required
    if (!REQUIRE_AUTH || !BOT_API_KEY) return undefined

    const providedKey =
      request.headers.get('x-api-key') ??
      request.headers.get('authorization')?.replace('Bearer ', '')

    if (!providedKey || !constantTimeCompare(providedKey, BOT_API_KEY)) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    return undefined
  })

  // Health check
  app.get('/health', () => ({
    status: 'ok',
    service: 'unified-bot',
    timestamp: Date.now(),
  }))

  // Bot statistics
  app.get('/stats', () => bot.getStats())

  // Current opportunities
  app.get('/opportunities', () => bot.getOpportunities())

  // Liquidity positions
  app.get('/positions', () => bot.getLiquidityPositions())

  // Pool recommendations
  app.get('/pools', async ({ query }) => {
    const minTvlStr = query.minTvl
    const minAprStr = query.minApr
    const minTvl = minTvlStr
      ? parseOrThrow(
          z.number().min(0),
          parseFloat(minTvlStr),
          'minTvl query parameter',
        )
      : undefined
    const minApr = minAprStr
      ? parseOrThrow(
          z.number().min(0).max(10000),
          parseFloat(minAprStr),
          'minApr query parameter',
        )
      : undefined

    return await bot.getPoolRecommendations({ minTvl, minApr })
  })

  // Pending rebalance actions
  app.get('/rebalance', async () => await bot.getRebalanceActions())

  // Execute rebalance action
  app.post('/rebalance/:actionId', async ({ params }) => {
    const parsedParams = parseOrThrow(
      RebalanceActionIdParamSchema,
      params,
      'Action ID parameter',
    )
    const actions = await bot.getRebalanceActions()
    const action = expect(
      actions.find((a) => a.positionId === parsedParams.actionId),
      `Action not found: ${parsedParams.actionId}`,
    )

    return await bot.executeRebalance(action)
  })

  // ============ Yield Farming Endpoints ============

  // Yield farming opportunities (ranked by risk-adjusted return)
  app.get('/yield', ({ query }) => {
    const limitStr = query.limit
    const limit = limitStr
      ? parseOrThrow(
          z.number().int().min(1).max(100),
          parseInt(limitStr, 10),
          'Limit query parameter',
        )
      : 20
    return bot.getYieldOpportunities(limit)
  })

  // Yield farming stats
  app.get('/yield/stats', () => {
    const stats = bot.getYieldStats()
    return stats ?? { error: 'Yield farming not enabled' }
  })

  // Verify yield for an opportunity (on-chain verification)
  app.get('/yield/verify/:id', async ({ params }) => {
    const parsedParams = parseOrThrow(
      YieldVerifyParamSchema,
      params,
      'Yield verify parameter',
    )
    return await bot.verifyYield(parsedParams.id)
  })

  // Add liquidity
  app.post('/liquidity/add', async ({ body }) => {
    const rawBody = body as Record<string, unknown>
    const parsedBody = parseOrThrow(
      AddLiquidityRequestSchema,
      rawBody,
      'Add liquidity request',
    )
    return await bot.addLiquidity({
      chain: parsedBody.chain as 'evm' | 'solana',
      dex: parsedBody.dex,
      poolId: parsedBody.poolId,
      amountA: parsedBody.amountA,
      amountB: parsedBody.amountB,
    })
  })

  // Remove liquidity (simplified - would need position ID and percent)
  app.post('/liquidity/remove', () => ({
    success: false,
    error: 'Not implemented',
  }))

  // Get Solana swap quotes
  app.get('/quotes/:inputMint/:outputMint/:amount', async ({ params }) => {
    const parsedParams = parseOrThrow(
      QuotesParamsSchema,
      params,
      'Quotes parameters',
    )
    return await bot.getSolanaQuotes(
      parsedParams.inputMint,
      parsedParams.outputMint,
      parsedParams.amount,
    )
  })

  // Execute swap
  app.post('/swap', async ({ body }) => {
    const rawBody = body as Record<string, unknown>
    const parsedBody = parseOrThrow(SwapRequestSchema, rawBody, 'Swap request')
    return await bot.executeSolanaSwap(
      parsedBody.inputMint,
      parsedBody.outputMint,
      parsedBody.amount,
    )
  })

  // Trade history
  app.get('/trades', ({ query }) => {
    const limitStr = query.limit
    const limit = limitStr
      ? parseOrThrow(
          z.number().int().min(1).max(1000),
          parseInt(limitStr, 10),
          'Limit query parameter',
        )
      : 100
    return bot.getTradeHistory(limit)
  })

  // Bot control
  app.post('/start', async () => {
    await bot.start()
    return { success: true, message: 'Bot started' }
  })

  app.post('/stop', async () => {
    await bot.stop()
    return { success: true, message: 'Bot stopped' }
  })

  return app
}

// ============ A2A API ============

function createA2AAPI(bot: MevBot, config: APIConfig): Elysia {
  const app = new Elysia()

  // CORS - restrict to configured origins in production
  app.use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        if (NETWORK === 'localnet') return true
        if (!origin) return false
        if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))
          return true
        return false
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      maxAge: 86400,
    }),
  )

  // Rate limiting for A2A
  app.onBeforeHandle(
    ({
      request,
      set,
    }): { error: { code: number; message: string } } | undefined => {
      const url = new URL(request.url)
      const path = url.pathname
      if (path === '/' || path.startsWith('/.well-known')) return undefined

      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        'unknown'
      const key = `a2a:${clientIp}`

      const now = Date.now()
      const record = rateLimitStore.get(key)

      if (!record || record.resetAt < now) {
        rateLimitStore.set(key, {
          count: 1,
          resetAt: now + RATE_LIMIT_WINDOW_MS,
        })
        return undefined
      }

      if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
        set.status = 429
        return { error: { code: -32603, message: 'Rate limit exceeded' } }
      }

      record.count++
      return undefined
    },
  )

  // Agent card
  const agentCard: AgentCard = {
    name: 'unified-mev-lp-bot',
    description:
      'Cross-chain MEV and liquidity management bot supporting EVM and Solana',
    url: `http://localhost:${config.a2aPort}`,
    version: '1.0.0',
    capabilities: [
      'arbitrage-detection',
      'cross-chain-arbitrage',
      'solana-arbitrage',
      'liquidity-management',
      'pool-analysis',
      'swap-execution',
    ],
    endpoints: {
      a2a: `http://localhost:${config.a2aPort}`,
      mcp: `http://localhost:${config.mcpPort}`,
      rest: `http://localhost:${config.restPort}`,
    },
  }

  // Well-known agent card
  app.get('/.well-known/agent-card.json', () => agentCard)

  // Root info
  app.get('/', () => ({
    service: 'unified-bot-a2a',
    version: '1.0.0',
    agentCard: '/.well-known/agent-card.json',
  }))

  // A2A request handler
  app.post('/a2a', async ({ body, set }) => {
    const rawBody = body as Record<string, unknown>
    const parsedBody = parseOrThrow(BotA2ARequestSchema, rawBody, 'A2A request')
    const { method, params } = parsedBody

    switch (method) {
      case 'getStats':
        return { result: bot.getStats() }

      case 'getOpportunities':
        return { result: bot.getOpportunities() }

      case 'getPositions':
        return { result: bot.getLiquidityPositions() }

      case 'getPools': {
        const poolParams = params
          ? parseOrThrow(
              z
                .object({
                  minTvl: z.number().min(0).optional(),
                  minApr: z.number().min(0).max(10000).optional(),
                })
                .strict(),
              params,
              'Get pools params',
            )
          : undefined
        const pools = await bot.getPoolRecommendations(poolParams)
        return { result: pools }
      }

      case 'getRebalanceActions': {
        const actions = await bot.getRebalanceActions()
        return { result: actions }
      }

      case 'executeRebalance': {
        const rebalanceParams = parseOrThrow(
          z.object({
            positionId: z.string().min(1, 'Position ID is required'),
          }),
          params,
          'Rebalance params',
        )
        const rebalanceActions = await bot.getRebalanceActions()
        const action = expect(
          rebalanceActions.find(
            (a) => a.positionId === rebalanceParams.positionId,
          ),
          `Action not found: ${rebalanceParams.positionId}`,
        )
        const result = await bot.executeRebalance(action)
        return { result }
      }

      case 'getQuotes': {
        const quotesParams = parseOrThrow(
          QuotesParamsSchema,
          params,
          'Get quotes params',
        )
        const quotes = await bot.getSolanaQuotes(
          quotesParams.inputMint,
          quotesParams.outputMint,
          quotesParams.amount,
        )
        return { result: quotes }
      }

      case 'executeSwap': {
        const swapParams = parseOrThrow(
          SwapRequestSchema,
          params,
          'Execute swap params',
        )
        const swapResult = await bot.executeSolanaSwap(
          swapParams.inputMint,
          swapParams.outputMint,
          swapParams.amount,
        )
        return { result: swapResult }
      }

      default:
        set.status = 404
        return { error: { code: -32601, message: 'Method not found' } }
    }
  })

  return app
}

// ============ MCP API ============

function createMCPAPI(bot: MevBot): Elysia {
  const app = new Elysia()

  // CORS - restrict to configured origins in production
  app.use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        if (NETWORK === 'localnet') return true
        if (!origin) return false
        if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))
          return true
        return false
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      maxAge: 86400,
    }),
  )

  // Rate limiting for MCP
  app.onBeforeHandle(({ request, set }): { error: string } | undefined => {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/') return undefined

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const key = `mcp:${clientIp}`

    const now = Date.now()
    const record = rateLimitStore.get(key)

    if (!record || record.resetAt < now) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      })
      return undefined
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    record.count++
    return undefined
  })

  const tools: MCPTool[] = [
    {
      name: 'get_bot_stats',
      description:
        'Get current bot statistics including profit, trades, and uptime',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_opportunities',
      description: 'Get current arbitrage opportunities across all chains',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_positions',
      description: 'Get all liquidity positions across EVM and Solana',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_pool_recommendations',
      description: 'Get pool recommendations for liquidity provision',
      inputSchema: {
        type: 'object',
        properties: {
          minTvl: { type: 'number', description: 'Minimum TVL in USD' },
          minApr: { type: 'number', description: 'Minimum APR percentage' },
        },
      },
    },
    {
      name: 'get_rebalance_actions',
      description: 'Get pending rebalance actions for liquidity optimization',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'execute_rebalance',
      description: 'Execute a specific rebalance action',
      inputSchema: {
        type: 'object',
        properties: {
          positionId: {
            type: 'string',
            description: 'Position ID to rebalance',
          },
        },
        required: ['positionId'],
      },
    },
    {
      name: 'get_swap_quotes',
      description: 'Get swap quotes from Solana DEXs',
      inputSchema: {
        type: 'object',
        properties: {
          inputMint: {
            type: 'string',
            description: 'Input token mint address',
          },
          outputMint: {
            type: 'string',
            description: 'Output token mint address',
          },
          amount: { type: 'string', description: 'Amount in base units' },
        },
        required: ['inputMint', 'outputMint', 'amount'],
      },
    },
    {
      name: 'execute_swap',
      description: 'Execute a swap on Solana',
      inputSchema: {
        type: 'object',
        properties: {
          inputMint: {
            type: 'string',
            description: 'Input token mint address',
          },
          outputMint: {
            type: 'string',
            description: 'Output token mint address',
          },
          amount: { type: 'string', description: 'Amount in base units' },
        },
        required: ['inputMint', 'outputMint', 'amount'],
      },
    },
    {
      name: 'get_yield_opportunities',
      description:
        'Get ranked yield farming opportunities (permissionless strategies only)',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of opportunities' },
        },
      },
    },
    {
      name: 'get_yield_stats',
      description: 'Get yield farming stats summary',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'verify_yield',
      description:
        'Verify a yield opportunity with permissionless data sources',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Opportunity id' },
        },
        required: ['id'],
      },
    },
    {
      name: 'add_liquidity',
      description: 'Add liquidity to a pool',
      inputSchema: {
        type: 'object',
        properties: {
          chain: { type: 'string', description: 'Chain (evm or solana)' },
          dex: { type: 'string', description: 'DEX name' },
          poolId: { type: 'string', description: 'Pool ID' },
          amountA: { type: 'string', description: 'Amount of token A' },
          amountB: { type: 'string', description: 'Amount of token B' },
        },
        required: ['chain', 'dex', 'poolId', 'amountA', 'amountB'],
      },
    },
    {
      name: 'get_trade_history',
      description: 'Get recent trade history',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of trades to return',
          },
        },
      },
    },
  ]

  const resources: MCPResource[] = [
    {
      uri: 'bot://stats',
      name: 'Bot Statistics',
      description: 'Current bot statistics',
      mimeType: 'application/json',
    },
    {
      uri: 'bot://opportunities',
      name: 'Opportunities',
      description: 'Current arbitrage opportunities',
      mimeType: 'application/json',
    },
    {
      uri: 'bot://positions',
      name: 'Positions',
      description: 'Liquidity positions',
      mimeType: 'application/json',
    },
    {
      uri: 'bot://pools',
      name: 'Pool Recommendations',
      description: 'Recommended pools for LP',
      mimeType: 'application/json',
    },
    {
      uri: 'bot://trades',
      name: 'Trade History',
      description: 'Recent trade history',
      mimeType: 'application/json',
    },
  ]

  // Root info
  app.get('/', () => ({
    server: 'unified-bot-mcp',
    version: '1.0.0',
    description: 'Cross-chain MEV and liquidity management bot',
    tools,
    resources,
    prompts: [
      {
        name: 'analyze_portfolio',
        description: 'Analyze the current portfolio and suggest optimizations',
        arguments: [],
      },
      {
        name: 'find_best_pool',
        description: 'Find the best pool for a given token pair',
        arguments: [
          {
            name: 'tokenA',
            description: 'First token symbol',
            required: true,
          },
          {
            name: 'tokenB',
            description: 'Second token symbol',
            required: true,
          },
        ],
      },
    ],
    capabilities: { resources: true, tools: true, prompts: true },
  }))

  // Tool execution
  app.post('/tools/:name', async ({ params, body, set }) => {
    const { name } = params
    const rawBody = body as Record<string, unknown>
    const parsedParams = parseOrThrow(
      JsonObjectSchema.optional().default({}),
      rawBody,
      'MCP tool params',
    )

    switch (name) {
      case 'get_bot_stats':
        return { result: bot.getStats() }

      case 'get_opportunities':
        return { result: bot.getOpportunities() }

      case 'get_positions':
        return { result: bot.getLiquidityPositions() }

      case 'get_pool_recommendations': {
        const poolRecParams = parsedParams
          ? parseOrThrow(
              z
                .object({
                  minTvl: z.number().min(0).optional(),
                  minApr: z.number().min(0).max(10000).optional(),
                })
                .strict(),
              parsedParams,
              'Pool recommendations params',
            )
          : undefined
        const pools = await bot.getPoolRecommendations(poolRecParams)
        return { result: pools }
      }

      case 'get_rebalance_actions': {
        const actions = await bot.getRebalanceActions()
        return { result: actions }
      }

      case 'execute_rebalance': {
        expect(parsedParams, 'Rebalance params are required')
        expect(parsedParams.positionId, 'Position ID is required')
        const rebalanceActions = await bot.getRebalanceActions()
        const action = expect(
          rebalanceActions.find(
            (a) => a.positionId === parsedParams.positionId,
          ),
          `Action not found: ${parsedParams.positionId}`,
        )
        const result = await bot.executeRebalance(action)
        return { result }
      }

      case 'get_swap_quotes': {
        const quotesParams = parseOrThrow(
          QuotesParamsSchema,
          parsedParams,
          'Get swap quotes params',
        )
        const quotes = await bot.getSolanaQuotes(
          quotesParams.inputMint,
          quotesParams.outputMint,
          quotesParams.amount,
        )
        return { result: quotes }
      }

      case 'execute_swap': {
        const swapParams = parseOrThrow(
          SwapRequestSchema,
          parsedParams,
          'Execute swap params',
        )
        const result = await bot.executeSolanaSwap(
          swapParams.inputMint,
          swapParams.outputMint,
          swapParams.amount,
        )
        return { result }
      }

      case 'get_yield_opportunities': {
        const limit =
          parsedParams?.limit !== undefined
            ? parseOrThrow(
                z.number().int().min(1).max(100),
                parsedParams.limit,
                'Yield opportunities limit',
              )
            : 20
        return { result: bot.getYieldOpportunities(limit) }
      }

      case 'get_yield_stats':
        return { result: bot.getYieldStats() }

      case 'verify_yield': {
        const verifyParams = parseOrThrow(
          YieldVerifyParamSchema,
          parsedParams,
          'Verify yield params',
        )
        const result = await bot.verifyYield(verifyParams.id)
        return { result }
      }

      case 'add_liquidity': {
        const liquidityParams = parseOrThrow(
          AddLiquidityRequestSchema,
          parsedParams,
          'Add liquidity params',
        )
        const result = await bot.addLiquidity({
          chain: liquidityParams.chain as 'evm' | 'solana',
          dex: liquidityParams.dex,
          poolId: liquidityParams.poolId,
          amountA: liquidityParams.amountA,
          amountB: liquidityParams.amountB,
        })
        return { result }
      }

      case 'get_trade_history': {
        const limit =
          parsedParams?.limit !== undefined
            ? parseOrThrow(
                z.number().int().min(1).max(1000),
                parsedParams.limit,
                'Trade history limit',
              )
            : 100
        return { result: bot.getTradeHistory(limit) }
      }

      default:
        set.status = 404
        return { error: 'Tool not found' }
    }
  })

  // Resource access
  app.get('/resources/:uri', async ({ params, set }) => {
    const { uri } = params
    const fullUri = `bot://${uri}`

    switch (fullUri) {
      case 'bot://stats':
        return bot.getStats()
      case 'bot://opportunities':
        return bot.getOpportunities()
      case 'bot://positions':
        return bot.getLiquidityPositions()
      case 'bot://pools':
        return await bot.getPoolRecommendations()
      case 'bot://trades':
        return bot.getTradeHistory()
      default:
        set.status = 404
        return { error: 'Resource not found' }
    }
  })

  return app
}

// ============ Start Server ============

export async function startBotAPIServer(config: APIConfig): Promise<void> {
  const { bot, restPort, a2aPort, mcpPort } = config

  // Create APIs
  const restApp = createRestAPI(bot)
  const a2aApp = createA2AAPI(bot, config)
  const mcpApp = createMCPAPI(bot)

  // Start servers
  restApp.listen(restPort)
  console.log(`📡 REST API running on http://localhost:${restPort}`)

  a2aApp.listen(a2aPort)
  console.log(`📡 A2A Server running on http://localhost:${a2aPort}`)

  mcpApp.listen(mcpPort)
  console.log(`📡 MCP Server running on http://localhost:${mcpPort}`)

  console.log(`
┌─────────────────────────────────────────┐
│     MEV Bot API Servers Running         │
├─────────────────────────────────────────┤
│  REST:    http://localhost:${restPort}         │
│  A2A:     http://localhost:${a2aPort}         │
│  MCP:     http://localhost:${mcpPort}         │
└─────────────────────────────────────────┘
`)
}

// ============ CLI Entry Point ============

export async function main(): Promise<void> {
  const enableYieldFarming =
    (process.env.ENABLE_YIELD_FARMING ?? 'true') === 'true'
  const yieldMinApr = process.env.YIELD_MIN_APR
    ? parseFloat(process.env.YIELD_MIN_APR)
    : undefined
  const yieldMaxRiskScore = process.env.YIELD_MAX_RISK_SCORE
    ? parseInt(process.env.YIELD_MAX_RISK_SCORE, 10)
    : undefined
  const yieldPreferReal = process.env.YIELD_PREFER_REAL_YIELD
    ? process.env.YIELD_PREFER_REAL_YIELD === 'true'
    : undefined
  const yieldMinTvl = process.env.YIELD_MIN_TVL
    ? parseFloat(process.env.YIELD_MIN_TVL)
    : undefined
  const yieldMaxPositionPercent = process.env.YIELD_MAX_POSITION_PERCENT
    ? parseFloat(process.env.YIELD_MAX_POSITION_PERCENT)
    : undefined
  const yieldAutoCompound = process.env.YIELD_AUTO_COMPOUND
    ? process.env.YIELD_AUTO_COMPOUND === 'true'
    : undefined
  const yieldAutoRebalance = process.env.YIELD_AUTO_REBALANCE
    ? process.env.YIELD_AUTO_REBALANCE === 'true'
    : undefined

  const botConfig: MevBotConfig = {
    evmChains: [1, 42161, 10, 8453] as ChainId[], // Ethereum, Arbitrum, Optimism, Base
    solanaNetwork:
      (process.env.SOLANA_NETWORK as 'mainnet-beta' | 'devnet' | 'localnet') ??
      'mainnet-beta',
    evmPrivateKey: process.env.EVM_PRIVATE_KEY,
    solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY,
    enableArbitrage: true,
    enableCrossChain: true,
    enableSolanaArb: true,
    enableLiquidity: true,
    enableSandwich: false, // Disabled by default
    enableLiquidation: false,
    enableSolver: false,
    enableXLP: false, // Enable for XLP (Cross-chain Liquidity Provider) mode
    enableYieldFarming: enableYieldFarming,
    minProfitBps: 50, // 0.5%
    maxPositionSize: BigInt(10e18), // 10 ETH
    maxSlippageBps: 100, // 1%
    maxGasPrice: BigInt(100e9), // 100 gwei
    yieldFarmingConfig: enableYieldFarming
      ? {
          ...(yieldMinApr !== undefined ? { minApr: yieldMinApr } : {}),
          ...(yieldMaxRiskScore !== undefined
            ? { maxRiskScore: yieldMaxRiskScore }
            : {}),
          ...(yieldPreferReal !== undefined
            ? { preferRealYield: yieldPreferReal }
            : {}),
          ...(yieldMinTvl !== undefined ? { minTvl: yieldMinTvl } : {}),
          ...(yieldMaxPositionPercent !== undefined
            ? { maxPositionPercent: yieldMaxPositionPercent }
            : {}),
          ...(yieldAutoCompound !== undefined
            ? { autoCompound: yieldAutoCompound }
            : {}),
          ...(yieldAutoRebalance !== undefined
            ? { autoRebalance: yieldAutoRebalance }
            : {}),
        }
      : undefined,
  }

  const bot = new MevBot(botConfig)
  await bot.initialize()
  await bot.start()

  const apiConfig: APIConfig = {
    restPort: parseInt(process.env.BOT_REST_PORT ?? '4020', 10),
    a2aPort: parseInt(process.env.BOT_A2A_PORT ?? '4021', 10),
    mcpPort: parseInt(process.env.BOT_MCP_PORT ?? '4022', 10),
    bot,
  }

  await startBotAPIServer(apiConfig)

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...')
    await bot.stop()
    process.exit(0)
  })
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  main().catch(console.error)
}
