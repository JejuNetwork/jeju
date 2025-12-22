/**
 * Indexer MCP Server
 *
 * Model Context Protocol interface for blockchain data queries.
 */

import { cors } from '@elysiajs/cors'
import { AddressSchema, HashSchema, validateOrThrow } from '@jejunetwork/types'
import { Elysia } from 'elysia'
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
  analyzeTransactionPromptArgsSchema,
  blockNumberSchema,
  explainProposalPromptArgsSchema,
  type JsonValue,
  mcpPromptGetSchema,
  mcpResourceReadSchema,
  mcpToolCallSchema,
  summarizeAgentActivityPromptArgsSchema,
  validateBody,
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

export function createIndexerMCPServer() {
  // SECURITY: Configure CORS with allowlist - defaults to permissive for local dev
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const app = new Elysia()
    // CORS middleware
    .use(
      CORS_ORIGINS?.length
        ? cors({ origin: CORS_ORIGINS, credentials: true })
        : cors(),
    )
    // SECURITY: Global error handler for JSON parse errors and other exceptions
    .onError(({ error, set }) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error('[MCP] Error:', errorMessage)

      // Handle JSON parse errors
      if (
        errorMessage.includes('JSON') ||
        errorMessage.includes('Unexpected')
      ) {
        set.status = 400
        return { error: 'Invalid JSON in request body' }
      }

      // Handle validation errors
      if (errorMessage.includes('Validation')) {
        set.status = 400
        return { error: errorMessage }
      }

      // Handle not found errors
      if (errorMessage.includes('not found')) {
        set.status = 404
        return { error: errorMessage }
      }

      // Don't expose internal error details
      set.status = 500
      return { error: 'Internal server error' }
    })
    // SECURITY: Request body size limit and rate limiting middleware
    .onBeforeHandle(({ request, set, path }) => {
      // Body size limit
      const contentLength = request.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        set.status = 413
        return { error: 'Request body too large' }
      }

      // Skip rate limiting for info endpoint
      if (path === '/') return

      // Use IP or API key for rate limiting
      const forwarded = request.headers
        .get('x-forwarded-for')
        ?.split(',')[0]
        ?.trim()
      const apiKey = request.headers.get('x-api-key')
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

      set.headers['X-RateLimit-Limit'] = String(MCP_RATE_LIMIT)
      set.headers['X-RateLimit-Remaining'] = String(
        Math.max(0, MCP_RATE_LIMIT - record.count),
      )
      set.headers['X-RateLimit-Reset'] = String(
        Math.ceil(record.resetAt / 1000),
      )

      if (record.count > MCP_RATE_LIMIT) {
        set.status = 429
        return { error: 'Rate limit exceeded' }
      }
      return undefined
    })
    // Initialize
    .post('/initialize', () => ({
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: SERVER_INFO.capabilities,
    }))
    // Resources
    .post('/resources/list', () => ({ resources: RESOURCES }))
    .post('/resources/read', ({ body }) => {
      const { uri } = validateBody(
        mcpResourceReadSchema,
        body as Record<string, JsonValue>,
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
    // Tools
    .post('/tools/list', () => ({ tools: TOOLS }))
    .post('/tools/call', ({ body }) => {
      const { name, arguments: args } = validateBody(
        mcpToolCallSchema,
        body as Record<string, JsonValue>,
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
            validateOrThrow(
              HashSchema,
              blockHash,
              'MCP tool get_block blockHash',
            )
          }
          const query = buildBlockQuery(blockNumber, blockHash)
          result = { query: query.query }
          break
        }

        case 'get_transaction': {
          if (typeof args.hash !== 'string') {
            throw new BadRequestError('hash is required and must be a string')
          }
          validateOrThrow(
            HashSchema,
            args.hash,
            'MCP tool get_transaction hash',
          )
          const query = buildTransactionQuery(args.hash)
          result = { query: query.query }
          break
        }

        case 'get_account': {
          if (typeof args.address !== 'string') {
            throw new BadRequestError(
              'address is required and must be a string',
            )
          }
          validateOrThrow(
            AddressSchema,
            args.address,
            'MCP tool get_account address',
          )
          const query = buildAccountQuery(args.address)
          result = { query: query.query }
          break
        }

        case 'get_token_balances': {
          if (typeof args.address !== 'string') {
            throw new BadRequestError(
              'address is required and must be a string',
            )
          }
          validateOrThrow(
            AddressSchema,
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
            throw new BadRequestError(
              'address is required and must be a string',
            )
          }
          validateOrThrow(
            AddressSchema,
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

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError,
      }
    })
    // Prompts
    .post('/prompts/list', () => ({ prompts: PROMPTS }))
    .post('/prompts/get', ({ body }) => {
      const { name, arguments: args } = validateBody(
        mcpPromptGetSchema,
        body as Record<string, JsonValue>,
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

      return { messages }
    })
    // Info endpoint
    .get('/', () => ({
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: SERVER_INFO.description,
      resources: RESOURCES,
      tools: TOOLS,
      prompts: PROMPTS,
      capabilities: SERVER_INFO.capabilities,
    }))

  return app
}

const MCP_PORT = parseInt(process.env.MCP_PORT || '4353', 10)

export async function startMCPServer(): Promise<void> {
  const app = createIndexerMCPServer()

  app.listen(MCP_PORT)

  console.log(`📡 MCP Server running on http://localhost:${MCP_PORT}`)
}
