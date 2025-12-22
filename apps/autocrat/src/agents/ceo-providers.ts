/**
 * CEO Agent Data Providers
 *
 * ElizaOS providers that give the AI CEO access to:
 * - On-chain governance data (proposals, votes, treasury)
 * - Council deliberation results
 * - Research reports
 * - Historical decisions
 * - Network state (via A2A/MCP)
 *
 * FULLY DECENTRALIZED - Endpoints resolved from network config
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core'
import { getAutocratA2AUrl, getAutocratUrl } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import {
  A2AJsonRpcResponseSchema,
  extractA2AData,
  MCPToolsResponseSchema,
} from '../schemas'
import type { AutocratVote } from '../types'

// ============================================================================
// Types (local-only interfaces not in types.ts)
// ============================================================================

interface ProposalData {
  id: string
  status: string
  proposer: string
  proposalType: number
  qualityScore: number
  autocratVoteEnd: number
  gracePeriodEnd: number
  hasResearch: boolean
  researchHash?: string
  contentHash: string
}

interface TreasuryState {
  balance: string
  totalAllocated: string
  pendingProposals: number
}

interface GovernanceStats {
  totalProposals: number
  approvedCount: number
  rejectedCount: number
  pendingCount: number
  avgQualityScore: number
}

// ============================================================================
// A2A Client Helper (Network-Aware)
// ============================================================================

function getAutocratA2A(): string {
  return process.env.AUTOCRAT_A2A_URL ?? getAutocratA2AUrl()
}

async function callAutocratA2A<T>(
  skillId: string,
  params: Record<string, unknown> = {},
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
          messageId: `ceo-${Date.now()}`,
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

  return extractA2AData<T>(result, `Autocrat A2A ${skillId}`)
}

// ============================================================================
// Governance Dashboard Provider
// ============================================================================

/**
 * Provider: Governance Dashboard
 * Comprehensive view of DAO state for CEO decision-making
 */
export const governanceDashboardProvider: Provider = {
  name: 'CEO_GOVERNANCE_DASHBOARD',
  description:
    'Get comprehensive governance dashboard with proposals, treasury, and autocrat status',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    interface CEOStatusResponse {
      currentModel?: { name: string }
      decisionsThisPeriod?: number
    }

    interface ProposalsListResponse {
      proposals?: ProposalData[]
      total?: number
    }

    const [stats, ceo, proposals] = await Promise.all([
      callAutocratA2A<GovernanceStats>('get-governance-stats'),
      callAutocratA2A<CEOStatusResponse>('get-ceo-status'),
      callAutocratA2A<ProposalsListResponse>('list-proposals', {
        activeOnly: false,
      }),
    ])

    const result = `📊 CEO GOVERNANCE DASHBOARD

🏛️ DAO STATE
Total Proposals: ${stats.totalProposals ?? 0}
Approved: ${stats.approvedCount ?? 0}
Rejected: ${stats.rejectedCount ?? 0}
Pending: ${stats.pendingCount ?? 0}
Avg Quality Score: ${stats.avgQualityScore ?? 0}/100

👤 CEO STATUS
Current Model: ${ceo.currentModel?.name ?? 'Not set'}
Decisions This Period: ${ceo.decisionsThisPeriod ?? 0}

📋 RECENT PROPOSALS (${proposals.total ?? 0} total)
${
  proposals.proposals
    ?.slice(0, 5)
    .map(
      (p) =>
        `- [${p.id.slice(0, 8)}] ${p.status} (Quality: ${p.qualityScore}/100)`,
    )
    .join('\n') || 'No proposals'
}

💡 NEXT ACTIONS
- Review pending proposals in CEO_QUEUE
- Analyze council voting patterns
- Check treasury health for budget proposals`

    return { text: result }
  },
}

// ============================================================================
// Active Proposals Provider
// ============================================================================

/**
 * Provider: Active Proposals
 * List of proposals requiring CEO attention
 */
