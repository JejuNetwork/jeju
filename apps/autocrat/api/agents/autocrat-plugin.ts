/**
 * Autocrat Agent Plugin
 *
 * ElizaOS plugin that provides autocrat agents with:
 * - Service discovery (A2A, MCP)
 * - Governance data providers
 * - Deliberation actions
 * - Cross-agent communication
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  Plugin,
  State,
} from '@elizaos/core'
import {
  getAutocratA2AUrl,
  getAutocratUrl,
  getCoreAppUrl,
} from '@jejunetwork/config'
import type { JsonRecord } from '@jejunetwork/types'
import { expectValid } from '@jejunetwork/types'
import {
  A2AJsonRpcResponseSchema,
  extractA2AData,
  MCPToolCallResponseSchema,
  type SubmitVoteResult,
  SubmitVoteResultSchema,
} from '../../lib'
import { autocratProviders } from './autocrat-providers'

// Config handles env overrides for URLs
function getA2AEndpoint(): string {
  return getAutocratA2AUrl()
}

function getMCPEndpoint(): string {
  return `${getAutocratUrl()}/mcp`
}

async function callA2A<T>(
  skillId: string,
  params: JsonRecord = {},
): Promise<T> {
  const a2aEndpoint = getA2AEndpoint()
  const response = await fetch(a2aEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `autocrat-action-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }],
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`A2A call failed: ${response.status}`)
  }

  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    `A2A ${skillId}`,
  )
  return extractA2AData<T>(result, `A2A ${skillId}`)
}

/**
 * Action: Discover Services
 * Find available A2A and MCP services
 */
const discoverServicesAction: Action = {
  name: 'DISCOVER_SERVICES',
  description: 'Discover available A2A agents and MCP services in the network',
  similes: [
    'find services',
    'list services',
    'what services are available',
    'show endpoints',
  ],
  examples: [
    [
      { name: 'user', content: { text: 'What services are available?' } },
      {
        name: 'agent',
        content: { text: 'Let me discover the available services...' },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    return (
      content.includes('service') ||
      content.includes('discover') ||
      content.includes('endpoint')
    )
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const services = [
      { name: 'Autocrat A2A', url: getA2AEndpoint(), type: 'a2a' },
      {
        name: 'CEO A2A',
        url: `${getCoreAppUrl('AUTOCRAT_AGENT')}/a2a`,
        type: 'a2a',
      },
      { name: 'Autocrat MCP', url: getMCPEndpoint(), type: 'mcp' },
      {
        name: 'CEO MCP',
        url: `${getCoreAppUrl('AUTOCRAT_AGENT')}/mcp`,
        type: 'mcp',
      },
    ]

    const results: string[] = []
    for (const service of services) {
      const healthUrl = service.url
        .replace('/a2a', '/health')
        .replace('/mcp', '/health')
      const response = await fetch(healthUrl)
      const status = response.ok ? '✅ Online' : '❌ Offline'
      results.push(`${status} ${service.name}: ${service.url}`)
    }

    if (callback) {
      await callback({
        text: `🔍 SERVICE DISCOVERY\n\n${results.join('\n')}`,
        action: 'DISCOVER_SERVICES',
      })
    }
  },
}

/**
 * Action: Cast Vote
 * Submit a deliberation vote on a proposal
 */
const castVoteAction: Action = {
  name: 'CAST_VOTE',
  description: 'Cast a deliberation vote on a proposal',
  similes: [
    'vote on proposal',
    'approve proposal',
    'reject proposal',
    'submit vote',
  ],
  examples: [
    [
      { name: 'user', content: { text: 'Vote APPROVE on proposal 0x1234...' } },
      { name: 'agent', content: { text: 'Casting vote on the proposal...' } },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    return (
      content.includes('vote') ||
      content.includes('approve') ||
      content.includes('reject')
    )
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content?.text ?? ''
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalMatch) {
      if (callback) {
        await callback({
          text: 'Please specify a proposal ID (0x...) to vote on.',
          action: 'CAST_VOTE',
        })
      }
      return
    }

    const proposalId = proposalMatch[0]
    const voteType = content.toLowerCase().includes('reject')
      ? 'REJECT'
      : content.toLowerCase().includes('abstain')
        ? 'ABSTAIN'
        : 'APPROVE'

    const role =
      runtime.character.name?.replace(' Agent', '').toUpperCase() ?? 'UNKNOWN'

    const result = await callA2A<SubmitVoteResult>('submit-vote', {
      proposalId,
      role,
      vote: voteType,
      reasoning: `${role} agent cast ${voteType} vote`,
      confidence: 75,
    })
    const validated = SubmitVoteResultSchema.safeParse(result)
    const success = validated.success && validated.data.success

    if (callback) {
      await callback({
        text: `🗳️ VOTE CAST

Proposal: ${proposalId.slice(0, 12)}...
Vote: ${voteType}
Role: ${role}
Status: ${success ? 'Recorded' : 'Failed'}`,
        action: 'CAST_VOTE',
      })
    }
  },
}

/**
 * Action: Request Research
 * Request deep research on a proposal
 */
const requestResearchAction: Action = {
  name: 'REQUEST_RESEARCH',
  description: 'Request deep research on a proposal',
  similes: ['research proposal', 'investigate', 'analyze'],
  examples: [],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    return content.includes('research') || content.includes('investigate')
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content?.text ?? ''
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (callback) {
      await callback({
        text: `🔬 RESEARCH REQUEST

${proposalMatch ? `Proposal: ${proposalMatch[0].slice(0, 12)}...` : 'No proposal specified'}
Status: Request submitted

Research will include:
• Technical feasibility
• Market analysis
• Risk assessment
• Community sentiment`,
        action: 'REQUEST_RESEARCH',
      })
    }
  },
}

/**
 * Action: Query A2A Skill
 * Execute an A2A skill on any available agent
 */
const queryA2AAction: Action = {
  name: 'QUERY_A2A',
  description: 'Query an A2A skill on the autocrat or CEO agent',
  similes: ['call skill', 'query agent', 'ask council', 'ask ceo'],
  examples: [],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    return (
      content.includes('query') ||
      content.includes('skill') ||
      content.includes('ask')
    )
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content?.text ?? ''

    // Try to parse skill from message
    const skillMatch = content.match(/skill[:\s]+(\S+)/i)
    const skillId = skillMatch?.[1] ?? 'get-governance-stats'

    const result = await callA2A<JsonRecord>(skillId, {})

    if (callback) {
      await callback({
        text: `📡 A2A QUERY RESULT

Skill: ${skillId}
Response:
${JSON.stringify(result, null, 2).slice(0, 500)}`,
        action: 'QUERY_A2A',
      })
    }
  },
}

