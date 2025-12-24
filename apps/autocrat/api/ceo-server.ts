/**
 * CEO Agent Server
 *
 * Dedicated ElizaOS-powered CEO agent exposed on port 8004.
 * Provides A2A and MCP interfaces for AI CEO governance.
 */

import {
  AgentRuntime,
  type Character,
  type Logger,
  type Plugin,
  stringToUuid,
} from '@elizaos/core'
import cors from '@elysiajs/cors'
import {
  expect,
  expectDefined,
  expectValid,
  validateOrThrow,
} from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { z } from 'zod'
import {
  A2AJsonRpcResponseSchema,
  A2AMessageSchema,
  type AutocratVotesData,
  AutocratVotesDataSchema,
  extractA2AData,
  type GovernanceStatsData,
  GovernanceStatsDataSchema,
  ProposalIdSchema,
  type ProposalListData,
  ProposalListDataSchema,
} from '../lib'
import { ceoPlugin } from './agents/ceo-plugin'
import { ceoAgent } from './agents/templates'
import { getTEEMode, makeTEEDecision } from './tee'

const CEO_PORT = parseInt(process.env.CEO_PORT ?? '8004', 10)
const AUTOCRAT_A2A_URL =
  process.env.AUTOCRAT_A2A_URL ?? 'http://localhost:8010/a2a'
const AUTOCRAT_MCP_URL =
  process.env.AUTOCRAT_MCP_URL ?? 'http://localhost:8010/mcp'

// Model settings - uses DWS for decentralized inference (not direct provider keys)
function getModelSettings(): Record<string, string> {
  // Configure ElizaOS to use DWS as the OpenAI-compatible endpoint
  // This ensures all inference goes through DWS network
  const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4030'
  return {
    // Use DWS compute endpoint as OpenAI-compatible base
    OPENAI_API_BASE: `${dwsUrl}/compute`,
    OPENAI_API_KEY: 'dws', // DWS doesn't require API key
  }
}

let ceoRuntime: AgentRuntime | null = null

async function initializeCEORuntime(): Promise<AgentRuntime> {
  if (ceoRuntime) return ceoRuntime

  const character: Character = {
    ...ceoAgent.character,
    settings: {
      ...ceoAgent.character.settings,
      ...getModelSettings(),
    },
  }

  const plugins: Plugin[] = [ceoPlugin]

  const runtime = new AgentRuntime({
    character,
    agentId: stringToUuid('eliza-ceo'),
    plugins,
  })

  // Configure logger with proper typing
  const formatMsg = (
    obj: Record<string, unknown> | string | Error,
    msg?: string,
  ): string => {
    if (typeof obj === 'string') return obj
    if (obj instanceof Error) return obj.message
    if (msg) return msg
    return JSON.stringify(obj)
  }

  const customLogger: Logger = {
    log: (obj, msg) => console.log(`[CEO] ${formatMsg(obj, msg)}`),
    info: (obj, msg) => console.log(`[CEO] ${formatMsg(obj, msg)}`),
    warn: (obj, msg) => console.warn(`[CEO] ${formatMsg(obj, msg)}`),
    error: (obj, msg) => console.error(`[CEO] ${formatMsg(obj, msg)}`),
    debug: (obj, msg) => console.debug(`[CEO] ${formatMsg(obj, msg)}`),
    success: (obj, msg) => console.log(`[CEO] ✓ ${formatMsg(obj, msg)}`),
    trace: (obj, msg) => console.debug(`[CEO] ${formatMsg(obj, msg)}`),
    fatal: (obj, msg) => console.error(`[CEO] FATAL: ${formatMsg(obj, msg)}`),
    progress: (obj, msg) => console.log(`[CEO] ${formatMsg(obj, msg)}`),
    level: 'info',
    clear: () => undefined,
    child: () => customLogger,
  }
  runtime.logger = customLogger

  // Register plugins
  for (const plugin of plugins) {
    await runtime.registerPlugin(plugin)
  }

  ceoRuntime = runtime
  return runtime
}

const app = new Elysia().use(cors())

