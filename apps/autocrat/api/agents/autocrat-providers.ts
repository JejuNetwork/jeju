/**
 * Autocrat Agent Data Providers
 *
 * ElizaOS providers that give autocrat agents access to:
 * - A2A service discovery
 * - MCP tools and resources
 * - On-chain governance data
 * - Other autocrat agent votes
 * - CEO status and decisions
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core'
import {
  getAutocratA2AUrl,
  getAutocratUrl,
  getCoreAppUrl,
} from '@jejunetwork/config'
import type { JsonRecord } from '@jejunetwork/sdk'
import { expectValid } from '@jejunetwork/types'
import type { z } from 'zod'
import {
  A2AJsonRpcResponseSchema,
  AgentCardSchema,
  AutocratVotesDataSchema,
  CEOStatusDataSchema,
  extractA2AData,
  GovernanceStatsDataSchema,
  MCPToolsResponseSchema,
  ProposalDataSchema,
  ProposalListDataSchema,
  ResearchDataSchema,
} from '../../lib'

function getAutocratA2A(): string {
  return process.env.AUTOCRAT_A2A_URL ?? getAutocratA2AUrl()
}

function getAutocratMCP(): string {
  return process.env.AUTOCRAT_MCP_URL ?? `${getAutocratUrl()}/mcp`
}

function getCEOA2A(): string {
  return process.env.CEO_A2A_URL ?? `${getCoreAppUrl('AUTOCRAT_CEO')}/a2a`
}

function getCEOMCP(): string {
  return process.env.CEO_MCP_URL ?? `${getCoreAppUrl('AUTOCRAT_CEO')}/mcp`
}

// Service registry for A2A discovery - resolved dynamically
function getServiceRegistry(): Record<
  string,
  { url: string; description: string }
> {
  return {
    autocrat: {
      url: getAutocratA2A(),
      description: 'Autocrat governance A2A server',
    },
    ceo: { url: getCEOA2A(), description: 'AI CEO decision-making agent' },
    'autocrat-mcp': {
      url: getAutocratMCP(),
      description: 'Autocrat MCP tools and resources',
    },
    'ceo-mcp': { url: getCEOMCP(), description: 'CEO MCP tools and resources' },
  }
}

async function callA2ATyped<T>(
  url: string,
  skillId: string,
  schema: z.ZodType<T>,
  params: JsonRecord = {},
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `autocrat-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }],
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`A2A call to ${url} failed: ${response.status}`)
  }

  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    `A2A ${skillId}`,
  )
  const data = extractA2AData<JsonRecord>(result, `A2A ${skillId}`)
  return expectValid(schema, data, `A2A ${skillId} data`)
}

interface AgentCard {
  protocolVersion: string
  name: string
  description: string
  url: string
  skills: Array<{ id: string; name: string; description: string }>
}

async function fetchAgentCard(baseUrl: string): Promise<AgentCard | null> {
  const cardUrl = `${baseUrl.replace('/a2a', '')}/.well-known/agent-card.json`
  const response = await fetch(cardUrl)
  if (!response.ok) return null
  const result = AgentCardSchema.safeParse(await response.json())
  return result.success ? (result.data as AgentCard) : null
}

/**
 * Provider: Service Discovery
 * Discover available A2A agents and MCP services
 */
