/**
 * Unified Bot API Server
 *
 * Provides REST, A2A, and MCP APIs for the Unified MEV + LP Bot:
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

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import {
  AddLiquidityRequestSchema,
  expect,
  parseOrThrow,
  QuotesParamsSchema,
  RebalanceActionIdParamSchema,
  SwapRequestSchema,
  YieldVerifyParamSchema,
} from '../schemas'
import type { ChainId } from './autocrat-types'
import { UnifiedBot, type UnifiedBotConfig } from './unified-bot'

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
  bot: UnifiedBot
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

function createRestAPI(bot: UnifiedBot): Hono {
  const app = new Hono()

  // CORS - restrict to configured origins in production
  // SECURITY: Wildcard '*' is ONLY honored in localnet to prevent misconfiguration
  app.use(
    '*',
    cors({
      origin: (origin) => {
        // In development (localnet), allow all origins
        if (NETWORK === 'localnet') return origin
        // In production/testnet, NEVER allow wildcard - explicit origins only
        if (!origin) return null
        if (ALLOWED_ORIGINS.includes(origin)) return origin
        return null
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Wallet-Address',
      ],
      maxAge: 86400,
    }),
  )

  // Rate limiting middleware with atomic increment pattern
  app.use('*', async (c, next) => {
    const path = c.req.path

    // Skip rate limiting for health check
    if (path === '/health') return next()

    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
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
        return c.json({ error: 'Rate limit exceeded' }, 429)
      }
    }

    return next()
  })

  // API Key authentication middleware (when enabled)
  app.use('*', async (c, next) => {
    const path = c.req.path

    // Skip auth for health check
    if (path === '/health') return next()

    // Skip auth if not required
    if (!REQUIRE_AUTH || !BOT_API_KEY) return next()

    const providedKey =
      c.req.header('x-api-key') ??
      c.req.header('authorization')?.replace('Bearer ', '')

    if (!providedKey || !constantTimeCompare(providedKey, BOT_API_KEY)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    return next()
  })

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'unified-bot',
      timestamp: Date.now(),
    })
  })

  // Bot statistics
  app.get('/stats', (c) => {
    const stats = bot.getStats()
    return c.json(stats)
  })

  // Current opportunities
  app.get('/opportunities', (c) => {
    const opportunities = bot.getOpportunities()
    return c.json(opportunities)
  })

  // Liquidity positions
  app.get('/positions', (c) => {
    const positions = bot.getLiquidityPositions()
    return c.json(positions)
  })

  // Pool recommendations
  app.get('/pools', async (c) => {
    const minTvlStr = c.req.query('minTvl')
    const minAprStr = c.req.query('minApr')
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

    const pools = await bot.getPoolRecommendations({ minTvl, minApr })
    return c.json(pools)
  })

  // Pending rebalance actions
  app.get('/rebalance', async (c) => {
    const actions = await bot.getRebalanceActions()
    return c.json(actions)
  })

  // Execute rebalance action
  app.post('/rebalance/:actionId', async (c) => {
    const params = parseOrThrow(
      RebalanceActionIdParamSchema,
      c.req.param(),
      'Action ID parameter',
    )
    const actions = await bot.getRebalanceActions()
    const action = expect(
      actions.find((a) => a.positionId === params.actionId),
      `Action not found: ${params.actionId}`,
    )

    const result = await bot.executeRebalance(action)
    return c.json(result)
  })

  // ============ Yield Farming Endpoints ============

  // Yield farming opportunities (ranked by risk-adjusted return)
  app.get('/yield', (c) => {
    const limitStr = c.req.query('limit')
    const limit = limitStr
      ? parseOrThrow(
          z.number().int().min(1).max(100),
          parseInt(limitStr, 10),
          'Limit query parameter',
        )
      : 20
    const opportunities = bot.getYieldOpportunities(limit)
    return c.json(opportunities)
  })

  // Yield farming stats
  app.get('/yield/stats', (c) => {
    const stats = bot.getYieldStats()
    return c.json(stats ?? { error: 'Yield farming not enabled' })
  })

  // Verify yield for an opportunity (on-chain verification)
  app.get('/yield/verify/:id', async (c) => {
    const params = parseOrThrow(
      YieldVerifyParamSchema,
      c.req.param(),
      'Yield verify parameter',
    )
    const result = await bot.verifyYield(params.id)
    return c.json(result)
  })

  // Add liquidity
  app.post('/liquidity/add', async (c) => {
    const rawBody = await c.req.json()
    const body = parseOrThrow(
      AddLiquidityRequestSchema,
      rawBody,
      'Add liquidity request',
    )
    const result = await bot.addLiquidity({
      chain: body.chain as 'evm' | 'solana',
      dex: body.dex,
      poolId: body.poolId,
      amountA: body.amountA,
      amountB: body.amountB,
    })
    return c.json(result)
  })

  // Remove liquidity (simplified - would need position ID and percent)
  app.post('/liquidity/remove', async (_c) => {
    // This would call liquidityManager.removeLiquidity
    return _c.json({ success: false, error: 'Not implemented' })
  })

  // Get Solana swap quotes
  app.get('/quotes/:inputMint/:outputMint/:amount', async (c) => {
    const params = parseOrThrow(
      QuotesParamsSchema,
      c.req.param(),
      'Quotes parameters',
    )
    const quotes = await bot.getSolanaQuotes(
      params.inputMint,
      params.outputMint,
      params.amount,
    )
    return c.json(quotes)
  })

  // Execute swap
  app.post('/swap', async (c) => {
    const rawBody = await c.req.json()
    const body = parseOrThrow(SwapRequestSchema, rawBody, 'Swap request')
    const result = await bot.executeSolanaSwap(
      body.inputMint,
      body.outputMint,
      body.amount,
    )
    return c.json(result)
  })

  // Trade history
  app.get('/trades', (c) => {
    const limitStr = c.req.query('limit')
    const limit = limitStr
      ? parseOrThrow(
          z.number().int().min(1).max(1000),
          parseInt(limitStr, 10),
          'Limit query parameter',
        )
      : 100
    const trades = bot.getTradeHistory(limit)
    return c.json(trades)
  })

  // Bot control
  app.post('/start', async (c) => {
    await bot.start()
    return c.json({ success: true, message: 'Bot started' })
  })

  app.post('/stop', async (c) => {
    await bot.stop()
    return c.json({ success: true, message: 'Bot stopped' })
  })

  return app
}

// ============ A2A API ============

function createA2AAPI(bot: UnifiedBot, config: APIConfig): Hono {
  const app = new Hono()

  // CORS - restrict to configured origins in production
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (NETWORK === 'localnet') return origin
        if (
          !origin ||
          ALLOWED_ORIGINS.includes(origin) ||
          ALLOWED_ORIGINS.includes('*')
        )
          return origin
        return null
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      maxAge: 86400,
    }),
  )

  // Rate limiting for A2A
  app.use('*', async (c, next) => {
    const path = c.req.path
    if (path === '/' || path.startsWith('/.well-known')) return next()

    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const key = `a2a:${clientIp}`

    const now = Date.now()
    const record = rateLimitStore.get(key)

    if (!record || record.resetAt < now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
      return next()
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      return c.json(
        { error: { code: -32603, message: 'Rate limit exceeded' } },
        429,
      )
    }

    record.count++
    return next()
  })

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
  app.get('/.well-known/agent-card.json', (c) => {
    return c.json(agentCard)
  })

  // Root info
  app.get('/', (c) => {
    return c.json({
      service: 'unified-bot-a2a',
      version: '1.0.0',
      agentCard: '/.well-known/agent-card.json',
    })
  })

  // A2A request handler
  app.post('/a2a', async (c) => {
    const body = await c.req.json()
    const { method, params } = body

    switch (method) {
      case 'getStats':
        return c.json({ result: bot.getStats() })

      case 'getOpportunities':
        return c.json({ result: bot.getOpportunities() })

      case 'getPositions':
        return c.json({ result: bot.getLiquidityPositions() })

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
        return c.json({ result: pools })
      }

      case 'getRebalanceActions': {
        const actions = await bot.getRebalanceActions()
        return c.json({ result: actions })
      }

      case 'executeRebalance': {
        expect(params, 'Rebalance action params are required')
        expect(params.positionId, 'Position ID is required')
        const rebalanceActions = await bot.getRebalanceActions()
        const action = expect(
          rebalanceActions.find((a) => a.positionId === params.positionId),
          `Action not found: ${params.positionId}`,
        )
        const result = await bot.executeRebalance(action)
        return c.json({ result })
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
        return c.json({ result: quotes })
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
        return c.json({ result: swapResult })
      }

      default:
        return c.json(
          { error: { code: -32601, message: 'Method not found' } },
          404,
        )
    }
  })

  return app
}

// ============ MCP API ============

function createMCPAPI(bot: UnifiedBot): Hono {
  const app = new Hono()

  // CORS - restrict to configured origins in production
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (NETWORK === 'localnet') return origin
        if (
          !origin ||
          ALLOWED_ORIGINS.includes(origin) ||
          ALLOWED_ORIGINS.includes('*')
        )
          return origin
        return null
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      maxAge: 86400,
    }),
  )

  // Rate limiting for MCP
  app.use('*', async (c, next) => {
    const path = c.req.path
    if (path === '/') return next()

    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const key = `mcp:${clientIp}`

    const now = Date.now()
    const record = rateLimitStore.get(key)

    if (!record || record.resetAt < now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
      return next()
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      return c.json({ error: 'Rate limit exceeded' }, 429)
    }

    record.count++
    return next()
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
  app.get('/', (c) => {
    return c.json({
      server: 'unified-bot-mcp',
      version: '1.0.0',
      description: 'Cross-chain MEV and liquidity management bot',
      tools,
      resources,
      prompts: [
        {
          name: 'analyze_portfolio',
          description:
            'Analyze the current portfolio and suggest optimizations',
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
    })
  })

  // Tool execution
  app.post('/tools/:name', async (c) => {
    const { name } = c.req.param()
    const params = await c.req.json().catch(() => ({}))

    switch (name) {
      case 'get_bot_stats':
        return c.json({ result: bot.getStats() })

      case 'get_opportunities':
        return c.json({ result: bot.getOpportunities() })

      case 'get_positions':
        return c.json({ result: bot.getLiquidityPositions() })

      case 'get_pool_recommendations': {
        const poolRecParams = params
          ? parseOrThrow(
              z
                .object({
                  minTvl: z.number().min(0).optional(),
                  minApr: z.number().min(0).max(10000).optional(),
                })
                .strict(),
              params,
              'Pool recommendations params',
            )
          : undefined
        const pools = await bot.getPoolRecommendations(poolRecParams)
        return c.json({ result: pools })
      }

      case 'get_rebalance_actions': {
        const actions = await bot.getRebalanceActions()
        return c.json({ result: actions })
      }

      case 'execute_rebalance': {
        expect(params, 'Rebalance params are required')
        expect(params.positionId, 'Position ID is required')
        const rebalanceActions = await bot.getRebalanceActions()
        const action = expect(
          rebalanceActions.find((a) => a.positionId === params.positionId),
          `Action not found: ${params.positionId}`,
        )
        const result = await bot.executeRebalance(action)
        return c.json({ result })
      }

      case 'get_swap_quotes': {
        const quotesParams = parseOrThrow(
          QuotesParamsSchema,
          params,
          'Get swap quotes params',
        )
        const quotes = await bot.getSolanaQuotes(
          quotesParams.inputMint,
          quotesParams.outputMint,
          quotesParams.amount,
        )
        return c.json({ result: quotes })
      }

      case 'execute_swap': {
        const swapParams = parseOrThrow(
          SwapRequestSchema,
          params,
          'Execute swap params',
        )
        const result = await bot.executeSolanaSwap(
          swapParams.inputMint,
          swapParams.outputMint,
          swapParams.amount,
        )
        return c.json({ result })
      }

      case 'get_yield_opportunities': {
        const limit =
          params?.limit !== undefined
            ? parseOrThrow(
                z.number().int().min(1).max(100),
                params.limit,
                'Yield opportunities limit',
              )
            : 20
        return c.json({ result: bot.getYieldOpportunities(limit) })
      }

      case 'get_yield_stats':
        return c.json({ result: bot.getYieldStats() })

      case 'verify_yield': {
        const verifyParams = parseOrThrow(
          YieldVerifyParamSchema,
          params,
          'Verify yield params',
        )
        const result = await bot.verifyYield(verifyParams.id)
        return c.json({ result })
      }

      case 'add_liquidity': {
        const liquidityParams = parseOrThrow(
          AddLiquidityRequestSchema,
          params,
          'Add liquidity params',
        )
        const result = await bot.addLiquidity({
          chain: liquidityParams.chain as 'evm' | 'solana',
          dex: liquidityParams.dex,
          poolId: liquidityParams.poolId,
          amountA: liquidityParams.amountA,
          amountB: liquidityParams.amountB,
        })
        return c.json({ result })
      }

      case 'get_trade_history': {
        const limit =
          params?.limit !== undefined
            ? parseOrThrow(
                z.number().int().min(1).max(1000),
                params.limit,
                'Trade history limit',
              )
            : 100
        return c.json({ result: bot.getTradeHistory(limit) })
      }

      default:
        return c.json({ error: 'Tool not found' }, 404)
    }
  })

  // Resource access
  app.get('/resources/:uri', async (c) => {
    const { uri } = c.req.param()
    const fullUri = `bot://${uri}`

    switch (fullUri) {
      case 'bot://stats':
        return c.json(bot.getStats())
      case 'bot://opportunities':
        return c.json(bot.getOpportunities())
      case 'bot://positions':
        return c.json(bot.getLiquidityPositions())
      case 'bot://pools':
        return c.json(await bot.getPoolRecommendations())
      case 'bot://trades':
        return c.json(bot.getTradeHistory())
      default:
        return c.json({ error: 'Resource not found' }, 404)
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
  serve({ fetch: restApp.fetch, port: restPort })
  console.log(`📡 REST API running on http://localhost:${restPort}`)

  serve({ fetch: a2aApp.fetch, port: a2aPort })
  console.log(`📡 A2A Server running on http://localhost:${a2aPort}`)

  serve({ fetch: mcpApp.fetch, port: mcpPort })
  console.log(`📡 MCP Server running on http://localhost:${mcpPort}`)

  console.log(`
┌─────────────────────────────────────────┐
│     Unified Bot API Servers Running     │
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

  const botConfig: UnifiedBotConfig = {
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

  const bot = new UnifiedBot(botConfig)
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
