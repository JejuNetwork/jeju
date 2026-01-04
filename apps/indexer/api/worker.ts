/**
 * Indexer API Worker
 *
 * Blockchain indexer with GraphQL and REST APIs - workerd-compatible.
 * Queries SQLit directly for data storage and retrieval.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

/**
 * Simple HTTP-based SQLit client for worker environments.
 * Uses the DWS SQLit proxy endpoint directly.
 */
const SQLIT_ENDPOINT =
  process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT ??
  (getCurrentNetwork() === 'localnet'
    ? 'http://127.0.0.1:4030/sqlit'
    : getCurrentNetwork() === 'testnet'
      ? 'https://dws.testnet.jejunetwork.org/sqlit'
      : 'https://dws.jejunetwork.org/sqlit')

interface SQLitQueryResult {
  success: boolean
  status: string
  data: {
    columns: string[]
    rows: Array<Array<string | number | null>>
    types: string[]
  } | null
}

async function sqlitQuery(
  database: string,
  sql: string,
  args?: Array<string | number | null>,
): Promise<SQLitQueryResult> {
  const url = `${SQLIT_ENDPOINT}/v1/query`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database, query: sql, args }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown')
      return {
        success: false,
        status: `SQLit query failed: ${response.status} at ${url} - ${text}`,
        data: null,
      }
    }

    return response.json() as Promise<SQLitQueryResult>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      status: `SQLit fetch error: ${message} (endpoint: ${url})`,
      data: null,
    }
  }
}

/**
 * Convert SQLit query result to array of objects
 */