export const serviceDiscoveryProvider: Provider = {
  name: 'AUTOCRAT_SERVICE_DISCOVERY',
  description: 'Discover available A2A agents and MCP services in the network',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const services: Array<{
      name: string
      url: string
      status: string
      skills?: string[]
    }> = []

    // Check each registered service (resolved dynamically)
    for (const [name, service] of Object.entries(getServiceRegistry())) {
      const isA2A = !name.includes('mcp')

      if (isA2A) {
        const card = await fetchAgentCard(service.url)
        if (card) {
          const skills = card.skills?.map((s) => s.id) ?? []
          services.push({ name, url: service.url, status: 'online', skills })
        } else {
          services.push({ name, url: service.url, status: 'offline' })
        }
      } else {
        // Check MCP health
        const healthUrl = service.url.replace('/mcp', '/health')
        const response = await fetch(healthUrl)
        services.push({
          name,
          url: service.url,
          status: response.ok ? 'online' : 'offline',
        })
      }
    }

    const onlineCount = services.filter((s) => s.status === 'online').length

    let result = `🔍 SERVICE DISCOVERY

📡 Available Services (${onlineCount}/${services.length} online):

`

    for (const service of services) {
      const emoji = service.status === 'online' ? '✅' : '❌'
      result += `${emoji} ${service.name}: ${service.url}\n`
      if (service.skills && service.skills.length > 0) {
        result += `   Skills: ${service.skills.join(', ')}\n`
      }
    }

    result += `
💡 Use these services to:
- Query governance data via autocrat A2A
- Make decisions via CEO A2A
- Access tools via MCP endpoints`

    return { text: result }
  },
}

/**
 * Provider: Other Autocrat Votes
 * Get votes from other autocrat agents on active proposals
 */
export const otherAutocratVotesProvider: Provider = {
  name: 'AUTOCRAT_OTHER_VOTES',
  description: 'Get votes from other autocrat agents on proposals',

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    // Extract proposal ID from message if present
    const content = message.content?.text ?? ''
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalMatch) {
      return {
        text: 'Specify a proposal ID (0x...) to see other autocrat votes.',
      }
    }

    const proposalId = proposalMatch[0]
    const data = await callA2ATyped(
      getAutocratA2A(),
      'get-autocrat-votes',
      AutocratVotesDataSchema,
      { proposalId },
    )
    const votes = data.votes

    // Filter out own votes based on runtime's character name
    const myRole = runtime.character.name?.replace(' Agent', '').toUpperCase()
    const otherVotes = votes.filter((v) => v.role !== myRole)

    if (otherVotes.length === 0) {
      return {
        text: `No votes from other autocrat members yet for proposal ${proposalId.slice(0, 12)}...`,
      }
    }

    let result = `🗳️ OTHER AUTOCRAT VOTES for ${proposalId.slice(0, 12)}...\n\n`

    for (const vote of otherVotes) {
      const emoji =
        vote.vote === 'APPROVE' ? '✅' : vote.vote === 'REJECT' ? '❌' : '⚪'
      result += `${emoji} ${vote.role}: ${vote.vote} (${vote.confidence}% confidence)\n`
      result += `   ${vote.reasoning.slice(0, 100)}${vote.reasoning.length > 100 ? '...' : ''}\n\n`
    }

    const approves = otherVotes.filter((v) => v.vote === 'APPROVE').length
    const rejects = otherVotes.filter((v) => v.vote === 'REJECT').length
    result += `\nConsensus: ${approves} approve, ${rejects} reject, ${otherVotes.length - approves - rejects} abstain`

    return { text: result }
  },
}

/**
 * Provider: Active Proposals
 * Get list of proposals awaiting deliberation
 */
export const activeProposalsProvider: Provider = {
  name: 'AUTOCRAT_ACTIVE_PROPOSALS',
  description: 'Get active proposals awaiting autocrat deliberation',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const data = await callA2ATyped(
      getAutocratA2A(),
      'list-proposals',
      ProposalListDataSchema,
      { activeOnly: true },
    )
    const proposals = data.proposals
    const total = data.total

    if (proposals.length === 0) {
      return { text: '📋 No active proposals requiring autocrat deliberation.' }
    }

    let result = `📋 ACTIVE PROPOSALS (${total} total)\n\n`

    for (const p of proposals.slice(0, 10)) {
      const statusEmoji =
        p.status === 'AUTOCRAT_REVIEW'
          ? '🗳️'
          : p.status === 'CEO_QUEUE'
            ? '👤'
            : '📝'
      result += `${statusEmoji} [${p.id.slice(0, 10)}...]\n`
      result += `   Status: ${p.status}, Quality: ${p.qualityScore}/100, Type: ${p.proposalType}\n\n`
    }

    return { text: result }
  },
}