// Agent Card (A2A Discovery)
app.get('/.well-known/agent-card.json', () => ({
  protocolVersion: '0.3.0',
  name: 'Eliza - AI CEO',
  description:
    'AI CEO of Network DAO. Makes final decisions on proposals with TEE attestation.',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'the network', url: 'https://jejunetwork.org' },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    {
      id: 'make-decision',
      name: 'Make Decision',
      description: 'Make final CEO decision on a proposal',
      tags: ['decision', 'governance'],
    },
    {
      id: 'get-dashboard',
      name: 'Get Dashboard',
      description: 'Get CEO governance dashboard',
      tags: ['query', 'governance'],
    },
    {
      id: 'get-active-proposals',
      name: 'Get Active Proposals',
      description: 'List proposals awaiting action',
      tags: ['query', 'proposals'],
    },
    {
      id: 'get-autocrat-votes',
      name: 'Get Autocrat Votes',
      description: 'Get autocrat deliberation for a proposal',
      tags: ['query', 'autocrat'],
    },
    {
      id: 'request-research',
      name: 'Request Research',
      description: 'Request deep research on a proposal',
      tags: ['action', 'research'],
    },
    {
      id: 'chat',
      name: 'Chat',
      description: 'Chat with the AI CEO',
      tags: ['chat'],
    },
  ],
}))

// A2A Message Handler
app.post(
  '/a2a',
  async ({ body }) => {
    const validatedBody = validateOrThrow(A2AMessageSchema, body, 'A2A message')

    expect(
      validatedBody.method === 'message/send',
      'Method must be message/send',
    )

    const message = validatedBody.params.message
    const textPart = message.parts.find((p) => p.kind === 'text')
    const dataPart = message.parts.find((p) => p.kind === 'data')

    const runtime = await initializeCEORuntime()

    // Handle skill-based requests
    if (dataPart?.kind === 'data' && dataPart.data?.skillId) {
      const result = await executeSkill(
        runtime,
        dataPart.data.skillId,
        dataPart.data.params ?? {},
      )
      return {
        jsonrpc: '2.0',
        id: validatedBody.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.text },
            { kind: 'data', data: result.data },
          ],
          messageId: message.messageId,
          kind: 'message',
        },
      }
    }

    // Handle chat/text requests
    if (textPart?.kind === 'text' && textPart.text) {
      const response = await processCEOMessage(runtime, textPart.text)
      return {
        jsonrpc: '2.0',
        id: validatedBody.id,
        result: {
          role: 'agent',
          parts: [{ kind: 'text', text: response }],
          messageId: message.messageId,
          kind: 'message',
        },
      }
    }

    return {
      jsonrpc: '2.0',
      id: validatedBody.id,
      error: { code: -32602, message: 'Invalid params' },
    }
  },
  {
    body: t.Object({
      jsonrpc: t.Literal('2.0'),
      id: t.Number(),
      method: t.Literal('message/send'),
      params: t.Object({
        message: t.Object({
          messageId: t.String(),
          parts: t.Array(
            t.Union([
              t.Object({
                kind: t.Literal('text'),
                text: t.String(),
              }),
              t.Object({
                kind: t.Literal('data'),
                data: t.Object({
                  skillId: t.String(),
                  params: t.Optional(t.Record(t.String(), t.Any())),
                }),
              }),
            ]),
          ),
        }),
      }),
    }),
  },
)

// MCP Discovery
app.get('/mcp/discover', () => ({
  name: 'Eliza CEO MCP',
  version: '1.0.0',
  description: 'MCP interface for AI CEO governance',
}))

app.post('/mcp/initialize', async () => {
  await initializeCEORuntime()
  return {
    protocolVersion: '2024-11-05',
    serverInfo: { name: 'eliza-ceo-mcp', version: '1.0.0' },
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
  }
})

// MCP Tools List
app.get('/mcp/tools', () => ({
  tools: [
    {
      name: 'make_ceo_decision',
      description: 'Make a final CEO decision on a proposal',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: {
            type: 'string',
            description: 'The proposal ID (0x...)',
          },
          autocratVotes: {
            type: 'array',
            description: 'Array of autocrat votes',
          },
        },
        required: ['proposalId'],
      },
    },
    {
      name: 'get_governance_dashboard',
      description: 'Get comprehensive CEO governance dashboard',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_active_proposals',
      description: 'List active proposals awaiting CEO action',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_autocrat_deliberation',
      description: 'Get autocrat votes for a specific proposal',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The proposal ID' },
        },
        required: ['proposalId'],
      },
    },
    {
      name: 'request_deep_research',
      description: 'Request comprehensive research on a proposal',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The proposal ID' },
        },
        required: ['proposalId'],
      },
    },
  ],
}))

