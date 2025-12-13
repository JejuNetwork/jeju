/**
 * Council Agent Data Providers
 * 
 * ElizaOS providers that give council agents access to:
 * - A2A service discovery
 * - MCP tools and resources
 * - On-chain governance data
 * - Other council agent votes
 * - CEO status and decisions
 */

import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';

// ============================================================================
// Configuration
// ============================================================================

const COUNCIL_A2A_URL = process.env.COUNCIL_A2A_URL ?? 'http://localhost:8010/a2a';
const COUNCIL_MCP_URL = process.env.COUNCIL_MCP_URL ?? 'http://localhost:8010/mcp';
const CEO_A2A_URL = process.env.CEO_A2A_URL ?? 'http://localhost:8004/a2a';
const CEO_MCP_URL = process.env.CEO_MCP_URL ?? 'http://localhost:8004/mcp';

// Service registry for A2A discovery
const SERVICE_REGISTRY: Record<string, { url: string; description: string }> = {
  'council': { url: COUNCIL_A2A_URL, description: 'Council governance A2A server' },
  'ceo': { url: CEO_A2A_URL, description: 'AI CEO decision-making agent' },
  'council-mcp': { url: COUNCIL_MCP_URL, description: 'Council MCP tools and resources' },
  'ceo-mcp': { url: CEO_MCP_URL, description: 'CEO MCP tools and resources' },
};

// ============================================================================
// A2A Client Helper
// ============================================================================