/**
 * Provider: Proposal Detail
 * Get full details of a specific proposal
 */
export const proposalDetailProvider: Provider = {
  name: 'AUTOCRAT_PROPOSAL_DETAIL',
  description: 'Get full details of a specific proposal for evaluation',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const content = message.content?.text ?? ''
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalMatch) {
      return { text: 'Specify a proposal ID (0x...) to get details.' }
    }

    const proposalId = proposalMatch[0]
    const proposal = await callA2ATyped(
      getAutocratA2A(),
      'get-proposal',
      ProposalDataSchema,
      { proposalId },
    )

    if (!proposal.id) {
      return { text: `Proposal ${proposalId.slice(0, 12)}... not found.` }
    }

    return {
      text: `📄 PROPOSAL DETAILS

ID: ${proposal.id}
Status: ${proposal.status}
Proposer: ${proposal.proposer}
Type: ${proposal.proposalType}
Quality Score: ${proposal.qualityScore}/100
Content Hash: ${proposal.contentHash?.slice(0, 20)}...
Research Available: ${proposal.hasResearch ? 'Yes' : 'No'}

Use this information to inform your deliberation vote.`,
    }
  },
}

/**
 * Provider: CEO Status
 * Get current AI CEO status and recent decisions
 */
export const ceoStatusProvider: Provider = {
  name: 'AUTOCRAT_CEO_STATUS',
  description: 'Get AI CEO status and recent decision patterns',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const ceo = await callA2ATyped(
      getAutocratA2A(),
      'get-ceo-status',
      CEOStatusDataSchema,
    )

    return {
      text: `👤 CEO STATUS

Model: ${ceo.currentModel.name}
Decisions This Period: ${ceo.decisionsThisPeriod}
Approval Rate: ${ceo.approvalRate}%

${ceo.lastDecision ? `Last Decision: ${ceo.lastDecision.proposalId.slice(0, 12)}... - ${ceo.lastDecision.approved ? 'APPROVED' : 'REJECTED'}` : 'No recent decisions'}

💡 The CEO weighs autocrat votes heavily - your assessment matters.`,
    }
  },
}

/**
 * Provider: Available MCP Tools
 * List MCP tools available for governance actions
 */
export const mcpToolsProvider: Provider = {
  name: 'AUTOCRAT_MCP_TOOLS',
  description: 'List available MCP tools for governance actions',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    // Fetch tools from both council and CEO MCP servers
    const tools: Array<{ source: string; name: string; description: string }> =
      []

    // Autocrat MCP tools
    const autocratResponse = await fetch(`${getAutocratMCP()}/tools`)
    if (autocratResponse.ok) {
      const autocratData = expectValid(
        MCPToolsResponseSchema,
        await autocratResponse.json(),
        'Autocrat MCP tools',
      )
      for (const tool of autocratData.tools ?? []) {
        tools.push({ source: 'autocrat', ...tool })
      }
    }

    // CEO MCP tools
    const ceoResponse = await fetch(`${getCEOMCP()}/tools`)
    if (ceoResponse.ok) {
      const ceoData = expectValid(
        MCPToolsResponseSchema,
        await ceoResponse.json(),
        'CEO MCP tools',
      )
      for (const tool of ceoData.tools ?? []) {
        tools.push({ source: 'ceo', ...tool })
      }
    }

    if (tools.length === 0) {
      return { text: 'No MCP tools available. Check service connectivity.' }
    }

    let result = `🔧 AVAILABLE MCP TOOLS\n\n`

    const autocratTools = tools.filter((t) => t.source === 'autocrat')
    const ceoTools = tools.filter((t) => t.source === 'ceo')

    if (autocratTools.length > 0) {
      result += `📋 Autocrat Tools (${getAutocratMCP()}):\n`
      for (const tool of autocratTools) {
        result += `  • ${tool.name}: ${tool.description}\n`
      }
      result += '\n'
    }

    if (ceoTools.length > 0) {
      result += `👤 CEO Tools (${getCEOMCP()}):\n`
      for (const tool of ceoTools) {
        result += `  • ${tool.name}: ${tool.description}\n`
      }
    }

    return { text: result }
  },
}

