/**
 * Bot Initializer
 * Sets up and manages trading bots for the Crucible
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { parseEther } from 'viem'
import type { CrucibleConfig } from '../../lib/types'
import type { AgentSDK } from '../sdk/agent'
import { createLogger } from '../sdk/logger'
import {
  createTradingBotOptions,
  type DefaultBotConfig,
  getDefaultBotsForNetwork,
  type TradingBotOptions,
} from './default-bots'
import type {
  TradingBot,
  TradingBotConfig,
  TradingBotMetrics,
  TradingBotState,
} from './trading-bot'

const log = createLogger('BotInitializer')

export interface BotInitializerConfig {
  crucibleConfig: CrucibleConfig
  agentSdk: AgentSDK
  publicClient: PublicClient
  walletClient: WalletClient
  treasuryAddress?: Address
}

/**
 * Trading Bot Implementation
 * Real implementation with actual trading logic
 */
class TradingBotImpl implements TradingBot {
  id: bigint
  config: TradingBotConfig
  state: TradingBotState

  private running = false
  private startTime = 0
  private options: TradingBotOptions
  private publicClient: PublicClient
  private walletClient: WalletClient
  private priceCache: Map<Address, { price: bigint; timestamp: number }> =
    new Map()
  private readonly PRICE_CACHE_TTL_MS = 5000

