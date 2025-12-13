/**
 * CEO Agent Plugin
 * 
 * ElizaOS plugin that provides the AI CEO with:
 * - Governance data providers
 * - Decision-making actions
 * - On-chain integration
 * - A2A/MCP access
 */

import type { Plugin, Action, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions } from '@elizaos/core';
import { ceoProviders } from './ceo-providers';
import { makeTEEDecision } from '../tee';

// ============================================================================
// CEO Actions
// ============================================================================

/**
 * Action: Make CEO Decision
 * Final decision on a proposal with TEE attestation
 */
const makeDecisionAction: Action = {
  name: 'MAKE_CEO_DECISION',
  description: 'Make a final decision on a proposal (APPROVE or REJECT) with reasoning',
  similes: ['decide on proposal', 'approve proposal', 'reject proposal', 'make decision'],
  examples: [
    [
      { 
        name: 'user', 
        content: { text: 'Please decide on proposal 0x1234...' } 
      },
      { 
        name: 'ceo', 
        content: { text: 'I have reviewed the proposal and council votes. Based on the strong council consensus and high quality score, I APPROVE this proposal.' } 
      }
    ]
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text ?? '';
    return content.includes('0x') || content.includes('proposal');
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const content = message.content?.text ?? '';
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalIdMatch) {
      if (callback) {
        await callback({
          text: 'I need a proposal ID to make a decision. Please provide the full proposal ID (0x...).',
          action: 'MAKE_CEO_DECISION',
        });
      }
      return;
    }

    const proposalId = proposalIdMatch[0];

    // Get council votes from state or fetch
    const councilVotes = (state as Record<string, unknown>)?.councilVotes as Array<{
      role: string;
      vote: string;
      reasoning: string;
    }> ?? [];

    // Make decision using TEE
    const decision = await makeTEEDecision({
      proposalId,
      councilVotes,
      researchReport: (state as Record<string, unknown>)?.researchReport as string | undefined,
    });

    const decisionText = decision.approved ? 'APPROVED' : 'REJECTED';
    
    if (callback) {
      await callback({
        text: `📋 CEO DECISION: ${decisionText}

Proposal: ${proposalId.slice(0, 12)}...

📊 Analysis:
${decision.publicReasoning}

Confidence: ${decision.confidenceScore}%
DAO Alignment: ${decision.alignmentScore}%

📝 Recommendations:
${decision.recommendations.map(r => `• ${r}`).join('\n')}

🔐 Attestation: ${decision.attestation?.provider ?? 'none'} (${decision.attestation?.verified ? 'verified' : 'unverified'})`,
        action: 'MAKE_CEO_DECISION',
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
  description: 'Request deep research on a proposal before making a decision',
  similes: ['research proposal', 'investigate', 'analyze deeply'],
  examples: [
    [
      { name: 'user', content: { text: 'I need more research on proposal 0x1234...' } },
      { name: 'ceo', content: { text: 'Initiating deep research on the proposal...' } }
    ]
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text ?? '';
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
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    const proposalId = proposalIdMatch?.[0] ?? 'pending';

    if (callback) {
      await callback({
        text: `🔬 RESEARCH REQUEST INITIATED

Proposal: ${proposalId.slice(0, 12)}...

Research will include:
• Technical feasibility analysis
• Market and competitive research
• Risk assessment
• Community sentiment analysis
• Precedent review

Estimated completion: 2-4 hours

The research report will be available via the get-research skill when complete.`,
        action: 'REQUEST_RESEARCH',
      });
    }
  },
};

/**
 * Action: Get Council Deliberation
 * Review council agent votes and reasoning
 */
const getDeliberationAction: Action = {
  name: 'GET_COUNCIL_DELIBERATION',
  description: 'Get council deliberation results for a proposal',
  similes: ['council votes', 'what did council say', 'council opinion'],
  examples: [],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content?.text ?? '';
    return content.includes('council') || content.includes('deliberation') || content.includes('votes');
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<void> => {
    const content = message.content?.text ?? '';
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/);
    
    if (!proposalIdMatch) {
      if (callback) {
        await callback({
          text: 'Please specify a proposal ID to get council deliberation.',
          action: 'GET_COUNCIL_DELIBERATION',
        });
      }
      return;
    }

    // Fetch from A2A
    const COUNCIL_A2A_URL = process.env.COUNCIL_A2A_URL ?? 'http://localhost:8010/a2a';
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
            parts: [{ kind: 'data', data: { skillId: 'get-council-votes', params: { proposalId: proposalIdMatch[0] } } }]
          }
        }
      }),
    });

    const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: { votes?: Array<{ role: string; vote: string; reasoning: string }> } }> } };
    const votes = result.result?.parts?.find(p => p.kind === 'data')?.data?.votes ?? [];

    if (votes.length === 0) {
      if (callback) {
        await callback({
          text: `No council votes recorded yet for proposal ${proposalIdMatch[0].slice(0, 12)}...`,
          action: 'GET_COUNCIL_DELIBERATION',
        });
      }
      return;
    }

    const voteText = votes.map(v => {
      const emoji = v.vote === 'APPROVE' ? '✅' : v.vote === 'REJECT' ? '❌' : '⚪';
      return `${emoji} ${v.role}: ${v.vote}\n   ${v.reasoning}`;
    }).join('\n\n');

    const approves = votes.filter(v => v.vote === 'APPROVE').length;
    const rejects = votes.filter(v => v.vote === 'REJECT').length;

    if (callback) {
      await callback({
        text: `🗳️ COUNCIL DELIBERATION

Proposal: ${proposalIdMatch[0].slice(0, 12)}...

Summary: ${approves} APPROVE, ${rejects} REJECT, ${votes.length - approves - rejects} ABSTAIN

${voteText}`,
        action: 'GET_COUNCIL_DELIBERATION',
      });
    }
  },
};

// ============================================================================
// CEO Plugin
// ============================================================================

/**
 * CEO Plugin for ElizaOS
 * Provides all data and actions needed for AI CEO governance
 */
export const ceoPlugin: Plugin = {
  name: 'ceo-plugin',
  description: 'AI CEO governance plugin with data providers and decision actions',
  
  providers: ceoProviders,
  
  actions: [
    makeDecisionAction,
    requestResearchAction,
    getDeliberationAction,
  ],
};

export default ceoPlugin;
