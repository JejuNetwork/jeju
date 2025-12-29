/**
 * Bot Initializer
 * Sets up and manages trading bots for the Crucible
 */

import type { Address, Hex, PublicClient } from 'viem'
import { encodeFunctionData, parseAbi, parseEther } from 'viem'
import type { CrucibleConfig } from '../../lib/types'
import type { AgentSDK } from '../sdk/agent'
import type { KMSSigner } from '../sdk/kms-signer'
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

// Standard DEX Router ABIs for actual swaps
const UNISWAP_V2_ROUTER_ABI = parseAbi([
  'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
])

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
])

// Known DEX router addresses by chain
const DEX_ROUTERS: Record<number, Address> = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Ethereum Mainnet - Uniswap V2
  42161: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // Arbitrum - SushiSwap
  8453: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Base - Aerodrome
  10: '0x9c12939390052919aF3155f41Bf4160Fd3666A6f', // Optimism - Velodrome
  420691: '0x0000000000000000000000000000000000000000', // Jeju Network - placeholder
  31337: '0x0000000000000000000000000000000000000000', // Local Anvil
}

// WETH addresses by chain
const WETH_ADDRESSES: Record<number, Address> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  8453: '0x4200000000000000000000000000000000000006',
  10: '0x4200000000000000000000000000000000000006',
  420691: '0x0000000000000000000000000000000000000000',
  31337: '0x0000000000000000000000000000000000000000',
}

export interface BotInitializerConfig {
  crucibleConfig: CrucibleConfig
  agentSdk: AgentSDK
  publicClient: PublicClient
  /** KMS-backed signer for threshold signing */
  kmsSigner: KMSSigner
  treasuryAddress?: Address
}

/**
 * Trading Bot Implementation
 * Real implementation with actual trading logic
 *
 * SECURITY: Uses KMS-backed signing in production.
 * Private keys are NEVER stored in this class.
 */
class TradingBotImpl implements TradingBot {
  id: bigint
  config: TradingBotConfig
  state: TradingBotState

  private running = false
  private startTime = 0
  private options: TradingBotOptions
  private publicClient: PublicClient
  private kmsSigner: KMSSigner
  private priceCache: Map<Address, { price: bigint; timestamp: number }> =
    new Map()
  private readonly PRICE_CACHE_TTL_MS = 5000

  constructor(
    config: TradingBotConfig,
    options: TradingBotOptions,
    publicClient: PublicClient,
    kmsSigner: KMSSigner,
  ) {
    this.id = config.id
    this.config = config
    this.options = options
    this.publicClient = publicClient
    this.kmsSigner = kmsSigner
    this.state = {
      lastTradeTimestamp: 0,
      totalTrades: 0,
      successfulTrades: 0,
      totalVolume: 0n,
      pnl: 0n,
      currentPositions: new Map(),
    }
  }

  /**
   * Execute a transaction using KMS
   */
  private async executeTransaction(params: {
    to: Address
    data: Hex
    value?: bigint
  }): Promise<Hex> {
    if (!this.kmsSigner.isInitialized()) {
      throw new Error('KMS signer not initialized')
    }
    return this.kmsSigner.signTransaction({
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
    })
  }

  /**
   * Get the signer's address
   */
  private getSignerAddress(): Address {
    if (!this.kmsSigner.isInitialized()) {
      throw new Error('KMS signer not initialized')
    }
    return this.kmsSigner.getAddress()
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

    // Get signer address (from KMS or wallet)
    const signerAddress = this.getSignerAddress()

    const chainId = this.options.chains[0]?.chainId ?? 1
    const routerAddress = DEX_ROUTERS[chainId]
    const wethAddress = WETH_ADDRESSES[chainId]

    if (
      !routerAddress ||
      routerAddress === '0x0000000000000000000000000000000000000000'
    ) {
      throw new Error(`No DEX router configured for chain ${chainId}`)
    }

    if (
      !wethAddress ||
      wethAddress === '0x0000000000000000000000000000000000000000'
    ) {
      throw new Error(`No WETH address configured for chain ${chainId}`)
    }

    this.state.totalTrades++
    this.state.lastTradeTimestamp = Date.now()

    const _chain = this.options.chains[0]
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
      : undefined

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800) // 30 minutes
    const recipient = this.options.treasuryAddress ?? signerAddress
    const slippageBps = BigInt(this.config.maxSlippageBps)

