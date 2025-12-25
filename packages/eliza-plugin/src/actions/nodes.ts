/**
 * Node Actions - Node registration, staking, management
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import type { JsonRecord } from '@jejunetwork/types'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  expectArray,
  expectResponseData,
  validateNodeStats,
  validateServiceExists,
} from '../validation'

export const listNodesAction: Action = {
  name: 'LIST_NODES',
  description: 'List registered nodes in the network',
  similes: [
    'list nodes',
    'show nodes',
    'network nodes',
    'registered nodes',
    'node operators',
  ],

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

    const response = await client.a2a.callGateway({
      skillId: 'list-nodes',
    })

    const responseData = expectResponseData(
      response,
      'Nodes API returned no data',
    )
    const nodes = expectArray<{
      address: string
      name: string
      stake: string
      status: string
    }>(
      responseData as Record<string, unknown>,
      'nodes',
      'Nodes API response missing nodes array',
    )

    if (nodes.length === 0) {
      callback?.({ text: 'No nodes registered yet.' })
      return
    }

    const nodeList = nodes
      .slice(0, 10)
      .map(
        (n) =>
          `• ${n.name} (${n.address.slice(0, 10)}...) - Stake: ${n.stake} ETH - ${n.status}`,
      )
      .join('\n')

    callback?.({
      text: `Registered nodes (${nodes.length}):
${nodeList}`,
      content: { nodes },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'List network nodes' } },
      {
        name: 'agent',
        content: { text: 'Registered nodes (12): • Node-1...' },
      },
    ],
  ],
}

export const getNodeStatsAction: Action = {
  name: 'GET_NODE_STATS',
  description: 'Get network node statistics',
  similes: [
    'node stats',
    'network stats',
    'node statistics',
    'network health',
    'infrastructure stats',
  ],

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

    const response = await client.a2a.callGateway({
      skillId: 'get-node-stats',
    })

    const responseData = expectResponseData(
      response,
      'Node stats API returned no data',
    )
    const stats = validateNodeStats(responseData as JsonRecord)

    callback?.({
      text: `Network Node Statistics:
• Total Nodes: ${stats.totalNodes}
• Active Nodes: ${stats.activeNodes}
• Total Stake: ${stats.totalStake} ETH
• Average Uptime: ${stats.averageUptime}%
• Network Capacity: ${stats.capacity}`,
      content: stats,
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show node stats' } },
      {
        name: 'agent',
        content: { text: 'Network Node Statistics: • Total Nodes: 15...' },
      },
    ],
  ],
}
