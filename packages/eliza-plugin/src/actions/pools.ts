/**
 * Pool Actions - XLP liquidity pools
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  expectResponseData,
  validatePoolStats,
  validateServiceExists,
} from '../validation'

export const listPoolsAction: Action = {
  name: 'LIST_POOLS',
  description: 'List available liquidity pools',
  similes: [
    'list pools',
    'show pools',
    'liquidity pools',
    'available pools',
    'xlp pools',
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

    const pools = await client.defi.listPools()

    if (pools.length === 0) {
      callback?.({ text: 'No liquidity pools available yet.' })
      return
    }

    const poolList = pools
      .slice(0, 10)
      .map(
        (p: {
          token0: { symbol: string }
          token1: { symbol: string }
          fee: number
          liquidity: bigint
        }) =>
          `• ${p.token0.symbol}/${p.token1.symbol} - Fee: ${p.fee / 10000}% - Liquidity: $${(Number(p.liquidity) / 1e18).toFixed(2)}`,
      )
      .join('\n')

    callback?.({
      text: `Liquidity Pools (${pools.length}):
${poolList}`,
      content: { pools },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show available pools' } },
      {
        name: 'agent',
        content: { text: 'Liquidity Pools (8): • ETH/USDC - Fee: 0.3%...' },
      },
    ],
  ],
}

export const getPoolStatsAction: Action = {
  name: 'GET_POOL_STATS',
  description: 'Get statistics for liquidity pools',
  similes: ['pool stats', 'pool statistics', 'pool tvl', 'pool volume'],

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
      skillId: 'xlp-pool-stats',
    })

    const responseData = expectResponseData(
      response,
      'Pool stats API returned no data',
    )
    const stats = validatePoolStats(responseData as Record<string, unknown>)

    callback?.({
      text: `XLP Pool Statistics:
• Total Value Locked: $${stats.tvl}
• 24h Volume: $${stats.volume24h}
• Total Pools: ${stats.totalPools}
• Total Swaps: ${stats.totalSwaps}`,
      content: stats,
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show pool statistics' } },
      {
        name: 'agent',
        content: {
          text: 'XLP Pool Statistics: • Total Value Locked: $1.2M...',
        },
      },
    ],
  ],
}

export const myPositionsAction: Action = {
  name: 'MY_POSITIONS',
  description: 'Show my liquidity positions',
  similes: [
    'my positions',
    'my liquidity',
    'my lp positions',
    'liquidity positions',
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

    const positions = await client.defi.listPositions()

    if (positions.length === 0) {
      callback?.({ text: 'You have no active liquidity positions.' })
      return
    }

    const positionList = positions
      .map(
        (p: { positionId: string | number | bigint; liquidity: bigint }) =>
          `• Position #${p.positionId} - Liquidity: ${p.liquidity.toString()}`,
      )
      .join('\n')

    callback?.({
      text: `Your Liquidity Positions (${positions.length}):
${positionList}`,
      content: { positions },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Show my liquidity positions' } },
      {
        name: 'agent',
        content: { text: 'Your Liquidity Positions (2): • Position #1...' },
      },
    ],
  ],
}
