/**
 * RPC Gateway Server
 * Multi-chain RPC proxy with stake-based rate limiting and X402 payments
 */

import { cors } from '@elysiajs/cors'
import {
  RPC_CHAINS as CHAINS,
  getRpcChain as getChain,
  getRpcMainnetChains as getMainnetChains,
  getRpcTestnetChains as getTestnetChains,
  isRpcChainSupported as isChainSupported,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { type Address, isAddress } from 'viem'
import { getRateLimitStats, RATE_LIMITS } from './middleware/rate-limiter.js'
import {
  getChainStats,
  getEndpointHealth,
  type JsonRpcRequest,
  proxyBatchRequest,
  proxyRequest,
} from './proxy/rpc-proxy.js'
import {
  createApiKey,
  getApiKeyStats,
  getApiKeysForAddress,
  revokeApiKeyById,
} from './services/api-keys.js'
import {
  generatePaymentRequirement,
  getCredits,
  getPaymentInfo,
  processPayment,
  purchaseCredits,
} from './services/x402-payments.js'

// MCP types
interface ChainInfo {
  chainId: number
  name: string
  isTestnet: boolean
  endpoint: string
}

interface TierInfo {
  stake: number
  limit: number | 'unlimited'
}

/** API key creation request body */
interface CreateApiKeyBody {
  name?: string
}

type MCPResourceContents =
  | ChainInfo[]
  | Record<string, { healthy: boolean; failures: number }>
  | Record<string, TierInfo>

interface MCPToolResult {
  chains?: Array<{ chainId: number; name: string; isTestnet: boolean }>
  error?: string
  key?: string
  id?: string
  tier?: string
  address?: string
  apiKeys?: number
  tiers?: typeof RATE_LIMITS
  totalRequests?: number
  chainId?: number
  name?: string
  shortName?: string
  rpcUrl?: string
  fallbackRpcs?: string[]
  explorerUrl?: string
  isTestnet?: boolean
  nativeCurrency?: { name: string; symbol: string; decimals: number }
}

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['*']
const MAX_API_KEYS_PER_ADDRESS = 10

function getValidatedAddress(request: Request): Address | null {
  const address = request.headers.get('X-Wallet-Address')
  if (!address || !isAddress(address)) return null
  return address
}

// MCP Server Info
const MCP_SERVER_INFO = {
  name: 'jeju-rpc-gateway',
  version: '1.0.0',
  description: 'Multi-chain RPC Gateway with stake-based rate limiting',
  capabilities: { resources: true, tools: true, prompts: false },
}

const MCP_RESOURCES = [
  {
    uri: 'rpc://chains',
    name: 'Supported Chains',
    description: 'All supported blockchain networks',
    mimeType: 'application/json',
  },
  {
    uri: 'rpc://health',
    name: 'Endpoint Health',
    description: 'Health status of all RPC endpoints',
    mimeType: 'application/json',
  },
  {
    uri: 'rpc://tiers',
    name: 'Rate Limit Tiers',
    description: 'Available staking tiers and rate limits',
    mimeType: 'application/json',
  },
]

const MCP_TOOLS = [
  {
    name: 'list_chains',
    description: 'List all supported chains',
    inputSchema: {
      type: 'object',
      properties: { testnet: { type: 'boolean' } },
    },
  },
  {
    name: 'get_chain',
    description: 'Get chain details',
    inputSchema: {
      type: 'object',
      properties: { chainId: { type: 'number' } },
      required: ['chainId'],
    },
  },
  {
    name: 'create_api_key',
    description: 'Create new API key',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' }, name: { type: 'string' } },
      required: ['address'],
    },
  },
  {
    name: 'check_rate_limit',
    description: 'Check rate limit for address',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
    },
  },
  {
    name: 'get_usage',
    description: 'Get usage statistics',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
    },
  },
]

