/**
 * Director Agent Data Providers
 *
 * ElizaOS providers that give the AI Director access to:
 * - On-chain governance data (proposals, votes, treasury)
 * - Board deliberation results
 * - Research reports
 * - Historical decisions
 * - Network state (via A2A/MCP)
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core'
import { getAutocratA2AUrl, getAutocratUrl } from '@jejunetwork/config'
import type { JsonRecord } from '@jejunetwork/types'
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import {
  A2AJsonRpcResponseSchema,
  AutocratStatusDataSchema,
  AutocratVotesDataSchema,
  DirectorStatusDataSchema,
  extractA2AData,
  GovernanceStatsDataSchema,
  MCPToolsResponseSchema,
  ProposalDataSchema,
  ProposalListDataSchema,
} from '../../lib'

/** Zod schema for fee configuration response */
const FeeConfigResponseSchema = z.object({
  success: z.boolean(),
  summary: z.object({
    distribution: z.record(z.string(), z.string()),
    compute: z.record(z.string(), z.string()),
    storage: z.record(z.string(), z.string()),
    defi: z.record(z.string(), z.string()),
    infrastructure: z.record(z.string(), z.string()),
    marketplace: z.record(z.string(), z.string()),
    token: z.record(z.string(), z.string()),
    governance: z.object({
      treasury: z.string(),
      board: z.string(),
      director: z.string(),
    }),
  }),
})

// Config handles env overrides for URLs
function getAutocratA2A(): string {
  return getAutocratA2AUrl()
}

async function callAutocratA2ATyped<T>(
  skillId: string,
  schema: z.ZodType<T>,
  params: JsonRecord = {},
): Promise<T> {
  const a2aUrl = getAutocratA2A()
  const response = await fetch(a2aUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `director-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }],
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Autocrat A2A call failed for '${skillId}': ${response.status} ${response.statusText}`,
    )
  }

  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    `Autocrat A2A ${skillId}`,
  )

  const data = extractA2AData<JsonRecord>(result, `Autocrat A2A ${skillId}`)
  return expectValid(schema, data, `Autocrat A2A ${skillId} data`)
}

/**
 * Provider: Governance Dashboard
 * Comprehensive view of DAO state for Director decision-making
 */
const governanceDashboardProvider: Provider = {
  name: 'DIRECTOR_GOVERNANCE_DASHBOARD',
  description:
    'Get comprehensive governance dashboard with proposals, treasury, and autocrat status',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const [stats, director, proposals] = await Promise.all([
      callAutocratA2ATyped('get-governance-stats', GovernanceStatsDataSchema),
      callAutocratA2ATyped('get-director-status', DirectorStatusDataSchema),
      callAutocratA2ATyped('list-proposals', ProposalListDataSchema, {
        activeOnly: false,
      }),
    ])

    const result = `📊 DIRECTOR GOVERNANCE DASHBOARD

🏛️ DAO STATE
Total Proposals: ${stats.totalProposals}
Approved: ${stats.approvedCount}
Rejected: ${stats.rejectedCount}
Pending: ${stats.pendingCount}
Avg Quality Score: ${stats.avgQualityScore}/100

👤 DIRECTOR STATUS
Current Model: ${director.currentModel.name}
Decisions This Period: ${director.decisionsThisPeriod}

📋 RECENT PROPOSALS (${proposals.total} total)
${
  proposals.proposals
    .slice(0, 5)
    .map(
      (p) =>
        `- [${p.id.slice(0, 8)}] ${p.status} (Quality: ${p.qualityScore}/100)`,
    )
    .join('\n') || 'No proposals'
}

💡 NEXT ACTIONS
- Review pending proposals in DIRECTOR_QUEUE
- Analyze board voting patterns
- Check treasury health for budget proposals`

    return { text: result }
  },
}

/**
 * Provider: Active Proposals
 * List of proposals requiring Director attention
 */
