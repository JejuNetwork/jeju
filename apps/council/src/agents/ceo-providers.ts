/**
 * CEO Agent Data Providers
 * 
 * ElizaOS providers that give the AI CEO access to:
 * - On-chain governance data (proposals, votes, treasury)
 * - Council deliberation results
 * - Research reports
 * - Historical decisions
 * - Network state (via A2A/MCP)
 */

import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';

// ============================================================================
// Types
// ============================================================================

interface ProposalData {
  id: string;
  status: string;
  proposer: string;
  proposalType: number;
  qualityScore: number;
  councilVoteEnd: number;
  gracePeriodEnd: number;
  hasResearch: boolean;
  researchHash?: string;
  contentHash: string;
}

interface CouncilVote {
  role: string;
  vote: string;
  reasoning: string;
  confidence: number;
}

interface TreasuryState {
  balance: string;
  totalAllocated: string;
  pendingProposals: number;
}

interface GovernanceStats {
  totalProposals: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  avgQualityScore: number;
}

// ============================================================================
// A2A Client Helper
// ============================================================================

const COUNCIL_A2A_URL = process.env.COUNCIL_A2A_URL ?? 'http://localhost:8010/a2a';

async function callCouncilA2A(skillId: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(COUNCIL_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `ceo-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }]
        }
      }
    }),
  });

  const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
  return result.result?.parts?.find((p) => p.kind === 'data')?.data ?? {};
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
  description: 'Get comprehensive governance dashboard with proposals, treasury, and council status',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const [statsData, ceoData, proposalsData] = await Promise.all([
      callCouncilA2A('get-governance-stats'),
      callCouncilA2A('get-ceo-status'),
      callCouncilA2A('list-proposals', { activeOnly: false }),
    ]);

    const stats = statsData as unknown as GovernanceStats;
    const ceo = ceoData as { currentModel?: { name: string }; decisionsThisPeriod?: number };
    const proposals = proposalsData as { proposals?: ProposalData[]; total?: number };

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
${proposals.proposals?.slice(0, 5).map(p => 
  `- [${p.id.slice(0, 8)}] ${p.status} (Quality: ${p.qualityScore}/100)`
).join('\n') || 'No proposals'}

💡 NEXT ACTIONS
- Review pending proposals in CEO_QUEUE
- Analyze council voting patterns
- Check treasury health for budget proposals`;

    return { text: result };
  },
};

// ============================================================================
// Active Proposals Provider
// ============================================================================

/**
 * Provider: Active Proposals
 * List of proposals requiring CEO attention
 */
export const activeProposalsProvider: Provider = {
  name: 'CEO_ACTIVE_PROPOSALS',
  description: 'Get active proposals awaiting CEO decision or in council review',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const data = await callCouncilA2A('list-proposals', { activeOnly: true });
    const proposalsData = data as { proposals?: ProposalData[]; total?: number };
    const proposals = proposalsData.proposals ?? [];

    if (proposals.length === 0) {
      return { text: '📋 No active proposals requiring attention.' };
    }

    const statusGroups = {
      'CEO_QUEUE': proposals.filter(p => p.status === 'CEO_QUEUE'),
      'COUNCIL_REVIEW': proposals.filter(p => p.status === 'COUNCIL_REVIEW'),
      'COUNCIL_FINAL': proposals.filter(p => p.status === 'COUNCIL_FINAL'),
      'RESEARCH_PENDING': proposals.filter(p => p.status === 'RESEARCH_PENDING'),
    };

    let result = `📋 ACTIVE PROPOSALS (${proposals.length} total)\n\n`;

    if (statusGroups['CEO_QUEUE'].length > 0) {
      result += `⚡ AWAITING CEO DECISION (${statusGroups['CEO_QUEUE'].length}):\n`;
      result += statusGroups['CEO_QUEUE'].map(p => 
        `  • [${p.id.slice(0, 10)}] Quality: ${p.qualityScore}/100, Research: ${p.hasResearch ? 'Yes' : 'No'}`
      ).join('\n') + '\n\n';
    }

    if (statusGroups['COUNCIL_REVIEW'].length > 0) {
      result += `🗳️ IN COUNCIL REVIEW (${statusGroups['COUNCIL_REVIEW'].length}):\n`;
      result += statusGroups['COUNCIL_REVIEW'].map(p => {
        const timeLeft = Math.max(0, p.councilVoteEnd - Math.floor(Date.now() / 1000));
        return `  • [${p.id.slice(0, 10)}] ${Math.floor(timeLeft / 3600)}h remaining`;
      }).join('\n') + '\n\n';
    }

    if (statusGroups['RESEARCH_PENDING'].length > 0) {
      result += `🔬 RESEARCH PENDING (${statusGroups['RESEARCH_PENDING'].length}):\n`;
      result += statusGroups['RESEARCH_PENDING'].map(p => 
        `  • [${p.id.slice(0, 10)}] Awaiting deep research`
      ).join('\n') + '\n';
    }

    return { text: result };
  },
};

