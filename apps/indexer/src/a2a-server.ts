/**
 * Indexer A2A Server
 *
 * Agent-to-agent interface for blockchain data queries.
 * Provides indexed blockchain data via A2A protocol.
 */

import { cors } from '@elysiajs/cors'
import { validateOrThrow } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  buildAccountQuery,
  buildAgentQuery,
  buildAgentReputationQuery,
  buildAgentsQuery,
  buildBlockQuery,
  buildIntentQuery,
  buildLogsQuery,
  buildNetworkStatsQuery,
  buildProposalQuery,
  buildProposalsQuery,
  buildSolverQuery,
  buildTokenBalancesQuery,
  buildTokenStatsQuery,
  buildTransactionQuery,
} from './lib/graphql-utils'
import { BadRequestError } from './lib/types'
import {
  a2aRequestSchema,
  getAccountSkillSchema,
  getAgentReputationSkillSchema,
  getAgentSkillSchema,
  getAgentsSkillSchema,
  getBlockSkillSchema,
  getIntentSkillSchema,
  getLogsSkillSchema,
  getProposalSkillSchema,
  getProposalsSkillSchema,
  getSolverSkillSchema,
  getTokenBalancesSkillSchema,
  getTransactionSkillSchema,
  type JsonValue,
  validateBody,
} from './lib/validation'

// Local agent card creator (avoids React dependency from shared package)
function createAgentCard(options: {
  name: string
  description: string
  url?: string
  version?: string
  skills?: Array<{
    id: string
    name: string
    description: string
    tags?: string[]
  }>
}): {
  protocolVersion: string
  name: string
  description: string
  url: string
  preferredTransport: string
  provider: { organization: string; url: string }
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: Array<{
    id: string
    name: string
    description: string
    tags?: string[]
  }>
} {
  return {
    protocolVersion: '0.3.0',
    name: `Network ${options.name}`,
    description: options.description,
    url: options.url || '/api/a2a',
    preferredTransport: 'http',
    provider: {
      organization: 'Network',
      url: 'https://network.io',
    },
    version: options.version || '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: options.skills || [],
  }
}

interface SkillResult {
  message: string
  data: Record<string, unknown>
}

const INDEXER_SKILLS = [
  // Block/Transaction Skills
  {
    id: 'get-block',
    name: 'Get Block',
    description: 'Get block by number or hash',
    tags: ['query', 'block'],
  },
  {
    id: 'get-transaction',
    name: 'Get Transaction',
    description: 'Get transaction by hash',
    tags: ['query', 'transaction'],
  },
  {
    id: 'get-transactions',
    name: 'Get Transactions',
    description: 'Query transactions with filters',
    tags: ['query', 'transactions'],
  },
  {
    id: 'get-logs',
    name: 'Get Event Logs',
    description: 'Query decoded event logs',
    tags: ['query', 'events'],
  },

  // Account Skills
  {
    id: 'get-account',
    name: 'Get Account',
    description: 'Get account info including balance and nonce',
    tags: ['query', 'account'],
  },
  {
    id: 'get-account-transactions',
    name: 'Get Account Transactions',
    description: 'Get transactions for an account',
    tags: ['query', 'account'],
  },
  {
    id: 'get-token-balances',
    name: 'Get Token Balances',
    description: 'Get ERC20 token balances for an account',
    tags: ['query', 'tokens'],
  },
  {
    id: 'get-nft-holdings',
    name: 'Get NFT Holdings',
    description: 'Get NFTs owned by an account',
    tags: ['query', 'nft'],
  },
]

