/**
 * RPC Service Routes
 * Multi-chain RPC provider service
 */

import { Elysia, t } from 'elysia'
import {
  canMakeRequest,
  extractApiKey,
  findBestProvider,
  getSessionFromApiKey,
  type RPCProvider,
  type RPCSession,
} from '../../shared/utils/rpc'

interface ChainConfig {
  id: number
  name: string
  network: string
  symbol: string
  rpcUrls: string[]
  wsUrls?: string[]
  explorerUrl?: string
  isTestnet: boolean
  enabled: boolean
}

// Supported chains
const CHAINS: Record<number, ChainConfig> = {
  // Ethereum
  1: {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    enabled: true,
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    enabled: true,
  },
  // Base
  8453: {
    id: 8453,
    name: 'Base',
    network: 'base',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    enabled: true,
  },
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    network: 'base-sepolia',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    enabled: true,
  },
  // Optimism
  10: {
    id: 10,
    name: 'Optimism',
    network: 'optimism',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://optimistic.etherscan.io',
    isTestnet: false,
    enabled: true,
  },
  // Arbitrum
  42161: {
    id: 42161,
    name: 'Arbitrum One',
    network: 'arbitrum',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    enabled: true,
  },
  // BSC
  56: {
    id: 56,
    name: 'BNB Smart Chain',
    network: 'bsc',
    symbol: 'BNB',
    rpcUrls: [],
    explorerUrl: 'https://bscscan.com',
    isTestnet: false,
    enabled: true,
  },
  // Polygon
  137: {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    symbol: 'MATIC',
    rpcUrls: [],
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    enabled: true,
  },
  // Solana (using chain ID convention)
  101: {
    id: 101,
    name: 'Solana',
    network: 'solana-mainnet',
    symbol: 'SOL',
    rpcUrls: [],
    explorerUrl: 'https://explorer.solana.com',
    isTestnet: false,
    enabled: true,
  },
  102: {
    id: 102,
    name: 'Solana Devnet',
    network: 'solana-devnet',
    symbol: 'SOL',
    rpcUrls: [],
    explorerUrl: 'https://explorer.solana.com?cluster=devnet',
    isTestnet: true,
    enabled: true,
  },
}

const providers = new Map<string, RPCProvider>()
const sessions = new Map<string, RPCSession>()
const apiKeyToSession = new Map<string, string>()

// Rate limits by tier
const RATE_LIMITS = {
  free: { rps: 10, daily: 10000 },
  standard: { rps: 100, daily: 1000000 },
  premium: { rps: 1000, daily: 10000000 },
}