    let txHash: Hex

    if (isBuy) {
      // Buy: Swap ETH for tokens using swapExactETHForTokens
      // Calculate minimum output with slippage
      const amountOutMin = (amount * (10000n - slippageBps)) / 10000n

      const swapData = encodeFunctionData({
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [
          amountOutMin,
          [wethAddress, token] as readonly Address[],
          recipient,
          deadline,
        ],
      })

      log.info('Executing buy swap', {
        botId: this.id.toString(),
        token,
        amountIn: amount.toString(),
        amountOutMin: amountOutMin.toString(),
        router: routerAddress,
      })

      txHash = await this.executeTransaction({
        to: routerAddress,
        data: swapData,
        value: amount,
      })
    } else {
      // Sell: Swap tokens for ETH using swapExactTokensForETH
      // First approve the router to spend tokens
      const currentAllowance = await this.publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [signerAddress, routerAddress],
      })

      if (currentAllowance < amount) {
        log.info('Approving router for token spend', {
          token,
          amount: amount.toString(),
          router: routerAddress,
        })

        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [routerAddress, amount],
        })

        const approveTxHash = await this.executeTransaction({
          to: token,
          data: approveData,
        })

        await this.publicClient.waitForTransactionReceipt({
          hash: approveTxHash,
        })
      }

      // Calculate minimum output with slippage
      const amountOutMin = (amount * (10000n - slippageBps)) / 10000n

      const swapData = encodeFunctionData({
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [
          amount,
          amountOutMin,
          [token, wethAddress] as readonly Address[],
          recipient,
          deadline,
        ],
      })

      log.info('Executing sell swap', {
        botId: this.id.toString(),
        token,
        amountIn: amount.toString(),
        amountOutMin: amountOutMin.toString(),
        router: routerAddress,
      })

      txHash = await this.executeTransaction({
        to: routerAddress,
        data: swapData,
      })
    }

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
    // Skip if no KMS signer configured
    if (!this.config.kmsSigner?.isInitialized()) {
      log.warn('No KMS signer configured, skipping bot initialization')
      return this.bots
    }
    log.info('Using KMS-backed signing for trading bots')

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
    // Verify we have a KMS signer
    if (!this.config.kmsSigner?.isInitialized()) {
      throw new Error('KMS signer required for bot initialization')
    }

    // Register the bot as an agent
    const agentResult = await this.config.agentSdk.registerAgent(
      {
        id: `trading-bot-${Date.now()}-${index}`,
        name: botConfig.name,
        description: botConfig.description,
        system: `You are a ${botConfig.name} trading bot that executes ${botConfig.strategies[0].type} strategies.`,
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

    // Create options - signing is handled by KMS
    const options = createTradingBotOptions(
      botConfig,
      agentResult.agentId,
      this.config.crucibleConfig.network,
      this.config.treasuryAddress,
    )

    const tradingConfig: TradingBotConfig = {
      id: agentResult.agentId,
      name: botConfig.name,
      strategy: this.mapStrategyType(botConfig.strategies[0].type),
      enabled: true,
      maxPositionSize: parseEther('10'),
      minTradeSize: parseEther('0.01'),
      maxSlippageBps: botConfig.strategies[0].maxSlippageBps ?? 50,
      cooldownMs: botConfig.strategies[0].cooldownMs ?? 60000,
      targetTokens: [],
      excludedTokens: [],
    }

    const bot = new TradingBotImpl(
      tradingConfig,
      options,
      this.config.publicClient,
      this.config.kmsSigner,
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
    // Verify we have a KMS signer
    if (!this.config.kmsSigner?.isInitialized()) {
      throw new Error('KMS signer required for bot initialization')
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
      maxConcurrentExecutions: 5,
      useFlashbots: this.config.crucibleConfig.network !== 'localnet',
    }

    const bot = new TradingBotImpl(
      config,
      options,
      this.config.publicClient,
      this.config.kmsSigner,
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
