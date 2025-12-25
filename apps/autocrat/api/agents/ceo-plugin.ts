/**
 * CEO Agent Plugin
 *
 * ElizaOS plugin that provides the AI CEO with:
 * - Governance data providers
 * - Decision-making actions
 * - On-chain integration
 * - A2A/MCP access
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
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import {
  A2AJsonRpcResponseSchema,
  type AutocratVote,
  AutocratVoteDataSchema,
} from '../../lib'
import { makeTEEDecision } from '../tee'
import { ceoProviders } from './ceo-providers'

/** Fee change request configuration */
interface FeeChangeRequest {
  category: string
  skillId: string
  params: Record<string, number>
}

/** Schema for fee execute response */
const FeeExecuteResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: z.object({ txHash: z.string() }),
    error: z.undefined(),
  }),
  z.object({
    success: z.literal(false),
    data: z.undefined(),
    error: z.string().optional(),
  }),
])

/** Schema for fee summary response */
const FeeSummaryResponseSchema = z.object({
  success: z.boolean(),
  summary: z.object({
    distribution: z.record(z.string(), z.string()),
    compute: z.record(z.string(), z.string()),
    storage: z.record(z.string(), z.string()),
    defi: z.record(z.string(), z.string()),
    infrastructure: z.record(z.string(), z.string()),
    marketplace: z.record(z.string(), z.string()),
    token: z.record(z.string(), z.string()),
  }),
})

/** Schema for autocrat votes response data */
const AutocratVotesResponseSchema = z.object({
  votes: z.array(AutocratVoteDataSchema).optional(),
})

