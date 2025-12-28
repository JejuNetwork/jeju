import { cors } from '@elysiajs/cors'
import {
  RPC_CHAINS as CHAINS,
  getRpcChain as getChain,
  getContract,
  getCurrentNetwork,
  getRpcMainnetChains as getMainnetChains,
  getRpcTestnetChains as getTestnetChains,
  isRpcChainSupported as isChainSupported,
  isProductionEnv,
} from '@jejunetwork/config'
import {
  expectValid as expect,
  expectAddress,
  expectChainId,
  type JsonRpcRequest,
} from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { type Address, isAddress } from 'viem'
import { z } from 'zod'
import {
  JsonObjectSchema,
  KeyIdSchema,
  PaymentRequirementQuerySchema,
  PurchaseCreditsRequestSchema,
  RpcBatchRequestSchema,
  RpcRequestSchema,
  validateBody,
  validateQuery,
} from '../../lib/validation'
import {
  getRateLimitStats,
  RATE_LIMITS,
  rateLimiterPlugin,
} from './middleware/rate-limiter'
import {
  getChainStats,
  getEndpointHealth,
  proxyBatchRequest,
  proxyRequest,
} from './proxy/rpc-proxy'
import {
  createApiKey,
  getApiKeyStats,
  getApiKeysForAddress,
  revokeApiKeyById,
} from './services/api-keys'
import {
  generatePaymentRequirement,
  getCredits,
  getPaymentInfo,
  processPayment,
  purchaseCredits,
} from './services/x402-payments'

interface ChainSummary {
  chainId: number
  name: string
  isTestnet: boolean
  endpoint: string
}

interface TierConfig {
  stake: number
  limit: number | string
}

type RpcMcpResourceContents =
  | ChainSummary[]
  | ReturnType<typeof getEndpointHealth>
  | Record<string, TierConfig>

interface ListChainsResult {
  chains: Array<{ chainId: number; name: string; isTestnet: boolean }>
}

interface CreateApiKeyResult {
  key: string
  id: string
  tier: string
}

interface CheckRateLimitResult {
  address: string
  apiKeys: number
  tiers: typeof RATE_LIMITS
}

interface GetUsageResult {
  address: string
  apiKeys: number
  totalRequests: number
}

interface McpErrorResult {
  error: string
}

/** Union of all possible MCP tool results */
type RpcMcpToolResult =
  | ListChainsResult
  | ReturnType<typeof getChain>
  | CreateApiKeyResult
  | CheckRateLimitResult
  | GetUsageResult
  | McpErrorResult

const CORS_ORIGINS_ENV = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = isProductionEnv()
const CORS_ORIGINS =
  isProduction && CORS_ORIGINS_ENV?.length ? CORS_ORIGINS_ENV : ['*']

const MAX_API_KEYS_PER_ADDRESS = 10
const MAX_BODY_SIZE = 512 * 1024

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

function getValidatedAddress(request: Request): Address | null {
  const address = request.headers.get('X-Wallet-Address')
  if (!address || !isAddress(address)) return null
  return address // isAddress validates the format
}