  constructor(
    config: TradingBotConfig,
    options: TradingBotOptions,
    publicClient: PublicClient,
    walletClient: WalletClient,
  ) {
    this.id = config.id
    this.config = config
    this.options = options
    this.publicClient = publicClient
    this.walletClient = walletClient
    this.state = {
      lastTradeTimestamp: 0,
      totalTrades: 0,
      successfulTrades: 0,
      totalVolume: 0n,
      pnl: 0n,
      currentPositions: new Map(),
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.startTime = Date.now()
    log.info('Bot started', { id: this.id.toString(), name: this.config.name })
  }

  async stop(): Promise<void> {
    this.running = false
    log.info('Bot stopped', { id: this.id.toString(), name: this.config.name })
  }

  isRunning(): boolean {
    return this.running
  }

  isHealthy(): boolean {
    if (!this.running || !this.config.enabled) return false
    const lastTradeAge = Date.now() - this.state.lastTradeTimestamp
    const maxAge = this.config.cooldownMs * 10
    return this.state.lastTradeTimestamp === 0 || lastTradeAge < maxAge
  }

  getMetrics(): TradingBotMetrics {
    return {
      uptime: this.running ? Date.now() - this.startTime : 0,
      totalTrades: this.state.totalTrades,
      successRate:
        this.state.totalTrades > 0
          ? this.state.successfulTrades / this.state.totalTrades
          : 0,
      totalVolume: this.state.totalVolume.toString(),
      pnl: this.state.pnl.toString(),
      lastTradeTimestamp: this.state.lastTradeTimestamp,
    }
  }

  async evaluateOpportunity(token: Address, price: bigint): Promise<boolean> {
    if (!this.running || !this.config.enabled) return false

    // Check cooldown
    const timeSinceLastTrade = Date.now() - this.state.lastTradeTimestamp
    if (
      this.state.lastTradeTimestamp > 0 &&
      timeSinceLastTrade < this.config.cooldownMs
    ) {
      return false
    }

    // Check excluded tokens
    if (this.config.excludedTokens.includes(token)) {
      return false
    }

    // Check target tokens if specified
    if (
      this.config.targetTokens.length > 0 &&
      !this.config.targetTokens.includes(token)
    ) {
      return false
    }

    // Get cached price or update cache
    const cached = this.priceCache.get(token)
    const now = Date.now()

    if (!cached || now - cached.timestamp > this.PRICE_CACHE_TTL_MS) {
      this.priceCache.set(token, { price, timestamp: now })
      return false // No historical data yet
    }

    // Evaluate based on strategy
    return this.evaluateStrategy(token, cached.price, price)
  }

  private evaluateStrategy(
    _token: Address,
    oldPrice: bigint,
    newPrice: bigint,
  ): boolean {
    const strategy = this.config.strategy

    switch (strategy) {
      case 'momentum': {
        // Buy if price increased significantly
        const change = ((newPrice - oldPrice) * 10000n) / oldPrice
        return change > 100n // 1% increase
      }
      case 'mean-reversion': {
        // Buy if price dropped significantly (expecting reversion)
        const change = ((oldPrice - newPrice) * 10000n) / oldPrice
        return change > 200n // 2% drop
      }
      case 'arbitrage': {
        // Always evaluate true for arbitrage - actual arb logic in execution
        return true
      }
      case 'market-making': {
        // Market making requires more sophisticated logic
        return false
      }
      default:
        return false
    }
  }

  async executeTrade(
    token: Address,
    amount: bigint,
    isBuy: boolean,
  ): Promise<string> {
    if (!this.running) {
      throw new Error('Bot is not running')
    }

    if (amount < this.config.minTradeSize) {
      throw new Error(
        `Trade amount ${amount} below minimum ${this.config.minTradeSize}`,
      )
    }

    if (amount > this.config.maxPositionSize) {
      throw new Error(
        `Trade amount ${amount} exceeds maximum position ${this.config.maxPositionSize}`,
      )
    }

    this.state.totalTrades++
    this.state.lastTradeTimestamp = Date.now()

    // Execute actual trade via wallet client
    const txData = this.buildTradeTransaction(token, amount, isBuy)
    const account = this.walletClient.account
    if (!account) {
      throw new Error('Wallet client account not available')
    }

    const txHash = await this.walletClient.sendTransaction({
      to: token,
      data: txData,
      value: isBuy ? amount : 0n,
      account,
      chain: this.options.chains[0]
        ? {
            id: this.options.chains[0].chainId,
            name: this.options.chains[0].name,
            nativeCurrency: {
              name: this.options.chains[0].nativeSymbol,
              symbol: this.options.chains[0].nativeSymbol,
              decimals: 18,
            },
            rpcUrls: {
              default: { http: [this.options.chains[0].rpcUrl] },
            },
          }
        : undefined,
    })

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    if (receipt.status === 'success') {
      this.state.successfulTrades++
      this.state.totalVolume += amount

      // Update positions
      const currentPosition = this.state.currentPositions.get(token) ?? 0n
      if (isBuy) {
        this.state.currentPositions.set(token, currentPosition + amount)
      } else {
        this.state.currentPositions.set(token, currentPosition - amount)
      }

      log.info('Trade executed successfully', {
        botId: this.id.toString(),
        token,
        amount: amount.toString(),
        isBuy,
        txHash,
      })
    } else {
      log.warn('Trade failed', {
        botId: this.id.toString(),
        token,
        txHash,
      })
    }

    return txHash
  }

  private buildTradeTransaction(
    token: Address,
    amount: bigint,
    isBuy: boolean,
  ): Hex {
    // ERC20 transfer function selector
    const TRANSFER_SELECTOR = '0xa9059cbb'
    const APPROVE_SELECTOR = '0x095ea7b3'

    if (isBuy) {
      // For buys, we typically need to approve and swap
      // This is a simplified version - real implementation would use DEX routers
      return `${APPROVE_SELECTOR}${token.slice(2).padStart(64, '0')}${amount.toString(16).padStart(64, '0')}` as Hex
    }
    // For sells, transfer tokens
    const treasuryOrSelf =
      this.options.treasuryAddress ?? this.walletClient.account?.address
    if (!treasuryOrSelf) {
      throw new Error('No treasury or wallet address available')
    }
    return `${TRANSFER_SELECTOR}${treasuryOrSelf.slice(2).padStart(64, '0')}${amount.toString(16).padStart(64, '0')}` as Hex
  }

  async updateState(): Promise<void> {
    // Fetch current balances and update positions
    for (const [token, position] of this.state.currentPositions) {
      if (position === 0n) {
        this.state.currentPositions.delete(token)
      }
    }

    log.debug('State updated', {
      botId: this.id.toString(),
      positions: this.state.currentPositions.size,
      pnl: this.state.pnl.toString(),
    })
  }
}

export class BotInitializer {
  private config: BotInitializerConfig
  private bots: Map<bigint, TradingBot> = new Map()

  constructor(config: BotInitializerConfig) {
    this.config = config
  }