/**
 * Provider: Available A2A Skills
 * List A2A skills available across all agents
 */
export const a2aSkillsProvider: Provider = {
  name: 'AUTOCRAT_A2A_SKILLS',
  description: 'List available A2A skills across autocrat and CEO agents',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const skills: Array<{
      agent: string
      id: string
      name: string
      description: string
    }> = []

    // Fetch from autocrat
    const autocratCard = await fetchAgentCard(getAutocratA2A())
    if (autocratCard?.skills) {
      for (const skill of autocratCard.skills) {
        skills.push({ agent: 'autocrat', ...skill })
      }
    }

    // Fetch from CEO
    const ceoCard = await fetchAgentCard(getCEOA2A())
    if (ceoCard?.skills) {
      for (const skill of ceoCard.skills) {
        skills.push({ agent: 'ceo', ...skill })
      }
    }

    if (skills.length === 0) {
      return { text: 'No A2A skills discovered. Agents may be offline.' }
    }

    let result = `📡 AVAILABLE A2A SKILLS\n\n`

    const autocratSkills = skills.filter((s) => s.agent === 'autocrat')
    const ceoSkills = skills.filter((s) => s.agent === 'ceo')

    if (autocratSkills.length > 0) {
      result += `📋 Autocrat Skills:\n`
      for (const skill of autocratSkills) {
        result += `  • ${skill.id}: ${skill.description}\n`
      }
      result += '\n'
    }

    if (ceoSkills.length > 0) {
      result += `👤 CEO Skills:\n`
      for (const skill of ceoSkills) {
        result += `  • ${skill.id}: ${skill.description}\n`
      }
    }

    return { text: result }
  },
}

/**
 * Provider: Governance Stats
 * Get overall governance statistics
 */
export const governanceStatsProvider: Provider = {
  name: 'AUTOCRAT_GOVERNANCE_STATS',
  description: 'Get overall DAO governance statistics',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const stats = await callA2ATyped(
      getAutocratA2A(),
      'get-governance-stats',
      GovernanceStatsDataSchema,
    )

    const total = stats.totalProposals
    const approved = stats.approvedCount
    const rejected = stats.rejectedCount
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0

    return {
      text: `📊 GOVERNANCE STATISTICS

Total Proposals: ${total}
Approved: ${approved} (${approvalRate}%)
Rejected: ${rejected}
Pending: ${stats.pendingCount}
Avg Quality Score: ${stats.avgQualityScore}/100

Use these stats to understand the DAO's governance patterns
and calibrate your voting recommendations.`,
    }
  },
}

/**
 * Provider: Research Reports
 * Access research reports for proposals
 */
export const researchReportsProvider: Provider = {
  name: 'AUTOCRAT_RESEARCH_REPORTS',
  description: 'Access deep research reports for proposals',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const content = message.content?.text ?? ''
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalMatch) {
      return {
        text: 'Specify a proposal ID (0x...) to get its research report.',
      }
    }

    const proposalId = proposalMatch[0]
    const research = await callA2ATyped(
      getAutocratA2A(),
      'get-research',
      ResearchDataSchema,
      { proposalId },
    )

    if (!research.report) {
      return {
        text: `📚 No research report available for proposal ${proposalId.slice(0, 12)}...

Status: ${research.status}

Request research via the request-research skill.`,
      }
    }

    return {
      text: `📚 RESEARCH REPORT for ${proposalId.slice(0, 12)}...

${research.report.slice(0, 2000)}${research.report.length > 2000 ? '...\n\n[Report truncated - full report available via MCP]' : ''}`,
    }
  },
}

export const autocratProviders: Provider[] = [
  serviceDiscoveryProvider,
  otherAutocratVotesProvider,
  activeProposalsProvider,
  proposalDetailProvider,
  ceoStatusProvider,
  mcpToolsProvider,
  a2aSkillsProvider,
  governanceStatsProvider,
  researchReportsProvider,
]
