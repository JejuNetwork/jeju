/**
 * REST API Server for Indexer
 * SQLit-based implementation
 */

import { cors } from '@elysiajs/cors'
import { getLocalhostHost } from '@jejunetwork/config'
import { type Context, Elysia } from 'elysia'
import { z } from 'zod'
import { config } from './config'
import { count, find, type RegisteredAgent } from './db'
import { getAccountByAddress } from './utils/account-utils'
import { getAgentsByTag } from './utils/agent-utils'
import { getBlockByIdentifier } from './utils/block-detail-utils'
import { getBlocks } from './utils/block-query-utils'
import { mapContainerListResponse } from './utils/container-utils'
import { getIndexerMode, isSchemaReady } from './utils/db'
import {
  mapAgentSummary,
  mapBlockDetail,
  mapBlockSummary,
  mapTransactionDetail,
  mapTransactionSummary,
} from './utils/mappers'
import { getNodes } from './utils/node-query-utils'
import { mapNodeResponse } from './utils/node-utils'
import { getOracleOperatorByAddress } from './utils/oracle-operator-utils'
import { getOracleFeedDetail } from './utils/oracle-utils'
import { getProviders } from './utils/provider-query-utils'
import {
  getContainerDetail,
  getFullStackProviders,
} from './utils/provider-utils'
import {
  buildContainersQuery,
  buildContractsQuery,
  buildCrossServiceRequestsQuery,
  buildOracleDisputesQuery,
  buildOracleFeedsQuery,
  buildOracleOperatorsQuery,
  buildOracleReportsQuery,
  buildTokenTransfersQuery,
} from './utils/query-utils'
import {
  mapAccountResponse,
  mapContractResponse,
  mapCrossServiceRequestResponse,
  mapOracleDisputeResponse,
  mapOracleFeedResponse,
  mapOracleOperatorResponse,
  mapOracleReportResponse,
  mapTokenTransferResponse,
} from './utils/response-utils'
import { getAgentById, getPopularTags, search } from './utils/search'
import { security } from './utils/security'
import {
  getRateLimitStats,
  RATE_LIMITS,
  stakeRateLimiter,
} from './utils/stake-rate-limiter'
import {
  getMarketplaceStats,
  getNetworkStats,
  getOracleStats,
} from './utils/stats-utils'
import {
  getTransactionByHash,
  getTransactions,
} from './utils/transaction-utils'
import { NotFoundError } from './utils/types'
import {
  accountAddressParamSchema,
  agentIdParamSchema,
  agentsQuerySchema,
  agentTagParamSchema,
  blockNumberOrHashParamSchema,
  blocksQuerySchema,
  containerCidParamSchema,
  containersQuerySchema,
  contractsQuerySchema,
  crossServiceRequestsQuerySchema,
  nodesQuerySchema,
  oracleDisputesQuerySchema,
  oracleFeedIdParamSchema,
  oracleFeedsQuerySchema,
  oracleOperatorAddressParamSchema,
  oracleOperatorsQuerySchema,
  oracleReportsQuerySchema,
  paginationSchema,
  providersQuerySchema,
  restSearchParamsSchema,
  type SearchParams,
  tokenTransfersQuerySchema,
  transactionHashParamSchema,
  transactionsQuerySchema,
  validateParams,
  validateQuery,
} from './utils/validation'

const REST_PORT = config.restPort

if (!REST_PORT || REST_PORT <= 0 || REST_PORT > 65535) {
  throw new Error(
    `Invalid REST_PORT: ${REST_PORT}. Must be between 1 and 65535`,
  )
}

const CORS_ORIGINS = config.corsOrigins

// Default CORS origins for cross-origin GraphQL/API access
const DEFAULT_CORS_ORIGINS = [
  'https://gateway.testnet.jejunetwork.org',
  'https://gateway.jejunetwork.org',
  'https://dws.testnet.jejunetwork.org',
  'https://dws.jejunetwork.org',
  'https://jejunetwork.org',
]

