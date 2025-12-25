/**
 * Bot Initializer
 * Sets up and manages trading bots for the Crucible
 */

import { type Address, erc20Abi, type PublicClient, type WalletClient } from 'viem'
import type { CrucibleConfig } from '../../lib/types'
import type { AgentSDK } from '../sdk/agent'
import type { TradingBot, TradingBotConfig } from './trading-bot'

export interface BotInitializerConfig {
  crucibleConfig: CrucibleConfig
  agentSdk: AgentSDK
  publicClient: PublicClient
  walletClient: WalletClient
  treasuryAddress?: Address
}

export class BotInitializer {
  private config: BotInitializerConfig
  private bots: Map<bigint, TradingBot> = new Map()

  constructor(config: BotInitializerConfig) {
    this.config = config
  }

  async initializeDefaultBots(): Promise<Map<bigint, TradingBot>> {
    // Initialize default trading bots based on config
    const defaultConfigs: TradingBotConfig[] = [
      {
        id: 1n,
        name: 'Momentum Bot',
        strategy: 'momentum',
        enabled: true,
        maxPositionSize: 10000000000000000000n, // 10 ETH
        minTradeSize: 100000000000000000n, // 0.1 ETH
        maxSlippageBps: 50, // 0.5%
        cooldownMs: 60_000,
        targetTokens: [],
        excludedTokens: [],
      },
      {
        id: 2n,
        name: 'Arbitrage Bot',
        strategy: 'arbitrage',
        enabled: true,
        maxPositionSize: 50000000000000000000n, // 50 ETH
        minTradeSize: 1000000000000000000n, // 1 ETH
        maxSlippageBps: 10, // 0.1%
        cooldownMs: 5_000,
        targetTokens: [],
        excludedTokens: [],
      },
    ]

    for (const botConfig of defaultConfigs) {
      const bot = this.createBot(botConfig)
      this.bots.set(botConfig.id, bot)

      if (botConfig.enabled) {
        await bot.start()
      }
    }

    return this.bots
  }

  async initializeBot(config: TradingBotConfig): Promise<TradingBot> {
    const bot = this.createBot(config)
    this.bots.set(config.id, bot)

    if (config.enabled) {
      await bot.start()
    }

    return bot
  }

  async stopBot(id: bigint): Promise<void> {
    const bot = this.bots.get(id)
    if (bot) {
      await bot.stop()
    }
  }

  async stopAll(): Promise<void> {
    for (const bot of this.bots.values()) {
      await bot.stop()
    }
  }

  getBot(id: bigint): TradingBot | undefined {
    return this.bots.get(id)
  }

  getAllBots(): Map<bigint, TradingBot> {
    return this.bots
  }

  private createBot(botConfig: TradingBotConfig): TradingBot {
    const { publicClient, walletClient } = this.config
    let running = false
    const startTime = Date.now()

    const state: TradingBot['state'] = {
      lastTradeTimestamp: 0,
      totalTrades: 0,
      successfulTrades: 0,
      totalVolume: 0n,
      pnl: 0n,
      currentPositions: new Map(),
    }

    const bot: TradingBot = {
      id: botConfig.id,
      config: botConfig,
      state,

      async start() {
        running = true
        console.log(`[Bot] Started: ${botConfig.name}`)
      },

      async stop() {
        running = false
        console.log(`[Bot] Stopped: ${botConfig.name}`)
      },

      isRunning() {
        return running
      },

      isHealthy() {
        return running && botConfig.enabled
      },

      getMetrics() {
        return {
          uptime: running ? Date.now() - startTime : 0,
          totalTrades: state.totalTrades,
          successRate:
            state.totalTrades > 0
              ? state.successfulTrades / state.totalTrades
              : 0,
          totalVolume: state.totalVolume.toString(),
          pnl: state.pnl.toString(),
          lastTradeTimestamp: state.lastTradeTimestamp,
        }
      },

      async evaluateOpportunity(token: Address, price: bigint) {
        const account = walletClient.account
        if (!account) return false
        
        // Check if price meets minimum trade size
        if (price < botConfig.minTradeSize) return false
        if (price > botConfig.maxPositionSize) return false
        
        // Check token balance to see if we have enough to trade
        const tokenBalance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        })
        
        // Check ETH balance for gas
        const ethBalance = await publicClient.getBalance({ address: account.address })
        const hasGas = ethBalance > 0n
        const hasTokens = tokenBalance > 0n
        
        return hasGas && hasTokens
      },

      async executeTrade(token: Address, amount: bigint, isBuy: boolean) {
        const account = walletClient.account
        if (!account) throw new Error('Wallet account required for trade execution')
        
        // Check cooldown
        const timeSinceLastTrade = Date.now() - state.lastTradeTimestamp
        if (timeSinceLastTrade < botConfig.cooldownMs) {
          throw new Error(`Cooldown active: ${botConfig.cooldownMs - timeSinceLastTrade}ms remaining`)
        }
        
        // Validate amount against config limits
        if (amount < botConfig.minTradeSize) {
          throw new Error(`Trade amount ${amount} below minimum ${botConfig.minTradeSize}`)
        }
        if (amount > botConfig.maxPositionSize) {
          throw new Error(`Trade amount ${amount} exceeds max position ${botConfig.maxPositionSize}`)
        }
        
        // TODO: Integrate with DEX router (Uniswap, etc.)
        // For now, this is a direct ERC20 transfer placeholder
        const txHash = isBuy
          ? await walletClient.writeContract({
              address: token,
              abi: erc20Abi,
              functionName: 'transfer',
              args: [account.address, amount],
              account,
              chain: walletClient.chain,
            })
          : await walletClient.writeContract({
              address: token,
              abi: erc20Abi,
              functionName: 'transfer',
              args: [token, amount], // Placeholder - real impl would send to DEX
              account,
              chain: walletClient.chain,
            })
        
        state.totalTrades++
        state.successfulTrades++
        state.totalVolume += amount
        state.lastTradeTimestamp = Date.now()
        
        return txHash
      },

      async updateState() {
        // Refresh positions from chain
      },
    }

    return bot
  }
}