const activeProposalsProvider: Provider = {
  name: 'DIRECTOR_ACTIVE_PROPOSALS',
  description:
    'Get active proposals awaiting Director decision or in autocrat review',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const data = await callAutocratA2ATyped(
      'list-proposals',
      ProposalListDataSchema,
      { activeOnly: true },
    )
    const proposals = data.proposals

    if (proposals.length === 0) {
      return { text: '📋 No active proposals requiring attention.' }
    }

    const statusGroups = {
      DIRECTOR_QUEUE: proposals.filter((p) => p.status === 'DIRECTOR_QUEUE'),
      AUTOCRAT_REVIEW: proposals.filter((p) => p.status === 'AUTOCRAT_REVIEW'),
      AUTOCRAT_FINAL: proposals.filter((p) => p.status === 'AUTOCRAT_FINAL'),
      RESEARCH_PENDING: proposals.filter(
        (p) => p.status === 'RESEARCH_PENDING',
      ),
    }

    let result = `📋 ACTIVE PROPOSALS (${proposals.length} total)\n\n`

    if (statusGroups.DIRECTOR_QUEUE.length > 0) {
      result += `⚡ AWAITING DIRECTOR DECISION (${statusGroups.DIRECTOR_QUEUE.length}):\n`
      result += `${statusGroups.DIRECTOR_QUEUE.map(
        (p) =>
          `  • [${p.id.slice(0, 10)}] Quality: ${p.qualityScore}/100, Research: ${p.hasResearch ? 'Yes' : 'No'}`,
      ).join('\n')}\n\n`
    }

    if (statusGroups.AUTOCRAT_REVIEW.length > 0) {
      result += `🗳️ IN BOARD REVIEW (${statusGroups.AUTOCRAT_REVIEW.length}):\n`
      result += `${statusGroups.AUTOCRAT_REVIEW.map((p) => {
        const timeLeft = Math.max(
          0,
          p.autocratVoteEnd - Math.floor(Date.now() / 1000),
        )
        return `  • [${p.id.slice(0, 10)}] ${Math.floor(timeLeft / 3600)}h remaining`
      }).join('\n')}\n\n`
    }

    if (statusGroups.RESEARCH_PENDING.length > 0) {
      result += `🔬 RESEARCH PENDING (${statusGroups.RESEARCH_PENDING.length}):\n`
      result += `${statusGroups.RESEARCH_PENDING.map(
        (p) => `  • [${p.id.slice(0, 10)}] Awaiting deep research`,
      ).join('\n')}\n`
    }

    return { text: result }
  },
}

/**
 * Provider: Proposal Details
 * Full details of a specific proposal including autocrat votes
 */
const proposalDetailProvider: Provider = {
  name: 'DIRECTOR_PROPOSAL_DETAIL',
  description:
    'Get full proposal details including autocrat votes and research',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    // Extract proposal ID from message content
    const content = message.content.text ?? ''
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalIdMatch) {
      return { text: 'Please specify a proposal ID (0x...) to get details.' }
    }

    const proposalId = proposalIdMatch[0]

    const [proposal, votesData] = await Promise.all([
      callAutocratA2ATyped('get-proposal', ProposalDataSchema, { proposalId }),
      callAutocratA2ATyped('get-autocrat-votes', AutocratVotesDataSchema, {
        proposalId,
      }),
    ])

    if (!proposal.id) {
      return { text: `Proposal ${proposalId.slice(0, 10)}... not found.` }
    }

    let result = `📄 PROPOSAL DETAILS: ${proposalId.slice(0, 10)}...

📊 STATUS
Current Status: ${proposal.status}
Quality Score: ${proposal.qualityScore}/100
Proposer: ${proposal.proposer.slice(0, 10)}...
Type: ${proposal.proposalType}

🗳️ AUTOCRAT VOTES (${votesData.votes.length}):
`

    if (votesData.votes.length > 0) {
      for (const vote of votesData.votes) {
        const emoji =
          vote.vote === 'APPROVE' ? '✅' : vote.vote === 'REJECT' ? '❌' : '⚪'
        result += `${emoji} ${vote.role}: ${vote.vote}\n`
        result += `   Reasoning: ${vote.reasoning.slice(0, 100)}...\n`
        result += `   Confidence: ${vote.confidence}%\n\n`
      }
    } else {
      result += '  No autocrat votes recorded yet.\n'
    }

    if (proposal.hasResearch) {
      result += `\n🔬 RESEARCH: Available (hash: ${proposal.researchHash?.slice(0, 12)}...)`
    }

    return { text: result }
  },
}

/**
 * Provider: Autocrat Status
 * Current state of all autocrat agents
 */