function resultToObjects(
  result: SQLitQueryResult,
): Array<Record<string, string | number | null>> {
  if (!result.success || !result.data) return []
  const { columns, rows } = result.data
  return rows.map((row) => {
    const obj: Record<string, string | number | null> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
}

/**
 * Worker Environment Types
 */
export interface IndexerEnv {
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string
  INDEXER_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

// Zod schemas for request validation
const GraphQLRequestSchema = z.object({
  query: z.string(),
  variables: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
  operationName: z.string().optional(),
})

const A2ARequestSchema = z.object({
  skill: z.string(),
  params: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
})

const MCPRequestSchema = z.object({
  tool: z.string(),
  arguments: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
})

// Database IDs per network (created via /sqlit/v1/admin/create)
// These must be hardcoded since env vars don't persist reliably in DWS workers
const DATABASE_IDS: Record<string, string> = {
  localnet: 'indexer-local',
  testnet: 'f5bf9ea3723bf1c3d77b6914f1f8ecd1c1d8c9bd89890d769488e9a9682db960',
  mainnet: 'indexer-mainnet', // To be created on mainnet deployment
}

/**
 * Detect network from SQLit endpoint URL when env vars aren't available.
 * This handles the case where workers are loaded by CID without env vars.
 */
function detectNetworkFromEndpoint(): string {
  // Check env var first (most reliable when available)
  const envNetwork = process.env.JEJU_NETWORK || process.env.NETWORK
  if (envNetwork && DATABASE_IDS[envNetwork]) {
    return envNetwork
  }

  // Detect from SQLit endpoint URL
  if (SQLIT_ENDPOINT.includes('testnet')) {
    return 'testnet'
  }
  if (
    SQLIT_ENDPOINT.includes('dws.jejunetwork.org') &&
    !SQLIT_ENDPOINT.includes('testnet')
  ) {
    return 'mainnet'
  }

  // K8s internal endpoint - check cluster context or default to testnet for DWS cluster
  if (SQLIT_ENDPOINT.includes('svc.cluster.local')) {
    // In K8s, check for namespace hints or default to testnet
    // The DWS K8s cluster runs testnet
    return 'testnet'
  }

  // Fallback to localnet for localhost/127.0.0.1
  return 'localnet'
}

// Detect network and log for debugging
const DETECTED_NETWORK = detectNetworkFromEndpoint()

// Database ID for SQLit - use env var override if set, otherwise detect from endpoint
const DATABASE_ID =
  process.env.SQLIT_DATABASE_ID ??
  DATABASE_IDS[DETECTED_NETWORK] ??
  // Ultimate fallback: use testnet database ID (most common DWS deployment target)
  DATABASE_IDS.testnet

console.log(
  `[Indexer Worker] Initializing: network=${DETECTED_NETWORK}, databaseId=${DATABASE_ID}, endpoint=${SQLIT_ENDPOINT}`,
)

/**
 * Execute a GraphQL-like query against SQLit
 * Supports basic queries: blocks, transactions, accounts
 */
async function executeGraphQLQuery(
  query: string,
  variables?: Record<string, string | number | boolean | null>,
): Promise<{
  data: Record<string, unknown> | null
  errors?: Array<{ message: string }>
}> {
  // Parse the GraphQL query to extract operation
  const blocksMatch = query.match(/blocks\s*(?:\(([^)]*)\))?\s*\{([^}]+)\}/)
  const transactionsMatch = query.match(
    /transactions\s*(?:\(([^)]*)\))?\s*\{([^}]+)\}/,
  )
  const accountsMatch = query.match(/accounts\s*(?:\(([^)]*)\))?\s*\{([^}]+)\}/)

  // Extract limit from query or variables
  const extractLimit = (args: string | undefined): number => {
    if (!args) return 10
    const limitMatch = args.match(/limit:\s*(\d+)/)
    if (limitMatch) return parseInt(limitMatch[1], 10)
    if (args.includes('$limit') && variables?.limit) {
      return typeof variables.limit === 'number' ? variables.limit : 10
    }
    return 10
  }

  // Extract orderBy from query
  const extractOrderBy = (
    args: string | undefined,
  ): { field: string; dir: 'ASC' | 'DESC' } => {
    if (!args) return { field: 'number', dir: 'DESC' }
    const orderMatch = args.match(/orderBy:\s*(\w+)_(ASC|DESC)/)
    if (orderMatch) {
      return {
        field: orderMatch[1].replace(/([A-Z])/g, '_$1').toLowerCase(),
        dir: orderMatch[2] as 'ASC' | 'DESC',
      }
    }
    return { field: 'number', dir: 'DESC' }
  }

  // Extract where clause
  const extractWhere = (
    args: string | undefined,
    vars?: Record<string, string | number | boolean | null>,
  ): Record<string, string | number> => {
    const where: Record<string, string | number> = {}
    if (!args) return where

    // Match patterns like: number_eq: 123 or hash_eq: "0x..."
    const eqMatches = args.matchAll(/(\w+)_eq:\s*(?:"([^"]+)"|(\d+)|\$(\w+))/g)
    for (const match of eqMatches) {
      const field = match[1]
      const stringVal = match[2]
      const numVal = match[3]
      const varName = match[4]

      if (stringVal) {
        where[field] = stringVal
      } else if (numVal) {
        where[field] = parseInt(numVal, 10)
      } else if (varName && vars && varName in vars) {
        const val = vars[varName]
        if (typeof val === 'string' || typeof val === 'number') {
          where[field] = val
        }
      }
    }
    return where
  }

  // Map GraphQL fields to SQL columns
  const mapFields = (fields: string): string[] => {
    return fields
      .split(/[,\s]+/)
      .filter((f) => f && !f.includes('{') && !f.includes('}'))
      .map((f) => f.trim())
      .filter((f) => /^\w+$/.test(f))
  }

  try {
    if (blocksMatch) {
      const args = blocksMatch[1]
      const fields = mapFields(blocksMatch[2])
      const limit = extractLimit(args)
      const orderBy = extractOrderBy(args)
      const where = extractWhere(args, variables)

      let sql = `SELECT * FROM blocks`
      const params: Array<string | number | null> = []

      if (Object.keys(where).length > 0) {
        const conditions = Object.entries(where).map(([k, v]) => {
          params.push(v)
          return `"${k}" = ?`
        })
        sql += ` WHERE ${conditions.join(' AND ')}`
      }

      sql += ` ORDER BY "${orderBy.field}" ${orderBy.dir} LIMIT ${limit}`

      const result = await sqlitQuery(DATABASE_ID, sql, params)

      if (!result.success) {
        return { data: null, errors: [{ message: result.status }] }
      }

      const rows = resultToObjects(result)

      return {
        data: {
          blocks: rows.map((row) => {
            const mapped: Record<string, string | number | null> = {}
            for (const field of fields) {
              const snakeField = field.replace(/([A-Z])/g, '_$1').toLowerCase()
              mapped[field] = row[snakeField] ?? row[field] ?? null
            }
            return mapped
          }),
        },
      }
    }

    if (transactionsMatch) {
      const args = transactionsMatch[1]
      const fields = mapFields(transactionsMatch[2])
      const limit = extractLimit(args)
      const orderBy = extractOrderBy(args)
      const where = extractWhere(args, variables)

      let sql = `SELECT * FROM transactions`
      const params: Array<string | number | null> = []

      if (Object.keys(where).length > 0) {
        const conditions = Object.entries(where).map(([k, v]) => {
          params.push(v)
          return `"${k}" = ?`
        })
        sql += ` WHERE ${conditions.join(' AND ')}`
      }

      sql += ` ORDER BY "${orderBy.field}" ${orderBy.dir} LIMIT ${limit}`

      const result = await sqlitQuery(DATABASE_ID, sql, params)

      if (!result.success) {
        return { data: null, errors: [{ message: result.status }] }
      }

      const rows = resultToObjects(result)

      return {
        data: {
          transactions: rows.map((row) => {
            const mapped: Record<string, string | number | null> = {}
            for (const field of fields) {
              const snakeField = field.replace(/([A-Z])/g, '_$1').toLowerCase()
              mapped[field] = row[snakeField] ?? row[field] ?? null
            }
            return mapped
          }),
        },
      }
    }

    if (accountsMatch) {
      const args = accountsMatch[1]
      const fields = mapFields(accountsMatch[2])
      const limit = extractLimit(args)
      const where = extractWhere(args, variables)

      let sql = `SELECT * FROM accounts`
      const params: Array<string | number | null> = []

      if (Object.keys(where).length > 0) {
        const conditions = Object.entries(where).map(([k, v]) => {
          params.push(v)
          return `"${k}" = ?`
        })
        sql += ` WHERE ${conditions.join(' AND ')}`
      }

      sql += ` LIMIT ${limit}`

      const result = await sqlitQuery(DATABASE_ID, sql, params)

      if (!result.success) {
        return { data: null, errors: [{ message: result.status }] }
      }

      const rows = resultToObjects(result)

      return {
        data: {
          accounts: rows.map((row) => {
            const mapped: Record<string, string | number | null> = {}
            for (const field of fields) {
              const snakeField = field.replace(/([A-Z])/g, '_$1').toLowerCase()
              mapped[field] = row[snakeField] ?? row[field] ?? null
            }
            return mapped
          }),
        },
      }
    }

    // Introspection query - return full schema for GraphiQL
    if (query.includes('__schema') || query.includes('__type')) {
      return {
        data: {
          __schema: {
            queryType: { name: 'Query' },
            mutationType: null,
            subscriptionType: null,
            types: [
              {
                kind: 'OBJECT',
                name: 'Query',
                fields: [
                  {
                    name: 'blocks',
                    args: [
                      { name: 'limit', type: { kind: 'SCALAR', name: 'Int' } },
                      { name: 'offset', type: { kind: 'SCALAR', name: 'Int' } },
                      {
                        name: 'orderBy',
                        type: { kind: 'ENUM', name: 'BlockOrderBy' },
                      },
                      {
                        name: 'where',
                        type: { kind: 'INPUT_OBJECT', name: 'BlockWhereInput' },
                      },
                    ],
                    type: {
                      kind: 'LIST',
                      ofType: { kind: 'OBJECT', name: 'Block' },
                    },
                  },
                  {
                    name: 'transactions',
                    args: [
                      { name: 'limit', type: { kind: 'SCALAR', name: 'Int' } },
                      { name: 'offset', type: { kind: 'SCALAR', name: 'Int' } },
                      {
                        name: 'orderBy',
                        type: { kind: 'ENUM', name: 'TransactionOrderBy' },
                      },
                      {
                        name: 'where',
                        type: {
                          kind: 'INPUT_OBJECT',
                          name: 'TransactionWhereInput',
                        },
                      },
                    ],
                    type: {
                      kind: 'LIST',
                      ofType: { kind: 'OBJECT', name: 'Transaction' },
                    },
                  },
                  {
                    name: 'accounts',
                    args: [
                      { name: 'limit', type: { kind: 'SCALAR', name: 'Int' } },
                      {
                        name: 'where',
                        type: {
                          kind: 'INPUT_OBJECT',
                          name: 'AccountWhereInput',
                        },
                      },
                    ],
                    type: {
                      kind: 'LIST',
                      ofType: { kind: 'OBJECT', name: 'Account' },
                    },
                  },
                ],
                interfaces: [],
              },
              {
                kind: 'OBJECT',
                name: 'Block',
                fields: [
                  {
                    name: 'id',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'ID' },
                    },
                    args: [],
                  },
                  {
                    name: 'number',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'Int' },
                    },
                    args: [],
                  },
                  {
                    name: 'hash',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'String' },
                    },
                    args: [],
                  },
                  {
                    name: 'parentHash',
                    type: { kind: 'SCALAR', name: 'String' },
                    args: [],
                  },
                  {
                    name: 'timestamp',
                    type: { kind: 'SCALAR', name: 'DateTime' },
                    args: [],
                  },
                  {
                    name: 'transactionCount',
                    type: { kind: 'SCALAR', name: 'Int' },
                    args: [],
                  },
                  {
                    name: 'gasUsed',
                    type: { kind: 'SCALAR', name: 'BigInt' },
                    args: [],
                  },
                  {
                    name: 'gasLimit',
                    type: { kind: 'SCALAR', name: 'BigInt' },
                    args: [],
                  },
                ],
                interfaces: [],
              },
              {
                kind: 'OBJECT',
                name: 'Transaction',
                fields: [
                  {
                    name: 'id',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'ID' },
                    },
                    args: [],
                  },
                  {
                    name: 'hash',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'String' },
                    },
                    args: [],
                  },
                  {
                    name: 'blockNumber',
                    type: { kind: 'SCALAR', name: 'Int' },
                    args: [],
                  },
                  {
                    name: 'from',
                    type: { kind: 'SCALAR', name: 'String' },
                    args: [],
                  },
                  {
                    name: 'to',
                    type: { kind: 'SCALAR', name: 'String' },
                    args: [],
                  },
                  {
                    name: 'value',
                    type: { kind: 'SCALAR', name: 'BigInt' },
                    args: [],
                  },
                  {
                    name: 'gasUsed',
                    type: { kind: 'SCALAR', name: 'BigInt' },
                    args: [],
                  },
                  {
                    name: 'status',
                    type: { kind: 'SCALAR', name: 'String' },
                    args: [],
                  },
                ],
                interfaces: [],
              },
              {
                kind: 'OBJECT',
                name: 'Account',
                fields: [
                  {
                    name: 'id',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'ID' },
                    },
                    args: [],
                  },
                  {
                    name: 'address',
                    type: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'SCALAR', name: 'String' },
                    },
                    args: [],
                  },
                  {
                    name: 'isContract',
                    type: { kind: 'SCALAR', name: 'Boolean' },
                    args: [],
                  },
                  {
                    name: 'transactionCount',
                    type: { kind: 'SCALAR', name: 'Int' },
                    args: [],
                  },
                ],
                interfaces: [],
              },
              { kind: 'SCALAR', name: 'ID' },
              { kind: 'SCALAR', name: 'String' },
              { kind: 'SCALAR', name: 'Int' },
              { kind: 'SCALAR', name: 'Boolean' },
              { kind: 'SCALAR', name: 'BigInt' },
              { kind: 'SCALAR', name: 'DateTime' },
              {
                kind: 'ENUM',
                name: 'BlockOrderBy',
                enumValues: [
                  { name: 'number_ASC' },
                  { name: 'number_DESC' },
                  { name: 'timestamp_ASC' },
                  { name: 'timestamp_DESC' },
                ],
              },
              {
                kind: 'ENUM',
                name: 'TransactionOrderBy',
                enumValues: [
                  { name: 'blockNumber_ASC' },
                  { name: 'blockNumber_DESC' },
                ],
              },
              {
                kind: 'INPUT_OBJECT',
                name: 'BlockWhereInput',
                inputFields: [
                  { name: 'number_eq', type: { kind: 'SCALAR', name: 'Int' } },
                  { name: 'hash_eq', type: { kind: 'SCALAR', name: 'String' } },
                ],
              },
              {
                kind: 'INPUT_OBJECT',
                name: 'TransactionWhereInput',
                inputFields: [
                  { name: 'hash_eq', type: { kind: 'SCALAR', name: 'String' } },
                  { name: 'from_eq', type: { kind: 'SCALAR', name: 'String' } },
                  { name: 'to_eq', type: { kind: 'SCALAR', name: 'String' } },
                ],
              },
              {
                kind: 'INPUT_OBJECT',
                name: 'AccountWhereInput',
                inputFields: [
                  { name: 'id_eq', type: { kind: 'SCALAR', name: 'String' } },
                  {
                    name: 'address_eq',
                    type: { kind: 'SCALAR', name: 'String' },
                  },
                ],
              },
            ],
            directives: [],
          },
        },
      }
    }

    return {
      data: null,
      errors: [
        {
          message:
            'Unsupported query. Supported: blocks, transactions, accounts. Use REST API at /api/* for full functionality.',
        },
      ],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GraphQL] Query error:', message)
    return {
      data: null,
      errors: [{ message: `Database error: ${message}` }],
    }
  }
}

