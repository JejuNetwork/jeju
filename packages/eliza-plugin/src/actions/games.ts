/**
 * Games Actions - Babylon/Hyperscape game integration
 */

import type {
  Action,
  ActionExample,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { getNetworkName } from '@jejunetwork/config'
import { type Address, formatEther, parseEther } from 'viem'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  getMessageText,
  getOptionalMessageText,
  validateServiceExists,
} from '../validation'

const networkName = getNetworkName()

// ============================================================================
// Get Player Info
// ============================================================================

export const getPlayerInfoAction: Action = {
  name: 'GET_PLAYER_INFO',
  similes: ['check player', 'player info', 'player status', 'my game status'],
  description: `Get player information from the game integration contract on ${networkName}`,
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
    const sdk = service.getClient()

    // Extract player address from message or use agent's own address
    const text = getOptionalMessageText(message)
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    const playerAddress = (
      addressMatch ? addressMatch[0] : sdk.address
    ) as Address

    const playerInfo = await sdk.games.getPlayerInfo(playerAddress)
    const isAllowed = await sdk.games.isPlayerAllowed(playerAddress)

    await callback?.({
      text: `Player Info for ${playerAddress}:
- Agent ID: ${playerInfo.agentId.toString()}
- Allowed: ${isAllowed}
- Gold Balance: ${formatEther(playerInfo.goldBalance)} GOLD
- Items: ${playerInfo.itemBalances.length} different item types`,
    })
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Check my player status' },
      },
      {
        name: 'assistant',
        content: { text: 'Getting your player information...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Get Gold Balance
// ============================================================================

export const getGoldBalanceAction: Action = {
  name: 'GET_GOLD_BALANCE',
  similes: ['gold balance', 'check gold', 'my gold', 'how much gold'],
  description: `Check gold balance in the game on ${networkName}`,
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
    const sdk = service.getClient()

    const text = getOptionalMessageText(message) // Address is optional
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    const account = addressMatch ? (addressMatch[0] as Address) : undefined

    const balance = await sdk.games.getGoldBalance(account)

    await callback?.({
      text: `Gold Balance: ${formatEther(balance)} GOLD`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Check my gold balance' },
      },
      {
        name: 'assistant',
        content: { text: 'Gold Balance: 1000.0 GOLD' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Transfer Gold
// ============================================================================

export const transferGoldAction: Action = {
  name: 'TRANSFER_GOLD',
  similes: ['send gold', 'transfer gold', 'give gold'],
  description: `Transfer gold to another player on ${networkName}`,
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
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse: "send 100 gold to 0x..."
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*gold/i)

    if (!addressMatch || !amountMatch) {
      await callback?.({
        text: "Please specify the recipient address and amount. Example: 'Send 100 gold to 0x1234...'",
      })
      return
    }

    const to = addressMatch[0] as Address
    const amount = parseEther(amountMatch[1])

    const txHash = await sdk.games.transferGold({ to, amount })

    await callback?.({
      text: `Transferred ${amountMatch[1]} GOLD to ${to}\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Send 100 gold to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        },
      },
      {
        name: 'assistant',
        content: { text: 'Transferred 100 GOLD. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Get Item Balance
// ============================================================================

export const getItemBalanceAction: Action = {
  name: 'GET_ITEM_BALANCE',
  similes: ['item balance', 'check items', 'my items', 'inventory'],
  description: `Check item balance in the game on ${networkName}`,
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
    const sdk = service.getClient()

    const text = getOptionalMessageText(message) // Item ID is optional, shows all items if not provided

    // Try to parse item ID
    const itemIdMatch =
      text.match(/item\s*#?(\d+)/i) ?? text.match(/id\s*(\d+)/i)

    if (itemIdMatch) {
      const itemId = BigInt(itemIdMatch[1])
      const balance = await sdk.games.getItemBalance(itemId)
      const uri = await sdk.games.getItemUri(itemId)

      await callback?.({
        text: `Item #${itemId}:
- Balance: ${balance.toString()}
- URI: ${uri}`,
      })
    } else {
      // Show multiple item balances
      const commonItems = [1n, 2n, 3n, 4n, 5n]
      const balances = await sdk.games.getItemBalances(commonItems)

      const itemList = commonItems
        .map((id, i) => `- Item #${id}: ${balances[i].toString()}`)
        .join('\n')

      await callback?.({
        text: `Your Item Inventory:\n${itemList}`,
      })
    }

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Check my items' },
      },
      {
        name: 'assistant',
        content: { text: 'Your Item Inventory:\n- Item #1: 5\n- Item #2: 3' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Transfer Item
// ============================================================================

export const transferItemAction: Action = {
  name: 'TRANSFER_ITEM',
  similes: ['send item', 'transfer item', 'give item'],
  description: `Transfer an item to another player on ${networkName}`,
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
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse: "send 5 of item #1 to 0x..."
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)
    const itemMatch = text.match(/item\s*#?(\d+)/i)
    const amountMatch = text.match(/(\d+)\s*(of|x)?/i)

    if (!addressMatch || !itemMatch) {
      await callback?.({
        text: "Please specify the item ID, amount, and recipient. Example: 'Send 5 of item #1 to 0x1234...'",
      })
      return
    }

    if (!amountMatch) {
      await callback?.({
        text: "Please specify the amount. Example: 'Send 5 of item #1 to 0x1234...'",
      })
      return
    }

    const to = addressMatch[0] as Address
    const itemId = BigInt(itemMatch[1])
    const amount = BigInt(amountMatch[1])

    const txHash = await sdk.games.transferItem({ to, itemId, amount })

    await callback?.({
      text: `Transferred ${amount} of Item #${itemId} to ${to}\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Send 5 of item #1 to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        },
      },
      {
        name: 'assistant',
        content: { text: 'Transferred 5 of Item #1. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Link Agent ID
// ============================================================================

export const linkAgentAction: Action = {
  name: 'LINK_GAME_AGENT',
  similes: ['link agent', 'connect agent', 'register with game'],
  description: `Link your agent ID to the game integration contract on ${networkName}`,
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
    const sdk = service.getClient()

    const text = getMessageText(message)

    const agentIdMatch =
      text.match(/agent\s*#?(\d+)/i) ?? text.match(/id\s*(\d+)/i)

    if (!agentIdMatch) {
      await callback?.({
        text: "Please specify the agent ID to link. Example: 'Link agent #123'",
      })
      return
    }

    const agentId = BigInt(agentIdMatch[1])
    const txHash = await sdk.games.linkAgentId(agentId)

    await callback?.({
      text: `Linked Agent #${agentId} to game contract.\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Link agent #123 to the game' },
      },
      {
        name: 'assistant',
        content: { text: 'Linked Agent #123. Transaction: 0x...' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Get Game Stats
// ============================================================================

export const getGameStatsAction: Action = {
  name: 'GET_GAME_STATS',
  similes: ['game stats', 'game statistics', 'game info', 'server stats'],
  description: `Get overall game statistics from ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const stats = await sdk.games.getGameStats()
    const contracts = await sdk.games.getContracts()

    await callback?.({
      text: `Game Statistics:
- Total Players: ${stats.totalPlayers.toString()}
- Total Items: ${stats.totalItems.toString()}
- Total Gold Supply: ${formatEther(stats.totalGoldSupply)} GOLD
- Game Agent ID: ${stats.gameAgentId.toString()}

Game Contracts:
- GameIntegration: ${contracts.gameIntegration}
- Gold: ${contracts.gold}
- Items: ${contracts.items}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Show me the game stats' },
      },
      {
        name: 'assistant',
        content: {
          text: 'Game Statistics:\n- Total Players: 1000\n- Total Gold Supply: 1000000 GOLD',
        },
      },
    ],
  ] as ActionExample[][],
}
