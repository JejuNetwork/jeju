import cors from 'cors'
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { z } from 'zod'
import { getAccountByAddress } from './lib/account-utils'
import { getAgentsByTag } from './lib/agent-utils'
import { getBlockByIdentifier } from './lib/block-detail-utils'
import { getBlocks } from './lib/block-query-utils'
import { mapContainerListResponse } from './lib/container-utils'
import { getDataSource } from './lib/db'
import {
  mapAgentSummary,
  mapBlockDetail,
  mapBlockSummary,
  mapTransactionDetail,
  mapTransactionSummary,
} from './lib/mappers'
import { getNodes } from './lib/node-query-utils'
import { mapNodeResponse } from './lib/node-utils'
import { getOracleOperatorByAddress } from './lib/oracle-operator-utils'
import { getOracleFeedDetail } from './lib/oracle-utils'
import { getProviders } from './lib/provider-query-utils'
import { getContainerDetail, getFullStackProviders } from './lib/provider-utils'
import {
  buildContainersQuery,
  buildContractsQuery,
  buildCrossServiceRequestsQuery,
  buildOracleDisputesQuery,
  buildOracleFeedsQuery,
  buildOracleOperatorsQuery,
  buildOracleReportsQuery,
  buildTokenTransfersQuery,
} from './lib/query-utils'
import {
  mapAccountResponse,
  mapContractResponse,
  mapCrossServiceRequestResponse,
  mapOracleDisputeResponse,
  mapOracleFeedResponse,
  mapOracleOperatorResponse,
  mapOracleReportResponse,
  mapTokenTransferResponse,
} from './lib/response-utils'
import { getAgentById, getPopularTags, search } from './lib/search'
import {
  getRateLimitStats,
  RATE_LIMITS,
  stakeRateLimiter,
} from './lib/stake-rate-limiter'
import {
  getMarketplaceStats,
  getNetworkStats,
  getOracleStats,
} from './lib/stats-utils'
import { getTransactionByHash, getTransactions } from './lib/transaction-utils'
import { NotFoundError } from './lib/types'
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
} from './lib/validation'
import { RegisteredAgent } from './model'

const REST_PORT = parseInt(process.env.REST_PORT || '4352', 10)

if (!REST_PORT || REST_PORT <= 0 || REST_PORT > 65535) {
  throw new Error(
    `Invalid REST_PORT: ${REST_PORT}. Must be between 1 and 65535`,
  )
}

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>
const asyncHandler =
  (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next)

const app: express.Application = express()

// SECURITY: Configure CORS with allowlist - defaults to permissive for local dev
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const corsOptions: cors.CorsOptions = CORS_ORIGINS?.length
  ? {
      origin: CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Wallet-Address',
        'X-Agent-Id',
      ],
    }
  : {} // Permissive CORS for local development when CORS_ORIGINS not set

app.use(cors(corsOptions))
app.use(express.json({ limit: '1mb' })) // Limit request body size
app.use(stakeRateLimiter({ skipPaths: ['/health', '/'] }))

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'indexer-rest', port: REST_PORT })
})

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Network Indexer REST API',
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
      // Cross-service integration
      containers: '/api/containers',
      crossServiceRequests: '/api/cross-service/requests',
      marketplaceStats: '/api/marketplace/stats',
      fullStackProviders: '/api/full-stack',
      // Oracle Network (JON)
      oracleFeeds: '/api/oracle/feeds',
      oracleOperators: '/api/oracle/operators',
      oracleReports: '/api/oracle/reports',
      oracleDisputes: '/api/oracle/disputes',
      oracleStats: '/api/oracle/stats',
    },
    graphql: 'http://localhost:4350/graphql',
    rateLimits: RATE_LIMITS,
  })
})

app.get(
  '/api/search',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      restSearchParamsSchema,
      req.query,
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

    const results = await search(ds, params)
    res.json(results)
  }),
)

app.get(
  '/api/tags',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    // Validate query params even if not used (for consistency and future-proofing)
    validateQuery(z.object({}).passthrough(), req.query, 'GET /api/tags')
    const tags = await getPopularTags(ds, 100)
    res.json({ tags, total: tags.length })
  }),
)

app.get(
  '/api/agents',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      agentsQuerySchema,
      req.query,
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

    res.json({
      agents: agents.map((a) => ({
        ...mapAgentSummary(a),
        owner: a.owner?.address,
      })),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/agents/:id',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { id } = validateParams(
      agentIdParamSchema,
      req.params,
      'GET /api/agents/:id',
    )

    const agent = await getAgentById(ds, id)
    if (!agent) {
      throw new NotFoundError('Agent', id)
    }

    res.json(agent)
  }),
)

app.get(
  '/api/agents/tag/:tag',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { tag } = validateParams(
      agentTagParamSchema,
      req.params,
      'GET /api/agents/tag/:tag',
    )
    const validated = validateQuery(
      paginationSchema,
      req.query,
      'GET /api/agents/tag/:tag',
    )

    const result = await getAgentsByTag(ds, tag, validated.limit)

    res.json({
      tag: result.tag,
      agents: result.agents.map(mapAgentSummary),
      count: result.agents.length,
    })
  }),
)