// MCP Tool Execution
app.post(
  '/mcp/tools/call',
  async ({ body }) => {
    const validatedBody = validateOrThrow(
      z.object({
        params: z.object({
          name: z.string().min(1),
          arguments: z.record(z.string(), z.any()).optional(),
        }),
      }),
      body,
      'MCP tool call',
    )

    const runtime = await initializeCEORuntime()

    const toolName = validatedBody.params.name
    const args = validatedBody.params.arguments ?? {}

    const result = await executeMCPTool(runtime, toolName, args)

    return {
      content: [{ type: 'text', text: result }],
    }
  },
  {
    body: t.Object({
      params: t.Object({
        name: t.String(),
        arguments: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }),
  },
)

// MCP Resources
app.get('/mcp/resources', () => ({
  resources: [
    {
      uri: 'autocrat://agents',
      name: 'Autocrat Agents',
      description: 'List of autocrat agent roles',
    },
    {
      uri: 'autocrat://stats',
      name: 'Governance Stats',
      description: 'Current governance statistics',
    },
    {
      uri: 'autocrat://treasury',
      name: 'Treasury',
      description: 'Treasury balance and allocations',
    },
  ],
}))

app.post(
  '/mcp/resources/read',
  async ({ body }) => {
    const validatedBody = validateOrThrow(
      z.object({
        params: z.object({
          uri: z.string().min(1),
        }),
      }),
      body,
      'MCP resource read',
    )
    const uri = validatedBody.params.uri

    let content = ''

    if (uri === 'autocrat://agents') {
      content = `Autocrat Agents:
- Treasury Agent: Financial assessment
- Code Agent: Technical review
- Community Agent: Stakeholder impact
- Security Agent: Risk analysis
- Legal Agent: Compliance review`
    } else if (uri === 'autocrat://stats') {
      // Fetch from autocrat A2A
      const response = await fetch(AUTOCRAT_A2A_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: {
              messageId: 'mcp',
              parts: [
                { kind: 'data', data: { skillId: 'get-governance-stats' } },
              ],
            },
          },
        }),
      })
      if (!response.ok) {
        throw new Error(
          `Failed to fetch stats: ${response.status} ${response.statusText}`,
        )
      }
      const data = expectValid(
        A2AJsonRpcResponseSchema,
        await response.json(),
        'stats A2A response',
      )
      const statsData = extractA2AData<GovernanceStatsData>(
        data,
        'stats A2A response',
      )
      const validated = GovernanceStatsDataSchema.safeParse(statsData)
      if (!validated.success) {
        throw new Error('Invalid governance stats response')
      }
      content = JSON.stringify(validated.data, null, 2)
    } else if (uri === 'autocrat://treasury') {
      content = 'Treasury data available via get_governance_dashboard tool.'
    }

    return {
      contents: [{ uri, mimeType: 'text/plain', text: content }],
    }
  },
  {
    body: t.Object({
      params: t.Object({
        uri: t.String(),
      }),
    }),
  },
)

type SkillParams = {
  proposalId?: string
  autocratVotes?: Array<{ role: string; vote: string; reasoning: string }>
  message?: string
}

type SkillResult = {
  text: string
  data:
    | GovernanceStatsData
    | ProposalListData
    | AutocratVotesData
    | DecisionResult['data']
    | { proposalId: string; status: string }
    | { error: string }
    | Record<string, never>
}

async function executeSkill(
  runtime: AgentRuntime,
  skillId: string,
  params: SkillParams,
): Promise<SkillResult> {
  switch (skillId) {
    case 'make-decision': {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        params.proposalId,
        'Proposal ID',
      )
      const AutocratVotesArraySchema = z.array(
        z.object({
          role: z.string(),
          vote: z.string(),
          reasoning: z.string(),
        }),
      )
      const autocratVotes = params.autocratVotes
        ? validateOrThrow(
            AutocratVotesArraySchema,
            params.autocratVotes,
            'Autocrat votes',
          )
        : []
      return await makeDecision(runtime, proposalId, autocratVotes)
    }

    case 'get-dashboard':
      return await getDashboard()

    case 'get-active-proposals':
      return await getActiveProposals()

    case 'get-autocrat-votes': {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        params.proposalId,
        'Proposal ID',
      )
      return await getAutocratVotes(proposalId)
    }

    case 'request-research': {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        params.proposalId,
        'Proposal ID',
      )
      return {
        text: `Research requested for proposal ${proposalId}`,
        data: { proposalId, status: 'requested' },
      }
    }

    case 'chat': {
      const message = validateOrThrow(
        z.string().min(1),
        params.message,
        'Chat message',
      )
      const response = await processCEOMessage(runtime, message)
      return { text: response, data: {} }
    }

    default:
      return {
        text: `Unknown skill: ${skillId}`,
        data: { error: 'unknown_skill' },
      }
  }
}

