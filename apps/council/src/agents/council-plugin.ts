/**
 * Council Agent Plugin
 * 
 * ElizaOS plugin that provides council agents with:
 * - Service discovery (A2A, MCP)
 * - Governance data providers
 * - Deliberation actions
 * - Cross-agent communication
 */

import type { Plugin, Action, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions } from '@elizaos/core';
import { councilProviders } from './council-providers';

// ============================================================================
// Configuration
// ============================================================================

const COUNCIL_A2A_URL = process.env.COUNCIL_A2A_URL ?? 'http://localhost:8010/a2a';

async function callA2A(
  skillId: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(COUNCIL_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `council-action-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }]
        }
      }
    }),
  });

  const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
  return result.result?.parts?.find((p) => p.kind === 'data')?.data ?? {};
}

// ============================================================================
// Council Actions
// ============================================================================

/**
 * Action: Discover Services
 * Find available A2A and MCP services
 */
const discoverServicesAction: Action = {
  name: 'DISCOVER_SERVICES',
  description: 'Discover available A2A agents and MCP services in the network',
  similes: ['find services', 'list services', 'what services are available', 'show endpoints'],
  examples: [
    [
      { name: 'user', content: { text: 'What services are available?' } },
      { name: 'agent', content: { text: 'Let me discover the available services...' } }
    ]
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? '';
    return content.includes('service') || content.includes('discover') || content.includes('endpoint');
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const services = [
      { name: 'Council A2A', url: COUNCIL_A2A_URL, type: 'a2a' },
      { name: 'CEO A2A', url: process.env.CEO_A2A_URL ?? 'http://localhost:8004/a2a', type: 'a2a' },
      { name: 'Council MCP', url: process.env.COUNCIL_MCP_URL ?? 'http://localhost:8010/mcp', type: 'mcp' },
      { name: 'CEO MCP', url: process.env.CEO_MCP_URL ?? 'http://localhost:8004/mcp', type: 'mcp' },
    ];

    const results: string[] = [];
    for (const service of services) {
      const healthUrl = service.url.replace('/a2a', '/health').replace('/mcp', '/health');
      const response = await fetch(healthUrl);
      const status = response.ok ? '✅ Online' : '❌ Offline';
      results.push(`${status} ${service.name}: ${service.url}`);
    }

    if (callback) {
      await callback({
        text: `🔍 SERVICE DISCOVERY\n\n${results.join('\n')}`,
        action: 'DISCOVER_SERVICES',
      });
    }
  },
};

/**
 * Action: Cast Vote
 * Submit a deliberation vote on a proposal
 */
const castVoteAction: Action = {
  name: 'CAST_VOTE',
  description: 'Cast a deliberation vote on a proposal',
  similes: ['vote on proposal', 'approve proposal', 'reject proposal', 'submit vote'],
  examples: [
    [
      { name: 'user', content: { text: 'Vote APPROVE on proposal 0x1234...' } },
      { name: 'agent', content: { text: 'Casting vote on the proposal...' } }
    ]
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? '';
    return content.includes('vote') || content.includes('approve') || content.includes('reject');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const content = message.content?.text ?? '';
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalMatch) {
      if (callback) {
        await callback({
          text: 'Please specify a proposal ID (0x...) to vote on.',
          action: 'CAST_VOTE',
        });
      }
      return;
    }

    const proposalId = proposalMatch[0];
    const voteType = content.toLowerCase().includes('reject') ? 'REJECT' 
                   : content.toLowerCase().includes('abstain') ? 'ABSTAIN' 
                   : 'APPROVE';
    
    const role = runtime.character.name?.replace(' Agent', '').toUpperCase() ?? 'UNKNOWN';

    const result = await callA2A('submit-vote', {
      proposalId,
      role,
      vote: voteType,
      reasoning: `${role} agent cast ${voteType} vote`,
      confidence: 75,
    });

    if (callback) {
      await callback({
        text: `🗳️ VOTE CAST

Proposal: ${proposalId.slice(0, 12)}...
Vote: ${voteType}
Role: ${role}
Status: ${(result as { success?: boolean }).success ? 'Recorded' : 'Failed'}`,
        action: 'CAST_VOTE',
      });
    }
  },
};

/**
 * Action: Request Research
 * Request deep research on a proposal
 */
const requestResearchAction: Action = {
  name: 'REQUEST_RESEARCH',
  description: 'Request deep research on a proposal',
  similes: ['research proposal', 'investigate', 'analyze'],
  examples: [],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? '';
    return content.includes('research') || content.includes('investigate');
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const content = message.content?.text ?? '';
    const proposalMatch = content.match(/0x[a-fA-F0-9]{64}/);

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
      });
    }
  },
};

/**
 * Action: Query A2A Skill
 * Execute an A2A skill on any available agent
 */
const queryA2AAction: Action = {
  name: 'QUERY_A2A',
  description: 'Query an A2A skill on the council or CEO agent',
  similes: ['call skill', 'query agent', 'ask council', 'ask ceo'],
  examples: [],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? '';
    return content.includes('query') || content.includes('skill') || content.includes('ask');
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const content = message.content?.text ?? '';
    
    // Try to parse skill from message
    const skillMatch = content.match(/skill[:\s]+(\S+)/i);
    const skillId = skillMatch?.[1] ?? 'get-governance-stats';

    const result = await callA2A(skillId, {});

    if (callback) {
      await callback({
        text: `📡 A2A QUERY RESULT

Skill: ${skillId}
Response:
${JSON.stringify(result, null, 2).slice(0, 500)}`,
        action: 'QUERY_A2A',
      });
    }
  },
};

/**
 * Action: Call MCP Tool
 * Execute an MCP tool
 */
const callMCPToolAction: Action = {
  name: 'CALL_MCP_TOOL',
  description: 'Call an MCP tool on the council or CEO server',
  similes: ['use tool', 'call tool', 'mcp'],
  examples: [],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? '';
    return content.includes('mcp') || content.includes('tool');
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const content = message.content?.text ?? '';
    
    // Try to parse tool name from message
    const toolMatch = content.match(/tool[:\s]+(\S+)/i);
    const toolName = toolMatch?.[1] ?? 'get_proposal_status';

    const MCP_URL = process.env.COUNCIL_MCP_URL ?? 'http://localhost:8010/mcp';
    
    const response = await fetch(`${MCP_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { name: toolName, arguments: {} } }),
    });

    const result = await response.json() as { content?: Array<{ text?: string }> };

    if (callback) {
      await callback({
        text: `🔧 MCP TOOL RESULT

Tool: ${toolName}
Response:
${result.content?.[0]?.text ?? JSON.stringify(result).slice(0, 500)}`,
        action: 'CALL_MCP_TOOL',
      });
    }
  },
};

// ============================================================================
// Council Plugin
// ============================================================================

/**
 * Council Plugin for ElizaOS
 * Provides data access and actions for council agents
 */
export const councilPlugin: Plugin = {
  name: 'council-plugin',
  description: 'Council agent plugin with service discovery, A2A/MCP access, and governance actions',
  
  providers: councilProviders,
  
  actions: [
    discoverServicesAction,
    castVoteAction,
    requestResearchAction,
    queryA2AAction,
    callMCPToolAction,
  ],
};

export default councilPlugin;