// ============================================================================
// Proposal Detail Provider
// ============================================================================

/**
 * Provider: Proposal Details
 * Full details of a specific proposal including council votes
 */
export const proposalDetailProvider: Provider = {
  name: 'CEO_PROPOSAL_DETAIL',
  description: 'Get full proposal details including council votes and research',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    // Extract proposal ID from message content
    const content = message.content?.text ?? '';
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalIdMatch) {
      return { text: 'Please specify a proposal ID (0x...) to get details.' };
    }

    const proposalId = proposalIdMatch[0];
    const [proposalData, votesData] = await Promise.all([
      callCouncilA2A('get-proposal', { proposalId }),
      callCouncilA2A('get-council-votes', { proposalId }),
    ]);

    const proposal = proposalData as unknown as ProposalData & { councilVotes?: CouncilVote[] };
    const votes = votesData as { votes?: CouncilVote[] };

    if (!proposal.id) {
      return { text: `Proposal ${proposalId.slice(0, 10)}... not found.` };
    }

    let result = `📄 PROPOSAL DETAILS: ${proposalId.slice(0, 10)}...

📊 STATUS
Current Status: ${proposal.status}
Quality Score: ${proposal.qualityScore}/100
Proposer: ${proposal.proposer.slice(0, 10)}...
Type: ${proposal.proposalType}

🗳️ COUNCIL VOTES (${votes.votes?.length ?? 0}):
`;

    if (votes.votes && votes.votes.length > 0) {
      for (const vote of votes.votes) {
        const emoji = vote.vote === 'APPROVE' ? '✅' : vote.vote === 'REJECT' ? '❌' : '⚪';
        result += `${emoji} ${vote.role}: ${vote.vote}\n`;
        result += `   Reasoning: ${vote.reasoning.slice(0, 100)}...\n`;
        result += `   Confidence: ${vote.confidence}%\n\n`;
      }
    } else {
      result += '  No council votes recorded yet.\n';
    }

    if (proposal.hasResearch) {
      result += `\n🔬 RESEARCH: Available (hash: ${proposal.researchHash?.slice(0, 12)}...)`;
    }

    return { text: result };
  },
};

// ============================================================================
// Council Status Provider
// ============================================================================

/**
 * Provider: Council Status
 * Current state of all council agents
 */