export const rpcApp = new Elysia({ name: 'rpc-gateway' })
  .use(
    cors({
      origin: CORS_ORIGINS,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-Api-Key',
        'X-Wallet-Address',
        'X-Payment',
      ],
      exposeHeaders: [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-RateLimit-Tier',
        'X-RPC-Latency-Ms',
        'X-Payment-Required',
      ],
      maxAge: 86400,
    }),
  )

  // Secure headers
  .onBeforeHandle(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-XSS-Protection'] = '1; mode=block'
  })

  // Error handler
  .onError(({ error, set }) => {
    const message = 'message' in error ? String(error.message) : String(error)
    console.error(`[RPC Gateway Error] ${message}`)
    set.status = 500
    return { error: 'Internal server error' }
  })

  // Health & Discovery
  .get('/', () => ({
    service: 'jeju-rpc-gateway',
    version: '1.0.0',
    description: 'Multi-chain RPC Gateway with stake-based rate limiting',
    endpoints: {
      chains: '/v1/chains',
      rpc: '/v1/rpc/:chainId',
      keys: '/v1/keys',
      usage: '/v1/usage',
      health: '/health',
    },
  }))

  .get('/health', () => {
    const chainStats = getChainStats()
    const rateLimitStats = getRateLimitStats()
    const apiKeyStats = getApiKeyStats()
    const endpointHealth = getEndpointHealth()
    const unhealthyEndpoints = Object.entries(endpointHealth)
      .filter(([, h]) => !h.healthy)
      .map(([url]) => url)
    const status =
      unhealthyEndpoints.length > chainStats.supported / 2 ? 'degraded' : 'ok'

    return {
      status,
      service: 'rpc-gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      chains: { ...chainStats, unhealthyEndpoints: unhealthyEndpoints.length },
      rateLimits: rateLimitStats,
      apiKeys: { total: apiKeyStats.total, active: apiKeyStats.active },
    }
  })

  // Chain Information
  .get('/v1/chains', ({ query }) => {
    const testnet = query.testnet
    const chains =
      testnet === 'true'
        ? getTestnetChains()
        : testnet === 'false'
          ? getMainnetChains()
          : Object.values(CHAINS)

    return {
      chains: chains.map((chain) => ({
        chainId: chain.chainId,
        name: chain.name,
        shortName: chain.shortName,
        rpcEndpoint: `/v1/rpc/${chain.chainId}`,
        explorerUrl: chain.explorerUrl,
        isTestnet: chain.isTestnet,
        nativeCurrency: chain.nativeCurrency,
      })),
      totalCount: chains.length,
    }
  })

  .get('/v1/chains/:chainId', ({ params, set }) => {
    const chainId = Number(params.chainId)
    if (!isChainSupported(chainId)) {
      set.status = 404
      return { error: `Unsupported chain: ${chainId}` }
    }

    const chain = getChain(chainId)
    const health = getEndpointHealth()

    return {
      chainId: chain.chainId,
      name: chain.name,
      shortName: chain.shortName,
      rpcEndpoint: `/v1/rpc/${chain.chainId}`,
      explorerUrl: chain.explorerUrl,
      isTestnet: chain.isTestnet,
      nativeCurrency: chain.nativeCurrency,
      endpoints: {
        primary: {
          url: chain.rpcUrl,
          healthy: health[chain.rpcUrl]?.healthy ?? true,
        },
        fallbacks: chain.fallbackRpcs.map((url) => ({
          url,
          healthy: health[url]?.healthy ?? true,
        })),
      },
    }
  })

  // RPC Proxy
  .post('/v1/rpc/:chainId', async ({ params, body, request, set }) => {
    const chainId = Number(params.chainId)
    if (!isChainSupported(chainId)) {
      set.status = 400
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: `Unsupported chain: ${chainId}` },
      }
    }

    // JSON-RPC body can be a single request, batch array, or invalid structure
    type RpcRequestBody = {
      jsonrpc: string
      id?: number | string
      method: string
      params?: (string | number | boolean | null | object)[]
    }
    const rpcBody:
      | RpcRequestBody
      | RpcRequestBody[]
      | Record<string, string | number | boolean | null | object>
      | null = body as typeof rpcBody

    // Get user address for x402 payment processing
    const userAddress = request.headers.get('X-Wallet-Address') ?? undefined
    const paymentHeader = request.headers.get('X-Payment') ?? undefined

    if (Array.isArray(rpcBody)) {
      if (rpcBody.length === 0) {
        set.status = 400
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid request: Empty batch' },
        }
      }
      if (rpcBody.length > 100) {
        set.status = 400
        return {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid request: Batch too large (max 100)',
          },
        }
      }

      // Check x402 payment for batch (use first method as reference)
      const firstMethod = rpcBody[0]?.method || 'eth_call'
      const paymentResult = await processPayment(
        paymentHeader,
        chainId,
        firstMethod,
        userAddress,
      )
      if (!paymentResult.allowed) {
        set.headers['X-Payment-Required'] = 'true'
        set.status = 402
        return {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: 402,
            message: 'Payment required',
            data: paymentResult.requirement,
          },
        }
      }

      const results = await proxyBatchRequest(
        chainId,
        rpcBody as JsonRpcRequest[],
      )
      return results.map((r) => r.response)
    }

    if (!rpcBody || typeof rpcBody !== 'object' || !('method' in rpcBody)) {
      set.status = 400
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request: Missing method' },
      }
    }

    const singleRequest = rpcBody as JsonRpcRequest

    // Check x402 payment for single request
    const paymentResult = await processPayment(
      paymentHeader,
      chainId,
      singleRequest.method,
      userAddress,
    )
    if (!paymentResult.allowed) {
      set.headers['X-Payment-Required'] = 'true'
      set.status = 402
      return {
        jsonrpc: '2.0',
        id: singleRequest.id,
        error: {
          code: 402,
          message: 'Payment required',
          data: paymentResult.requirement,
        },
      }
    }

    const result = await proxyRequest(chainId, singleRequest)
    set.headers['X-RPC-Latency-Ms'] = String(result.latencyMs)
    if (result.usedFallback) set.headers['X-RPC-Used-Fallback'] = 'true'

    return result.response
  })

  // API Key Management
  .get('/v1/keys', async ({ request, set }) => {
    const address = getValidatedAddress(request)
    if (!address) {
      set.status = 401
      return { error: 'Valid X-Wallet-Address header required' }
    }

    const keys = await getApiKeysForAddress(address)
    return {
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        tier: k.tier,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        requestCount: k.requestCount,
        isActive: k.isActive,
      })),
    }
  })

  .post('/v1/keys', async ({ request, body, set }) => {
    const address = getValidatedAddress(request)
    if (!address) {
      set.status = 401
      return { error: 'Valid X-Wallet-Address header required' }
    }

    const existingKeys = await getApiKeysForAddress(address)
    if (
      existingKeys.filter((k) => k.isActive).length >= MAX_API_KEYS_PER_ADDRESS
    ) {
      set.status = 400
      return {
        error: `Maximum API keys reached (${MAX_API_KEYS_PER_ADDRESS}). Revoke an existing key first.`,
      }
    }

    const bodyObj = (body || {}) as CreateApiKeyBody
    const name = (bodyObj.name || 'Default').slice(0, 100)
    const { key, record } = await createApiKey(address, name)

    set.status = 201
    return {
      message:
        'API key created. Store this key securely - it cannot be retrieved again.',
      key,
      id: record.id,
      name: record.name,
      tier: record.tier,
      createdAt: record.createdAt,
    }
  })

  .delete('/v1/keys/:keyId', async ({ params, request, set }) => {
    const address = getValidatedAddress(request)
    const keyId = params.keyId
    if (!address) {
      set.status = 401
      return { error: 'Valid X-Wallet-Address header required' }
    }
    if (!keyId || keyId.length !== 32) {
      set.status = 400
      return { error: 'Invalid key ID format' }
    }

    const success = await revokeApiKeyById(keyId, address)
    if (!success) {
      set.status = 404
      return { error: 'Key not found or not owned by this address' }
    }

    return { message: 'API key revoked', id: keyId }
  })

  // Usage & Staking Info
  .get('/v1/usage', async ({ request, set }) => {
    const address = getValidatedAddress(request)
    if (!address) {
      set.status = 401
      return { error: 'Valid X-Wallet-Address header required' }
    }

    const keys = await getApiKeysForAddress(address)
    const activeKeys = keys.filter((k) => k.isActive)
    const totalRequests = keys.reduce((sum, k) => sum + k.requestCount, 0)
    const tier = (set.headers['X-RateLimit-Tier'] ||
      'FREE') as keyof typeof RATE_LIMITS
    const remaining =
      set.headers['X-RateLimit-Remaining'] || String(RATE_LIMITS.FREE)

    return {
      address,
      currentTier: tier,
      rateLimit: RATE_LIMITS[tier],
      remaining: remaining === 'unlimited' ? -1 : Number(remaining),
      apiKeys: {
        total: keys.length,
        active: activeKeys.length,
        maxAllowed: MAX_API_KEYS_PER_ADDRESS,
      },
      totalRequests,
      tiers: {
        FREE: { stake: '0', limit: RATE_LIMITS.FREE },
        BASIC: { stake: '100 JEJU', limit: RATE_LIMITS.BASIC },
        PRO: { stake: '1,000 JEJU', limit: RATE_LIMITS.PRO },
        UNLIMITED: { stake: '10,000 JEJU', limit: 'unlimited' },
      },
    }
  })

  .get('/v1/stake', () => ({
    contract: process.env.RPC_STAKING_ADDRESS || 'Not deployed',
    pricing: 'USD-denominated (dynamic based on JEJU price)',
    tiers: {
      FREE: { minUsd: 0, rateLimit: 10, description: '10 requests/minute' },
      BASIC: { minUsd: 10, rateLimit: 100, description: '100 requests/minute' },
      PRO: {
        minUsd: 100,
        rateLimit: 1000,
        description: '1,000 requests/minute',
      },
      UNLIMITED: {
        minUsd: 1000,
        rateLimit: 'unlimited',
        description: 'Unlimited requests',
      },
    },
    unbondingPeriod: '7 days',
    reputationDiscount:
      'Up to 50% effective stake multiplier for high-reputation users',
    priceOracle: 'Chainlink-compatible, with $0.10 fallback',
  }))

  // X402 Payment Endpoints
  .get('/v1/payments', () => {
    const info = getPaymentInfo()
    return {
      x402Enabled: info.enabled,
      pricing: {
        standard: info.pricing.standard.toString(),
        archive: info.pricing.archive.toString(),
        trace: info.pricing.trace.toString(),
      },
      acceptedAssets: info.acceptedAssets,
      recipient: info.recipient,
      description: 'Pay-per-request pricing for RPC access without staking',
    }
  })

  .get('/v1/payments/credits', async ({ request, set }) => {
    const address = getValidatedAddress(request)
    if (!address) {
      set.status = 401
      return { error: 'Valid X-Wallet-Address header required' }
    }
    const balance = await getCredits(address)
    return {
      address,
      credits: balance.toString(),
      creditsFormatted: `${Number(balance) / 1e18} JEJU`,
    }
  })

  .post('/v1/payments/credits', async ({ request, body, set }) => {
    const address = getValidatedAddress(request)
    if (!address) {
      set.status = 401
      return { error: 'Valid X-Wallet-Address header required' }
    }

    const bodyObj = body as { txHash?: string; amount?: string }
    const { txHash, amount } = bodyObj
    if (!txHash || !amount) {
      set.status = 400
      return { error: 'txHash and amount required' }
    }

    const result = await purchaseCredits(address, txHash, BigInt(amount))
    return {
      success: result.success,
      newBalance: result.newBalance.toString(),
      message: 'Credits added to your account',
    }
  })

  .get('/v1/payments/requirement', ({ query, set }) => {
    const chainId = Number(query.chainId || '1')
    const method = query.method || 'eth_blockNumber'
    set.status = 402
    return generatePaymentRequirement(chainId, method)
  })

  // MCP Server Endpoints
  .post('/mcp/initialize', () => ({
    protocolVersion: '2024-11-05',
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_INFO.capabilities,
  }))

  .post('/mcp/resources/list', () => ({ resources: MCP_RESOURCES }))

  .post('/mcp/resources/read', async ({ body, set }) => {
    const bodyObj = body as { uri?: string }
    const { uri } = bodyObj
    if (!uri || typeof uri !== 'string') {
      set.status = 400
      return { error: 'Missing or invalid uri' }
    }

    let contents: MCPResourceContents
    switch (uri) {
      case 'rpc://chains':
        contents = Object.values(CHAINS).map((chain) => ({
          chainId: chain.chainId,
          name: chain.name,
          isTestnet: chain.isTestnet,
          endpoint: `/v1/rpc/${chain.chainId}`,
        }))
        break
      case 'rpc://health':
        contents = getEndpointHealth()
        break
      case 'rpc://tiers':
        contents = {
          FREE: { stake: 0, limit: 10 },
          BASIC: { stake: 100, limit: 100 },
          PRO: { stake: 1000, limit: 1000 },
          UNLIMITED: { stake: 10000, limit: 'unlimited' },
        }
        break
      default:
        set.status = 404
        return { error: 'Resource not found' }
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(contents, null, 2),
        },
      ],
    }
  })

  .post('/mcp/tools/list', () => ({ tools: MCP_TOOLS }))

  .post('/mcp/tools/call', async ({ body, set }) => {
    interface MCPToolCallBody {
      name: string
      arguments: Record<string, string | number | boolean | undefined>
    }
    const bodyObj = body as MCPToolCallBody
    const { name, arguments: args = {} } = bodyObj
    if (!name || typeof name !== 'string') {
      set.status = 400
      return { error: 'Missing or invalid tool name' }
    }

    let result: MCPToolResult
    let isError = false

    switch (name) {
      case 'list_chains': {
        const testnet =
          typeof args.testnet === 'boolean' ? args.testnet : undefined
        let chains = Object.values(CHAINS)
        if (testnet !== undefined)
          chains = chains.filter((ch) => ch.isTestnet === testnet)
        result = {
          chains: chains.map((ch) => ({
            chainId: ch.chainId,
            name: ch.name,
            isTestnet: ch.isTestnet,
          })),
        }
        break
      }
      case 'get_chain': {
        const chainId =
          typeof args.chainId === 'number' ? args.chainId : Number(args.chainId)
        if (Number.isNaN(chainId) || !isChainSupported(chainId)) {
          result = { error: `Unsupported chain: ${chainId}` }
          isError = true
        } else {
          const chain = getChain(chainId)
          result = {
            chainId: chain.chainId,
            name: chain.name,
            shortName: chain.shortName,
            rpcUrl: chain.rpcUrl,
            fallbackRpcs: chain.fallbackRpcs,
            explorerUrl: chain.explorerUrl,
            isTestnet: chain.isTestnet,
            nativeCurrency: chain.nativeCurrency,
          }
        }
        break
      }
      case 'create_api_key': {
        const address = typeof args.address === 'string' ? args.address : ''
        if (!address || !isAddress(address)) {
          result = { error: 'Invalid address' }
          isError = true
          break
        }
        const existingKeys = await getApiKeysForAddress(address as Address)
        if (
          existingKeys.filter((k) => k.isActive).length >=
          MAX_API_KEYS_PER_ADDRESS
        ) {
          result = {
            error: `Maximum API keys reached (${MAX_API_KEYS_PER_ADDRESS})`,
          }
          isError = true
          break
        }
        const keyName = (
          typeof args.name === 'string' ? args.name : 'MCP Generated'
        ).slice(0, 100)
        const { key, record } = await createApiKey(address as Address, keyName)
        result = { key, id: record.id, tier: record.tier }
        break
      }
      case 'check_rate_limit': {
        const address = typeof args.address === 'string' ? args.address : ''
        if (!address || !isAddress(address)) {
          result = { error: 'Invalid address' }
          isError = true
          break
        }
        const keys = await getApiKeysForAddress(address as Address)
        result = { address, apiKeys: keys.length, tiers: RATE_LIMITS }
        break
      }
      case 'get_usage': {
        const address = typeof args.address === 'string' ? args.address : ''
        if (!address || !isAddress(address)) {
          result = { error: 'Invalid address' }
          isError = true
          break
        }
        const keys = await getApiKeysForAddress(address as Address)
        result = {
          address,
          apiKeys: keys.length,
          totalRequests: keys.reduce((sum, k) => sum + k.requestCount, 0),
        }
        break
      }
      default:
        result = { error: 'Tool not found' }
        isError = true
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError,
    }
  })

  .get('/mcp', () => ({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: MCP_SERVER_INFO.description,
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS,
    capabilities: MCP_SERVER_INFO.capabilities,
  }))

// Export app type for Eden
export type RpcApp = typeof rpcApp

// Server startup function
export function startRpcServer(port = 4004, host = '0.0.0.0') {
  console.log(`RPC Gateway starting on http://${host}:${port}`)
  console.log(`   Supported chains: ${Object.keys(CHAINS).length}`)
  console.log(`   MCP endpoint: http://${host}:${port}/mcp`)
  console.log(`   RPC endpoint: http://${host}:${port}/v1/rpc/:chainId`)

  return {
    port,
    hostname: host,
    fetch: rpcApp.fetch,
  }
}

export default rpcApp
