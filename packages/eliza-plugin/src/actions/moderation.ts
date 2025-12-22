/**
 * Moderation Actions - Report agents/content
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import { getMessageText, validateServiceExists } from '../validation'

export const reportAgentAction: Action = {
  name: 'REPORT_AGENT',
  description: 'Report an agent or content for moderation',
  similes: [
    'report agent',
    'report content',
    'flag agent',
    'report spam',
    'report abuse',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()
    const text = getMessageText(message)

    // Extract address/agent ID and reason
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    const agentIdMatch = text.match(/agent\s+#?(\d+)/i)

    if (!addressMatch && !agentIdMatch) {
      callback?.({ text: 'Please specify an address or agent ID to report.' })
      return
    }

    // Determine report type
    let reportType: 'spam' | 'scam' | 'abuse' | 'illegal' | 'other' = 'other'
    if (text.toLowerCase().includes('spam')) reportType = 'spam'
    else if (text.toLowerCase().includes('scam')) reportType = 'scam'
    else if (text.toLowerCase().includes('abuse')) reportType = 'abuse'
    else if (text.toLowerCase().includes('illegal')) reportType = 'illegal'

    callback?.({ text: `Submitting ${reportType} report...` })

    const agentId = agentIdMatch ? BigInt(agentIdMatch[1]) : 0n
    const txHash = await client.identity.report({
      agentId,
      type: reportType,
      description: text,
    })

    callback?.({
      text: `Report submitted successfully.
Transaction: ${txHash}
Type: ${reportType}

Your report will be reviewed by moderators.`,
      content: { txHash, reportType },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Report agent #123 for spam' } },
      {
        name: 'agent',
        content: { text: 'Report submitted successfully. Transaction: 0x...' },
      },
    ],
  ],
}