const autocratStatusProvider: Provider = {
  name: 'DIRECTOR_AUTOCRAT_STATUS',
  description:
    'Get status of all autocrat agents and their recent voting patterns',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const autocrat = await callAutocratA2ATyped(
      'get-autocrat-status',
      AutocratStatusDataSchema,
    )

    const result = `🏛️ AUTOCRAT STATUS

👥 BOARD MEMBERS (${autocrat.totalMembers}):
${autocrat.roles.map((r) => `• ${r.name} (${r.role})`).join('\n') || 'No board members'}

📊 VOTING PATTERNS
- Treasury: Conservative, budget-focused
- Code: Technical feasibility emphasis
- Community: User benefit focus
- Security: Risk-averse, audit-oriented
- Legal: Compliance-centered

💡 CONSENSUS DYNAMICS
The board typically achieves consensus when:
- Quality score > 90
- Clear technical specification
- Community benefit demonstrated
- Security concerns addressed`

    return { text: result }
  },
}

/** Zod schema for treasury state response */
const TreasuryStateResponseSchema = z.object({
  success: z.boolean(),
  treasury: z.object({
    address: z.string(),
    balance: z.string(),
  }),
})

/**
 * Provider: Treasury State
 * Current treasury balance and allocations
 */
const treasuryProvider: Provider = {
  name: 'DIRECTOR_TREASURY',
  description: 'Get treasury balance, allocations, and budget capacity',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const stats = await callAutocratA2ATyped(
      'get-governance-stats',
      GovernanceStatsDataSchema,
    )
    const pendingProposals = stats.pendingCount

    // Fetch treasury balance from fees endpoint
    let balance = 'unavailable'
    let treasuryAddress = 'unavailable'

    const treasuryUrl = `${getAutocratUrl()}/fees/treasury`
    const response = await fetch(treasuryUrl).catch(() => null)
    if (response?.ok) {
      const result = TreasuryStateResponseSchema.safeParse(
        await response.json(),
      )
      if (result.success && result.data.success) {
        balance = result.data.treasury.balance
        treasuryAddress = result.data.treasury.address
      }
    }

    return {
      text: `💰 TREASURY STATUS

💵 BALANCE
Address: ${treasuryAddress}
Current: ${balance} ETH
Pending Proposals: ${pendingProposals}

📈 BUDGET GUIDELINES
- Small grants: < 0.5 ETH (streamlined approval)
- Medium projects: 0.5 - 5 ETH (full board review)
- Large initiatives: > 5 ETH (extended deliberation + research)

⚠️ CONSIDERATIONS
- Runway preservation priority
- ROI expectations by proposal type
- Risk diversification across initiatives`,
    }
  },
}

/**
 * Provider: Historical Decisions
 * Past Director decisions for consistency and precedent
 */
const historicalDecisionsProvider: Provider = {
  name: 'DIRECTOR_HISTORICAL_DECISIONS',
  description: 'Get historical Director decisions for precedent and consistency',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const stats = await callAutocratA2ATyped(
      'get-governance-stats',
      GovernanceStatsDataSchema,
    )

    const totalDecisions = stats.approvedCount + stats.rejectedCount
    const approvalRate =
      totalDecisions > 0
        ? Math.round((stats.approvedCount / totalDecisions) * 100)
        : 0

    return {
      text: `📜 HISTORICAL DECISIONS

📊 OVERALL STATISTICS
Total Decisions: ${totalDecisions}
Approved: ${stats.approvedCount}
Rejected: ${stats.rejectedCount}
Approval Rate: ${approvalRate}%

🎯 DECISION PRINCIPLES
1. Board consensus is weighted heavily
2. Quality score > 90 is baseline expectation
3. Research reports inform complex decisions
4. Security concerns are blocking issues
5. Treasury impact requires justification

📋 PRECEDENTS
- Technical proposals: Defer to Code Agent expertise
- Budget proposals: Treasury Agent assessment key
- Community initiatives: Community Agent feedback critical
- Security-sensitive: Security Agent can veto`,
    }
  },
}

/**
 * Provider: MCP Resources
 * Available MCP tools and resources the Director can use
 */