const effectiveCorsOrigins =
  CORS_ORIGINS.length > 0 ? CORS_ORIGINS : DEFAULT_CORS_ORIGINS

const corsOptions = {
  origin: effectiveCorsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'] as ('GET' | 'POST' | 'OPTIONS')[],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Wallet-Address',
    'X-Agent-Id',
  ],
}

const app = new Elysia()
  .use(cors(corsOptions))
  .use(security({ service: 'indexer-rest' }))
  .use(stakeRateLimiter({ skipPaths: ['/health', '/'] }))
  .get('/health', () => ({
    status: isSchemaReady() ? 'ok' : 'degraded',
    service: 'indexer-rest',
    port: REST_PORT,
    mode: getIndexerMode(),
    schemaReady: isSchemaReady(),
  }))
  .get('/', () => ({
    name: 'Indexer REST API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      search: '/api/search',
      agents: '/api/agents',
      blocks: '/api/blocks',
      transactions: '/api/transactions',
      contracts: '/api/contracts',
      tokens: '/api/tokens',
      nodes: '/api/nodes',
      providers: '/api/providers',
      tags: '/api/tags',
      stats: '/api/stats',
      containers: '/api/containers',
      crossServiceRequests: '/api/cross-service/requests',
      marketplaceStats: '/api/marketplace/stats',
      fullStackProviders: '/api/full-stack',
      oracleFeeds: '/api/oracle/feeds',
      oracleOperators: '/api/oracle/operators',
      oracleReports: '/api/oracle/reports',
      oracleDisputes: '/api/oracle/disputes',
      oracleStats: '/api/oracle/stats',
    },
    graphql: `http://${getLocalhostHost()}:4350/graphql`,
    rateLimits: RATE_LIMITS,
  }))
  .get('/api/search', async (ctx: Context) => {
    const validated = validateQuery(
      restSearchParamsSchema,
      ctx.query,
      'GET /api/search',
    )

    const params: Partial<SearchParams> = {
      query: validated.q,
      endpointType: validated.type,
      tags: validated.tags,
      category: validated.category,
      minStakeTier: validated.minTier,
      verified: validated.verified,
      active: validated.active,
      limit: validated.limit,
      offset: validated.offset,
    }

    return await search(params)
  })
  .get('/api/tags', async (ctx: Context) => {
    validateQuery(z.object({}).passthrough(), ctx.query, 'GET /api/tags')
    const tags = await getPopularTags(100)
    return { tags, total: tags.length }
  })
  .get('/api/agents', async (ctx: Context) => {
    const validated = validateQuery(
      agentsQuerySchema,
      ctx.query,
      'GET /api/agents',
    )

    const where: { active?: boolean } = {}
    if (validated.active !== undefined) {
      where.active = validated.active
    }

    const agents = await find<RegisteredAgent>('RegisteredAgent', {
      where,
      order: { registeredAt: 'DESC' },
      take: validated.limit,
      skip: validated.offset,
    })
    const total = await count('RegisteredAgent', where)

    return {
      agents: agents.map((a) => mapAgentSummary(a)),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/agents/:id', async (ctx: Context) => {
    const { id } = validateParams(
      agentIdParamSchema,
      ctx.params,
      'GET /api/agents/:id',
    )

    const agent = await getAgentById(id)
    if (!agent) {
      ctx.set.status = 404
      return { error: `Agent not found: ${id}` }
    }

    return agent
  })
  .get('/api/agents/tag/:tag', async (ctx: Context) => {
    const { tag } = validateParams(
      agentTagParamSchema,
      ctx.params,
      'GET /api/agents/tag/:tag',
    )
    const validated = validateQuery(
      paginationSchema,
      ctx.query,
      'GET /api/agents/tag/:tag',
    )

    const result = await getAgentsByTag(tag, validated.limit)

    return {
      tag: result.tag,
      agents: result.agents.map(mapAgentSummary),
      count: result.agents.length,
    }
  })
  .get('/api/blocks', async (ctx: Context) => {
    const validated = validateQuery(
      blocksQuerySchema,
      ctx.query,
      'GET /api/blocks',
    )

    const blocks = await getBlocks({
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      blocks: blocks.map(mapBlockSummary),
    }
  })
  .get('/api/blocks/:numberOrHash', async (ctx: Context) => {
    const { numberOrHash } = validateParams(
      blockNumberOrHashParamSchema,
      ctx.params,
      'GET /api/blocks/:numberOrHash',
    )

    const block = await getBlockByIdentifier(numberOrHash)
    if (!block) {
      ctx.set.status = 404
      return { error: `Block not found: ${numberOrHash}` }
    }

    return {
      ...mapBlockDetail(block),
      baseFeePerGas: block.baseFeePerGas ?? null,
      size: block.size,
    }
  })
  .get('/api/transactions', async (ctx: Context) => {
    const validated = validateQuery(
      transactionsQuerySchema,
      ctx.query,
      'GET /api/transactions',
    )

    const txs = await getTransactions({
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      transactions: txs.map(mapTransactionSummary),
    }
  })
  .get('/api/transactions/:hash', async (ctx: Context) => {
    const { hash } = validateParams(
      transactionHashParamSchema,
      ctx.params,
      'GET /api/transactions/:hash',
    )

    const tx = await getTransactionByHash(hash)

    if (!tx) {
      ctx.set.status = 404
      return { error: `Transaction not found: ${hash}` }
    }

    return {
      ...mapTransactionDetail(tx),
      gasLimit: tx.gasLimit,
      input: tx.input,
      nonce: tx.nonce,
    }
  })
  .get('/api/accounts/:address', async (ctx: Context) => {
    const { address } = validateParams(
      accountAddressParamSchema,
      ctx.params,
      'GET /api/accounts/:address',
    )

    const account = await getAccountByAddress(address)

    if (!account) {
      ctx.set.status = 404
      return { error: `Account not found: ${address.toLowerCase()}` }
    }

    return mapAccountResponse(account)
  })
  .get('/api/contracts', async (ctx: Context) => {
    const validated = validateQuery(
      contractsQuerySchema,
      ctx.query,
      'GET /api/contracts',
    )

    const { contracts, total } = await buildContractsQuery({
      type: validated.type,
      name: validated.name,
      limit: validated.limit,
      offset: validated.offset ?? 0,
    })

    return {
      contracts: contracts.map(mapContractResponse),
      total,
    }
  })
  .get('/api/tokens/transfers', async (ctx: Context) => {
    const validated = validateQuery(
      tokenTransfersQuerySchema,
      ctx.query,
      'GET /api/tokens/transfers',
    )

    const { transfers, total } = await buildTokenTransfersQuery({
      token: validated.token,
      from: validated.from,
      to: validated.to,
      transactionHash: validated.transactionHash,
      limit: validated.limit,
      offset: validated.offset ?? 0,
    })

    return {
      transfers: transfers.map(mapTokenTransferResponse),
      total,
    }
  })
  .get('/api/nodes', async (ctx: Context) => {
    const validated = validateQuery(
      nodesQuerySchema,
      ctx.query,
      'GET /api/nodes',
    )

    const nodes = await getNodes({
      active: validated.active,
      limit: validated.limit,
    })

    return {
      nodes: nodes.map(mapNodeResponse),
      total: nodes.length,
    }
  })
  .get('/api/providers', async (ctx: Context) => {
    const validated = validateQuery(
      providersQuerySchema,
      ctx.query,
      'GET /api/providers',
    )

    const result = await getProviders({
      type: validated.type,
      limit: validated.limit,
    })

    return result
  })
  .get('/api/containers', async (ctx: Context) => {
    const validated = validateQuery(
      containersQuerySchema,
      ctx.query,
      'GET /api/containers',
    )

    const { containers, total } = await buildContainersQuery({
      verified: validated.verified,
      gpu: validated.gpu,
      tee: validated.tee,
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      containers: containers.map(mapContainerListResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/containers/:cid', async (ctx: Context) => {
    const { cid } = validateParams(
      containerCidParamSchema,
      ctx.params,
      'GET /api/containers/:cid',
    )
    const container = await getContainerDetail(cid)
    if (!container) {
      ctx.set.status = 404
      return { error: `Container not found: ${cid}` }
    }
    return mapContainerListResponse(container)
  })
  .get('/api/cross-service/requests', async (ctx: Context) => {
    const validated = validateQuery(
      crossServiceRequestsQuerySchema,
      ctx.query,
      'GET /api/cross-service/requests',
    )

    const { requests, total } = await buildCrossServiceRequestsQuery({
      status: validated.status,
      type: validated.type,
      agentId: validated.agentId,
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      requests: requests.map(mapCrossServiceRequestResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/marketplace/stats', async (ctx: Context) => {
    validateQuery(
      z.object({}).passthrough(),
      ctx.query,
      'GET /api/marketplace/stats',
    )
    return await getMarketplaceStats()
  })
  .get('/api/full-stack', async (ctx: Context) => {
    const validated = validateQuery(
      paginationSchema.extend({
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      ctx.query,
      'GET /api/full-stack',
    )
    return await getFullStackProviders(validated.limit, validated.offset)
  })
  .get('/api/oracle/feeds', async (ctx: Context) => {
    const validated = validateQuery(
      oracleFeedsQuerySchema,
      ctx.query,
      'GET /api/oracle/feeds',
    )

    const { feeds, total } = await buildOracleFeedsQuery({
      isActive: validated.active,
      category: validated.category,
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      feeds: feeds.map(mapOracleFeedResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/feeds/:feedId', async (ctx: Context) => {
    const { feedId } = validateParams(
      oracleFeedIdParamSchema,
      ctx.params,
      'GET /api/oracle/feeds/:feedId',
    )
    return await getOracleFeedDetail(feedId)
  })
  .get('/api/oracle/operators', async (ctx: Context) => {
    const validated = validateQuery(
      oracleOperatorsQuerySchema,
      ctx.query,
      'GET /api/oracle/operators',
    )

    const { operators, total } = await buildOracleOperatorsQuery({
      isActive: validated.active,
      isJailed: validated.jailed,
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      operators: operators.map(mapOracleOperatorResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/operators/:address', async (ctx: Context) => {
    const { address } = validateParams(
      oracleOperatorAddressParamSchema,
      ctx.params,
      'GET /api/oracle/operators/:address',
    )

    const operator = await getOracleOperatorByAddress(address)

    if (!operator) {
      ctx.set.status = 404
      return { error: `Oracle Operator not found: ${address.toLowerCase()}` }
    }

    return {
      operator: mapOracleOperatorResponse(operator),
    }
  })
  .get('/api/oracle/reports', async (ctx: Context) => {
    const validated = validateQuery(
      oracleReportsQuerySchema,
      ctx.query,
      'GET /api/oracle/reports',
    )

    const { reports, total } = await buildOracleReportsQuery({
      feedId: validated.feedId,
      operatorAddress: validated.operatorAddress,
      isDisputed: validated.disputed,
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      reports: reports.map(mapOracleReportResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/disputes', async (ctx: Context) => {
    const validated = validateQuery(
      oracleDisputesQuerySchema,
      ctx.query,
      'GET /api/oracle/disputes',
    )

    const { disputes, total } = await buildOracleDisputesQuery({
      status: validated.status,
      feedId: validated.feedId,
      reporter: validated.reporter,
      challenger: validated.challenger,
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      disputes: disputes.map(mapOracleDisputeResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/stats', async (ctx: Context) => {
    validateQuery(
      z.object({}).passthrough(),
      ctx.query,
      'GET /api/oracle/stats',
    )
    return await getOracleStats()
  })
  .get('/api/stats', async (ctx: Context) => {
    validateQuery(z.object({}).passthrough(), ctx.query, 'GET /api/stats')
    const stats = await getNetworkStats()
    return {
      ...stats,
      rateLimitStats: getRateLimitStats(),
    }
  })
  .get('/api/rate-limits', () => ({
    tiers: RATE_LIMITS,
    thresholds: {
      FREE: { minUsd: 0, limit: RATE_LIMITS.FREE },
      BASIC: { minUsd: 10, limit: RATE_LIMITS.BASIC },
      PRO: { minUsd: 100, limit: RATE_LIMITS.PRO },
      UNLIMITED: { minUsd: 1000, limit: 'unlimited' },
    },
    stats: getRateLimitStats(),
    note: 'Stake tokens to increase rate limits',
  }))
  // GraphQL playground - serve HTML interface
  .get('/graphql', async () => {
    const playgroundPath = `${import.meta.dir}/../public/playground.html`
    const file = Bun.file(playgroundPath)
    if (await file.exists()) {
      const html = await file.text()
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
    // Fallback: redirect to the Subsquid GraphQL server
    const graphqlPort = process.env.GQL_PORT ?? '4350'
    return Response.redirect(`http://localhost:${graphqlPort}/graphql`, 302)
  })
  // Playground alias
  .get('/playground', async () => {
    const playgroundPath = `${import.meta.dir}/../public/playground.html`
    const file = Bun.file(playgroundPath)
    if (await file.exists()) {
      const html = await file.text()
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
    // Fallback: redirect to /graphql
    return Response.redirect('/graphql', 302)
  })
  // GraphQL proxy with CORS - forwards to Subsquid GraphQL server
  .post('/graphql', async (ctx: Context) => {
    // Validate request body structure
    const body = ctx.body as Record<string, unknown> | undefined
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.query !== 'string' ||
      body.query.length > 10000 // Limit query size
    ) {
      ctx.set.status = 400
      return { errors: [{ message: 'Invalid GraphQL request' }] }
    }

    const graphqlPort = process.env.GQL_PORT ?? '4350'
    const graphqlUrl = `http://localhost:${graphqlPort}/graphql`

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: body.query,
        variables: body.variables,
        operationName: body.operationName,
      }),
    }).catch((err: Error) => {
      console.error('[REST] GraphQL proxy error:', err.message)
      return null
    })

    if (!response) {
      ctx.set.status = 503
      return { errors: [{ message: 'GraphQL server unavailable' }] }
    }

    // Validate response structure before returning
    let data: Record<string, unknown>
    try {
      data = (await response.json()) as Record<string, unknown>
    } catch {
      ctx.set.status = 502
      return { errors: [{ message: 'Invalid response from GraphQL server' }] }
    }

    // Only return expected GraphQL response fields
    return {
      data: data.data ?? null,
      errors: Array.isArray(data.errors) ? data.errors : undefined,
    }
  })
  .onError(({ error, set }) => {
    if (error instanceof Error) {
      // Only log stack traces in non-production for security
      if (config.isProduction) {
        console.error('[REST] Error:', error.name, error.message)
      } else {
        console.error('[REST] Error:', error.message, error.stack)
      }

      if (
        error.name === 'ValidationError' ||
        error.message.includes('Validation error')
      ) {
        set.status = 400
        // Don't expose internal validation details in production
        return {
          error: 'Validation error',
          message: config.isProduction
            ? 'Invalid request parameters'
            : error.message,
        }
      }

      if (error instanceof NotFoundError || error.name === 'NotFoundError') {
        set.status = 404
        return { error: error.message }
      }

      if (error.name === 'BadRequestError') {
        set.status = 400
        return { error: error.message }
      }
    } else {
      console.error('[REST] Unhandled error type')
    }

    set.status = 500
    return { error: 'Internal server error' }
  })

export async function startRestServer(): Promise<void> {
  const mode = getIndexerMode()
  console.log(`📡 REST API starting in ${mode} mode`)

  app.listen(
    {
      port: REST_PORT,
      hostname: '0.0.0.0',
    },
    () => {
      const host = getLocalhostHost()
      console.log(`📡 REST API running on http://${host}:${REST_PORT}`)
    },
  )
}

if (require.main === module) {
  startRestServer().catch((err: Error) => {
    console.error('REST server failed to start:', err.message)
    process.exit(1)
  })
}

export { app }