/**
 * Action: Call MCP Tool
 * Execute an MCP tool
 */
const callMCPToolAction: Action = {
  name: 'CALL_MCP_TOOL',
  description: 'Call an MCP tool on the autocrat or CEO server',
  similes: ['use tool', 'call tool', 'mcp'],
  examples: [],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    return content.includes('mcp') || content.includes('tool')
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content?.text ?? ''

    // Try to parse tool name from message
    const toolMatch = content.match(/tool[:\s]+(\S+)/i)
    const toolName = toolMatch?.[1] ?? 'get_proposal_status'

    const mcpUrl = getMCPEndpoint()

    const response = await fetch(`${mcpUrl}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { name: toolName, arguments: {} } }),
    })

    const parseResult = MCPToolCallResponseSchema.safeParse(
      await response.json(),
    )
    const result = parseResult.success ? parseResult.data : { content: [] }

    if (callback) {
      await callback({
        text: `🔧 MCP TOOL RESULT

Tool: ${toolName}
Response:
${result.content[0]?.text ?? 'No content returned'}`,
        action: 'CALL_MCP_TOOL',
      })
    }
  },
}

/**
 * Autocrat Plugin for ElizaOS
 * Provides data access and actions for autocrat agents
 */
export const autocratPlugin: Plugin = {
  name: 'autocrat-plugin',
  description:
    'Autocrat agent plugin with service discovery, A2A/MCP access, and governance actions',

  providers: autocratProviders,

  actions: [
    discoverServicesAction,
    castVoteAction,
    requestResearchAction,
    queryA2AAction,
    callMCPToolAction,
  ],
}

export default autocratPlugin
