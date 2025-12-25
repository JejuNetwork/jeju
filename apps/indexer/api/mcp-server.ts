/**
 * Indexer MCP server
 */

import { cors } from '@elysiajs/cors'
import { validateOrThrow } from '@jejunetwork/types'
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
} from './utils/graphql-utils'
import { BadRequestError, NotFoundError } from './utils/types'
import {
  analyzeTransactionPromptArgsSchema,
  explainProposalPromptArgsSchema,
  getAccountSkillSchema,
  getAgentSkillSchema,
  getAgentsSkillSchema,
  getBlockSkillSchema,
  getContractEventsArgsSchema,
  getIntentSkillSchema,
  getProposalSkillSchema,
  getTokenBalancesSkillSchema,
  getTransactionSkillSchema,
  mcpPromptGetSchema,
  mcpResourceReadSchema,
  mcpToolCallSchema,
  queryGraphqlArgsSchema,
  summarizeAgentActivityPromptArgsSchema,
  validateBody,
} from './utils/validation'

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

const MAX_BODY_SIZE = 1024 * 1024

const mcpRateLimitStore = new Map<string, { count: number; resetAt: number }>()
const MCP_RATE_LIMIT = 100
const MCP_RATE_WINDOW = 60_000

setInterval(() => {
  const now = Date.now()
  for (const [key, { resetAt }] of mcpRateLimitStore) {
    if (now > resetAt) mcpRateLimitStore.delete(key)
  }
}, 60_000).unref()

export function createIndexerMCPServer() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const app = new Elysia()
    .use(
      CORS_ORIGINS?.length
        ? cors({ origin: CORS_ORIGINS, credentials: true })
        : cors(),
    )
    .onError(({ error, set }) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error('[MCP] Error:', errorMessage)

      if (
        errorMessage.includes('JSON') ||
        errorMessage.includes('Unexpected')
      ) {
        set.status = 400
        return { error: 'Invalid JSON in request body' }
      }

      if (errorMessage.includes('Validation')) {
        set.status = 400
        return { error: errorMessage }
      }

      if (errorMessage.includes('not found')) {
        set.status = 404
        return { error: errorMessage }
      }

      set.status = 500
      return { error: 'Internal server error' }
    })
    .onBeforeHandle(({ request, set, path }) => {
      const contentLength = request.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        set.status = 413
        return { error: 'Request body too large' }
      }

      if (path === '/') return

      const forwarded = request.headers
        .get('x-forwarded-for')
        ?.split(',')[0]
        ?.trim()
      const apiKey = request.headers.get('x-api-key')
      const clientKey = apiKey
        ? `apikey:${apiKey}`
        : `ip:${forwarded ?? 'unknown'}`

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
    .post('/initialize', () => ({
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: SERVER_INFO.capabilities,
    }))
    .post('/resources/list', () => ({ resources: RESOURCES }))
    .post('/resources/read', ({ body }) => {
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
    .post('/tools/list', () => ({ tools: TOOLS }))
    .post('/tools/call', ({ body }) => {
      const { name, arguments: args } = validateBody(
        mcpToolCallSchema,
        body,
        'MCP POST /tools/call',
      )
      let result: MCPToolResult
      const isError = false

      switch (name) {
        case 'query_graphql': {
          const validated = validateOrThrow(
            queryGraphqlArgsSchema,
            args,
            'MCP tool query_graphql',
          )
          result = {
            endpoint: '/graphql',
            method: 'POST',
            body: {
              query: validated.query,
              variables: validated.variables,
            },
          }
          break
        }

        case 'get_block': {
          const validated = validateOrThrow(
            getBlockSkillSchema,
            args,
            'MCP tool get_block',
          )
          const query = buildBlockQuery(
            validated.blockNumber,
            validated.blockHash,
          )
          result = { query: query.query }
          break
        }

        case 'get_transaction': {
          const validated = validateOrThrow(
            getTransactionSkillSchema,
            args,
            'MCP tool get_transaction',
          )
          const query = buildTransactionQuery(validated.hash)
          result = { query: query.query }
          break
        }

        case 'get_account': {
          const validated = validateOrThrow(
            getAccountSkillSchema,
            args,
            'MCP tool get_account',
          )
          const query = buildAccountQuery(validated.address)
          result = { query: query.query }
          break
        }

        case 'get_token_balances': {
          const validated = validateOrThrow(
            getTokenBalancesSkillSchema,
            args,
            'MCP tool get_token_balances',
          )
          const query = buildTokenBalancesQuery(validated.address)
          result = { query: query.query }
          break
        }

        case 'get_agent': {
          const validated = validateOrThrow(
            getAgentSkillSchema,
            args,
            'MCP tool get_agent',
          )
          const query = buildAgentQuery(validated.agentId)
          result = { query: query.query }
          break
        }

        case 'search_agents': {
          const validated = validateOrThrow(
            getAgentsSkillSchema,
            args,
            'MCP tool search_agents',
          )
          const query = buildAgentsQuery({
            role: validated.role,
            active: validated.active ?? true,
            limit: validated.limit ?? 50,
          })
          result = { query: query.query }
          break
        }

        case 'get_intent': {
          const validated = validateOrThrow(
            getIntentSkillSchema,
            args,
            'MCP tool get_intent',
          )
          const query = buildIntentQuery(validated.intentId)
          result = { query: query.query }
          break
        }

        case 'get_proposal': {
          const validated = validateOrThrow(
            getProposalSkillSchema,
            args,
            'MCP tool get_proposal',
          )
          const query = buildProposalQuery(validated.proposalId)
          result = { query: query.query }
          break
        }

        case 'get_contract_events': {
          const validated = validateOrThrow(
            getContractEventsArgsSchema,
            args,
            'MCP tool get_contract_events',
          )
          const query = buildLogsQuery({
            address: validated.address,
            topic0: validated.eventName,
            fromBlock: validated.fromBlock,
            toBlock: validated.toBlock,
            limit: validated.limit ?? 100,
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
    .post('/prompts/list', () => ({ prompts: PROMPTS }))
    .post('/prompts/get', ({ body }) => {
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

      return { messages }
    })
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