const ALL_INDEXER_SKILLS = [
  ...INDEXER_SKILLS,
  // Contract Skills
  {
    id: 'get-contract',
    name: 'Get Contract',
    description: 'Get contract info including ABI if verified',
    tags: ['query', 'contract'],
  },
  {
    id: 'get-contract-events',
    name: 'Get Contract Events',
    description: 'Get events emitted by a contract',
    tags: ['query', 'events'],
  },
  {
    id: 'get-verified-contracts',
    name: 'Get Verified Contracts',
    description: 'List verified contracts',
    tags: ['query', 'verified'],
  },
  // ERC-8004 Agent Skills
  {
    id: 'get-agent',
    name: 'Get Agent',
    description: 'Get registered agent by ID',
    tags: ['query', 'agent'],
  },
  {
    id: 'get-agents',
    name: 'Get Agents',
    description: 'Query registered agents with filters',
    tags: ['query', 'agents'],
  },
  {
    id: 'get-agent-reputation',
    name: 'Get Agent Reputation',
    description: 'Get reputation metrics for an agent',
    tags: ['query', 'reputation'],
  },
  {
    id: 'get-agent-activity',
    name: 'Get Agent Activity',
    description: 'Get on-chain activity for an agent',
    tags: ['query', 'activity'],
  },
  // OIF/EIL Skills
  {
    id: 'get-intent',
    name: 'Get Intent',
    description: 'Get cross-chain intent by ID',
    tags: ['query', 'oif'],
  },
  {
    id: 'get-intents',
    name: 'Get Intents',
    description: 'Query intents with filters',
    tags: ['query', 'oif'],
  },
  {
    id: 'get-solver',
    name: 'Get Solver',
    description: 'Get solver info and statistics',
    tags: ['query', 'solver'],
  },
  {
    id: 'get-xlp',
    name: 'Get XLP',
    description: 'Get cross-chain liquidity provider info',
    tags: ['query', 'xlp'],
  },
  // Governance Skills
  {
    id: 'get-proposal',
    name: 'Get Proposal',
    description: 'Get governance proposal by ID',
    tags: ['query', 'governance'],
  },
  {
    id: 'get-proposals',
    name: 'Get Proposals',
    description: 'Query governance proposals',
    tags: ['query', 'governance'],
  },
  {
    id: 'get-votes',
    name: 'Get Votes',
    description: 'Get votes for a proposal',
    tags: ['query', 'votes'],
  },
  // Statistics Skills
  {
    id: 'get-network-stats',
    name: 'Get Network Stats',
    description: 'Get overall network statistics',
    tags: ['query', 'stats'],
  },
  {
    id: 'get-token-stats',
    name: 'Get Token Stats',
    description: 'Get token transfer statistics',
    tags: ['query', 'stats'],
  },
  {
    id: 'get-defi-stats',
    name: 'Get DeFi Stats',
    description: 'Get DeFi protocol statistics',
    tags: ['query', 'stats'],
  },
]

const AGENT_CARD = {
  ...createAgentCard({
    name: 'Indexer',
    description:
      'Blockchain data indexing service providing fast queries for on-chain events, transactions, and state',
    skills: ALL_INDEXER_SKILLS,
  }),
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
}