async function callA2A(
  url: string,
  skillId: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `council-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }]
        }
      }
    }),
  });

  const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
  return result.result?.parts?.find((p) => p.kind === 'data')?.data ?? {};
}

async function fetchAgentCard(baseUrl: string): Promise<Record<string, unknown> | null> {
  const cardUrl = baseUrl.replace('/a2a', '') + '/.well-known/agent-card.json';
  const response = await fetch(cardUrl);
  if (!response.ok) return null;
  return await response.json() as Record<string, unknown>;
}

// ============================================================================
// Service Discovery Provider
// ============================================================================

/**
 * Provider: Service Discovery
 * Discover available A2A agents and MCP services
 */
export const serviceDiscoveryProvider: Provider = {
  name: 'COUNCIL_SERVICE_DISCOVERY',
  description: 'Discover available A2A agents and MCP services in the network',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const services: Array<{ name: string; url: string; status: string; skills?: string[] }> = [];

    // Check each registered service
    for (const [name, service] of Object.entries(SERVICE_REGISTRY)) {
      const isA2A = !name.includes('mcp');
      
      if (isA2A) {
        const card = await fetchAgentCard(service.url);
        if (card) {
          const skills = (card.skills as Array<{ id: string }>)?.map(s => s.id) ?? [];
          services.push({ name, url: service.url, status: 'online', skills });
        } else {
          services.push({ name, url: service.url, status: 'offline' });
        }
      } else {
        // Check MCP health
        const healthUrl = service.url.replace('/mcp', '/health');
        const response = await fetch(healthUrl);
        services.push({
          name,
          url: service.url,
          status: response.ok ? 'online' : 'offline',
        });
      }
    }

    const onlineCount = services.filter(s => s.status === 'online').length;

    let result = `🔍 SERVICE DISCOVERY

📡 Available Services (${onlineCount}/${services.length} online):

`;

    for (const service of services) {
      const emoji = service.status === 'online' ? '✅' : '❌';
      result += `${emoji} ${service.name}: ${service.url}\n`;
      if (service.skills && service.skills.length > 0) {
        result += `   Skills: ${service.skills.join(', ')}\n`;
      }
    }

    result += `
💡 Use these services to:
- Query governance data via council A2A
- Make decisions via CEO A2A
- Access tools via MCP endpoints`;

    return { text: result };
  },
};

// ============================================================================
// Other Council Votes Provider
// ============================================================================

/**
 * Provider: Other Council Votes
 * Get votes from other council agents on active proposals
 */
export const otherCouncilVotesProvider: Provider = {
  name: 'COUNCIL_OTHER_VOTES',
  description: 'Get votes from other council agents on proposals',

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    // Extract proposal ID from message if present
    const content = message.content?.text ?? '';
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalMatch) {
      return { text: 'Specify a proposal ID (0x...) to see other council votes.' };
    }

    const proposalId = proposalMatch[0];
    const data = await callA2A(COUNCIL_A2A_URL, 'get-council-votes', { proposalId });
    const votes = (data as { votes?: Array<{ role: string; vote: string; reasoning: string; confidence: number }> }).votes ?? [];

    // Filter out own votes based on runtime's character name
    const myRole = runtime.character.name?.replace(' Agent', '').toUpperCase();
    const otherVotes = votes.filter(v => v.role !== myRole);

    if (otherVotes.length === 0) {
      return { text: `No votes from other council members yet for proposal ${proposalId.slice(0, 12)}...` };
    }

    let result = `🗳️ OTHER COUNCIL VOTES for ${proposalId.slice(0, 12)}...\n\n`;
    
    for (const vote of otherVotes) {
      const emoji = vote.vote === 'APPROVE' ? '✅' : vote.vote === 'REJECT' ? '❌' : '⚪';
      result += `${emoji} ${vote.role}: ${vote.vote} (${vote.confidence}% confidence)\n`;
      result += `   ${vote.reasoning.slice(0, 100)}${vote.reasoning.length > 100 ? '...' : ''}\n\n`;
    }

    const approves = otherVotes.filter(v => v.vote === 'APPROVE').length;
    const rejects = otherVotes.filter(v => v.vote === 'REJECT').length;
    result += `\nConsensus: ${approves} approve, ${rejects} reject, ${otherVotes.length - approves - rejects} abstain`;

    return { text: result };
  },
};

// ============================================================================
// Active Proposals Provider
// ============================================================================

/**
 * Provider: Active Proposals
 * Get list of proposals awaiting deliberation
 */
export const activeProposalsProvider: Provider = {
  name: 'COUNCIL_ACTIVE_PROPOSALS',
  description: 'Get active proposals awaiting council deliberation',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const data = await callA2A(COUNCIL_A2A_URL, 'list-proposals', { activeOnly: true });
    const proposals = (data as { proposals?: Array<{ id: string; status: string; qualityScore: number; proposalType: number }> }).proposals ?? [];
    const total = (data as { total?: number }).total ?? 0;

    if (proposals.length === 0) {
      return { text: '📋 No active proposals requiring council deliberation.' };
    }

    let result = `📋 ACTIVE PROPOSALS (${total} total)\n\n`;

    for (const p of proposals.slice(0, 10)) {
      const statusEmoji = p.status === 'COUNCIL_REVIEW' ? '🗳️' : p.status === 'CEO_QUEUE' ? '👤' : '📝';
      result += `${statusEmoji} [${p.id.slice(0, 10)}...]\n`;
      result += `   Status: ${p.status}, Quality: ${p.qualityScore}/100, Type: ${p.proposalType}\n\n`;
    }

    return { text: result };
  },
};

// ============================================================================
// Proposal Detail Provider
// ============================================================================

/**
 * Provider: Proposal Detail
 * Get full details of a specific proposal
 */
export const proposalDetailProvider: Provider = {
  name: 'COUNCIL_PROPOSAL_DETAIL',
  description: 'Get full details of a specific proposal for evaluation',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const content = message.content?.text ?? '';
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalMatch) {
      return { text: 'Specify a proposal ID (0x...) to get details.' };
    }

    const proposalId = proposalMatch[0];
    const data = await callA2A(COUNCIL_A2A_URL, 'get-proposal', { proposalId });
    const proposal = data as {
      id?: string;
      status?: string;
      proposer?: string;
      proposalType?: number;
      qualityScore?: number;
      contentHash?: string;
      hasResearch?: boolean;
    };

    if (!proposal.id) {
      return { text: `Proposal ${proposalId.slice(0, 12)}... not found.` };
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

Use this information to inform your deliberation vote.`
    };
  },
};

