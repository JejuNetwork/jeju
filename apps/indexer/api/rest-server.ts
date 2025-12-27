import { cors } from '@elysiajs/cors'
import { type Context, Elysia } from 'elysia'
import { z } from 'zod'
import { RegisteredAgent } from '../src/model'
import { getAccountByAddress } from './utils/account-utils'
import { getAgentsByTag } from './utils/agent-utils'
import { getBlockByIdentifier } from './utils/block-detail-utils'
import { getBlocks } from './utils/block-query-utils'
import { mapContainerListResponse } from './utils/container-utils'
import {
  type DataSource,
  getDataSource,
  getIndexerMode,
  isPostgresAvailable,
  isSchemaReady,
} from './utils/db'
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

const REST_PORT = parseInt(process.env.REST_PORT || '4352', 10)

if (!REST_PORT || REST_PORT <= 0 || REST_PORT > 65535) {
  throw new Error(
    `Invalid REST_PORT: ${REST_PORT}. Must be between 1 and 65535`,
  )
}

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const corsOptions = CORS_ORIGINS?.length
  ? {
      origin: CORS_ORIGINS,
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
  : undefined

const app = new Elysia()
  .use(cors(corsOptions))
  .use(security({ service: 'indexer-rest' }))
  .use(stakeRateLimiter({ skipPaths: ['/health', '/'] }))
  .get('/health', () => ({
    status: isSchemaReady() ? 'ok' : 'degraded',
    service: 'indexer-rest',
    port: REST_PORT,
    mode: getIndexerMode(),
    postgresAvailable: isPostgresAvailable(),
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
    graphql: 'http://localhost:4350/graphql',
    rateLimits: RATE_LIMITS,
  }))
  .get('/api/search', async (ctx: Context) => {
    const ds = await requireDataSource()
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

    return await search(ds, params)
  })
  .get('/api/tags', async (ctx: Context) => {
    const ds = await requireDataSource()
    validateQuery(z.object({}).passthrough(), ctx.query, 'GET /api/tags')
    const tags = await getPopularTags(ds, 100)
    return { tags, total: tags.length }
  })
  .get('/api/agents', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      agentsQuerySchema,
      ctx.query,
      'GET /api/agents',
    )

    const where: { active?: boolean } = {}
    if (validated.active !== undefined) {
      where.active = validated.active
    }

    const [agents, total] = await ds
      .getRepository(RegisteredAgent)
      .findAndCount({
        where,
        order: { registeredAt: 'DESC' },
        take: validated.limit,
        skip: validated.offset,
        relations: ['owner'],
      })

    return {
      agents: agents.map((a) => ({
        ...mapAgentSummary(a),
        owner: a.owner.address,
      })),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/agents/:id', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { id } = validateParams(
      agentIdParamSchema,
      ctx.params,
      'GET /api/agents/:id',
    )

    const agent = await getAgentById(ds, id)
    if (!agent) {
      ctx.set.status = 404
      return { error: `Agent not found: ${id}` }
    }

    return agent
  })
  .get('/api/agents/tag/:tag', async (ctx: Context) => {
    const ds = await requireDataSource()
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

    const result = await getAgentsByTag(ds, tag, validated.limit)

    return {
      tag: result.tag,
      agents: result.agents.map(mapAgentSummary),
      count: result.agents.length,
    }
  })
  .get('/api/blocks', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      blocksQuerySchema,
      ctx.query,
      'GET /api/blocks',
    )

    const blocks = await getBlocks(ds, {
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      blocks: blocks.map(mapBlockSummary),
    }
  })
  .get('/api/blocks/:numberOrHash', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { numberOrHash } = validateParams(
      blockNumberOrHashParamSchema,
      ctx.params,
      'GET /api/blocks/:numberOrHash',
    )

    const block = await getBlockByIdentifier(ds, numberOrHash)
    if (!block) {
      ctx.set.status = 404
      return { error: `Block not found: ${numberOrHash}` }
    }

    return {
      ...mapBlockDetail(block),
      baseFeePerGas: block.baseFeePerGas?.toString() || null,
      size: block.size,
    }
  })
  .get('/api/transactions', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      transactionsQuerySchema,
      ctx.query,
      'GET /api/transactions',
    )

    const txs = await getTransactions(ds, {
      limit: validated.limit,
      offset: validated.offset,
    })

    return {
      transactions: txs.map(mapTransactionSummary),
    }
  })
  .get('/api/transactions/:hash', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { hash } = validateParams(
      transactionHashParamSchema,
      ctx.params,
      'GET /api/transactions/:hash',
    )

    const tx = await getTransactionByHash(ds, hash)

    if (!tx) {
      ctx.set.status = 404
      return { error: `Transaction not found: ${hash}` }
    }

    return {
      ...mapTransactionDetail(tx),
      gasLimit: tx.gasLimit.toString(),
      input: tx.input,
      nonce: tx.nonce,
    }
  })
  .get('/api/accounts/:address', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { address } = validateParams(
      accountAddressParamSchema,
      ctx.params,
      'GET /api/accounts/:address',
    )

    const account = await getAccountByAddress(ds, address)

    if (!account) {
      ctx.set.status = 404
      return { error: `Account not found: ${address.toLowerCase()}` }
    }

    return mapAccountResponse(account)
  })
  .get('/api/contracts', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      contractsQuerySchema,
      ctx.query,
      'GET /api/contracts',
    )

    const contractsQuery = buildContractsQuery(ds, {
      type: validated.type,
      limit: validated.limit,
    })

    const contracts = await contractsQuery.getMany()

    return {
      contracts: contracts.map(mapContractResponse),
    }
  })
  .get('/api/tokens/transfers', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      tokenTransfersQuerySchema,
      ctx.query,
      'GET /api/tokens/transfers',
    )

    const transfersQuery = buildTokenTransfersQuery(ds, {
      token: validated.token,
      limit: validated.limit,
    })

    const transfers = await transfersQuery.getMany()

    return {
      transfers: transfers.map(mapTokenTransferResponse),
    }
  })
  .get('/api/nodes', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      nodesQuerySchema,
      ctx.query,
      'GET /api/nodes',
    )

    const nodes = await getNodes(ds, {
      active: validated.active,
      limit: validated.limit,
    })

    return {
      nodes: nodes.map(mapNodeResponse),
      total: nodes.length,
    }
  })
  .get('/api/providers', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      providersQuerySchema,
      ctx.query,
      'GET /api/providers',
    )

    const result = await getProviders(ds, {
      type: validated.type,
      limit: validated.limit,
    })

    return result
  })
  .get('/api/containers', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      containersQuerySchema,
      ctx.query,
      'GET /api/containers',
    )

    const containersQuery = buildContainersQuery(ds, {
      verified: validated.verified,
      gpu: validated.gpu,
      tee: validated.tee,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [containers, total] = await containersQuery.getManyAndCount()

    return {
      containers: containers.map(mapContainerListResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/containers/:cid', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { cid } = validateParams(
      containerCidParamSchema,
      ctx.params,
      'GET /api/containers/:cid',
    )
    return await getContainerDetail(ds, cid)
  })
  .get('/api/cross-service/requests', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      crossServiceRequestsQuerySchema,
      ctx.query,
      'GET /api/cross-service/requests',
    )

    const requestsQuery = buildCrossServiceRequestsQuery(ds, {
      status: validated.status,
      type: validated.type,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [requests, total] = await requestsQuery.getManyAndCount()

    return {
      requests: requests.map(mapCrossServiceRequestResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/marketplace/stats', async (ctx: Context) => {
    const ds = await requireDataSource()
    validateQuery(
      z.object({}).passthrough(),
      ctx.query,
      'GET /api/marketplace/stats',
    )
    return await getMarketplaceStats(ds)
  })
  .get('/api/full-stack', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      paginationSchema.extend({
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      ctx.query,
      'GET /api/full-stack',
    )
    return await getFullStackProviders(ds, validated.limit)
  })
  .get('/api/oracle/feeds', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      oracleFeedsQuerySchema,
      ctx.query,
      'GET /api/oracle/feeds',
    )

    const feedsQuery = buildOracleFeedsQuery(ds, {
      active: validated.active,
      category: validated.category,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [feeds, total] = await feedsQuery.getManyAndCount()

    return {
      feeds: feeds.map(mapOracleFeedResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/feeds/:feedId', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { feedId } = validateParams(
      oracleFeedIdParamSchema,
      ctx.params,
      'GET /api/oracle/feeds/:feedId',
    )
    return await getOracleFeedDetail(ds, feedId)
  })
  .get('/api/oracle/operators', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      oracleOperatorsQuerySchema,
      ctx.query,
      'GET /api/oracle/operators',
    )

    const operatorsQuery = buildOracleOperatorsQuery(ds, {
      active: validated.active,
      jailed: validated.jailed,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [operators, total] = await operatorsQuery.getManyAndCount()

    return {
      operators: operators.map(mapOracleOperatorResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/operators/:address', async (ctx: Context) => {
    const ds = await requireDataSource()
    const { address } = validateParams(
      oracleOperatorAddressParamSchema,
      ctx.params,
      'GET /api/oracle/operators/:address',
    )

    const operator = await getOracleOperatorByAddress(ds, address)

    if (!operator) {
      ctx.set.status = 404
      return { error: `Oracle Operator not found: ${address.toLowerCase()}` }
    }

    return {
      operator: mapOracleOperatorResponse(operator),
    }
  })
  .get('/api/oracle/reports', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      oracleReportsQuerySchema,
      ctx.query,
      'GET /api/oracle/reports',
    )

    const reportsQuery = buildOracleReportsQuery(ds, {
      feedId: validated.feedId,
      disputed: validated.disputed,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [reports, total] = await reportsQuery.getManyAndCount()

    return {
      reports: reports.map(mapOracleReportResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/disputes', async (ctx: Context) => {
    const ds = await requireDataSource()
    const validated = validateQuery(
      oracleDisputesQuerySchema,
      ctx.query,
      'GET /api/oracle/disputes',
    )

    const disputesQuery = buildOracleDisputesQuery(ds, {
      status: validated.status,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [disputes, total] = await disputesQuery.getManyAndCount()

    return {
      disputes: disputes.map(mapOracleDisputeResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    }
  })
  .get('/api/oracle/stats', async (ctx: Context) => {
    const ds = await requireDataSource()
    validateQuery(
      z.object({}).passthrough(),
      ctx.query,
      'GET /api/oracle/stats',
    )
    return await getOracleStats(ds)
  })
  .get('/api/stats', async (ctx: Context) => {
    const ds = await requireDataSource()
    validateQuery(z.object({}).passthrough(), ctx.query, 'GET /api/stats')
    const stats = await getNetworkStats(ds)
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
  .onError(({ error, set }) => {
    if (error instanceof ServiceUnavailableError) {
      set.status = 503
      return {
        error: 'Service Unavailable',
        message: error.message,
        mode: getIndexerMode(),
      }
    }

    if (error instanceof Error) {
      console.error('[REST] Unhandled error:', error.message, error.stack)

      if (
        error.name === 'ValidationError' ||
        error.message.includes('Validation error')
      ) {
        set.status = 400
        return { error: 'Validation error', message: error.message }
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
      console.error('[REST] Unhandled non-error:', error)
    }

    set.status = 500
    return { error: 'Internal server error' }
  })

/**
 * Get a data source, throwing a service unavailable error if not available
 */
async function requireDataSource(): Promise<DataSource> {
  const ds = await getDataSource()
  if (!ds) {
    throw new ServiceUnavailableError('Database not available')
  }
  if (!isSchemaReady()) {
    throw new ServiceUnavailableError(
      'Database schema not ready - run the processor to create tables',
    )
  }
  return ds
}

class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}

export async function startRestServer(): Promise<void> {
  const mode = getIndexerMode()
  console.log(`📡 REST API starting in ${mode} mode`)

  app.listen(REST_PORT, () => {
    const status = isPostgresAvailable() ? 'full' : 'degraded'
    console.log(
      `📡 REST API running on http://localhost:${REST_PORT} (${status})`,
    )
  })
}

if (require.main === module) {
  startRestServer().catch((err: Error) => {
    console.error('REST server failed to start:', err.message)
    process.exit(1)
  })
}

export { app, requireDataSource }
