/**
 * Indexer MCP Server
 *
 * Model Context Protocol interface for blockchain data queries.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  buildAccountQuery,
  buildAgentQuery,
  buildAgentsQuery,
  buildBlockQuery,
  buildIntentQuery,
  buildLogsQuery,
  buildProposalQuery,
  buildTokenBalancesQuery,
  buildTransactionQuery,
} from './lib/graphql-utils'
import { BadRequestError, NotFoundError } from './lib/types'
import {
  addressSchema,
  analyzeTransactionPromptArgsSchema,
  blockNumberSchema,
  explainProposalPromptArgsSchema,
  hashSchema,
  mcpPromptGetSchema,
  mcpResourceReadSchema,
  mcpToolCallSchema,
  summarizeAgentActivityPromptArgsSchema,
  validateBody,
  validateOrThrow,
} from './lib/validation'

interface MCPResourceContents {
  note: string
  query: string
}

interface MCPToolResult {
  endpoint?: string
  method?: string
  body?: {
    query: string
    variables?: Record<string, unknown>
  }
  query?: string
  error?: string
}

// ============================================================================
// Configuration
// ============================================================================

const SERVER_INFO = {
  name: 'jeju-indexer',
  version: '1.0.0',
  description: 'Blockchain data indexing service with GraphQL access',
  capabilities: { resources: true, tools: true, prompts: true },
}

const RESOURCES = [
  {
    uri: 'indexer://blocks/latest',
    name: 'Latest Blocks',
    description: 'Most recent indexed blocks',
    mimeType: 'application/json',
  },
  {
    uri: 'indexer://transactions/recent',
    name: 'Recent Transactions',
    description: 'Recent transactions',
    mimeType: 'application/json',
  },
  {
    uri: 'indexer://agents',
    name: 'Registered Agents',
    description: 'All ERC-8004 registered agents',
    mimeType: 'application/json',
  },
  {
    uri: 'indexer://intents/active',
    name: 'Active Intents',
    description: 'Active cross-chain intents',
    mimeType: 'application/json',
  },
  {
    uri: 'indexer://proposals/active',
    name: 'Active Proposals',
    description: 'Active governance proposals',
    mimeType: 'application/json',
  },
  {
    uri: 'indexer://stats/network',
    name: 'Network Stats',
    description: 'Network-wide statistics',
    mimeType: 'application/json',
  },
  {
    uri: 'indexer://stats/defi',
    name: 'DeFi Stats',
    description: 'DeFi protocol statistics',
    mimeType: 'application/json',
  },
]

const TOOLS = [
  // Query Tools
  {
    name: 'query_graphql',
    description: 'Execute a GraphQL query against the indexer',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GraphQL query string' },
        variables: { type: 'object', description: 'Query variables' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_block',
    description: 'Get block by number or hash',
    inputSchema: {
      type: 'object',
      properties: {
        blockNumber: { type: 'number', description: 'Block number' },
        blockHash: { type: 'string', description: 'Block hash' },
      },
    },
  },
  {
    name: 'get_transaction',
    description: 'Get transaction by hash',
    inputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Transaction hash' },
      },
      required: ['hash'],
    },
  },
  {
    name: 'get_account',
    description: 'Get account information',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Account address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_token_balances',
    description: 'Get ERC20 token balances for an address',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Account address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_agent',
    description: 'Get ERC-8004 registered agent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'search_agents',
    description: 'Search registered agents',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Filter by role' },
        name: { type: 'string', description: 'Search by name' },
        active: { type: 'boolean', description: 'Only active agents' },
        limit: { type: 'number', description: 'Max results' },
      },
    },
  },
  {
    name: 'get_intent',
    description: 'Get cross-chain intent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        intentId: { type: 'string', description: 'Intent ID' },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'get_proposal',
    description: 'Get governance proposal',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'Proposal ID' },
      },
      required: ['proposalId'],
    },
  },
  {
    name: 'get_contract_events',
    description: 'Get events emitted by a contract',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Contract address' },
        eventName: { type: 'string', description: 'Filter by event name' },
        fromBlock: { type: 'number', description: 'Start block' },
        toBlock: { type: 'number', description: 'End block' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['address'],
    },
  },
]

const PROMPTS = [
  {
    name: 'analyze_transaction',
    description: 'Analyze a transaction in detail',
    arguments: [
      {
        name: 'hash',
        description: 'Transaction hash to analyze',
        required: true,
      },
    ],
  },
  {
    name: 'summarize_agent_activity',
    description: "Summarize an agent's on-chain activity",
    arguments: [
      { name: 'agentId', description: 'Agent ID to summarize', required: true },
      {
        name: 'days',
        description: 'Number of days to look back',
        required: false,
      },
    ],
  },
  {
    name: 'explain_proposal',
    description: 'Explain a governance proposal',
    arguments: [
      {
        name: 'proposalId',
        description: 'Proposal ID to explain',
        required: true,
      },
    ],
  },
]

// ============================================================================
// MCP Server
// ============================================================================

// Request body size limit (1MB)
const MAX_BODY_SIZE = 1024 * 1024

// Simple in-memory rate limiter for MCP server
const mcpRateLimitStore = new Map<string, { count: number; resetAt: number }>()
const MCP_RATE_LIMIT = 100 // requests per minute
const MCP_RATE_WINDOW = 60_000 // 1 minute

// Cleanup expired entries
setInterval(() => {
  const now = Date.now()
  for (const [key, { resetAt }] of mcpRateLimitStore) {
    if (now > resetAt) mcpRateLimitStore.delete(key)
  }
}, 60_000).unref()

export function createIndexerMCPServer(): Hono {
  const app = new Hono()

  // SECURITY: Global error handler for JSON parse errors and other exceptions
  app.onError((err, c) => {
    console.error('[MCP] Error:', err.message)

    // Handle JSON parse errors
    if (err.message.includes('JSON') || err.message.includes('Unexpected')) {
      return c.json({ error: 'Invalid JSON in request body' }, 400)
    }

    // Handle validation errors
    if (err.message.includes('Validation')) {
      return c.json({ error: err.message }, 400)
    }

    // Handle not found errors
    if (err.message.includes('not found')) {
      return c.json({ error: err.message }, 404)
    }

    // Don't expose internal error details
    return c.json({ error: 'Internal server error' }, 500)
  })

  // SECURITY: Configure CORS with allowlist - defaults to permissive for local dev
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  if (CORS_ORIGINS?.length) {
    app.use('/*', cors({ origin: CORS_ORIGINS, credentials: true }))
  } else {
    // Permissive CORS for local development when CORS_ORIGINS not set
    app.use('/*', cors())
  }

  // SECURITY: Request body size limit middleware
  app.use('/*', async (c, next) => {
    const contentLength = c.req.header('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return c.json({ error: 'Request body too large' }, 413)
    }
    return next()
  })

  // SECURITY: Rate limiting middleware
  app.use('/*', async (c, next) => {
    // Skip rate limiting for info endpoint
    if (c.req.path === '/') return next()

    // Use IP or API key for rate limiting
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    const apiKey = c.req.header('x-api-key')
    const clientKey = apiKey
      ? `apikey:${apiKey}`
      : `ip:${forwarded || 'unknown'}`

    const now = Date.now()
    let record = mcpRateLimitStore.get(clientKey)
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + MCP_RATE_WINDOW }
      mcpRateLimitStore.set(clientKey, record)
    }
    record.count++

    c.header('X-RateLimit-Limit', String(MCP_RATE_LIMIT))
    c.header(
      'X-RateLimit-Remaining',
      String(Math.max(0, MCP_RATE_LIMIT - record.count)),
    )
    c.header('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)))

    if (record.count > MCP_RATE_LIMIT) {
      return c.json({ error: 'Rate limit exceeded' }, 429)
    }

    return next()
  })

  // Initialize
  app.post('/initialize', (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: SERVER_INFO.capabilities,
    })
  })

  // Resources
  app.post('/resources/list', (c) => {
    return c.json({ resources: RESOURCES })
  })

  app.post('/resources/read', async (c) => {
    const body = await c.req.json()
    const { uri } = validateBody(
      mcpResourceReadSchema,
      body,
      'MCP POST /resources/read',
    )
    let contents: MCPResourceContents

    switch (uri) {
      case 'indexer://blocks/latest':
        contents = {
          note: 'Query latest blocks via GraphQL',
          query:
            'query { blocks(limit: 10, orderBy: number_DESC) { number hash timestamp } }',
        }
        break

      case 'indexer://transactions/recent':
        contents = {
          note: 'Query recent transactions via GraphQL',
          query:
            'query { transactions(limit: 20, orderBy: timestamp_DESC) { hash from to value } }',
        }
        break

      case 'indexer://agents':
        contents = {
          note: 'Query registered agents via GraphQL',
          query:
            'query { registeredAgents(limit: 100, orderBy: registeredAt_DESC) { agentId name role isActive } }',
        }
        break

      case 'indexer://intents/active':
        contents = {
          note: 'Query active intents via GraphQL',
          query:
            'query { oifIntents(where: { status_eq: "PENDING" }, limit: 50) { intentId sender amount status } }',
        }
        break

      case 'indexer://proposals/active':
        contents = {
          note: 'Query active proposals via GraphQL',
          query:
            'query { councilProposals(where: { status_eq: "ACTIVE" }) { proposalId title votesFor votesAgainst } }',
        }
        break

      case 'indexer://stats/network':
        contents = {
          note: 'Query network stats via GraphQL',
          query:
            'query { networkSnapshots(limit: 1, orderBy: timestamp_DESC) { totalTransactions totalAccounts } }',
        }
        break

      default:
        throw new NotFoundError('MCP Resource', uri)
    }

    return c.json({
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(contents, null, 2),
        },
      ],
    })
  })

  // Tools
  app.post('/tools/list', (c) => {
    return c.json({ tools: TOOLS })
  })

  app.post('/tools/call', async (c) => {
    const body = await c.req.json()
    const { name, arguments: args } = validateBody(
      mcpToolCallSchema,
      body,
      'MCP POST /tools/call',
    )
    let result: MCPToolResult
    const isError = false

    switch (name) {
      case 'query_graphql': {
        if (typeof args.query !== 'string' || !args.query) {
          throw new BadRequestError(
            'query is required and must be a non-empty string',
          )
        }
        const variables =
          args.variables &&
          typeof args.variables === 'object' &&
          !Array.isArray(args.variables)
            ? (args.variables as Record<string, unknown>)
            : undefined
        result = {
          endpoint: '/graphql',
          method: 'POST',
          body: {
            query: args.query,
            variables,
          },
        }
        break
      }

      case 'get_block': {
        const blockNumber =
          typeof args.blockNumber === 'number' ? args.blockNumber : undefined
        const blockHash =
          typeof args.blockHash === 'string' ? args.blockHash : undefined
        if (!blockNumber && !blockHash) {
          throw new BadRequestError(
            'Either blockNumber or blockHash must be provided',
          )
        }
        if (blockNumber) {
          validateOrThrow(
            blockNumberSchema,
            blockNumber,
            'MCP tool get_block blockNumber',
          )
        }
        if (blockHash) {
          validateOrThrow(hashSchema, blockHash, 'MCP tool get_block blockHash')
        }
        const query = buildBlockQuery(blockNumber, blockHash)
        result = { query: query.query }
        break
      }

      case 'get_transaction': {
        if (typeof args.hash !== 'string') {
          throw new BadRequestError('hash is required and must be a string')
        }
        validateOrThrow(hashSchema, args.hash, 'MCP tool get_transaction hash')
        const query = buildTransactionQuery(args.hash)
        result = { query: query.query }
        break
      }

      case 'get_account': {
        if (typeof args.address !== 'string') {
          throw new BadRequestError('address is required and must be a string')
        }
        validateOrThrow(
          addressSchema,
          args.address,
          'MCP tool get_account address',
        )
        const query = buildAccountQuery(args.address)
        result = { query: query.query }
        break
      }

      case 'get_token_balances': {
        if (typeof args.address !== 'string') {
          throw new BadRequestError('address is required and must be a string')
        }
        validateOrThrow(
          addressSchema,
          args.address,
          'MCP tool get_token_balances address',
        )
        const query = buildTokenBalancesQuery(args.address)
        result = { query: query.query }
        break
      }

      case 'get_agent': {
        if (
          typeof args.agentId !== 'string' &&
          typeof args.agentId !== 'number'
        ) {
          throw new BadRequestError(
            'agentId is required and must be a string or number',
          )
        }
        const query = buildAgentQuery(args.agentId)
        result = { query: query.query }
        break
      }

      case 'search_agents': {
        const role = typeof args.role === 'string' ? args.role : undefined
        const active = typeof args.active === 'boolean' ? args.active : true
        const limit = typeof args.limit === 'number' ? args.limit : 50
        const query = buildAgentsQuery({ role, active, limit })
        result = { query: query.query }
        break
      }

      case 'get_intent': {
        if (typeof args.intentId !== 'string' || !args.intentId) {
          throw new BadRequestError(
            'intentId is required and must be a non-empty string',
          )
        }
        const query = buildIntentQuery(args.intentId)
        result = { query: query.query }
        break
      }

      case 'get_proposal': {
        if (typeof args.proposalId !== 'string' || !args.proposalId) {
          throw new BadRequestError(
            'proposalId is required and must be a non-empty string',
          )
        }
        const query = buildProposalQuery(args.proposalId)
        result = { query: query.query }
        break
      }

      case 'get_contract_events': {
        if (typeof args.address !== 'string') {
          throw new BadRequestError('address is required and must be a string')
        }
        validateOrThrow(
          addressSchema,
          args.address,
          'MCP tool get_contract_events address',
        )
        const limit = typeof args.limit === 'number' ? args.limit : 100
        const eventName =
          typeof args.eventName === 'string' ? args.eventName : undefined
        const fromBlock =
          typeof args.fromBlock === 'number' ? args.fromBlock : undefined
        const toBlock =
          typeof args.toBlock === 'number' ? args.toBlock : undefined
        const query = buildLogsQuery({
          address: args.address,
          topic0: eventName,
          fromBlock,
          toBlock,
          limit,
        })
        result = { query: query.query }
        break
      }

      default:
        throw new BadRequestError(
          `Unknown tool: ${name}. Available tools: ${TOOLS.map((t) => t.name).join(', ')}`,
        )
    }

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError,
    })
  })

  // Prompts
  app.post('/prompts/list', (c) => {
    return c.json({ prompts: PROMPTS })
  })

  app.post('/prompts/get', async (c) => {
    const body = await c.req.json()
    const { name, arguments: args } = validateBody(
      mcpPromptGetSchema,
      body,
      'MCP POST /prompts/get',
    )

    let messages: Array<{
      role: string
      content: { type: string; text: string }
    }> = []

    switch (name) {
      case 'analyze_transaction': {
        const validated = validateOrThrow(
          analyzeTransactionPromptArgsSchema,
          args,
          'MCP prompt analyze_transaction',
        )
        messages = [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze the following transaction in detail. Explain what it does, the contracts involved, and any notable patterns.

Transaction Hash: ${validated.hash}

Please query the transaction data using the indexer tools and provide a comprehensive analysis.`,
            },
          },
        ]
        break
      }

      case 'summarize_agent_activity': {
        const validated = validateOrThrow(
          summarizeAgentActivityPromptArgsSchema,
          args,
          'MCP prompt summarize_agent_activity',
        )
        messages = [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Summarize the on-chain activity for agent ID ${validated.agentId} over the past ${validated.days} days.

Include:
- Transaction count and volume
- Types of operations performed
- Interactions with other agents
- Any notable events or anomalies`,
            },
          },
        ]
        break
      }

      case 'explain_proposal': {
        const validated = validateOrThrow(
          explainProposalPromptArgsSchema,
          args,
          'MCP prompt explain_proposal',
        )
        messages = [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Explain governance proposal ${validated.proposalId} in simple terms.

Include:
- What the proposal aims to change
- Current voting status
- Key arguments for and against
- Potential impact if passed`,
            },
          },
        ]
        break
      }

      default:
        throw new NotFoundError('MCP Prompt', name)
    }

    return c.json({ messages })
  })

  // Info endpoint
  app.get('/', (c) => {
    return c.json({
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: SERVER_INFO.description,
      resources: RESOURCES,
      tools: TOOLS,
      prompts: PROMPTS,
      capabilities: SERVER_INFO.capabilities,
    })
  })

  return app
}

const MCP_PORT = parseInt(process.env.MCP_PORT || '4353', 10)

export async function startMCPServer(): Promise<void> {
  const app = createIndexerMCPServer()
  const { serve } = await import('@hono/node-server')

  serve({
    fetch: app.fetch,
    port: MCP_PORT,
  })

  console.log(`📡 MCP Server running on http://localhost:${MCP_PORT}`)
}
