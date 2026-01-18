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
  getServicesConfig,
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
    const content = message.content.text?.toLowerCase() ?? ''
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
    const servicesConfig = getServicesConfig()
    const services = [
      { name: 'Autocrat A2A', url: getA2AEndpoint(), type: 'a2a' },
      {
        name: 'Director A2A',
        url: `${getCoreAppUrl('AUTOCRAT_AGENT')}/a2a`,
        type: 'a2a',
      },
      { name: 'Autocrat MCP', url: getMCPEndpoint(), type: 'mcp' },
      {
        name: 'Director MCP',
        url: `${getCoreAppUrl('AUTOCRAT_AGENT')}/mcp`,
        type: 'mcp',
      },
      // Cross-app A2A discovery
      { name: 'Bazaar A2A', url: `${servicesConfig.bazaar}/a2a`, type: 'a2a' },
      {
        name: 'Crucible A2A',
        url: `${servicesConfig.crucible.api}/a2a`,
        type: 'a2a',
      },
    ]

    const results: string[] = []
    for (const service of services) {
      try {
        const healthUrl = service.url
          .replace('/a2a', '/health')
          .replace('/mcp', '/health')
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(2000),
        })
        const status = response.ok ? '✅ Online' : '❌ Offline'
        results.push(`${status} ${service.name}: ${service.url}`)
      } catch {
        results.push(`❌ Offline ${service.name}: ${service.url}`)
      }
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
    const content = message.content.text?.toLowerCase() ?? ''
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
    const content = message.content.text ?? ''
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
      runtime.character.name.replace(' Agent', '').toUpperCase() ?? 'UNKNOWN'

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
 * Request deep research on a proposal using DWS compute
 */
const requestResearchAction: Action = {
  name: 'REQUEST_RESEARCH',
  description: 'Request deep research on a proposal using AI analysis',
  similes: ['research proposal', 'investigate', 'analyze', 'deep dive'],
  examples: [
    [
      { name: 'user', content: { text: 'Research proposal 0x1234...' } },
      {
        name: 'agent',
        content: { text: 'Conducting deep research on the proposal...' },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content.text?.toLowerCase() ?? ''
    return (
      content.includes('research') ||
      content.includes('investigate') ||
      content.includes('analyze')
    )
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content.text ?? ''
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalMatch) {
      if (callback) {
        await callback({
          text: 'Please specify a proposal ID (0x...) to research.',
          action: 'REQUEST_RESEARCH',
        })
      }
      return
    }

    const proposalId = proposalMatch[0]

    // Import dynamically to avoid circular deps
    const { generateResearchReport } = await import('../research-agent')

    try {
      // Extract title and description from message if available
      const titleMatch = content.match(/title[:\s]+["']?([^"'\n]+)["']?/i)
      const title = titleMatch?.[1] ?? `Proposal ${proposalId.slice(0, 12)}`

      const report = await generateResearchReport({
        proposalId,
        title,
        description: content,
        depth: 'standard',
      })

      if (callback) {
        await callback({
          text: `🔬 RESEARCH REPORT

**Proposal:** ${proposalId.slice(0, 12)}...
**Model:** ${report.model}
**Execution Time:** ${report.executionTime}ms

## Summary
${report.summary}

## Recommendation: ${report.recommendation.toUpperCase()}
- Confidence: ${report.confidenceLevel}%
- Risk Level: ${report.riskLevel}

## Key Findings
${report.keyFindings.map((f) => `• ${f}`).join('\n')}

## Concerns
${report.concerns.map((c) => `• ${c}`).join('\n')}

${report.alternatives.length > 0 ? `## Alternatives\n${report.alternatives.map((a) => `• ${a}`).join('\n')}` : ''}`,
          action: 'REQUEST_RESEARCH',
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (callback) {
        await callback({
          text: `🔬 RESEARCH REQUEST FAILED

Proposal: ${proposalId.slice(0, 12)}...
Error: ${errorMessage}

Please ensure DWS compute is available and try again.`,
          action: 'REQUEST_RESEARCH',
        })
      }
    }
  },
}

/**
 * Action: Query A2A Skill
 * Execute an A2A skill on any available agent
 */
const queryA2AAction: Action = {
  name: 'QUERY_A2A',
  description: 'Query an A2A skill on the autocrat or Director agent',
  similes: ['call skill', 'query agent', 'ask board', 'ask director'],
  examples: [],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content.text?.toLowerCase() ?? ''
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
    const content = message.content.text ?? ''

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
  description: 'Call an MCP tool on the autocrat or Director server',
  similes: ['use tool', 'call tool', 'mcp'],
  examples: [],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content.text?.toLowerCase() ?? ''
    return content.includes('mcp') || content.includes('tool')
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content.text ?? ''

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
${result.content[0].text ?? 'No content returned'}`,
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