// ============================================================================
// CEO Status Provider
// ============================================================================

/**
 * Provider: CEO Status
 * Get current AI CEO status and recent decisions
 */
export const ceoStatusProvider: Provider = {
  name: 'COUNCIL_CEO_STATUS',
  description: 'Get AI CEO status and recent decision patterns',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const data = await callA2A(COUNCIL_A2A_URL, 'get-ceo-status');
    const ceo = data as {
      currentModel?: { name: string };
      decisionsThisPeriod?: number;
      approvalRate?: number;
      lastDecision?: { proposalId: string; approved: boolean };
    };

    return {
      text: `👤 CEO STATUS

Model: ${ceo.currentModel?.name ?? 'Not set'}
Decisions This Period: ${ceo.decisionsThisPeriod ?? 0}
Approval Rate: ${ceo.approvalRate ?? 0}%

${ceo.lastDecision ? `Last Decision: ${ceo.lastDecision.proposalId.slice(0, 12)}... - ${ceo.lastDecision.approved ? 'APPROVED' : 'REJECTED'}` : 'No recent decisions'}

💡 The CEO weighs council votes heavily - your assessment matters.`
    };
  },
};

// ============================================================================
// MCP Tools Provider
// ============================================================================

/**
 * Provider: Available MCP Tools
 * List MCP tools available for governance actions
 */
export const mcpToolsProvider: Provider = {
  name: 'COUNCIL_MCP_TOOLS',
  description: 'List available MCP tools for governance actions',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    // Fetch tools from both council and CEO MCP servers
    const tools: Array<{ source: string; name: string; description: string }> = [];

    // Council MCP tools
    const councilResponse = await fetch(`${COUNCIL_MCP_URL}/tools`);
    if (councilResponse.ok) {
      const councilData = await councilResponse.json() as { tools?: Array<{ name: string; description: string }> };
      for (const tool of councilData.tools ?? []) {
        tools.push({ source: 'council', ...tool });
      }
    }

    // CEO MCP tools
    const ceoResponse = await fetch(`${CEO_MCP_URL}/tools`);
    if (ceoResponse.ok) {
      const ceoData = await ceoResponse.json() as { tools?: Array<{ name: string; description: string }> };
      for (const tool of ceoData.tools ?? []) {
        tools.push({ source: 'ceo', ...tool });
      }
    }

    if (tools.length === 0) {
      return { text: 'No MCP tools available. Check service connectivity.' };
    }

    let result = `🔧 AVAILABLE MCP TOOLS\n\n`;

    const councilTools = tools.filter(t => t.source === 'council');
    const ceoTools = tools.filter(t => t.source === 'ceo');

    if (councilTools.length > 0) {
      result += `📋 Council Tools (${COUNCIL_MCP_URL}):\n`;
      for (const tool of councilTools) {
        result += `  • ${tool.name}: ${tool.description}\n`;
      }
      result += '\n';
    }

    if (ceoTools.length > 0) {
      result += `👤 CEO Tools (${CEO_MCP_URL}):\n`;
      for (const tool of ceoTools) {
        result += `  • ${tool.name}: ${tool.description}\n`;
      }
    }

    return { text: result };
  },
};

// ============================================================================
// A2A Skills Provider
// ============================================================================

/**
 * Provider: Available A2A Skills
 * List A2A skills available across all agents
 */
