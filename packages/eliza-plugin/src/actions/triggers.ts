/**
 * Triggers Action - Cron/webhook triggers
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  getMessageText,
  isUrlSafeToFetch,
  validateServiceExists,
} from '../validation'

export const createTriggerAction: Action = {
  name: 'CREATE_TRIGGER',
  description: 'Create a cron or webhook trigger for automated tasks',
  similes: [
    'create trigger',
    'schedule task',
    'set cron',
    'create webhook',
    'automate',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const text = getMessageText(message)

    // Parse trigger type and parameters
    const isCron = /cron|schedule|every|hourly|daily/i.test(text)
    const type = isCron ? 'cron' : 'webhook'

    // Extract cron expression
    let cronExpression: string | undefined
    const minsMatch = text.match(/every\s*(\d+)\s*min/i)
    if (minsMatch) {
      cronExpression = `*/${minsMatch[1]} * * * *`
    } else if (/hourly/i.test(text)) {
      cronExpression = '0 * * * *'
    } else if (/daily/i.test(text)) {
      cronExpression = '0 0 * * *'
    }

    if (type === 'cron' && !cronExpression) {
      callback?.({
        text: "Please specify a schedule (e.g., 'every 5 minutes', 'hourly', 'daily').",
      })
      return
    }

    // Extract endpoint URL - required for webhooks
    const urlMatch = text.match(/https?:\/\/[^\s]+/)
    if (!urlMatch) {
      callback?.({ text: 'Please provide an endpoint URL for the trigger.' })
      return
    }
    const endpoint = urlMatch[0]

    // Validate endpoint URL is safe (prevent SSRF via trigger creation)
    // Note: For triggers, we're more permissive but still block obvious internal URLs
    if (!isUrlSafeToFetch(endpoint)) {
      callback?.({
        text: 'Cannot create trigger pointing to internal or private URLs for security reasons.',
      })
      return
    }

    // Extract name - required
    const nameMatch = text.match(/(?:named?|called?)\s+["']?([^"'\s]+)["']?/i)
    if (!nameMatch) {
      callback?.({
        text: "Please specify a name for the trigger (e.g., 'named my-trigger').",
      })
      return
    }
    const name = nameMatch[1]

    callback?.({ text: `Creating ${type} trigger "${name}"...` })

    const txHash = await client.compute.createTrigger({
      type,
      name,
      endpoint,
      cronExpression: type === 'cron' ? cronExpression : undefined,
    })

    callback?.({
      text: `Trigger created successfully.
Name: ${name}
Type: ${type}
${type === 'cron' ? `Schedule: ${cronExpression}` : ''}
Endpoint: ${endpoint}
Transaction: ${txHash}`,
      content: { txHash, name, type, endpoint },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Create a cron trigger that runs every hour' },
      },
      {
        name: 'agent',
        content: { text: 'Trigger created successfully. Name: trigger-xxx...' },
      },
    ],
  ],
}