export const activeProposalsProvider: Provider = {
  name: 'CEO_ACTIVE_PROPOSALS',
  description:
    'Get active proposals awaiting CEO decision or in autocrat review',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const data = await callAutocratA2A('list-proposals', { activeOnly: true })
    const proposalsData = data as { proposals?: ProposalData[]; total?: number }
    const proposals = proposalsData.proposals ?? []

    if (proposals.length === 0) {
      return { text: '📋 No active proposals requiring attention.' }
    }

    const statusGroups = {
      CEO_QUEUE: proposals.filter((p) => p.status === 'CEO_QUEUE'),
      AUTOCRAT_REVIEW: proposals.filter((p) => p.status === 'AUTOCRAT_REVIEW'),
      AUTOCRAT_FINAL: proposals.filter((p) => p.status === 'AUTOCRAT_FINAL'),
      RESEARCH_PENDING: proposals.filter(
        (p) => p.status === 'RESEARCH_PENDING',
      ),
    }

    let result = `📋 ACTIVE PROPOSALS (${proposals.length} total)\n\n`

    if (statusGroups.CEO_QUEUE.length > 0) {
      result += `⚡ AWAITING CEO DECISION (${statusGroups.CEO_QUEUE.length}):\n`
      result += `${statusGroups.CEO_QUEUE.map(
        (p) =>
          `  • [${p.id.slice(0, 10)}] Quality: ${p.qualityScore}/100, Research: ${p.hasResearch ? 'Yes' : 'No'}`,
      ).join('\n')}\n\n`
    }

    if (statusGroups.AUTOCRAT_REVIEW.length > 0) {
      result += `🗳️ IN COUNCIL REVIEW (${statusGroups.AUTOCRAT_REVIEW.length}):\n`
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

// ============================================================================
// Proposal Detail Provider
// ============================================================================

/**
 * Provider: Proposal Details
 * Full details of a specific proposal including autocrat votes
 */
export const proposalDetailProvider: Provider = {
  name: 'CEO_PROPOSAL_DETAIL',
  description:
    'Get full proposal details including autocrat votes and research',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    // Extract proposal ID from message content
    const content = message.content?.text ?? ''
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalIdMatch) {
      return { text: 'Please specify a proposal ID (0x...) to get details.' }
    }

    const proposalId = proposalIdMatch[0]

    type ProposalDetailResponse = ProposalData & {
      autocratVotes?: AutocratVote[]
    }
    interface VotesResponse {
      votes?: AutocratVote[]
    }

    const [proposal, votesData] = await Promise.all([
      callAutocratA2A<ProposalDetailResponse>('get-proposal', { proposalId }),
      callAutocratA2A<VotesResponse>('get-autocrat-votes', { proposalId }),
    ])
    const votes = votesData

    if (!proposal.id) {
      return { text: `Proposal ${proposalId.slice(0, 10)}... not found.` }
    }

    let result = `📄 PROPOSAL DETAILS: ${proposalId.slice(0, 10)}...

📊 STATUS
Current Status: ${proposal.status}
Quality Score: ${proposal.qualityScore}/100
Proposer: ${proposal.proposer.slice(0, 10)}...
Type: ${proposal.proposalType}

🗳️ AUTOCRAT VOTES (${votes.votes?.length ?? 0}):
`

    if (votes.votes && votes.votes.length > 0) {
      for (const vote of votes.votes) {
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

// ============================================================================
// Autocrat Status Provider
// ============================================================================

/**
 * Provider: Autocrat Status
 * Current state of all autocrat agents
 */
export const autocratStatusProvider: Provider = {
  name: 'CEO_AUTOCRAT_STATUS',
  description:
    'Get status of all autocrat agents and their recent voting patterns',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const data = await callAutocratA2A('get-autocrat-status')
    const autocrat = data as {
      roles?: Array<{ id: string; name: string; role: string }>
      totalMembers?: number
    }

    const result = `🏛️ AUTOCRAT STATUS

👥 AUTOCRAT MEMBERS (${autocrat.totalMembers ?? 0}):
${autocrat.roles?.map((r) => `• ${r.name} (${r.role})`).join('\n') || 'No autocrat members'}

📊 VOTING PATTERNS
- Treasury: Conservative, budget-focused
- Code: Technical feasibility emphasis
- Community: User benefit focus
- Security: Risk-averse, audit-oriented
- Legal: Compliance-centered

💡 CONSENSUS DYNAMICS
The autocrat typically achieves consensus when:
- Quality score > 90
- Clear technical specification
- Community benefit demonstrated
- Security concerns addressed`

    return { text: result }
  },
}

// ============================================================================
// Treasury Provider
// ============================================================================

/**
 * Provider: Treasury State
 * Current treasury balance and allocations
 */
export const treasuryProvider: Provider = {
  name: 'CEO_TREASURY',
  description: 'Get treasury balance, allocations, and budget capacity',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    // Treasury data would come from on-chain in production
    // For now, use governance stats as proxy
    const data = await callAutocratA2A('get-governance-stats')
    const stats = data as {
      treasury?: TreasuryState
      ceo?: { treasuryBalance?: string }
    }

    // Treasury data is optional - display what's available
    const balance =
      stats.treasury?.balance ?? stats.ceo?.treasuryBalance ?? 'unavailable'
    const totalAllocated = stats.treasury?.totalAllocated ?? 'unavailable'
    const pendingProposals = stats.treasury?.pendingProposals ?? 0

    return {
      text: `💰 TREASURY STATUS

💵 BALANCE
Current: ${balance} ETH
Allocated: ${totalAllocated} ETH
Pending Proposals: ${pendingProposals}

📈 BUDGET GUIDELINES
- Small grants: < 0.5 ETH (streamlined approval)
- Medium projects: 0.5 - 5 ETH (full council review)
- Large initiatives: > 5 ETH (extended deliberation + research)

⚠️ CONSIDERATIONS
- Runway preservation priority
- ROI expectations by proposal type
- Risk diversification across initiatives`,
    }
  },
}

// ============================================================================
// Historical Decisions Provider
// ============================================================================

/**
 * Provider: Historical Decisions
 * Past CEO decisions for consistency and precedent
 */
export const historicalDecisionsProvider: Provider = {
  name: 'CEO_HISTORICAL_DECISIONS',
  description: 'Get historical CEO decisions for precedent and consistency',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const data = await callAutocratA2A('get-governance-stats')
    const stats = data as {
      approvedCount?: number
      rejectedCount?: number
      recentDecisions?: Array<{
        proposalId: string
        approved: boolean
        reason: string
        date: string
      }>
    }

    const approvalRate =
      stats.approvedCount &&
      stats.approvedCount + (stats.rejectedCount ?? 0) > 0
        ? Math.round(
            (stats.approvedCount /
              (stats.approvedCount + (stats.rejectedCount ?? 0))) *
              100,
          )
        : 0

    return {
      text: `📜 HISTORICAL DECISIONS

📊 OVERALL STATISTICS
Total Decisions: ${(stats.approvedCount ?? 0) + (stats.rejectedCount ?? 0)}
Approved: ${stats.approvedCount ?? 0}
Rejected: ${stats.rejectedCount ?? 0}
Approval Rate: ${approvalRate}%

🎯 DECISION PRINCIPLES
1. Autocrat consensus is weighted heavily
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

// ============================================================================
// MCP Resources Provider
// ============================================================================

/**
 * Provider: MCP Resources
 * Available MCP tools and resources the CEO can use
 */
export const mcpResourcesProvider: Provider = {
  name: 'CEO_MCP_RESOURCES',
  description: 'List available MCP tools and resources for governance actions',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const mcpUrl = process.env.AUTOCRAT_MCP_URL ?? `${getAutocratUrl()}/mcp`

    const response = await fetch(`${mcpUrl}/tools`)
    const data = response.ok
      ? expectValid(MCPToolsResponseSchema, await response.json(), 'MCP tools')
      : { tools: [] }
    const tools = data.tools ?? []

    return {
      text: `🔧 AVAILABLE MCP TOOLS

${
  tools.length > 0
    ? tools.map((t) => `• ${t.name}: ${t.description}`).join('\n')
    : `• assess_proposal_quality: Evaluate proposal before submission
• prepare_proposal_submission: Prepare on-chain transaction
• get_proposal_status: Check proposal state
• request_deep_research: Request comprehensive research
• get_council_deliberation: Get council agent votes`
}

🔗 ENDPOINTS
- A2A: ${process.env.AUTOCRAT_A2A_URL ?? 'http://localhost:8010/a2a'}
- MCP: ${process.env.AUTOCRAT_MCP_URL ?? 'http://localhost:8010/mcp'}

💡 USAGE
Use these tools to gather information and prepare actions.
All decisions are recorded with TEE attestation.`,
    }
  },
}

// ============================================================================
// Fee Configuration Provider
// ============================================================================

/**
 * Provider: Fee Configuration
 * Current network-wide fee settings that the CEO can modify
 */
export const feeConfigProvider: Provider = {
  name: 'CEO_FEE_CONFIG',
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

    const data = (await response.json()) as {
      success: boolean
      summary: {
        distribution: Record<string, string>
        compute: Record<string, string>
        storage: Record<string, string>
        defi: Record<string, string>
        infrastructure: Record<string, string>
        marketplace: Record<string, string>
        token: Record<string, string>
        governance: { treasury: string; council: string; ceo: string }
      }
    }

    if (!data.success) {
      return { text: '⚠️ Fee configuration unavailable.' }
    }

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
• Council: ${s.governance.council.slice(0, 10)}...
• CEO: ${s.governance.ceo.slice(0, 10)}...

💡 ACTIONS
As CEO, you can modify any of these fees using the fee management skills:
- set-distribution-fees: Change app/LP/contributor splits
- set-compute-fees: Adjust inference and rental platform fees
- set-defi-fees: Modify swap and bridge fees
- set-marketplace-fees: Update bazaar and x402 fees
- set-token-fees: Configure token economics`,
    }
  },
}

// ============================================================================
// Export All Providers
// ============================================================================

export const ceoProviders: Provider[] = [
  governanceDashboardProvider,
  activeProposalsProvider,
  proposalDetailProvider,
  autocratStatusProvider,
  treasuryProvider,
  historicalDecisionsProvider,
  mcpResourcesProvider,
  feeConfigProvider,
]