export const a2aSkillsProvider: Provider = {
  name: 'COUNCIL_A2A_SKILLS',
  description: 'List available A2A skills across council and CEO agents',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const skills: Array<{ agent: string; id: string; name: string; description: string }> = [];

    // Fetch from council
    const councilCard = await fetchAgentCard(COUNCIL_A2A_URL);
    if (councilCard) {
      for (const skill of (councilCard.skills as Array<{ id: string; name: string; description: string }>) ?? []) {
        skills.push({ agent: 'council', ...skill });
      }
    }

    // Fetch from CEO
    const ceoCard = await fetchAgentCard(CEO_A2A_URL);
    if (ceoCard) {
      for (const skill of (ceoCard.skills as Array<{ id: string; name: string; description: string }>) ?? []) {
        skills.push({ agent: 'ceo', ...skill });
      }
    }

    if (skills.length === 0) {
      return { text: 'No A2A skills discovered. Agents may be offline.' };
    }

    let result = `📡 AVAILABLE A2A SKILLS\n\n`;

    const councilSkills = skills.filter(s => s.agent === 'council');
    const ceoSkills = skills.filter(s => s.agent === 'ceo');

    if (councilSkills.length > 0) {
      result += `📋 Council Skills:\n`;
      for (const skill of councilSkills) {
        result += `  • ${skill.id}: ${skill.description}\n`;
      }
      result += '\n';
    }

    if (ceoSkills.length > 0) {
      result += `👤 CEO Skills:\n`;
      for (const skill of ceoSkills) {
        result += `  • ${skill.id}: ${skill.description}\n`;
      }
    }

    return { text: result };
  },
};

// ============================================================================
// Governance Stats Provider
// ============================================================================

/**
 * Provider: Governance Stats
 * Get overall governance statistics
 */
export const governanceStatsProvider: Provider = {
  name: 'COUNCIL_GOVERNANCE_STATS',
  description: 'Get overall DAO governance statistics',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const data = await callA2A(COUNCIL_A2A_URL, 'get-governance-stats');
    const stats = data as {
      totalProposals?: number;
      approvedCount?: number;
      rejectedCount?: number;
      pendingCount?: number;
      avgQualityScore?: number;
    };

    const total = stats.totalProposals ?? 0;
    const approved = stats.approvedCount ?? 0;
    const rejected = stats.rejectedCount ?? 0;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    return {
      text: `📊 GOVERNANCE STATISTICS

Total Proposals: ${total}
Approved: ${approved} (${approvalRate}%)
Rejected: ${rejected}
Pending: ${stats.pendingCount ?? 0}
Avg Quality Score: ${stats.avgQualityScore ?? 0}/100

Use these stats to understand the DAO's governance patterns
and calibrate your voting recommendations.`
    };
  },
};

// ============================================================================
// Research Reports Provider
// ============================================================================

/**
 * Provider: Research Reports
 * Access research reports for proposals
 */
export const researchReportsProvider: Provider = {
  name: 'COUNCIL_RESEARCH_REPORTS',
  description: 'Access deep research reports for proposals',

  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const content = message.content?.text ?? '';
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalMatch) {
      return { text: 'Specify a proposal ID (0x...) to get its research report.' };
    }

    const proposalId = proposalMatch[0];
    const data = await callA2A(COUNCIL_A2A_URL, 'get-research', { proposalId });
    const research = data as { report?: string; status?: string };

    if (!research.report) {
      return {
        text: `📚 No research report available for proposal ${proposalId.slice(0, 12)}...

Status: ${research.status ?? 'Not requested'}

Request research via the request-research skill.`
      };
    }

    return {
      text: `📚 RESEARCH REPORT for ${proposalId.slice(0, 12)}...

${research.report.slice(0, 2000)}${research.report.length > 2000 ? '...\n\n[Report truncated - full report available via MCP]' : ''}`
    };
  },
};

// ============================================================================
// Export All Providers
// ============================================================================

export const councilProviders: Provider[] = [
  serviceDiscoveryProvider,
  otherCouncilVotesProvider,
  activeProposalsProvider,
  proposalDetailProvider,
  ceoStatusProvider,
  mcpToolsProvider,
  a2aSkillsProvider,
  governanceStatsProvider,
  researchReportsProvider,
];