/**
 * Create the Indexer Elysia app
 */
export function createIndexerApp(env?: Partial<IndexerEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://indexer.jejunetwork.org',
              'https://indexer.testnet.jejunetwork.org',
              'https://jejunetwork.org',
              'https://gateway.testnet.jejunetwork.org',
              'https://gateway.jejunetwork.org',
              getCoreAppUrl('INDEXER_GRAPHQL'),
            ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
        ],
        credentials: true,
      }),
    )
    // Global error handler
    .onError(({ error, set }) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Indexer Worker] Error:', message)

      // Return proper error response instead of 500
      set.status = 200 // GraphQL errors should be 200 with error in body
      return {
        data: null,
        errors: [{ message: `Internal error: ${message}` }],
      }
    })

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: 'indexer-api',
      version: '2.0.1',
      network,
      detectedNetwork: DETECTED_NETWORK,
      runtime: 'workerd',
      databaseId: DATABASE_ID,
      sqlitEndpoint: SQLIT_ENDPOINT,
      endpoints: {
        graphql: '/graphql',
        rest: '/api',
        a2a: '/a2a',
        mcp: '/mcp',
      },
    }))

    // GraphQL Playground
    .get('/graphql', () => {
      const playgroundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Indexer GraphQL Playground</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js" crossorigin></script>
  <link href="https://unpkg.com/graphiql@3/graphiql.min.css" rel="stylesheet" />
  <style>
    body { margin: 0; height: 100vh; }
    #graphiql { height: 100vh; }
  </style>
</head>
<body>
  <div id="graphiql"></div>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '/graphql' });
    const defaultQuery = \`query {
  blocks(limit: 5, orderBy: number_DESC) {
    number
    hash
    timestamp
  }
}\`;
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher, defaultQuery })
    );
  </script>
</body>
</html>`
      return new Response(playgroundHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    })
    .get('/playground', () => {
      return Response.redirect('/graphql', 302)
    })

    // GraphQL endpoint - executes queries against SQLit
    .post('/graphql', async ({ body }) => {
      const parsed = GraphQLRequestSchema.safeParse(body)

      if (!parsed.success) {
        return {
          data: null,
          errors: [
            { message: `Invalid GraphQL request: ${parsed.error.message}` },
          ],
        }
      }

      const { query, variables } = parsed.data
      return await executeGraphQLQuery(query, variables)
    })

    // REST API Routes
    .group('/api', (api) =>
      api
        .get('/health', () => ({ status: 'ok' }))

        // Blocks
        .get('/blocks', async ({ query }) => {
          const limit = parseInt(String(query.limit ?? '10'), 10)
          const offset = parseInt(String(query.offset ?? '0'), 10)

          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM blocks ORDER BY number DESC LIMIT ? OFFSET ?`,
            [limit, offset],
          )
          const countResult = await sqlitQuery(
            DATABASE_ID,
            `SELECT COUNT(*) as count FROM blocks`,
            [],
          )
          if (!result.success) {
            return { blocks: [], total: 0, error: result.status }
          }
          return {
            blocks: resultToObjects(result),
            total: resultToObjects(countResult)[0]?.count ?? 0,
          }
        })
        .get('/blocks/latest', async () => {
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM blocks ORDER BY number DESC LIMIT 1`,
            [],
          )
          if (!result.success) {
            return { block: null, error: result.status }
          }
          const rows = resultToObjects(result)
          return { block: rows[0] ?? null }
        })
        .get('/blocks/:blockNumber', async ({ params }) => {
          const blockNumber = parseInt(params.blockNumber, 10)
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM blocks WHERE number = ? LIMIT 1`,
            [blockNumber],
          )
          if (!result.success) {
            return {
              blockNumber: params.blockNumber,
              block: null,
              error: result.status,
            }
          }
          const rows = resultToObjects(result)
          return { block: rows[0] ?? null }
        })

        // Transactions
        .get('/transactions', async ({ query }) => {
          const limit = parseInt(String(query.limit ?? '10'), 10)
          const offset = parseInt(String(query.offset ?? '0'), 10)

          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM transactions ORDER BY block_number DESC LIMIT ? OFFSET ?`,
            [limit, offset],
          )
          const countResult = await sqlitQuery(
            DATABASE_ID,
            `SELECT COUNT(*) as count FROM transactions`,
            [],
          )
          if (!result.success) {
            return { transactions: [], total: 0, error: result.status }
          }
          return {
            transactions: resultToObjects(result),
            total: resultToObjects(countResult)[0]?.count ?? 0,
          }
        })
        .get('/transactions/:hash', async ({ params }) => {
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM transactions WHERE hash = ? LIMIT 1`,
            [params.hash],
          )
          if (!result.success) {
            return {
              hash: params.hash,
              transaction: null,
              error: result.status,
            }
          }
          const rows = resultToObjects(result)
          return { transaction: rows[0] ?? null }
        })

        // Addresses/Accounts
        .get('/addresses/:address', async ({ params }) => {
          const address = params.address.toLowerCase()
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM accounts WHERE address = ? OR id = ? LIMIT 1`,
            [address, address],
          )
          if (!result.success) {
            return {
              address: params.address,
              account: null,
              error: result.status,
            }
          }
          const rows = resultToObjects(result)
          return { account: rows[0] ?? null, address: params.address }
        })
        .get('/addresses/:address/transactions', async ({ params, query }) => {
          const limit = parseInt(String(query.limit ?? '10'), 10)
          const address = params.address.toLowerCase()

          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM transactions WHERE from_address = ? OR to_address = ? ORDER BY block_number DESC LIMIT ?`,
            [address, address, limit],
          )
          if (!result.success) {
            return {
              address: params.address,
              transactions: [],
              error: result.status,
            }
          }
          return {
            address: params.address,
            transactions: resultToObjects(result),
          }
        })

        // Tokens (table may not exist yet - return empty)
        .get('/tokens', async ({ query }) => {
          const limit = parseInt(String(query.limit ?? '10'), 10)
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM contracts WHERE is_erc20 = 1 OR is_erc721 = 1 OR is_erc1155 = 1 LIMIT ?`,
            [limit],
          )
          if (!result.success) {
            return { tokens: [], total: 0, error: result.status }
          }
          const rows = resultToObjects(result)
          return { tokens: rows, total: rows.length }
        })
        .get('/tokens/:address', async ({ params }) => {
          const address = params.address.toLowerCase()
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM contracts WHERE address = ? LIMIT 1`,
            [address],
          )
          if (!result.success) {
            return {
              address: params.address,
              token: null,
              error: result.status,
            }
          }
          const rows = resultToObjects(result)
          return { token: rows[0] ?? null }
        })

        // Events (table may not exist yet - return empty)
        .get('/events', async ({ query }) => {
          const limit = parseInt(String(query.limit ?? '10'), 10)
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM decoded_events ORDER BY timestamp DESC LIMIT ?`,
            [limit],
          )
          if (!result.success) {
            return { events: [], total: 0, error: result.status }
          }
          const rows = resultToObjects(result)
          return { events: rows, total: rows.length }
        })
        .get('/events/:contractAddress', async ({ params, query }) => {
          const limit = parseInt(String(query.limit ?? '10'), 10)
          const contractAddress = params.contractAddress.toLowerCase()

          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT * FROM decoded_events WHERE address_id = ? ORDER BY timestamp DESC LIMIT ?`,
            [contractAddress, limit],
          )
          if (!result.success) {
            return {
              contractAddress: params.contractAddress,
              events: [],
              error: result.status,
            }
          }
          return {
            contractAddress: params.contractAddress,
            events: resultToObjects(result),
          }
        })

        // Stats
        .get('/stats', async () => {
          const [blocksCount, txCount, accountsCount, latestBlock] =
            await Promise.all([
              sqlitQuery(
                DATABASE_ID,
                `SELECT COUNT(*) as count FROM blocks`,
                [],
              ),
              sqlitQuery(
                DATABASE_ID,
                `SELECT COUNT(*) as count FROM transactions`,
                [],
              ),
              sqlitQuery(
                DATABASE_ID,
                `SELECT COUNT(*) as count FROM accounts`,
                [],
              ),
              sqlitQuery(
                DATABASE_ID,
                `SELECT timestamp FROM blocks ORDER BY number DESC LIMIT 1`,
                [],
              ),
            ])

          return {
            totalBlocks: resultToObjects(blocksCount)[0]?.count ?? 0,
            totalTransactions: resultToObjects(txCount)[0]?.count ?? 0,
            totalAddresses: resultToObjects(accountsCount)[0]?.count ?? 0,
            lastBlockTime: resultToObjects(latestBlock)[0]?.timestamp ?? null,
          }
        })
        .get('/stats/tps', async () => {
          const oneMinuteAgo = new Date(Date.now() - 60000).toISOString()
          const result = await sqlitQuery(
            DATABASE_ID,
            `SELECT COUNT(*) as count FROM transactions t 
             JOIN blocks b ON t.block_id = b.id 
             WHERE b.timestamp > ?`,
            [oneMinuteAgo],
          )
          const txInLastMinute = resultToObjects(result)[0]?.count ?? 0
          const currentTPS =
            (typeof txInLastMinute === 'number' ? txInLastMinute : 0) / 60

          return {
            currentTPS: Math.round(currentTPS * 100) / 100,
            avgTPS: currentTPS,
            maxTPS: currentTPS,
          }
        }),
    )

    // A2A Protocol
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Indexer',
          description: 'Blockchain Indexer with GraphQL API',
          version: '2.0.0',
          protocol: 'a2a',
          capabilities: ['query', 'subscribe', 'historical-data'],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = A2ARequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          // Execute skill based on name
          const { skill, params } = parsed.data

          if (skill === 'query_blocks') {
            const limit = typeof params?.limit === 'number' ? params.limit : 10
            const result = await sqlitQuery(
              DATABASE_ID,
              `SELECT number, hash, timestamp FROM blocks ORDER BY number DESC LIMIT ?`,
              [limit],
            )
            if (!result.success) {
              return { skill, error: result.status }
            }
            return { skill, result: resultToObjects(result) }
          }

          return { skill, result: 'Skill not implemented' }
        }),
    )

    // MCP Protocol
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Indexer MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'indexer_query_blocks',
              description: 'Query recent blocks',
              parameters: {
                type: 'object',
                properties: {
                  limit: { type: 'number', default: 10 },
                  offset: { type: 'number', default: 0 },
                },
              },
            },
            {
              name: 'indexer_query_transactions',
              description: 'Query transactions',
              parameters: {
                type: 'object',
                properties: {
                  address: { type: 'string' },
                  limit: { type: 'number', default: 10 },
                },
              },
            },
            {
              name: 'indexer_graphql',
              description: 'Execute GraphQL query',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  variables: { type: 'object' },
                },
                required: ['query'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = MCPRequestSchema.safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          const { tool, arguments: args } = parsed.data

          if (tool === 'indexer_query_blocks') {
            const limit = typeof args.limit === 'number' ? args.limit : 10
            const result = await sqlitQuery(
              DATABASE_ID,
              `SELECT number, hash, timestamp FROM blocks ORDER BY number DESC LIMIT ?`,
              [limit],
            )
            if (!result.success) {
              return { tool, error: result.status }
            }
            return { tool, result: resultToObjects(result) }
          }

          if (tool === 'indexer_query_transactions') {
            const limit = typeof args.limit === 'number' ? args.limit : 10
            const address =
              typeof args.address === 'string'
                ? args.address.toLowerCase()
                : null

            let sql = `SELECT hash, block_number, from_address, to_address FROM transactions`
            const params: Array<string | number | null> = []

            if (address) {
              sql += ` WHERE from_address = ? OR to_address = ?`
              params.push(address, address)
            }

            sql += ` ORDER BY block_number DESC LIMIT ?`
            params.push(limit)

            const result = await sqlitQuery(DATABASE_ID, sql, params)
            if (!result.success) {
              return { tool, error: result.status }
            }
            return { tool, result: resultToObjects(result) }
          }

          if (tool === 'indexer_graphql') {
            const query = typeof args.query === 'string' ? args.query : ''
            return await executeGraphQLQuery(query)
          }

          return { tool, result: 'Tool not implemented' }
        }),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createIndexerApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point - only runs when executed directly
 * When imported as a module (by DWS bootstrap or test), this won't run
 */
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path

if (isMainModule) {
  const port = Number(process.env.PORT ?? process.env.INDEXER_PORT ?? 4352)
  const host = getLocalhostHost()

  console.log(`[Indexer Worker] Starting on http://${host}:${port}`)
  console.log(`[Indexer Worker] Network: ${getCurrentNetwork()}`)
  console.log(`[Indexer Worker] Database: ${DATABASE_ID}`)

  Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  })
}
