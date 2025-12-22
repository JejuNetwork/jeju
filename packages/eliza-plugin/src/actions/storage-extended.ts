/**
 * Extended Storage Actions - Deals, stats, pinning
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

export const pinCidAction: Action = {
  name: 'PIN_CID',
  description: 'Pin an existing IPFS CID to the network',
  similes: ['pin cid', 'pin hash', 'pin content', 'add pin'],

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

    // Extract CID
    const cidMatch = text.match(/Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]+/)

    if (!cidMatch) {
      callback?.({
        text: 'Please provide a valid IPFS CID (Qm... or bafy...).',
      })
      return
    }

    callback?.({ text: `Pinning ${cidMatch[0]}...` })

    await client.storage.pin(cidMatch[0])

    callback?.({
      text: `Successfully pinned!
CID: ${cidMatch[0]}
Gateway: ${client.storage.getGatewayUrl(cidMatch[0])}

Your content is now available on the network.`,
      content: { cid: cidMatch[0] },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Pin CID QmXyz123...' } },
      {
        name: 'agent',
        content: { text: 'Successfully pinned! CID: QmXyz123...' },
      },
    ],
  ],
}

export const listPinsAction: Action = {
  name: 'LIST_PINS',
  description: 'List my pinned files',
  similes: ['my pins', 'list pins', 'my files', 'pinned files'],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const pins = await client.storage.listPins()

    if (pins.length === 0) {
      callback?.({ text: 'You have no pinned files.' })
      return
    }

    const pinList = pins
      .slice(0, 15)
      .map(
        (p: {
          name?: string
          cid: string
          sizeBytes: number
          status: string
        }) =>
          `• ${p.name ?? p.cid.slice(0, 12)} - ${(p.sizeBytes / 1024).toFixed(1)} KB - ${p.status}`,
      )
      .join('\n')

    callback?.({
      text: `Your Pinned Files (${pins.length}):
${pinList}`,
      content: { pins },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show my pinned files' } },
      {
        name: 'agent',
        content: { text: 'Your Pinned Files (5): • data.json - 2.3 KB...' },
      },
    ],
  ],
}

export const getStorageStatsAction: Action = {
  name: 'GET_STORAGE_STATS',
  description: 'Get storage usage statistics',
  similes: ['storage stats', 'my storage', 'storage usage'],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const stats = await client.storage.getStats()

    callback?.({
      text: `Storage Statistics:
• Total Pins: ${stats.totalPins}
• Total Size: ${stats.totalSizeGB.toFixed(2)} GB
• Used: ${stats.totalSizeBytes.toLocaleString()} bytes`,
      content: stats,
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show my storage stats' } },
      {
        name: 'agent',
        content: { text: 'Storage Statistics: • Total Pins: 12...' },
      },
    ],
  ],
}

export const unpinAction: Action = {
  name: 'UNPIN',
  description: 'Unpin a file from storage',
  similes: ['unpin', 'remove pin', 'delete pin'],

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

    const cidMatch = text.match(/Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]+/)

    if (!cidMatch) {
      callback?.({ text: 'Please provide a valid IPFS CID to unpin.' })
      return
    }

    await client.storage.unpin(cidMatch[0])

    callback?.({
      text: `Successfully unpinned ${cidMatch[0]}`,
      content: { cid: cidMatch[0] },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Unpin QmXyz123...' } },
      { name: 'agent', content: { text: 'Successfully unpinned QmXyz123...' } },
    ],
  ],
}

export const estimateStorageCostAction: Action = {
  name: 'ESTIMATE_STORAGE_COST',
  description: 'Estimate storage cost for a file',
  similes: ['storage cost', 'how much to store', 'storage price'],

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

    // Parse size
    const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(gb|mb|kb|bytes?)/i)
    const durationMatch = text.match(/(\d+)\s*months?/i)

    if (!sizeMatch) {
      callback?.({
        text: "Please specify the file size (e.g., '100MB', '1GB', '500KB').",
      })
      return
    }

    if (!durationMatch) {
      callback?.({
        text: "Please specify the duration in months (e.g., '3 months').",
      })
      return
    }

    const size = parseFloat(sizeMatch[1])
    const unit = sizeMatch[2].toLowerCase()
    let sizeBytes: number
    if (unit.startsWith('g')) sizeBytes = size * 1024 * 1024 * 1024
    else if (unit.startsWith('m')) sizeBytes = size * 1024 * 1024
    else if (unit.startsWith('k')) sizeBytes = size * 1024
    else sizeBytes = size

    const durationMonths = parseInt(durationMatch[1], 10)

    const cost = client.storage.estimateCost(sizeBytes, durationMonths, 'warm')

    callback?.({
      text: `Storage Cost Estimate:
Size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB
Duration: ${durationMonths} month(s)
Tier: Warm
Cost: ${(Number(cost) / 1e18).toFixed(6)} ETH`,
      content: { sizeBytes, durationMonths, cost: cost.toString() },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'How much to store 100MB for 3 months?' },
      },
      {
        name: 'agent',
        content: { text: 'Storage Cost Estimate: Size: 100 MB...' },
      },
    ],
  ],
}