export const councilStatusProvider: Provider = {
  name: 'CEO_COUNCIL_STATUS',
  description: 'Get status of all council agents and their recent voting patterns',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const data = await callCouncilA2A('get-council-status');
    const council = data as {
      roles?: Array<{ id: string; name: string; role: string }>;
      totalMembers?: number;
    };

    const result = `🏛️ COUNCIL STATUS

👥 COUNCIL MEMBERS (${council.totalMembers ?? 0}):
${council.roles?.map(r => `• ${r.name} (${r.role})`).join('\n') || 'No council members'}

📊 VOTING PATTERNS
- Treasury: Conservative, budget-focused
- Code: Technical feasibility emphasis
- Community: User benefit focus
- Security: Risk-averse, audit-oriented
- Legal: Compliance-centered

💡 CONSENSUS DYNAMICS
The council typically achieves consensus when:
- Quality score > 90
- Clear technical specification
- Community benefit demonstrated
- Security concerns addressed`;

    return { text: result };
  },
};

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
    _state: State
  ): Promise<ProviderResult> => {
    // Treasury data would come from on-chain in production
    // For now, use governance stats as proxy
    const data = await callCouncilA2A('get-governance-stats');
    const stats = data as {
      treasury?: TreasuryState;
      ceo?: { treasuryBalance?: string };
    };

    const treasury = stats.treasury ?? {
      balance: stats.ceo?.treasuryBalance ?? '0',
      totalAllocated: '0',
      pendingProposals: 0,
    };

    return {
      text: `💰 TREASURY STATUS

💵 BALANCE
Current: ${treasury.balance} ETH
Allocated: ${treasury.totalAllocated} ETH
Pending Proposals: ${treasury.pendingProposals}

📈 BUDGET GUIDELINES
- Small grants: < 0.5 ETH (streamlined approval)
- Medium projects: 0.5 - 5 ETH (full council review)
- Large initiatives: > 5 ETH (extended deliberation + research)

⚠️ CONSIDERATIONS
- Runway preservation priority
- ROI expectations by proposal type
- Risk diversification across initiatives`
    };
  },
};

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
    _state: State
  ): Promise<ProviderResult> => {
    const data = await callCouncilA2A('get-governance-stats');
    const stats = data as {
      approvedCount?: number;
      rejectedCount?: number;
      recentDecisions?: Array<{
        proposalId: string;
        approved: boolean;
        reason: string;
        date: string;
      }>;
    };

    const approvalRate = stats.approvedCount && (stats.approvedCount + (stats.rejectedCount ?? 0)) > 0
      ? Math.round((stats.approvedCount / (stats.approvedCount + (stats.rejectedCount ?? 0))) * 100)
      : 0;

    return {
      text: `📜 HISTORICAL DECISIONS

📊 OVERALL STATISTICS
Total Decisions: ${(stats.approvedCount ?? 0) + (stats.rejectedCount ?? 0)}
Approved: ${stats.approvedCount ?? 0}
Rejected: ${stats.rejectedCount ?? 0}
Approval Rate: ${approvalRate}%

🎯 DECISION PRINCIPLES
1. Council consensus is weighted heavily
2. Quality score > 90 is baseline expectation
3. Research reports inform complex decisions
4. Security concerns are blocking issues
5. Treasury impact requires justification

📋 PRECEDENTS
- Technical proposals: Defer to Code Agent expertise
- Budget proposals: Treasury Agent assessment key
- Community initiatives: Community Agent feedback critical
- Security-sensitive: Security Agent can veto`
    };
  },
};

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
    _state: State
  ): Promise<ProviderResult> => {
    const MCP_URL = process.env.COUNCIL_MCP_URL ?? 'http://localhost:8010/mcp';
    
    let tools: Array<{ name: string; description: string }> = [];
    try {
      const response = await fetch(`${MCP_URL}/tools`);
      const data = await response.json() as { tools?: Array<{ name: string; description: string }> };
      tools = data.tools ?? [];
    } catch {
      // MCP not available
    }

    return {
      text: `🔧 AVAILABLE MCP TOOLS

${tools.length > 0 
  ? tools.map(t => `• ${t.name}: ${t.description}`).join('\n')
  : `• assess_proposal_quality: Evaluate proposal before submission
• prepare_proposal_submission: Prepare on-chain transaction
• get_proposal_status: Check proposal state
• request_deep_research: Request comprehensive research
• get_council_deliberation: Get council agent votes`}

🔗 ENDPOINTS
- A2A: ${COUNCIL_A2A_URL}
- MCP: ${MCP_URL}

💡 USAGE
Use these tools to gather information and prepare actions.
All decisions are recorded with TEE attestation.`
    };
  },
};

// ============================================================================
// Export All Providers
// ============================================================================

export const ceoProviders: Provider[] = [
  governanceDashboardProvider,
  activeProposalsProvider,
  proposalDetailProvider,
  councilStatusProvider,
  treasuryProvider,
  historicalDecisionsProvider,
  mcpResourcesProvider,
];