app.get(
  '/api/blocks',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      blocksQuerySchema,
      req.query,
      'GET /api/blocks',
    )

    const blocks = await getBlocks(ds, {
      limit: validated.limit,
      offset: validated.offset,
    })

    res.json({
      blocks: blocks.map(mapBlockSummary),
    })
  }),
)

app.get(
  '/api/blocks/:numberOrHash',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { numberOrHash } = validateParams(
      blockNumberOrHashParamSchema,
      req.params,
      'GET /api/blocks/:numberOrHash',
    )

    const block = await getBlockByIdentifier(ds, numberOrHash)
    if (!block) {
      throw new NotFoundError('Block', numberOrHash)
    }

    res.json({
      ...mapBlockDetail(block),
      baseFeePerGas: block.baseFeePerGas?.toString() || null,
      size: block.size,
    })
  }),
)

app.get(
  '/api/transactions',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      transactionsQuerySchema,
      req.query,
      'GET /api/transactions',
    )

    const txs = await getTransactions(ds, {
      limit: validated.limit,
      offset: validated.offset,
    })

    res.json({
      transactions: txs.map(mapTransactionSummary),
    })
  }),
)

app.get(
  '/api/transactions/:hash',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { hash } = validateParams(
      transactionHashParamSchema,
      req.params,
      'GET /api/transactions/:hash',
    )

    const tx = await getTransactionByHash(ds, hash)

    if (!tx) {
      throw new NotFoundError('Transaction', hash)
    }

    res.json({
      ...mapTransactionDetail(tx),
      gasLimit: tx.gasLimit.toString(),
      input: tx.input,
      nonce: tx.nonce,
    })
  }),
)

app.get(
  '/api/accounts/:address',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { address } = validateParams(
      accountAddressParamSchema,
      req.params,
      'GET /api/accounts/:address',
    )

    const account = await getAccountByAddress(ds, address)

    if (!account) {
      throw new NotFoundError('Account', address.toLowerCase())
    }

    res.json(mapAccountResponse(account))
  }),
)

app.get(
  '/api/contracts',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      contractsQuerySchema,
      req.query,
      'GET /api/contracts',
    )

    const query = buildContractsQuery(ds, {
      type: validated.type,
      limit: validated.limit,
    })

    const contracts = await query.getMany()

    res.json({
      contracts: contracts.map(mapContractResponse),
    })
  }),
)

app.get(
  '/api/tokens/transfers',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      tokenTransfersQuerySchema,
      req.query,
      'GET /api/tokens/transfers',
    )

    const query = buildTokenTransfersQuery(ds, {
      token: validated.token,
      limit: validated.limit,
    })

    const transfers = await query.getMany()

    res.json({
      transfers: transfers.map(mapTokenTransferResponse),
    })
  }),
)

app.get(
  '/api/nodes',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      nodesQuerySchema,
      req.query,
      'GET /api/nodes',
    )

    const nodes = await getNodes(ds, {
      active: validated.active,
      limit: validated.limit,
    })

    res.json({
      nodes: nodes.map(mapNodeResponse),
      total: nodes.length,
    })
  }),
)

app.get(
  '/api/providers',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      providersQuerySchema,
      req.query,
      'GET /api/providers',
    )

    const result = await getProviders(ds, {
      type: validated.type,
      limit: validated.limit,
    })

    res.json(result)
  }),
)

