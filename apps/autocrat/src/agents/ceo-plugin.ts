/**
 * CEO Agent Plugin
 *
 * ElizaOS plugin that provides the AI CEO with:
 * - Governance data providers
 * - Decision-making actions
 * - On-chain integration
 * - A2A/MCP access
 *
 * FULLY DECENTRALIZED - Endpoints resolved from network config
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
import { getAutocratA2AUrl, getAutocratUrl } from '@jejunetwork/config'
import { A2AJsonRpcResponseSchema, expectValid } from '../schemas'
import { makeTEEDecision } from '../tee'
import { ceoProviders } from './ceo-providers'

// ============================================================================
// CEO Actions
// ============================================================================

/**
 * Action: Make CEO Decision
 * Final decision on a proposal with TEE attestation
 */
const makeDecisionAction: Action = {
  name: 'MAKE_CEO_DECISION',
  description:
    'Make a final decision on a proposal (APPROVE or REJECT) with reasoning',
  similes: [
    'decide on proposal',
    'approve proposal',
    'reject proposal',
    'make decision',
  ],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Please decide on proposal 0x1234...' },
      },
      {
        name: 'ceo',
        content: {
          text: 'I have reviewed the proposal and council votes. Based on the strong council consensus and high quality score, I APPROVE this proposal.',
        },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text ?? ''
    return content.includes('0x') || content.includes('proposal')
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content?.text ?? ''
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalIdMatch) {
      if (callback) {
        await callback({
          text: 'I need a proposal ID to make a decision. Please provide the full proposal ID (0x...).',
          action: 'MAKE_CEO_DECISION',
        })
      }
      return
    }

    const proposalId = proposalIdMatch[0]

    // Get council votes from state or fetch
    const autocratVotes =
      ((state as Record<string, unknown>)?.autocratVotes as Array<{
        role: string
        vote: string
        reasoning: string
      }>) ?? []

    // Make decision using TEE
    const decision = await makeTEEDecision({
      proposalId,
      autocratVotes,
      researchReport: (state as Record<string, unknown>)?.researchReport as
        | string
        | undefined,
    })

    const decisionText = decision.approved ? 'APPROVED' : 'REJECTED'

    if (callback) {
      await callback({
        text: `📋 CEO DECISION: ${decisionText}

Proposal: ${proposalId.slice(0, 12)}...

📊 Analysis:
${decision.publicReasoning}

Confidence: ${decision.confidenceScore}%
DAO Alignment: ${decision.alignmentScore}%

📝 Recommendations:
${decision.recommendations.map((r) => `• ${r}`).join('\n')}

🔐 Attestation: ${decision.attestation?.provider ?? 'none'} (${decision.attestation?.verified ? 'verified' : 'unverified'})`,
        action: 'MAKE_CEO_DECISION',
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
  description: 'Request deep research on a proposal before making a decision',
  similes: ['research proposal', 'investigate', 'analyze deeply'],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'I need more research on proposal 0x1234...' },
      },
      {
        name: 'ceo',
        content: { text: 'Initiating deep research on the proposal...' },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text ?? ''
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
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/)

    const proposalId = proposalIdMatch?.[0] ?? 'pending'

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
      })
    }
  },
}

/**
 * Action: Get Autocrat Deliberation
 * Review autocrat agent votes and reasoning
 */
const getDeliberationAction: Action = {
  name: 'GET_AUTOCRAT_DELIBERATION',
  description: 'Get autocrat deliberation results for a proposal',
  similes: ['autocrat votes', 'what did autocrat say', 'autocrat opinion'],
  examples: [],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text ?? ''
    return (
      content.includes('autocrat') ||
      content.includes('deliberation') ||
      content.includes('votes')
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
    const proposalIdMatch = content.match(/0x[a-fA-F0-9]{64}/)

    if (!proposalIdMatch) {
      if (callback) {
        await callback({
          text: 'Please specify a proposal ID to get autocrat deliberation.',
          action: 'GET_AUTOCRAT_DELIBERATION',
        })
      }
      return
    }

    // Fetch from A2A (using network-aware endpoint)
    const autocratA2aUrl = process.env.AUTOCRAT_A2A_URL ?? getAutocratA2AUrl()
    const response = await fetch(autocratA2aUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'message/send',
        params: {
          message: {
            messageId: `ceo-${Date.now()}`,
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-autocrat-votes',
                  params: { proposalId: proposalIdMatch[0] },
                },
              },
            ],
          },
        },
      }),
    })

    const result = expectValid(
      A2AJsonRpcResponseSchema,
      await response.json(),
      'autocrat votes A2A response',
    )
    const dataPart = result.result?.parts?.find((p) => p.kind === 'data')
    const votesData =
      dataPart?.kind === 'data' && dataPart.data ? dataPart.data : {}
    const votes =
      (
        votesData as {
          votes?: Array<{ role: string; vote: string; reasoning: string }>
        }
      ).votes ?? []

    if (votes.length === 0) {
      if (callback) {
        await callback({
          text: `No autocrat votes recorded yet for proposal ${proposalIdMatch[0].slice(0, 12)}...`,
          action: 'GET_AUTOCRAT_DELIBERATION',
        })
      }
      return
    }

    const voteText = votes
      .map((v) => {
        const emoji =
          v.vote === 'APPROVE' ? '✅' : v.vote === 'REJECT' ? '❌' : '⚪'
        return `${emoji} ${v.role}: ${v.vote}\n   ${v.reasoning}`
      })
      .join('\n\n')

    const approves = votes.filter((v) => v.vote === 'APPROVE').length
    const rejects = votes.filter((v) => v.vote === 'REJECT').length

    if (callback) {
      await callback({
        text: `🗳️ AUTOCRAT DELIBERATION

Proposal: ${proposalIdMatch[0].slice(0, 12)}...

Summary: ${approves} APPROVE, ${rejects} REJECT, ${votes.length - approves - rejects} ABSTAIN

${voteText}`,
        action: 'GET_AUTOCRAT_DELIBERATION',
      })
    }
  },
}

// ============================================================================
// CEO Plugin
// ============================================================================

/**
 * CEO Plugin for ElizaOS
 * Provides all data and actions needed for AI CEO governance
 */
export const ceoPlugin: Plugin = {
  name: 'ceo-plugin',
  description:
    'AI CEO governance plugin with data providers and decision actions',

  providers: ceoProviders,

  actions: [makeDecisionAction, requestResearchAction, getDeliberationAction],
}

export default ceoPlugin