export const rpcRoutes = new Elysia({ name: 'rpc', prefix: '/rpc' })
  // ============================================================================
  // Health & Info
  // ============================================================================

  .get('/health', () => {
    const activeProviders = Array.from(providers.values()).filter(
      (p) => p.status === 'active',
    )

    const chainStatus = Object.values(CHAINS)
      .filter((chain) => chain.enabled)
      .map((chain) => {
        const chainProviders = activeProviders.filter(
          (p) => p.chainId === chain.id,
        )
        return {
          chainId: chain.id,
          name: chain.name,
          providers: chainProviders.length,
          avgLatency:
            chainProviders.length > 0
              ? chainProviders.reduce((sum, p) => sum + p.latency, 0) /
                chainProviders.length
              : null,
        }
      })

    return {
      status: 'healthy',
      service: 'dws-rpc',
      chains: chainStatus,
      totalProviders: providers.size,
      activeSessions: sessions.size,
    }
  })

  // List supported chains
  .get(
    '/chains',
    ({ query }) => {
      const includeTestnets = query.testnet === 'true'

      const chains = Object.values(CHAINS)
        .filter(
          (chain) => chain.enabled && (includeTestnets || !chain.isTestnet),
        )
        .map((chain) => {
          const chainProviders = Array.from(providers.values()).filter(
            (p) => p.chainId === chain.id && p.status === 'active',
          )

          return {
            chainId: chain.id,
            name: chain.name,
            network: chain.network,
            symbol: chain.symbol,
            explorerUrl: chain.explorerUrl,
            isTestnet: chain.isTestnet,
            providers: chainProviders.length,
            avgLatency:
              chainProviders.length > 0
                ? Math.round(
                    chainProviders.reduce((sum, p) => sum + p.latency, 0) /
                      chainProviders.length,
                  )
                : null,
          }
        })

      return { chains }
    },
    {
      query: t.Object({
        testnet: t.Optional(t.String()),
      }),
    },
  )

  // Get chain info
  .get(
    '/chains/:chainId',
    ({ params, set }) => {
      const chainId = parseInt(params.chainId, 10)
      const chain = CHAINS[chainId]

      if (!chain || !chain.enabled) {
        set.status = 400
        return { error: 'Chain not supported' }
      }

      const chainProviders = Array.from(providers.values()).filter(
        (p) => p.chainId === chainId,
      )

      return {
        ...chain,
        providers: chainProviders.map((p) => ({
          id: p.id,
          region: p.region,
          tier: p.tier,
          latency: p.latency,
          uptime: p.uptime,
          status: p.status,
        })),
      }
    },
    {
      params: t.Object({
        chainId: t.String(),
      }),
    },
  )

  // ============================================================================
  // Provider Management
  // ============================================================================

  // Register provider
  .post(
    '/providers',
    async ({ headers, body, set }) => {
      const operator = headers['x-jeju-address']
      if (!operator) {
        set.status = 401
        return { error: 'x-jeju-address header required' }
      }

      if (!CHAINS[body.chainId]) {
        set.status = 400
        return { error: 'Chain not supported' }
      }

      const id = crypto.randomUUID()
      const provider: RPCProvider = {
        id,
        operator,
        chainId: body.chainId,
        endpoint: body.endpoint,
        wsEndpoint: body.wsEndpoint,
        region: body.region,
        tier: body.tier,
        maxRps: body.maxRps,
        currentRps: 0,
        latency: 0,
        uptime: 100,
        lastSeen: Date.now(),
        status: 'active',
      }

      providers.set(id, provider)

      set.status = 201
      return {
        providerId: id,
        chainId: body.chainId,
        status: 'registered',
      }
    },
    {
      headers: t.Object({
        'x-jeju-address': t.Optional(t.String()),
      }),
      body: t.Object({
        chainId: t.Number(),
        endpoint: t.String(),
        wsEndpoint: t.Optional(t.String()),
        region: t.String(),
        tier: t.Union([
          t.Literal('free'),
          t.Literal('standard'),
          t.Literal('premium'),
        ]),
        maxRps: t.Number(),
      }),
    },
  )

  // Provider heartbeat
  .post(
    '/providers/:id/heartbeat',
    async ({ params, body, set }) => {
      const provider = providers.get(params.id)
      if (!provider) {
        set.status = 404
        return { error: 'Provider not found' }
      }

      provider.lastSeen = Date.now()
      if (body.latency !== undefined) provider.latency = body.latency
      if (body.currentRps !== undefined) provider.currentRps = body.currentRps
      if (body.status) provider.status = body.status

      return { success: true }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        latency: t.Optional(t.Number()),
        currentRps: t.Optional(t.Number()),
        status: t.Optional(
          t.Union([
            t.Literal('active'),
            t.Literal('degraded'),
            t.Literal('offline'),
          ]),
        ),
      }),
    },
  )

  // ============================================================================
  // API Key Management
  // ============================================================================

  // Create API key
  .post(
    '/keys',
    async ({ headers, body, set }) => {
      const user = headers['x-jeju-address']
      if (!user) {
        set.status = 401
        return { error: 'x-jeju-address header required' }
      }

      const tier = body.tier ?? 'free'
      const apiKey = `dws_${crypto.randomUUID().replace(/-/g, '')}`
      const sessionId = crypto.randomUUID()

      const session: RPCSession = {
        id: sessionId,
        user,
        chainId: 0, // All chains
        apiKey,
        tier,
        requestCount: 0,
        dailyLimit: RATE_LIMITS[tier].daily,
        createdAt: Date.now(),
        status: 'active',
      }

      sessions.set(sessionId, session)
      apiKeyToSession.set(apiKey, sessionId)

      set.status = 201
      return {
        apiKey,
        tier,
        limits: RATE_LIMITS[tier],
        endpoints: Object.values(CHAINS)
          .filter((chain) => chain.enabled)
          .map((chain) => ({
            chainId: chain.id,
            name: chain.name,
            http: `/rpc/${chain.id}`,
            ws: `/rpc/${chain.id}/ws`,
          })),
      }
    },
    {
      headers: t.Object({
        'x-jeju-address': t.Optional(t.String()),
      }),
      body: t.Object({
        tier: t.Optional(
          t.Union([
            t.Literal('free'),
            t.Literal('standard'),
            t.Literal('premium'),
          ]),
        ),
        chains: t.Optional(t.Array(t.Number())),
      }),
    },
  )

  // Get API key info
  .get(
    '/keys/:apiKey',
    ({ params, set }) => {
      const sessionId = apiKeyToSession.get(params.apiKey)
      if (!sessionId) {
        set.status = 404
        return { error: 'API key not found' }
      }

      const session = sessions.get(sessionId)
      if (!session) {
        set.status = 404
        return { error: 'Session not found' }
      }

      return {
        tier: session.tier,
        requestCount: session.requestCount,
        dailyLimit: session.dailyLimit,
        remainingToday: session.dailyLimit - session.requestCount,
        status: session.status,
        createdAt: session.createdAt,
      }
    },
    {
      params: t.Object({
        apiKey: t.String(),
      }),
    },
  )

  // Revoke API key
  .delete(
    '/keys/:apiKey',
    ({ params, headers, set }) => {
      const user = headers['x-jeju-address']?.toLowerCase()
      const sessionId = apiKeyToSession.get(params.apiKey)

      if (!sessionId) {
        set.status = 404
        return { error: 'API key not found' }
      }

      const session = sessions.get(sessionId)
      if (!session || !user || session.user.toLowerCase() !== user) {
        set.status = 403
        return { error: 'Not authorized' }
      }

      session.status = 'suspended'
      apiKeyToSession.delete(params.apiKey)

      return { success: true }
    },
    {
      params: t.Object({
        apiKey: t.String(),
      }),
      headers: t.Object({
        'x-jeju-address': t.Optional(t.String()),
      }),
    },
  )

  // ============================================================================
  // RPC Proxy
  // ============================================================================

  // JSON-RPC endpoint
  .post(
    '/:chainId',
    async ({ params, headers, query, body, set }) => {
      const chainId = parseInt(params.chainId, 10)
      const chain = CHAINS[chainId]

      if (!chain || !chain.enabled) {
        set.status = 400
        return { error: 'Chain not supported' }
      }

      // Get API key from header or query
      const apiKey = extractApiKey(
        headers['x-api-key'],
        headers.authorization,
        query.apiKey,
      )

      // Validate API key and check rate limits
      const session = getSessionFromApiKey(apiKey, apiKeyToSession, sessions)
      const canRequest = canMakeRequest(session)
      if (!canRequest.allowed) {
        set.status = 429
        return { error: canRequest.reason || 'Request not allowed' }
      }

      if (session) {
        session.requestCount++
      }

      // Find best provider
      const provider = findBestProvider(providers, chainId)
      if (!provider) {
        set.status = 503
        return { error: 'No available providers' }
      }

      // Forward request
      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const result = await response.json()

      // Track provider usage
      provider.currentRps++
      setTimeout(() => provider.currentRps--, 1000)

      return result
    },
    {
      params: t.Object({
        chainId: t.String(),
      }),
      headers: t.Object({
        'x-api-key': t.Optional(t.String()),
        authorization: t.Optional(t.String()),
      }),
      query: t.Object({
        apiKey: t.Optional(t.String()),
      }),
      body: t.Object({
        jsonrpc: t.String(),
        method: t.String(),
        params: t.Optional(t.Array(t.Unknown())),
        id: t.Union([t.Number(), t.String()]),
      }),
    },
  )

  // Batch RPC
  .post(
    '/:chainId/batch',
    async ({ params, body, set }) => {
      const chainId = parseInt(params.chainId, 10)
      const chain = CHAINS[chainId]

      if (!chain || !chain.enabled) {
        set.status = 400
        return { error: 'Chain not supported' }
      }

      // Find provider
      const provider = Array.from(providers.values()).find(
        (p) => p.chainId === chainId && p.status === 'active',
      )

      if (!provider) {
        set.status = 503
        return { error: 'No available providers' }
      }

      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      return await response.json()
    },
    {
      params: t.Object({
        chainId: t.String(),
      }),
      body: t.Array(
        t.Object({
          jsonrpc: t.String(),
          method: t.String(),
          params: t.Optional(t.Array(t.Unknown())),
          id: t.Union([t.Number(), t.String()]),
        }),
      ),
    },
  )

export type RPCRoutes = typeof rpcRoutes

// Backwards compatible factory function
export function createRPCRouter(): Elysia {
  return rpcRoutes
}