async function executeSkill(
  skillId: string,
  params: Record<string, unknown>,
): Promise<SkillResult> {
  switch (skillId) {
    // Block/Transaction Skills
    case 'get-block': {
      const validated = validateOrThrow(
        getBlockSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildBlockQuery(validated.blockNumber, validated.blockHash)
      return {
        message: `Block data for ${validated.blockNumber ?? validated.blockHash}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-transaction': {
      const validated = validateOrThrow(
        getTransactionSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildTransactionQuery(validated.hash)
      return {
        message: `Transaction ${validated.hash}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-logs': {
      const validated = validateOrThrow(
        getLogsSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const topics = validated.topics
      const query = buildLogsQuery({
        address: validated.address,
        topic0: topics?.[0],
        fromBlock: validated.fromBlock,
        toBlock: validated.toBlock,
        limit: validated.limit ?? 100,
      })
      return {
        message: 'Event logs query',
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    // Account Skills
    case 'get-account': {
      const validated = validateOrThrow(
        getAccountSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildAccountQuery(validated.address)
      return {
        message: `Account ${validated.address}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-token-balances': {
      const validated = validateOrThrow(
        getTokenBalancesSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildTokenBalancesQuery(validated.address)
      return {
        message: `Token balances for ${validated.address}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    // ERC-8004 Agent Skills
    case 'get-agent': {
      const validated = validateOrThrow(
        getAgentSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildAgentQuery(validated.agentId)
      return {
        message: `Agent ${validated.agentId}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-agents': {
      const validated = validateOrThrow(
        getAgentsSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildAgentsQuery({
        role: validated.role,
        active: validated.active,
        limit: validated.limit ?? 50,
        offset: validated.offset ?? 0,
      })
      return {
        message: 'Query agents',
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-agent-reputation': {
      const validated = validateOrThrow(
        getAgentReputationSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildAgentReputationQuery(validated.agentId)
      return {
        message: `Reputation for agent ${validated.agentId}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    // OIF/EIL Skills
    case 'get-intent': {
      const validated = validateOrThrow(
        getIntentSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildIntentQuery(validated.intentId)
      return {
        message: `Intent ${validated.intentId}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-solver': {
      const validated = validateOrThrow(
        getSolverSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildSolverQuery(validated.address)
      return {
        message: `Solver ${validated.address}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    // Governance Skills
    case 'get-proposal': {
      const validated = validateOrThrow(
        getProposalSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildProposalQuery(validated.proposalId)
      return {
        message: `Proposal ${validated.proposalId}`,
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-proposals': {
      const validated = validateOrThrow(
        getProposalsSkillSchema,
        params,
        `A2A skill ${skillId}`,
      )
      const query = buildProposalsQuery({
        status: validated.status,
        limit: validated.limit ?? 20,
      })
      return {
        message: 'Query proposals',
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    // Statistics Skills
    case 'get-network-stats': {
      const query = buildNetworkStatsQuery()
      return {
        message: 'Network statistics',
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    case 'get-token-stats': {
      const query = buildTokenStatsQuery()
      return {
        message: 'Token statistics',
        data: {
          endpoint: '/graphql',
          ...query,
        },
      }
    }

    default:
      throw new BadRequestError(
        `Unknown skill: ${skillId}. Available skills: ${AGENT_CARD.skills.map((s) => s.id).join(', ')}`,
      )
  }
}

// Request body size limit (1MB)
const MAX_BODY_SIZE = 1024 * 1024

// Simple in-memory rate limiter for A2A server
const a2aRateLimitStore = new Map<string, { count: number; resetAt: number }>()
const A2A_RATE_LIMIT = 100 // requests per minute
const A2A_RATE_WINDOW = 60_000 // 1 minute

// Cleanup expired entries
setInterval(() => {
  const now = Date.now()
  for (const [key, { resetAt }] of a2aRateLimitStore) {
    if (now > resetAt) a2aRateLimitStore.delete(key)
  }
}, 60_000).unref()

export function createIndexerA2AServer() {
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
      const errorName = error instanceof Error ? error.name : 'Error'
      console.error('[A2A] Error:', errorMessage)

      // Handle JSON parse errors
      if (
        errorMessage.includes('JSON') ||
        errorMessage.includes('Unexpected')
      ) {
        set.status = 400
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: Invalid JSON' },
        }
      }

      // Handle validation errors
      if (
        errorMessage.includes('Validation') ||
        errorName === 'BadRequestError'
      ) {
        set.status = 400
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: errorMessage },
        }
      }

      // Don't expose internal error details
      set.status = 500
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error' },
      }
    })
    // SECURITY: Request body size limit and rate limiting middleware
    .onBeforeHandle(({ request, set, path }) => {
      // Body size limit
      const contentLength = request.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        set.status = 413
        return {
          jsonrpc: '2.0' as const,
          id: null,
          error: { code: -32600, message: 'Request body too large' },
        }
      }

      // Skip rate limiting for agent card and info endpoints
      if (path === '/' || path === '/.well-known/agent-card.json') return

      // Use IP or Agent ID for rate limiting
      const forwarded = request.headers
        .get('x-forwarded-for')
        ?.split(',')[0]
        ?.trim()
      const agentId = request.headers.get('x-agent-id')
      const clientKey = agentId
        ? `agent:${agentId}`
        : `ip:${forwarded || 'unknown'}`

      const now = Date.now()
      let record = a2aRateLimitStore.get(clientKey)
      if (!record || now > record.resetAt) {
        record = { count: 0, resetAt: now + A2A_RATE_WINDOW }
        a2aRateLimitStore.set(clientKey, record)
      }
      record.count++

      set.headers['X-RateLimit-Limit'] = String(A2A_RATE_LIMIT)
      set.headers['X-RateLimit-Remaining'] = String(
        Math.max(0, A2A_RATE_LIMIT - record.count),
      )
      set.headers['X-RateLimit-Reset'] = String(
        Math.ceil(record.resetAt / 1000),
      )

      if (record.count > A2A_RATE_LIMIT) {
        set.status = 429
        return {
          jsonrpc: '2.0' as const,
          id: null,
          error: { code: -32600, message: 'Rate limit exceeded' },
        }
      }
      return undefined
    })
    .get('/.well-known/agent-card.json', () => AGENT_CARD)
    .post('/', async ({ body }) => {
      const validated = validateBody(
        a2aRequestSchema,
        body as Record<string, JsonValue>,
        'A2A POST /',
      )

      const message = validated.params.message
      const dataPart = message.parts.find((p) => p.kind === 'data')

      if (!dataPart?.data) {
        throw new BadRequestError('No data part found in message')
      }

      const skillId = dataPart.data.skillId
      if (typeof skillId !== 'string' || !skillId) {
        throw new BadRequestError('skillId is required and must be a string')
      }

      const result = await executeSkill(skillId, dataPart.data)

      return {
        jsonrpc: '2.0',
        id: validated.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data },
          ],
          messageId: message.messageId,
          kind: 'message',
        },
      }
    })
    .get('/', () => ({
      service: 'indexer-a2a',
      version: '1.0.0',
      agentCard: '/.well-known/agent-card.json',
    }))

  return app
}

const A2A_PORT = parseInt(process.env.A2A_PORT || '4351', 10)

export async function startA2AServer(): Promise<void> {
  const app = createIndexerA2AServer()

  app.listen(A2A_PORT)

  console.log(`📡 A2A Server running on http://localhost:${A2A_PORT}`)
}

export { AGENT_CARD as INDEXER_AGENT_CARD }