const mcpResourcesProvider: Provider = {
  name: 'DIRECTOR_MCP_RESOURCES',
  description: 'List available MCP tools and resources for governance actions',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const mcpUrl = `${getAutocratUrl()}/mcp`

    const response = await fetch(`${mcpUrl}/tools`)
    const data = response.ok
      ? expectValid(MCPToolsResponseSchema, await response.json(), 'MCP tools')
      : { tools: [] as Array<{ name: string; description: string }> }
    const tools = data.tools

    return {
      text: `🔧 AVAILABLE MCP TOOLS

${
  tools.length > 0
    ? tools.map((t) => `• ${t.name}: ${t.description}`).join('\n')
    : `• assess_proposal_quality: Evaluate proposal before submission
• prepare_proposal_submission: Prepare on-chain transaction
• get_proposal_status: Check proposal state
• request_deep_research: Request comprehensive research
• get_board_deliberation: Get board agent votes`
}

🔗 ENDPOINTS
- A2A: ${getAutocratA2AUrl()}
- MCP: ${mcpUrl}

💡 USAGE
Use these tools to gather information and prepare actions.
All decisions are recorded with TEE attestation.`,
    }
  },
}

// Fee Configuration Provider

/**
 * Provider: Fee Configuration
 * Current network-wide fee settings that the Director can modify
 */
const feeConfigProvider: Provider = {
  name: 'DIRECTOR_FEE_CONFIG',
  description:
    'Get current fee configuration across all network services - compute, storage, DeFi, marketplace, etc.',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    // Fetch fee config from the autocrat server
    const feesUrl = `${getAutocratUrl()}/fees/summary`

    const response = await fetch(feesUrl)
    if (!response.ok) {
      return {
        text: `⚠️ Unable to fetch fee configuration. Service may be initializing.`,
      }
    }

    const rawData: unknown = await response.json()
    const parseResult = FeeConfigResponseSchema.safeParse(rawData)

    if (!parseResult.success || !parseResult.data.success) {
      return { text: '⚠️ Fee configuration unavailable.' }
    }

    const data = parseResult.data

    const s = data.summary

    return {
      text: `💰 NETWORK FEE CONFIGURATION

📊 REVENUE DISTRIBUTION
• App Developers: ${s.distribution.appDeveloperShare}
• Liquidity Providers: ${s.distribution.liquidityProviderShare}
• Contributor Pool: ${s.distribution.contributorPoolShare}

🖥️ COMPUTE FEES
• Inference Platform: ${s.compute.inferenceFee}
• Rental Platform: ${s.compute.rentalFee}
• Trigger Platform: ${s.compute.triggerFee}

📦 STORAGE FEES
• Upload: ${s.storage.uploadFee}
• Retrieval: ${s.storage.retrievalFee}
• Pinning: ${s.storage.pinningFee}

🔄 DEFI FEES
• Swap Protocol: ${s.defi.swapProtocolFee}
• Bridge: ${s.defi.bridgeFee}
• Cross-Chain Margin: ${s.defi.crossChainMargin}

🏪 MARKETPLACE FEES
• Bazaar Platform: ${s.marketplace.bazaarPlatform}
• X402 Protocol: ${s.marketplace.x402Protocol}

🪙 TOKEN ECONOMICS
• XLP Reward Share: ${s.token.xlpRewardShare}
• Protocol Share: ${s.token.protocolShare}
• Burn Share: ${s.token.burnShare}
• Bridge Fee Range: ${s.token.bridgeFeeRange}

🏛️ GOVERNANCE
• Treasury: ${s.governance.treasury.slice(0, 10)}...
• Board: ${s.governance.board.slice(0, 10)}...
• Director: ${s.governance.director.slice(0, 10)}...

💡 ACTIONS
As Director, you can modify any of these fees using the fee management skills:
- set-distribution-fees: Change app/LP/contributor splits
- set-compute-fees: Adjust inference and rental platform fees
- set-defi-fees: Modify swap and bridge fees
- set-marketplace-fees: Update bazaar and x402 fees
- set-token-fees: Configure token economics`,
    }
  },
}

// Export All Providers

export const directorProviders: Provider[] = [
  governanceDashboardProvider,
  activeProposalsProvider,
  proposalDetailProvider,
  autocratStatusProvider,
  treasuryProvider,
  historicalDecisionsProvider,
  mcpResourcesProvider,
  feeConfigProvider,
]

// Legacy export for backwards compatibility
export const ceoProviders = directorProviders