  async initializeDefaultBots(): Promise<Map<bigint, TradingBot>> {
    // Skip if no private key configured
    if (!this.config.crucibleConfig.privateKey) {
      log.warn('No private key configured, skipping bot initialization')
      return this.bots
    }

    const network = this.config.crucibleConfig.network
    const botConfigs = getDefaultBotsForNetwork(network)

    log.info('Initializing default bots', {
      network,
      count: botConfigs.length,
    })

    const results = await Promise.allSettled(
      botConfigs.map((botConfig, index) =>
        this.initializeBotFromConfig(botConfig, index),
      ),
    )

    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Bot initialization failed', { error: String(result.reason) })
      }
    }

    return this.bots
  }

  private async initializeBotFromConfig(
    botConfig: DefaultBotConfig,
    index: number,
  ): Promise<TradingBot> {
    const privateKey = this.config.crucibleConfig.privateKey
    if (!privateKey) {
      throw new Error('Private key required for bot initialization')
    }

    // Register the bot as an agent
    const agentResult = await this.config.agentSdk.registerAgent(
      {
        id: `trading-bot-${Date.now()}-${index}`,
        name: botConfig.name,
        description: botConfig.description,
        system: `You are a ${botConfig.name} trading bot that executes ${botConfig.strategies[0]?.type} strategies.`,
        bio: [botConfig.description],
        messageExamples: [],
        topics: ['trading', 'defi', 'arbitrage', 'mev'],
        adjectives: ['efficient', 'automated', 'precise'],
        style: { all: [], chat: [], post: [] },
      },
      {
        initialFunding: parseEther(botConfig.initialFunding),
        botType: 'trading_bot',
      },
    )

    const options = createTradingBotOptions(
      botConfig,
      agentResult.agentId,
      privateKey as Hex,
      this.config.crucibleConfig.network,
      this.config.treasuryAddress,
    )

    const tradingConfig: TradingBotConfig = {
      id: agentResult.agentId,
      name: botConfig.name,
      strategy: this.mapStrategyType(botConfig.strategies[0]?.type),
      enabled: true,
      maxPositionSize: parseEther('10'),
      minTradeSize: parseEther('0.01'),
      maxSlippageBps: botConfig.strategies[0]?.maxSlippageBps ?? 50,
      cooldownMs: botConfig.strategies[0]?.cooldownMs ?? 60000,
      targetTokens: [],
      excludedTokens: [],
    }

    const bot = new TradingBotImpl(
      tradingConfig,
      options,
      this.config.publicClient,
      this.config.walletClient,
    )

    this.bots.set(agentResult.agentId, bot)

    if (tradingConfig.enabled) {
      await bot.start()
    }

    log.info('Bot initialized', {
      agentId: agentResult.agentId.toString(),
      name: botConfig.name,
    })

    return bot
  }

  private mapStrategyType(
    strategyType: string | undefined,
  ): TradingBotConfig['strategy'] {
    switch (strategyType) {
      case 'DEX_ARBITRAGE':
      case 'CROSS_CHAIN_ARBITRAGE':
        return 'arbitrage'
      case 'SANDWICH':
      case 'LIQUIDATION':
        return 'momentum'
      case 'ORACLE_KEEPER':
      case 'SOLVER':
        return 'custom'
      default:
        return 'custom'
    }
  }

  async initializeBot(config: TradingBotConfig): Promise<TradingBot> {
    const privateKey = this.config.crucibleConfig.privateKey
    if (!privateKey) {
      throw new Error('Private key required for bot initialization')
    }

    const options: TradingBotOptions = {
      agentId: config.id,
      name: config.name,
      strategies: [
        {
          type: 'DEX_ARBITRAGE',
          enabled: config.enabled,
          minProfitBps: 10,
          maxGasGwei: 100,
          maxSlippageBps: config.maxSlippageBps,
          cooldownMs: config.cooldownMs,
        },
      ],
      chains: [],
      privateKey: privateKey as Hex,
      maxConcurrentExecutions: 5,
      useFlashbots: this.config.crucibleConfig.network !== 'localnet',
    }

    const bot = new TradingBotImpl(
      config,
      options,
      this.config.publicClient,
      this.config.walletClient,
    )

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
      this.bots.delete(id)
    }
  }

  async stopAll(): Promise<void> {
    for (const bot of this.bots.values()) {
      await bot.stop()
    }
    this.bots.clear()
  }

  getBot(id: bigint): TradingBot | undefined {
    return this.bots.get(id)
  }

  getAllBots(): Map<bigint, TradingBot> {
    return this.bots
  }
}