const securityHeaders = new Elysia({ name: 'security-headers' }).onAfterHandle(
  ({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-XSS-Protection'] = '1; mode=block'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    set.headers['Content-Security-Policy'] = "default-src 'self'"
  },
)

const loggerPlugin = new Elysia({ name: 'logger' }).onBeforeHandle(
  ({ request }) => {
    console.log(`${request.method} ${new URL(request.url).pathname}`)
  },
)

export const rpcApp = new Elysia({ name: 'rpc-gateway' })
  .use(securityHeaders)
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
  .use(loggerPlugin)
  .onParse(async ({ request }) => {
    // Check body size limit
    const contentLength = request.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      throw new Error('Request body too large')
    }
    return undefined
  })
  .onError(({ error, set }) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[RPC Gateway Error] ${errorMessage}`, errorStack)
    if (errorMessage === 'Request body too large') {
      set.status = 413
      return { error: 'Request body too large', maxSize: MAX_BODY_SIZE }
    }
    set.status = 500
    return { error: 'Internal server error' }
  })
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
  .post('/mcp/initialize', () => ({
    protocolVersion: '2024-11-05',
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_INFO.capabilities,
  }))
  .post('/mcp/resources/list', () => ({ resources: MCP_RESOURCES }))
  .post('/mcp/resources/read', async ({ body, set }) => {
    const validated = validateBody(
      z.object({ uri: z.string().min(1) }),
      body,
      'MCP resource read',
    )
    const { uri } = validated

    let contents: RpcMcpResourceContents
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
  .post('/mcp/tools/call', async ({ body }) => {
    let result: RpcMcpToolResult
    let isError = false

    // MCP tool argument schemas
    const ListChainsArgsSchema = z.object({
      testnet: z.boolean().optional(),
    })
    const GetChainArgsSchema = z.object({
      chainId: z.number(),
    })
    const CreateApiKeyArgsSchema = z.object({
      address: z.string(),
      name: z.string().optional(),
    })
    const AddressArgsSchema = z.object({
      address: z.string(),
    })

    const validated = validateBody(
      z.object({
        name: z.string().min(1),
        arguments: JsonObjectSchema.nullable().default({}),
      }),
      body,
      'MCP tool call',
    )
    const { name, arguments: rawArgs } = validated
    const args = rawArgs ?? {}

    switch (name) {
      case 'list_chains': {
        const parsed = ListChainsArgsSchema.safeParse(args)
        const testnet = parsed.success ? parsed.data.testnet : undefined
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
        const parsed = expect(GetChainArgsSchema, args, 'get_chain arguments')
        const chainId = expectChainId(parsed.chainId, 'chainId')
        if (!isChainSupported(chainId)) {
          result = { error: `Unsupported chain: ${chainId}` }
          isError = true
        } else {
          result = getChain(chainId)
        }
        break
      }
      case 'create_api_key': {
        const parsed = expect(
          CreateApiKeyArgsSchema,
          args,
          'create_api_key arguments',
        )
        const address = expectAddress(parsed.address, 'address')
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
        const keyName = (parsed.name ?? 'MCP Generated').slice(0, 100)
        const { key, record } = await createApiKey(address, keyName)
        result = { key, id: record.id, tier: record.tier }
        break
      }
      case 'check_rate_limit': {
        const parsed = expect(
          AddressArgsSchema,
          args,
          'check_rate_limit arguments',
        )
        const address = expectAddress(parsed.address, 'address')
        const keys = await getApiKeysForAddress(address)
        result = { address, apiKeys: keys.length, tiers: RATE_LIMITS }
        break
      }
      case 'get_usage': {
        const parsed = expect(AddressArgsSchema, args, 'get_usage arguments')
        const address = expectAddress(parsed.address, 'address')
        const keys = await getApiKeysForAddress(address)
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
  .group('/v1', (app) =>
    app
      .use(rateLimiterPlugin)
      .get('/chains', ({ query }) => {
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
      .get('/chains/:chainId', ({ params, set }) => {
        const chainIdParam = Number(params.chainId)
        const chainId = expectChainId(chainIdParam, 'chainId')
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
      .post('/rpc/:chainId', async ({ params, body, request, set }) => {
        const chainIdParam = Number(params.chainId)
        const chainId = expectChainId(chainIdParam, 'chainId')

        if (!isChainSupported(chainId)) {
          set.status = 400
          return {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32001, message: `Unsupported chain: ${chainId}` },
          }
        }

        const userAddressHeader = request.headers.get('X-Wallet-Address')
        const userAddress =
          userAddressHeader && isAddress(userAddressHeader)
            ? userAddressHeader
            : undefined
        const paymentHeader = request.headers.get('X-Payment') ?? undefined

        if (Array.isArray(body)) {
          const validated = expect(
            RpcBatchRequestSchema,
            body,
            'RPC batch request',
          )

          const firstMethod = validated[0].method ?? 'eth_call'
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

          // Type cast: RpcBatchRequestSchema produces optional params, but proxyBatchRequest handles this
          const results = await proxyBatchRequest(
            chainId,
            validated as JsonRpcRequest[],
          )
          return results.map((r) => r.response)
        }

        const rpcBody = expect(RpcRequestSchema, body, 'RPC request')

        const paymentResult = await processPayment(
          paymentHeader,
          chainId,
          rpcBody.method,
          userAddress,
        )
        if (!paymentResult.allowed) {
          set.headers['X-Payment-Required'] = 'true'
          set.status = 402
          return {
            jsonrpc: '2.0',
            id: rpcBody.id,
            error: {
              code: 402,
              message: 'Payment required',
              data: paymentResult.requirement,
            },
          }
        }

        // Type cast: RpcRequestSchema produces optional params, but proxyRequest handles this
        const result = await proxyRequest(chainId, rpcBody as JsonRpcRequest)
        set.headers['X-RPC-Latency-Ms'] = String(result.latencyMs)
        if (result.usedFallback) set.headers['X-RPC-Used-Fallback'] = 'true'

        return result.response
      })
      .get('/keys', async ({ request, set }) => {
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
      .post('/keys', async ({ body, request, set }) => {
        const address = getValidatedAddress(request)
        if (!address) {
          set.status = 401
          return { error: 'Valid X-Wallet-Address header required' }
        }

        const existingKeys = await getApiKeysForAddress(address)
        if (
          existingKeys.filter((k) => k.isActive).length >=
          MAX_API_KEYS_PER_ADDRESS
        ) {
          set.status = 400
          return {
            error: `Maximum API keys reached (${MAX_API_KEYS_PER_ADDRESS}). Revoke an existing key first.`,
          }
        }

        // Body schema for API key creation - only name from body, address from header
        const ApiKeyBodySchema = z
          .object({ name: z.string().max(100).optional() })
          .nullable()
        const parsed = ApiKeyBodySchema.safeParse(body)
        const name = (parsed.success ? parsed.data?.name : null) ?? 'Default'
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
      .delete('/keys/:keyId', async ({ params, request, set }) => {
        const address = getValidatedAddress(request)
        if (!address) {
          set.status = 401
          return { error: 'Valid X-Wallet-Address header required' }
        }

        const keyId = expect(KeyIdSchema, params.keyId, 'keyId')
        const success = await revokeApiKeyById(keyId, address)
        if (!success) {
          set.status = 404
          return { error: 'Key not found or not owned by this address' }
        }

        return { message: 'API key revoked', id: keyId }
      })
      .get('/usage', async ({ request, set, rateLimit }) => {
        const address = getValidatedAddress(request)
        if (!address) {
          set.status = 401
          return { error: 'Valid X-Wallet-Address header required' }
        }

        const keys = await getApiKeysForAddress(address)
        const activeKeys = keys.filter((k) => k.isActive)
        const totalRequests = keys.reduce((sum, k) => sum + k.requestCount, 0)
        const tier = (rateLimit?.tier ?? 'FREE') as keyof typeof RATE_LIMITS
        const remaining = rateLimit?.remaining ?? RATE_LIMITS.FREE

        return {
          address,
          currentTier: tier,
          rateLimit: RATE_LIMITS[tier],
          remaining: remaining === -1 ? -1 : remaining,
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
      .get('/stake', () => {
        const network = getCurrentNetwork()
        const stakingAddress =
          getContract('rpc', 'staking', network) || 'Not deployed'
        return {
          contract: stakingAddress,
          pricing: 'USD-denominated (dynamic based on JEJU price)',
          tiers: {
            FREE: {
              minUsd: 0,
              rateLimit: 10,
              description: '10 requests/minute',
            },
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
      .get('/payments', () => {
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
      .get('/payments/credits', async (request, set) => {
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
      .post('/payments/credits', async (body, request, set) => {
        const address = getValidatedAddress(request)
        if (!address) {
          set.status = 401
          return { error: 'Valid X-Wallet-Address header required' }
        }

        const validated = validateBody(
          PurchaseCreditsRequestSchema,
          body,
          'purchase credits',
        )
        const result = await purchaseCredits(
          address,
          validated.txHash,
          BigInt(validated.amount),
        )
        return {
          success: result.success,
          newBalance: result.newBalance.toString(),
          message: 'Credits added to your account',
        }
      })
      .get('/payments/requirement', (query, set) => {
        const validated = validateQuery(
          PaymentRequirementQuerySchema,
          query,
          'payment requirement',
        )
        const chainId = validated.chainId ?? 1
        const method = validated.method ?? 'eth_blockNumber'
        set.status = 402
        return generatePaymentRequirement(chainId, method)
      }),
  )

export type RpcApp = typeof rpcApp

export function _startRpcServer(port = 4004, host = '0.0.0.0') {
  console.log(`🌐 RPC Gateway starting on http://${host}:${port}`)
  console.log(`   Supported chains: ${Object.keys(CHAINS).length}`)
  console.log(`   MCP endpoint: http://${host}:${port}/mcp`)
  console.log(`   RPC endpoint: http://${host}:${port}/v1/rpc/:chainId`)

  return rpcApp.listen({
    port,
    hostname: host,
  })
}

export default rpcApp