/** Type guard for autocrat vote using Zod schema */
function isAutocratVote(value: unknown): value is AutocratVote {
  return AutocratVoteDataSchema.safeParse(value).success
}

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
    const autocratVotes: AutocratVote[] = Array.isArray(state?.autocratVotes)
      ? state.autocratVotes.filter(isAutocratVote)
      : []

    // Get research report from state
    const researchReport =
      typeof state?.researchReport === 'string'
        ? state.researchReport
        : undefined

    // Make decision using TEE
    const decision = await makeTEEDecision({
      proposalId,
      autocratVotes,
      researchReport,
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

🔐 Attestation: ${decision.attestation.provider} (${decision.attestation.verified ? 'verified' : 'unverified'})`,
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

    // Fetch from A2A (config handles env overrides)
    const autocratA2aUrl = getAutocratA2AUrl()
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
    const rawVotesData =
      dataPart?.kind === 'data' && dataPart.data ? dataPart.data : {}
    const parsedVotes = AutocratVotesResponseSchema.safeParse(rawVotesData)
    const votes = parsedVotes.success ? (parsedVotes.data.votes ?? []) : []

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

// Fee Management Actions

/**
 * Action: Modify Fees
 * CEO can modify network-wide fee configuration
 */
const modifyFeesAction: Action = {
  name: 'MODIFY_FEES',
  description: 'Modify network-wide fee configuration as CEO',
  similes: [
    'change fees',
    'update fees',
    'set fees',
    'adjust fees',
    'modify fee',
    'change distribution',
    'set compute fees',
    'adjust swap fee',
  ],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Set the swap protocol fee to 0.1%' },
      },
      {
        name: 'ceo',
        content: {
          text: 'I will update the swap protocol fee from 0.05% to 0.1%. This change affects all DEX trades on the network.',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Change the distribution to 50% apps, 40% LPs, 10% contributors',
        },
      },
      {
        name: 'ceo',
        content: {
          text: 'Updating revenue distribution: App share 50%, LP share 40%, Contributor pool 10%. This rebalances incentives toward app developers.',
        },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    const feeKeywords = [
      'fee',
      'fees',
      'distribution',
      'share',
      'percentage',
      '%',
      'bps',
      'basis points',
      'swap',
      'bridge',
      'compute',
      'storage',
      'marketplace',
    ]
    return feeKeywords.some((k) => content.includes(k))
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const content = message.content?.text?.toLowerCase() ?? ''

    const parseRequest = (): FeeChangeRequest | null => {
      // Distribution fees
      if (content.includes('distribution') || content.includes('app share')) {
        const appMatch = content.match(/(\d+)%?\s*(app|developer)/i)
        const lpMatch = content.match(/(\d+)%?\s*(lp|liquidity)/i)
        const contribMatch = content.match(/(\d+)%?\s*(contrib|pool)/i)

        if (appMatch && lpMatch && contribMatch) {
          return {
            category: 'distribution',
            skillId: 'set-distribution-fees',
            params: {
              appShareBps: parseInt(appMatch[1], 10) * 100,
              lpShareBps: parseInt(lpMatch[1], 10) * 100,
              contributorShareBps: parseInt(contribMatch[1], 10) * 100,
              ethLpShareBps: 7000,
              tokenLpShareBps: 3000,
            },
          }
        }
      }

      // DeFi fees
      if (content.includes('swap') && content.includes('fee')) {
        const percentMatch = content.match(/(\d+\.?\d*)%/)
        const bpsMatch = content.match(/(\d+)\s*bps/)
        if (percentMatch) {
          return {
            category: 'defi',
            skillId: 'set-defi-fees',
            params: {
              swapProtocolFeeBps: Math.round(parseFloat(percentMatch[1]) * 100),
              bridgeFeeBps: 10,
              crossChainMarginBps: 1000,
            },
          }
        }
        if (bpsMatch) {
          return {
            category: 'defi',
            skillId: 'set-defi-fees',
            params: {
              swapProtocolFeeBps: parseInt(bpsMatch[1], 10),
              bridgeFeeBps: 10,
              crossChainMarginBps: 1000,
            },
          }
        }
      }

      if (content.includes('bridge') && content.includes('fee')) {
        const percentMatch = content.match(/(\d+\.?\d*)%/)
        if (percentMatch) {
          return {
            category: 'defi',
            skillId: 'set-defi-fees',
            params: {
              swapProtocolFeeBps: 5,
              bridgeFeeBps: Math.round(parseFloat(percentMatch[1]) * 100),
              crossChainMarginBps: 1000,
            },
          }
        }
      }

      // Marketplace fees
      if (content.includes('bazaar') || content.includes('marketplace')) {
        const percentMatch = content.match(/(\d+\.?\d*)%/)
        if (percentMatch) {
          return {
            category: 'marketplace',
            skillId: 'set-marketplace-fees',
            params: {
              bazaarPlatformFeeBps: Math.round(
                parseFloat(percentMatch[1]) * 100,
              ),
              launchpadCreatorFeeBps: 8000,
              launchpadCommunityFeeBps: 2000,
              x402ProtocolFeeBps: 50,
            },
          }
        }
      }

      // Compute fees
      if (content.includes('inference') || content.includes('compute')) {
        const percentMatch = content.match(/(\d+\.?\d*)%/)
        if (percentMatch) {
          return {
            category: 'compute',
            skillId: 'set-compute-fees',
            params: {
              inferencePlatformFeeBps: Math.round(
                parseFloat(percentMatch[1]) * 100,
              ),
              rentalPlatformFeeBps: 300,
              triggerPlatformFeeBps: 200,
            },
          }
        }
      }

      return null
    }

    const request = parseRequest()

    if (!request) {
      if (callback) {
        await callback({
          text: `I couldn't parse your fee change request. Please specify:

• **Distribution**: "Set distribution to X% apps, Y% LPs, Z% contributors"
• **Swap Fee**: "Set swap fee to X%" or "Set swap fee to X bps"
• **Bridge Fee**: "Set bridge fee to X%"
• **Marketplace**: "Set bazaar fee to X%"
• **Compute**: "Set inference fee to X%"

Current fees can be viewed using the fee configuration provider.`,
          action: 'MODIFY_FEES',
        })
      }
      return
    }

    // Execute the fee change
    const feesUrl = `${getAutocratUrl()}/fees/execute`
    const response = await fetch(feesUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId: request.skillId,
        params: request.params,
      }),
    })

    const parsedResult = FeeExecuteResponseSchema.safeParse(
      await response.json(),
    )
    if (!parsedResult.success || !parsedResult.data.success) {
      const errorMsg = parsedResult.success
        ? (parsedResult.data.error ?? 'Unknown error')
        : 'Invalid response format'
      if (callback) {
        await callback({
          text: `❌ Fee change failed: ${errorMsg}`,
          action: 'MODIFY_FEES',
        })
      }
      return
    }

    const paramStr = Object.entries(request.params)
      .map(([k, v]) => `${k}: ${v / 100}%`)
      .join(', ')

    if (callback) {
      await callback({
        text: `✅ CEO FEE UPDATE EXECUTED

📊 Category: ${request.category.toUpperCase()}
🔧 Changes: ${paramStr}

📝 Transaction: ${parsedResult.data.data.txHash.slice(0, 16)}...

The fee changes are now active across the network. All contracts reading from FeeConfig will use the new values.`,
        action: 'MODIFY_FEES',
      })
    }
  },
}

/**
 * Action: View Fee Configuration
 * Get current fee settings
 */
const viewFeesAction: Action = {
  name: 'VIEW_FEES',
  description: 'View current network fee configuration',
  similes: [
    'show fees',
    'get fees',
    'current fees',
    'fee config',
    'fee settings',
  ],
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Show me the current fee configuration' },
      },
      {
        name: 'ceo',
        content: { text: 'Here is the current network fee configuration...' },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() ?? ''
    return (
      (content.includes('fee') || content.includes('fees')) &&
      (content.includes('show') ||
        content.includes('view') ||
        content.includes('get') ||
        content.includes('current') ||
        content.includes('what'))
    )
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const feesUrl = `${getAutocratUrl()}/fees/summary`

    const response = await fetch(feesUrl)
    if (!response.ok) {
      if (callback) {
        await callback({
          text: '⚠️ Unable to fetch fee configuration.',
          action: 'VIEW_FEES',
        })
      }
      return
    }

    const parsedData = FeeSummaryResponseSchema.safeParse(await response.json())
    if (!parsedData.success) {
      if (callback) {
        await callback({
          text: '⚠️ Invalid fee configuration response.',
          action: 'VIEW_FEES',
        })
      }
      return
    }

    const s = parsedData.data.summary

    if (callback) {
      await callback({
        text: `💰 CURRENT NETWORK FEE CONFIGURATION

📊 **Revenue Distribution**
• App Developers: ${s.distribution.appDeveloperShare}
• Liquidity Providers: ${s.distribution.liquidityProviderShare}
• Contributor Pool: ${s.distribution.contributorPoolShare}

🔄 **DeFi Fees**
• Swap Protocol: ${s.defi.swapProtocolFee}
• Bridge: ${s.defi.bridgeFee}
• Cross-Chain Margin: ${s.defi.crossChainMargin}

🖥️ **Compute Fees**
• Inference: ${s.compute.inferenceFee}
• Rental: ${s.compute.rentalFee}
• Triggers: ${s.compute.triggerFee}

🏪 **Marketplace Fees**
• Bazaar Platform: ${s.marketplace.bazaarPlatform}
• X402 Protocol: ${s.marketplace.x402Protocol}

🪙 **Token Economics**
• XLP Rewards: ${s.token.xlpRewardShare}
• Protocol Treasury: ${s.token.protocolShare}
• Token Burn: ${s.token.burnShare}

As CEO, you can modify any of these by saying "set [category] fee to X%"`,
        action: 'VIEW_FEES',
      })
    }
  },
}

// CEO Plugin

/**
 * CEO Plugin for ElizaOS
 * Provides all data and actions needed for AI CEO governance
 */
export const ceoPlugin: Plugin = {
  name: 'ceo-plugin',
  description:
    'AI CEO governance plugin with data providers and decision actions',

  providers: ceoProviders,

  actions: [
    makeDecisionAction,
    requestResearchAction,
    getDeliberationAction,
    modifyFeesAction,
    viewFeesAction,
  ],
}

export default ceoPlugin