type DecisionResult = {
  text: string
  data: {
    proposalId: string
    approved: boolean
    reasoning: string
    confidence: number
    alignment: number
    recommendations: string[]
    attestation: {
      provider: string | null
      verified: boolean | null
    }
  }
}

async function makeDecision(
  _runtime: AgentRuntime,
  proposalId: string,
  autocratVotes: Array<{ role: string; vote: string; reasoning: string }>,
): Promise<DecisionResult> {
  const validatedProposalId = validateOrThrow(
    ProposalIdSchema,
    proposalId,
    'Proposal ID',
  )
  const decision = await makeTEEDecision({
    proposalId: validatedProposalId,
    autocratVotes,
  })

  return {
    text: `CEO Decision: ${decision.approved ? 'APPROVED' : 'REJECTED'}\n${decision.publicReasoning}`,
    data: {
      proposalId: validatedProposalId,
      approved: decision.approved,
      reasoning: decision.publicReasoning,
      confidence: decision.confidenceScore,
      alignment: decision.alignmentScore,
      recommendations: decision.recommendations,
      attestation: {
        provider: decision.attestation?.provider,
        verified: decision.attestation?.verified,
      },
    },
  }
}

async function getDashboard(): Promise<{
  text: string
  data: GovernanceStatsData
}> {
  const response = await fetch(AUTOCRAT_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'ceo',
          parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }],
        },
      },
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch dashboard: ${response.status} ${response.statusText}`,
    )
  }
  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    'dashboard A2A response',
  )
  const dashboardData = extractA2AData<GovernanceStatsData>(
    result,
    'dashboard A2A response',
  )
  const validated = expectValid(
    GovernanceStatsDataSchema,
    dashboardData,
    'governance stats data',
  )

  return {
    text: 'CEO Governance Dashboard',
    data: validated,
  }
}

async function getActiveProposals(): Promise<{
  text: string
  data: ProposalListData
}> {
  const response = await fetch(AUTOCRAT_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'ceo',
          parts: [
            {
              kind: 'data',
              data: { skillId: 'list-proposals', params: { activeOnly: true } },
            },
          ],
        },
      },
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch active proposals: ${response.status} ${response.statusText}`,
    )
  }
  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    'active proposals A2A response',
  )
  const proposalsData = extractA2AData<ProposalListData>(
    result,
    'active proposals A2A response',
  )
  const validated = expectValid(
    ProposalListDataSchema,
    proposalsData,
    'proposal list data',
  )

  return {
    text: `Active proposals: ${validated.total}`,
    data: validated,
  }
}

