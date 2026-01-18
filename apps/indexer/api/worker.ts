/**
 * Indexer Worker for DWS Deployment
 *
 * Provides GraphQL and REST API access to the indexed blockchain data.
 * Uses SQLit for decentralized, distributed storage.
 *
 * This worker handles:
 * - GraphQL queries for registeredAgents, blocks, transactions, accounts
 * - REST API endpoints for full functionality
 * - Health checks
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  type Account,
  type Block,
  count,
  find,
  findOne,
  query,
  type RegisteredAgent,
  type Transaction,
} from './db'

// GraphQL request schema
const GraphQLRequestSchema = z.object({
  query: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
  operationName: z.string().optional(),
})

// Simple GraphQL query parser for common queries
interface ParsedQuery {
  type:
    | 'registeredAgents'
    | 'blocks'
    | 'transactions'
    | 'accounts'
    | 'account'
    | 'block'
    | 'transaction'
    | 'unknown'
  args: {
    limit?: number
    offset?: number
    orderBy?: string
    where?: Record<string, unknown>
    id?: string
    address?: string
    hash?: string
    number?: number
  }
  fields: string[]
}

function parseGraphQLQuery(queryStr: string): ParsedQuery {
  // Normalize whitespace
  const normalized = queryStr.replace(/\s+/g, ' ').trim()

  // Default result
  const result: ParsedQuery = {
    type: 'unknown',
    args: {},
    fields: [],
  }

  // Match registeredAgents query
  const registeredAgentsMatch = normalized.match(
    /registeredAgents\s*\(\s*([^)]*)\s*\)\s*\{([^}]+)\}/i,
  )
  if (registeredAgentsMatch) {
    result.type = 'registeredAgents'
    const argsStr = registeredAgentsMatch[1]
    const fieldsStr = registeredAgentsMatch[2]

    // Parse limit
    const limitMatch = argsStr.match(/limit:\s*(\d+)/i)
    if (limitMatch) result.args.limit = parseInt(limitMatch[1], 10)

    // Parse orderBy
    const orderByMatch = argsStr.match(/orderBy:\s*(\w+)/i)
    if (orderByMatch) result.args.orderBy = orderByMatch[1]

    // Parse fields
    result.fields = fieldsStr
      .split(/\s+/)
      .filter((f) => f && !f.includes('{') && !f.includes('}'))

    return result
  }

  // Match blocks query
  const blocksMatch = normalized.match(
    /blocks\s*\(\s*([^)]*)\s*\)\s*\{([^}]+)\}/i,
  )
  if (blocksMatch) {
    result.type = 'blocks'
    const argsStr = blocksMatch[1]
    const fieldsStr = blocksMatch[2]

    const limitMatch = argsStr.match(/limit:\s*(\d+)/i)
    if (limitMatch) result.args.limit = parseInt(limitMatch[1], 10)

    const orderByMatch = argsStr.match(/orderBy:\s*(\w+)/i)
    if (orderByMatch) result.args.orderBy = orderByMatch[1]

    result.fields = fieldsStr
      .split(/\s+/)
      .filter((f) => f && !f.includes('{') && !f.includes('}'))

    return result
  }

  // Match transactions query
  const txMatch = normalized.match(
    /transactions\s*\(\s*([^)]*)\s*\)\s*\{([^}]+)\}/i,
  )
  if (txMatch) {
    result.type = 'transactions'
    const argsStr = txMatch[1]
    const fieldsStr = txMatch[2]

    const limitMatch = argsStr.match(/limit:\s*(\d+)/i)
    if (limitMatch) result.args.limit = parseInt(limitMatch[1], 10)

    result.fields = fieldsStr
      .split(/\s+/)
      .filter((f) => f && !f.includes('{') && !f.includes('}'))

    return result
  }

  // Match accounts query
  const accountsMatch = normalized.match(
    /accounts\s*\(\s*([^)]*)\s*\)\s*\{([^}]+)\}/i,
  )
  if (accountsMatch) {
    result.type = 'accounts'
    const argsStr = accountsMatch[1]
    const fieldsStr = accountsMatch[2]

    const limitMatch = argsStr.match(/limit:\s*(\d+)/i)
    if (limitMatch) result.args.limit = parseInt(limitMatch[1], 10)

    result.fields = fieldsStr
      .split(/\s+/)
      .filter((f) => f && !f.includes('{') && !f.includes('}'))

    return result
  }

  // Introspection query
  if (normalized.includes('__typename') || normalized.includes('__schema')) {
    result.type = 'unknown'
    return result
  }

  return result
}

// Execute a parsed GraphQL query against SQLit
async function executeQuery(parsed: ParsedQuery): Promise<{
  data: Record<string, unknown> | null
  errors?: Array<{ message: string }>
}> {
  try {
    switch (parsed.type) {
      case 'registeredAgents': {
        const limit = parsed.args.limit ?? 100
        const agents = await find<RegisteredAgent>('RegisteredAgent', {
          order: { registeredAt: 'DESC' },
          take: limit,
        })

        // Map to GraphQL format with owner nested object
        const mapped = agents.map((agent) => ({
          id: agent.id,
          agentId: String(agent.agentId),
          owner: { address: agent.ownerAddress },
          name: agent.name,
          description: agent.description,
          tags:
            typeof agent.tags === 'string'
              ? JSON.parse(agent.tags)
              : (agent.tags ?? []),
          tokenURI: agent.metadataUri,
          stakeToken: 'ETH',
          stakeAmount: agent.stakeAmount,
          stakeTier: agent.stakeTier,
          registeredAt: agent.registeredAt,
          lastActivityAt: null,
          active: agent.active,
          isBanned: agent.isBanned,
          a2aEndpoint: agent.a2aEndpoint,
          mcpEndpoint: agent.mcpEndpoint,
          serviceType: agent.serviceType ?? 'agent',
          category: agent.category,
          x402Support: agent.x402Support,
          mcpTools:
            typeof agent.mcpTools === 'string'
              ? JSON.parse(agent.mcpTools)
              : (agent.mcpTools ?? []),
          a2aSkills:
            typeof agent.a2aSkills === 'string'
              ? JSON.parse(agent.a2aSkills)
              : (agent.a2aSkills ?? []),
          image: null,
        }))

        return { data: { registeredAgents: mapped } }
      }

      case 'blocks': {
        const limit = parsed.args.limit ?? 10
        const blocks = await find<Block>('Block', {
          order: { number: 'DESC' },
          take: limit,
        })
        return { data: { blocks } }
      }

      case 'transactions': {
        const limit = parsed.args.limit ?? 10
        const txs = await find<Transaction>('Transaction', {
          order: { blockNumber: 'DESC' },
          take: limit,
        })
        return { data: { transactions: txs } }
      }

      case 'accounts': {
        const limit = parsed.args.limit ?? 10
        const accounts = await find<Account>('Account', {
          order: { lastSeenAt: 'DESC' },
          take: limit,
        })
        return { data: { accounts } }
      }

      case 'unknown':
        // Return empty for introspection queries
        if (parsed.fields.includes('__typename')) {
          return { data: { __typename: 'Query' } }
        }
        return {
          data: null,
          errors: [
            {
              message:
                'Unsupported query. Supported: registeredAgents, blocks, transactions, accounts. Use REST API at /api/* for full functionality.',
            },
          ],
        }

      default:
        return {
          data: null,
          errors: [{ message: `Unknown query type: ${parsed.type}` }],
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      data: null,
      errors: [
        {
          message: `Database error: ${message}. The indexer database may not be available in this worker environment.`,
        },
      ],
    }
  }
}

// Create the Elysia app
const app = new Elysia()
  .use(
    cors({
      origin: [
        'https://gateway.testnet.jejunetwork.org',
        'https://gateway.jejunetwork.org',
        'https://dws.testnet.jejunetwork.org',
        'https://dws.jejunetwork.org',
      ],
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  )
  // Health check
  .get('/health', () => ({
    status: 'ok',
    service: 'indexer-worker',
    timestamp: new Date().toISOString(),
  }))
  // Root
  .get('/', () => ({
    name: 'Indexer API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      graphql: '/graphql',
      stats: '/stats',
      agents: '/agents',
      blocks: '/blocks',
      transactions: '/transactions',
    },
  }))
  // GraphQL playground (GET)
  .get('/graphql', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Indexer GraphQL Playground</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js" crossorigin></script>
  <link href="https://unpkg.com/graphiql@3/graphiql.min.css" rel="stylesheet" />
  <style>body { margin: 0; height: 100vh; } #graphiql { height: 100vh; }</style>
</head>
<body>
  <div id="graphiql"></div>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '/graphql' });
    const defaultQuery = \`query {
  registeredAgents(limit: 10, orderBy: registeredAt_DESC) {
    agentId
    name
    description
    owner { address }
    active
  }
}\`;
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher, defaultQuery })
    );
  </script>
</body>
</html>`
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  })
  // GraphQL endpoint (POST)
  .post('/graphql', async ({ body, set }) => {
    const parsed = GraphQLRequestSchema.safeParse(body)

    if (!parsed.success) {
      set.status = 400
      return {
        errors: [{ message: `Invalid request: ${parsed.error.message}` }],
      }
    }

    const queryAst = parseGraphQLQuery(parsed.data.query)
    return await executeQuery(queryAst)
  })
  // REST: Stats endpoint for frontend
  .get('/stats', async () => {
    // Return basic stats - database may not be available in worker
    // TODO: Connect to SQLit when available in worker environment
    return {
      totalBlocks: 0,
      totalTransactions: 0,
      totalAccounts: 0,
      totalContracts: 0,
      totalTokenTransfers: 0,
      totalAgents: 0,
      latestBlockNumber: 0,
      latestBlockTimestamp: new Date().toISOString(),
      status: 'worker-mode',
    }
  })
  // REST: List agents
  .get('/agents', async ({ query: queryParams, set }) => {
    try {
      const limit = queryParams.limit
        ? parseInt(queryParams.limit as string, 10)
        : 100
      const offset = queryParams.offset
        ? parseInt(queryParams.offset as string, 10)
        : 0

      const agents = await find<RegisteredAgent>('RegisteredAgent', {
        order: { registeredAt: 'DESC' },
        take: limit,
        skip: offset,
      })
      const total = await count('RegisteredAgent')

      // Map to frontend-friendly format
      const mapped = agents.map((agent) => ({
        agentId: String(agent.agentId),
        name: agent.name,
        description: agent.description,
        owner: agent.ownerAddress,
        tags:
          typeof agent.tags === 'string'
            ? JSON.parse(agent.tags)
            : (agent.tags ?? []),
        stakeAmount: agent.stakeAmount,
        stakeTier: agent.stakeTier,
        registeredAt: agent.registeredAt,
        active: agent.active,
        a2aEndpoint: agent.a2aEndpoint,
        mcpEndpoint: agent.mcpEndpoint,
        serviceType: agent.serviceType ?? 'agent',
        category: agent.category,
        x402Support: agent.x402Support,
      }))

      return { agents: mapped, total, limit, offset }
    } catch (error) {
      set.status = 503
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Database unavailable: ${message}`, agents: [], total: 0 }
    }
  })
  // REST: Get agent by ID
  .get('/agents/:id', async ({ params, set }) => {
    try {
      const agent = await findOne<RegisteredAgent>('RegisteredAgent', params.id)
      if (!agent) {
        set.status = 404
        return { error: 'Agent not found' }
      }
      return agent
    } catch (error) {
      set.status = 503
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Database unavailable: ${message}` }
    }
  })
  // REST: List blocks
  .get('/blocks', async ({ query: queryParams, set }) => {
    try {
      const limit = queryParams.limit
        ? parseInt(queryParams.limit as string, 10)
        : 10
      const blocks = await find<Block>('Block', {
        order: { number: 'DESC' },
        take: limit,
      })
      return { blocks }
    } catch (error) {
      set.status = 503
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Database unavailable: ${message}`, blocks: [] }
    }
  })
  // REST: List transactions
  .get('/transactions', async ({ query: queryParams, set }) => {
    try {
      const limit = queryParams.limit
        ? parseInt(queryParams.limit as string, 10)
        : 10
      const txs = await find<Transaction>('Transaction', {
        order: { blockNumber: 'DESC' },
        take: limit,
      })
      return { transactions: txs }
    } catch (error) {
      set.status = 503
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Database unavailable: ${message}`, transactions: [] }
    }
  })
  // REST: Search
  .get('/search', async ({ query: queryParams, set }) => {
    try {
      const q = (queryParams.q as string) || ''
      const limit = queryParams.limit
        ? parseInt(queryParams.limit as string, 10)
        : 20

      // Search agents by name
      const result = await query<RegisteredAgent>(
        `SELECT * FROM registered_agent WHERE name LIKE ? ORDER BY registered_at DESC LIMIT ?`,
        [`%${q}%`, limit],
      )

      return { results: result.rows, query: q }
    } catch (error) {
      set.status = 503
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Database unavailable: ${message}`, results: [] }
    }
  })

// Export the fetch handler for DWS worker runtime
export default {
  async fetch(request: Request): Promise<Response> {
    return app.handle(request)
  },
}

// Also export the app for direct usage
export { app }
