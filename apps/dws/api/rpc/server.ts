/**
 * RPC Gateway Server
 * Multi-chain RPC proxy with stake-based rate limiting and X402 payments
 */

import { cors } from '@elysiajs/cors'
import {
  RPC_CHAINS as CHAINS,
  getRpcChain as getChain,
  getCurrentNetwork,
  getRpcMainnetChains as getMainnetChains,
  getRpcTestnetChains as getTestnetChains,
  isRpcChainSupported as isChainSupported,
  tryGetContract,
} from '@jejunetwork/config'
import { AddressSchema, JsonValueSchema } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { type Address, isAddress } from 'viem'
import { z } from 'zod'
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

// Zod schemas for request validation
const RpcRequestBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string(),
  params: z.array(JsonValueSchema).optional(),
})

const RpcBatchRequestSchema = z.array(RpcRequestBodySchema).min(1).max(100)

const CreateApiKeyBodySchema = z.object({
  name: z.string().max(100).optional(),
})

const MCPResourceReadSchema = z.object({
  uri: z.string().min(1),
})

const MCPToolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), JsonValueSchema).default({}),
})

const PurchaseCreditsSchema = z.object({
  txHash: z.string().min(1),
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
})

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

  .get('/health', async () => {
    const chainStats = getChainStats()
    const rateLimitStats = await getRateLimitStats()
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
          healthy: health[chain.rpcUrl].healthy ?? true,
        },
        fallbacks: chain.fallbackRpcs.map((url) => ({
          url,
          healthy: health[url].healthy ?? true,
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

    // Get user address for x402 payment processing
    const userAddressHeader = request.headers.get('X-Wallet-Address')
    const userAddress =
      userAddressHeader && isAddress(userAddressHeader)
        ? userAddressHeader
        : undefined
    const paymentHeader = request.headers.get('X-Payment') ?? undefined

    // Validate batch request
    if (Array.isArray(body)) {
      const batchResult = RpcBatchRequestSchema.safeParse(body)
      if (!batchResult.success) {
        set.status = 400
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid batch request format' },
        }
      }

      const rpcBatch = batchResult.data
      const firstMethod = rpcBatch[0].method
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
        rpcBatch as JsonRpcRequest[],
      )
      return results.map((r) => r.response)
    }

    // Validate single request
    const singleResult = RpcRequestBodySchema.safeParse(body)
    if (!singleResult.success) {
      set.status = 400
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request: Missing method' },
      }
    }

    const singleRequest = singleResult.data as JsonRpcRequest

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

    const validated = CreateApiKeyBodySchema.safeParse(body ?? {})
    const name = validated.success
      ? (validated.data.name ?? 'Default')
      : 'Default'
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
    const totalRequests = keys.reduce(
      (sum, k) => sum + (k.requestCount ?? 0),
      0,
    )
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

  .get('/v1/stake', () => {
    const network = getCurrentNetwork()
    const stakingAddress = tryGetContract('rpc', 'staking', network)
    return {
      contract:
        (typeof process !== 'undefined'
          ? process.env.RPC_STAKING_ADDRESS
          : undefined) ??
        stakingAddress ??
        'Not deployed',
      pricing: 'USD-denominated (dynamic based on JEJU price)',
      tiers: {
        FREE: { minUsd: 0, rateLimit: 10, description: '10 requests/minute' },
        BASIC: {
          minUsd: 10,
          rateLimit: 100,
          description: '100 requests/minute',
        },
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
    }
  })

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

    const validated = PurchaseCreditsSchema.safeParse(body)
    if (!validated.success) {
      set.status = 400
      return { error: 'txHash and amount required' }
    }

    const { txHash, amount } = validated.data
    const result = await purchaseCredits(address, txHash, BigInt(amount))
    return {
      success: result.success,
      newBalance: (result.newBalance ?? 0n).toString(),
      message: 'Credits added to your account',
    }
  })

  .get('/v1/payments/requirement', ({ query, set }) => {
    const chainId = Number(query.chainId ?? '1')
    const method = query.method ?? 'eth_blockNumber'
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
    const validated = MCPResourceReadSchema.safeParse(body)
    if (!validated.success) {
      set.status = 400
      return { error: 'Missing or invalid uri' }
    }

    const { uri } = validated.data
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
    const validated = MCPToolCallSchema.safeParse(body)
    if (!validated.success) {
      set.status = 400
      return { error: 'Missing or invalid tool name' }
    }

    const { name, arguments: args } = validated.data
    let result: MCPToolResult
    let isError = false

    // Zod schemas for tool arguments
    const ListChainsArgsSchema = z.object({
      testnet: z.boolean().optional(),
    })
    const GetChainArgsSchema = z.object({
      chainId: z.coerce.number(),
    })
    const CreateApiKeyArgsSchema = z.object({
      address: AddressSchema,
      name: z.string().max(100).optional(),
    })
    const AddressArgsSchema = z.object({
      address: AddressSchema,
    })

    switch (name) {
      case 'list_chains': {
        const argsResult = ListChainsArgsSchema.safeParse(args)
        const testnet = argsResult.success ? argsResult.data.testnet : undefined
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
        const argsResult = GetChainArgsSchema.safeParse(args)
        if (!argsResult.success) {
          result = { error: 'chainId is required' }
          isError = true
          break
        }
        const chainId = argsResult.data.chainId
        if (!isChainSupported(chainId)) {
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
        const argsResult = CreateApiKeyArgsSchema.safeParse(args)
        if (!argsResult.success) {
          result = { error: 'Invalid address' }
          isError = true
          break
        }
        const address = argsResult.data.address
        const existingKeys = await getApiKeysForAddress(address)
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
        const keyName = argsResult.data.name ?? 'MCP Generated'
        const { key, record } = await createApiKey(address, keyName)
        result = { key, id: record.id, tier: record.tier }
        break
      }
      case 'check_rate_limit': {
        const argsResult = AddressArgsSchema.safeParse(args)
        if (!argsResult.success) {
          result = { error: 'Invalid address' }
          isError = true
          break
        }
        const address = argsResult.data.address
        const keys = await getApiKeysForAddress(address)
        result = { address, apiKeys: keys.length, tiers: RATE_LIMITS }
        break
      }
      case 'get_usage': {
        const argsResult = AddressArgsSchema.safeParse(args)
        if (!argsResult.success) {
          result = { error: 'Invalid address' }
          isError = true
          break
        }
        const address = argsResult.data.address
        const keys = await getApiKeysForAddress(address)
        result = {
          address,
          apiKeys: keys.length,
          totalRequests: keys.reduce(
            (sum, k) => sum + (k.requestCount ?? 0),
            0,
          ),
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