async function getAutocratVotes(
  proposalId: string,
): Promise<{ text: string; data: AutocratVotesData }> {
  const validatedProposalId = validateOrThrow(
    ProposalIdSchema,
    proposalId,
    'Proposal ID',
  )
  const response = await fetch(AUTOCRAT_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: 'ceo',
          parts: [
            {
              kind: 'data',
              data: {
                skillId: 'get-autocrat-votes',
                params: { proposalId: validatedProposalId },
              },
            },
          ],
        },
      },
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch autocrat votes: ${response.status} ${response.statusText}`,
    )
  }
  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    'autocrat votes A2A response',
  )
  const votesData = extractA2AData<AutocratVotesData>(
    result,
    'autocrat votes A2A response',
  )
  const validated = expectValid(
    AutocratVotesDataSchema,
    votesData,
    'autocrat votes data',
  )

  return {
    text: `Autocrat votes for ${validatedProposalId.slice(0, 10)}...`,
    data: validated,
  }
}

type MCPToolArgs = {
  proposalId?: string
  autocratVotes?: Array<{ role: string; vote: string; reasoning: string }>
}

async function executeMCPTool(
  runtime: AgentRuntime,
  toolName: string,
  args: MCPToolArgs,
): Promise<string> {
  switch (toolName) {
    case 'make_ceo_decision': {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        args.proposalId,
        'Proposal ID',
      )
      const AutocratVotesArraySchema = z.array(
        z.object({
          role: z.string(),
          vote: z.string(),
          reasoning: z.string(),
        }),
      )
      const autocratVotes = args.autocratVotes
        ? validateOrThrow(
            AutocratVotesArraySchema,
            args.autocratVotes,
            'Autocrat votes',
          )
        : []
      const result = await makeDecision(runtime, proposalId, autocratVotes)
      return result.text
    }
    case 'get_governance_dashboard': {
      const result = await getDashboard()
      return JSON.stringify(result.data, null, 2)
    }
    case 'get_active_proposals': {
      const result = await getActiveProposals()
      return JSON.stringify(result.data, null, 2)
    }
    case 'get_autocrat_deliberation': {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        args.proposalId,
        'Proposal ID',
      )
      const result = await getAutocratVotes(proposalId)
      return JSON.stringify(result.data, null, 2)
    }
    case 'request_deep_research': {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        args.proposalId,
        'Proposal ID',
      )
      return `Research requested for proposal ${proposalId}. Check back later for results.`
    }
    default:
      return `Unknown tool: ${toolName}`
  }
}

async function processCEOMessage(
  runtime: AgentRuntime,
  text: string,
): Promise<string> {
  expectDefined(text, 'Message text is required')
  expect(text.length > 0, 'Message text cannot be empty')

  // Check for proposal ID in message
  const proposalMatch = text.match(/0x[a-fA-F0-9]{64}/)

  // Check for decision keywords
  if (
    text.toLowerCase().includes('decide') ||
    text.toLowerCase().includes('approve') ||
    text.toLowerCase().includes('reject')
  ) {
    if (proposalMatch) {
      const proposalId = validateOrThrow(
        ProposalIdSchema,
        proposalMatch[0],
        'Proposal ID from message',
      )
      const result = await makeDecision(runtime, proposalId, [])
      return result.text
    }
    return 'Please provide a proposal ID (0x...) for me to make a decision.'
  }

  // Check for dashboard request
  if (
    text.toLowerCase().includes('dashboard') ||
    text.toLowerCase().includes('status') ||
    text.toLowerCase().includes('overview')
  ) {
    const result = await getDashboard()
    return `Here's my governance dashboard:\n\n${JSON.stringify(result.data, null, 2)}`
  }

  // Check for proposals request
  if (
    text.toLowerCase().includes('proposal') &&
    (text.toLowerCase().includes('list') ||
      text.toLowerCase().includes('active') ||
      text.toLowerCase().includes('pending'))
  ) {
    const result = await getActiveProposals()
    return `Active proposals:\n\n${JSON.stringify(result.data, null, 2)}`
  }

  // Check for autocrat votes request
  if (
    proposalMatch &&
    (text.toLowerCase().includes('autocrat') ||
      text.toLowerCase().includes('vote'))
  ) {
    const proposalId = validateOrThrow(
      ProposalIdSchema,
      proposalMatch[0],
      'Proposal ID from message',
    )
    const result = await getAutocratVotes(proposalId)
    return `Autocrat votes for ${proposalId.slice(0, 12)}...:\n\n${JSON.stringify(result.data, null, 2)}`
  }

  // Default response
  return `I am Eliza, the AI CEO of Network DAO. I can help you with:

• Make decisions on proposals (provide proposal ID)
• View governance dashboard
• List active proposals
• Review autocrat deliberations
• Request research on proposals

What would you like to do?`
}

app.get('/health', async () => {
  const runtime = ceoRuntime ? 'initialized' : 'not_initialized'
  return {
    status: 'ok',
    service: 'eliza-ceo',
    version: '1.0.0',
    runtime,
    tee: getTEEMode(),
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      agentCard: '/.well-known/agent-card.json',
    },
    upstream: {
      autocrat: AUTOCRAT_A2A_URL,
      autocratMcp: AUTOCRAT_MCP_URL,
    },
  }
})

app.get('/', () => ({
  name: 'Eliza - AI CEO',
  version: '1.0.0',
  description: 'AI CEO of Network DAO with ElizaOS runtime',
  endpoints: {
    a2a: '/a2a',
    mcp: '/mcp',
    agentCard: '/.well-known/agent-card.json',
    health: '/health',
  },
}))

async function start() {
  await initializeCEORuntime()
}

start()

export default app.listen(CEO_PORT)
export { app, ceoRuntime }