app.get(
  '/api/containers',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      containersQuerySchema,
      req.query,
      'GET /api/containers',
    )

    const query = buildContainersQuery(ds, {
      verified: validated.verified,
      gpu: validated.gpu,
      tee: validated.tee,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [containers, total] = await query.getManyAndCount()

    res.json({
      containers: containers.map(mapContainerListResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/containers/:cid',
  asyncHandler(async (req: Request, res: Response) => {
    const ds = await getDataSource()
    const { cid } = validateParams(
      containerCidParamSchema,
      req.params,
      'GET /api/containers/:cid',
    )
    const result = await getContainerDetail(ds, cid)
    res.json(result)
  }),
)

app.get(
  '/api/cross-service/requests',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      crossServiceRequestsQuerySchema,
      req.query,
      'GET /api/cross-service/requests',
    )

    const query = buildCrossServiceRequestsQuery(ds, {
      status: validated.status,
      type: validated.type,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [requests, total] = await query.getManyAndCount()

    res.json({
      requests: requests.map(mapCrossServiceRequestResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/marketplace/stats',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    // Validate query params even if not used (for consistency and future-proofing)
    validateQuery(
      z.object({}).passthrough(),
      req.query,
      'GET /api/marketplace/stats',
    )
    const stats = await getMarketplaceStats(ds)
    res.json(stats)
  }),
)

// ============================================================================
// FULL-STACK PROVIDERS - Providers with both compute and storage
// ============================================================================

app.get(
  '/api/full-stack',
  asyncHandler(async (req: Request, res: Response) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      paginationSchema.extend({
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      req.query,
      'GET /api/full-stack',
    )
    const result = await getFullStackProviders(ds, validated.limit)
    res.json(result)
  }),
)

app.get(
  '/api/oracle/feeds',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      oracleFeedsQuerySchema,
      req.query,
      'GET /api/oracle/feeds',
    )

    const query = buildOracleFeedsQuery(ds, {
      active: validated.active,
      category: validated.category,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [feeds, total] = await query.getManyAndCount()

    res.json({
      feeds: feeds.map(mapOracleFeedResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/oracle/feeds/:feedId',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { feedId } = validateParams(
      oracleFeedIdParamSchema,
      req.params,
      'GET /api/oracle/feeds/:feedId',
    )
    const result = await getOracleFeedDetail(ds, feedId)
    res.json(result)
  }),
)

app.get(
  '/api/oracle/operators',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      oracleOperatorsQuerySchema,
      req.query,
      'GET /api/oracle/operators',
    )

    const query = buildOracleOperatorsQuery(ds, {
      active: validated.active,
      jailed: validated.jailed,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [operators, total] = await query.getManyAndCount()

    res.json({
      operators: operators.map(mapOracleOperatorResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/oracle/operators/:address',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const { address } = validateParams(
      oracleOperatorAddressParamSchema,
      req.params,
      'GET /api/oracle/operators/:address',
    )

    const operator = await getOracleOperatorByAddress(ds, address)

    if (!operator) {
      throw new NotFoundError('Oracle Operator', address.toLowerCase())
    }

    res.json({
      operator: mapOracleOperatorResponse(operator),
    })
  }),
)

app.get(
  '/api/oracle/reports',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      oracleReportsQuerySchema,
      req.query,
      'GET /api/oracle/reports',
    )

    const query = buildOracleReportsQuery(ds, {
      feedId: validated.feedId,
      disputed: validated.disputed,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [reports, total] = await query.getManyAndCount()

    res.json({
      reports: reports.map(mapOracleReportResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/oracle/disputes',
  asyncHandler(async (req: Request, res: Response) => {
    const ds = await getDataSource()
    const validated = validateQuery(
      oracleDisputesQuerySchema,
      req.query,
      'GET /api/oracle/disputes',
    )

    const query = buildOracleDisputesQuery(ds, {
      status: validated.status,
      limit: validated.limit,
      offset: validated.offset,
    })

    const [disputes, total] = await query.getManyAndCount()

    res.json({
      disputes: disputes.map(mapOracleDisputeResponse),
      total,
      limit: validated.limit,
      offset: validated.offset,
    })
  }),
)

app.get(
  '/api/oracle/stats',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    // Validate query params even if not used (for consistency and future-proofing)
    validateQuery(
      z.object({}).passthrough(),
      req.query,
      'GET /api/oracle/stats',
    )
    const stats = await getOracleStats(ds)
    res.json(stats)
  }),
)

app.get(
  '/api/stats',
  asyncHandler(async (req, res) => {
    const ds = await getDataSource()
    // Validate query params even if not used (for consistency and future-proofing)
    validateQuery(z.object({}).passthrough(), req.query, 'GET /api/stats')
    const stats = await getNetworkStats(ds)
    res.json({
      ...stats,
      rateLimitStats: getRateLimitStats(),
    })
  }),
)

app.get('/api/rate-limits', (_req, res) => {
  res.json({
    tiers: RATE_LIMITS,
    thresholds: {
      FREE: { minUsd: 0, limit: RATE_LIMITS.FREE },
      BASIC: { minUsd: 10, limit: RATE_LIMITS.BASIC },
      PRO: { minUsd: 100, limit: RATE_LIMITS.PRO },
      UNLIMITED: { minUsd: 1000, limit: 'unlimited' },
    },
    stats: getRateLimitStats(),
    note: 'Stake tokens to increase rate limits',
  })
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log full error details server-side for debugging
  console.error('[REST] Unhandled error:', err.message, err.stack)

  if (
    err.name === 'ValidationError' ||
    err.message.includes('Validation error')
  ) {
    res.status(400).json({ error: 'Validation error', message: err.message })
    return
  }

  if (err.name === 'NotFoundError') {
    res.status(404).json({ error: err.message })
    return
  }

  if (err.name === 'BadRequestError') {
    res.status(400).json({ error: err.message })
    return
  }

  // SECURITY: Never expose internal error details to clients
  // Internal errors are logged server-side but clients only see a generic message
  res.status(500).json({ error: 'Internal server error' })
})

export async function startRestServer(): Promise<void> {
  await getDataSource()

  app.listen(REST_PORT, () => {
    console.log(`📡 REST API running on http://localhost:${REST_PORT}`)
  })
}

if (require.main === module) {
  startRestServer().catch((err: Error) => {
    console.error('REST server failed to start:', err.message)
    process.exit(1)
  })
}

export { app }
