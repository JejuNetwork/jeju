/**
 * Unified MEV + Liquidity Management Bot
 *
 * Combines all profit strategies into a single unified bot:
 * - DEX Arbitrage (same-chain)
 * - Cross-Chain Arbitrage (EVM <-> Solana)
 * - Sandwich (pending block analysis)
 * - Liquidations (lending protocol monitoring)
 * - Liquidity Management (LP optimization)
 * - Solver/Intent Settlement
 *
 * Features:
 * - Multi-chain support (EVM + Solana)
 * - Automatic strategy selection
 * - Risk management
 * - Treasury management
 * - Real-time monitoring via A2A/MCP/REST APIs
 */

import { EventEmitter } from 'node:events'
import { Connection, Keypair } from '@solana/web3.js'
import { type Address, createPublicClient, http } from 'viem'
import { createLogger } from '../sdk/logger'
import type {
  ArbitrageOpportunity,
  ChainId,
  CrossChainArbOpportunity,
  StrategyConfig,
  StrategyType,
} from './autocrat-types'
// Contract integrations (EIL/XLP/OIF)
import {
  type LiquidityRequest,
  type XLPConfig,
  XLPManager,
  type XLPProfile,
} from './contracts/eil-xlp'
import {
  OIFSolver,
  type OIFSolverConfig,
  type OpenIntent,
} from './contracts/oif-solver'
import { RiskManager } from './engine/risk-manager'
import { SolanaDexAggregator } from './solana/dex-adapters'
import { CrossChainArbStrategy } from './strategies/cross-chain-arb'
// Strategy imports
import { DexArbitrageStrategy } from './strategies/dex-arbitrage'
import {
  LiquidityManager,
  type LiquidityManagerConfig,
  type RebalanceAction,
  type UnifiedPosition,
} from './strategies/liquidity-manager'
import { SolanaArbStrategy } from './strategies/solana-arb'
import {
  type YieldFarmingConfig,
  YieldFarmingStrategy,
  type YieldOpportunity,
} from './strategies/yield-farming'

const log = createLogger('UnifiedBot')

// ============ Types ============

export interface UnifiedBotConfig {
  // Chain configuration
  evmChains: ChainId[]
  solanaNetwork: 'mainnet-beta' | 'devnet' | 'localnet'

  // Wallet configuration
  evmPrivateKey?: string
  solanaPrivateKey?: string

  // Strategy configuration
  enableArbitrage: boolean
  enableCrossChain: boolean
  enableSolanaArb: boolean
  enableLiquidity: boolean
  enableSandwich: boolean
  enableLiquidation: boolean
  enableSolver: boolean
  enableXLP: boolean // Cross-chain Liquidity Provider mode
  enableYieldFarming: boolean // Cross-chain yield optimization

  // Risk parameters
  minProfitBps: number
  maxPositionSize: bigint
  maxSlippageBps: number
  maxGasPrice: bigint
  maxGasGwei?: number

  // LP parameters
  lpConfig?: Partial<LiquidityManagerConfig>

  // XLP parameters (FederatedLiquidity integration)
  xlpConfig?: Partial<XLPConfig>

  // OIF Solver parameters
  oifSolverName?: string

  // Yield farming parameters
  yieldFarmingConfig?: Partial<YieldFarmingConfig>
}

export interface BotStats {
  uptime: number
  totalProfitUsd: number
  totalTrades: number
  successRate: number
  activeStrategies: string[]
  pendingOpportunities: number
  liquidityPositions: number
  lastTradeAt: number
  // XLP stats
  xlpActive: boolean
  xlpTotalEarned: string
  xlpPendingRequests: number
  // OIF stats
  oifActive: boolean
  oifOpenIntents: number
  oifProfitableIntents: number
  // Yield farming stats
  yieldFarmingActive: boolean
  yieldOpportunities: number
  avgYieldApr: number
}

export interface TradeResult {
  id: string
  strategy: string
  chain: 'evm' | 'solana'
  chainId: ChainId | string
  txHash: string
  profitUsd: number
  gasUsed: bigint
  timestamp: number
  success: boolean
  error?: string
}

// ============ Unified Bot ============

export class UnifiedBot extends EventEmitter {
  private config: UnifiedBotConfig
  private startTime: number = 0
  private running = false

  // Solana
  private solanaConnection: Connection | null = null
  private solanaKeypair: Keypair | null = null
  private solanaDex: SolanaDexAggregator | null = null

  // Strategies
  private dexArb: Map<ChainId, DexArbitrageStrategy> = new Map()
  private crossChainArb: CrossChainArbStrategy | null = null
  private solanaArb: SolanaArbStrategy | null = null
  private liquidityManager: LiquidityManager | null = null
  private yieldFarming: YieldFarmingStrategy | null = null

  // Cross-chain integrations (EIL/XLP/OIF)
  private xlpManagers: Map<ChainId, XLPManager> = new Map()
  private oifSolver: OIFSolver | null = null
  private xlpProfile: XLPProfile | null = null

  // Stats
  private trades: TradeResult[] = []
  private totalProfitUsd = 0

  // Engine
  private riskManager: RiskManager | null = null

  constructor(config: UnifiedBotConfig) {
    super()
    this.config = config
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    log.info('Initializing Unified MEV + LP Bot', {
      evmChains: this.config.evmChains,
      solanaNetwork: this.config.solanaNetwork,
    })

    // Initialize Solana
    await this.initializeSolana()

    // Initialize EVM components
    await this.initializeEVM()

    // Initialize strategies
    await this.initializeStrategies()

    // Initialize engine
    await this.initializeEngine()

    log.info('Bot initialized successfully')
  }

  private async initializeSolana(): Promise<void> {
    const rpcUrls: Record<string, string> = {
      'mainnet-beta':
        process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      devnet: 'https://api.devnet.solana.com',
      localnet: 'http://127.0.0.1:8899',
    }

    const rpcUrl = rpcUrls[this.config.solanaNetwork]
    this.solanaConnection = new Connection(rpcUrl, 'confirmed')

    if (this.config.solanaPrivateKey) {
      const secretKey = Buffer.from(this.config.solanaPrivateKey, 'base64')
      this.solanaKeypair = Keypair.fromSecretKey(secretKey)
      console.log(
        `   Solana wallet: ${this.solanaKeypair.publicKey.toBase58()}`,
      )
    }

    this.solanaDex = new SolanaDexAggregator(this.solanaConnection)

    const slot = await this.solanaConnection.getSlot()
    log.info('Solana slot', { slot })
  }

  private async initializeEVM(): Promise<void> {
    for (const chainId of this.config.evmChains) {
      const rpcUrl = process.env[`RPC_URL_${chainId}`]
      if (!rpcUrl) {
        console.warn(`   ⚠️ No RPC URL for chain ${chainId}`)
        continue
      }

      const client = createPublicClient({ transport: http(rpcUrl) })
      const block = await client.getBlockNumber()
      console.log(`   Chain ${chainId} at block ${block}`)
    }
  }

  private async initializeStrategies(): Promise<void> {
    const baseStrategyConfig = (type: StrategyType): StrategyConfig => ({
      type,
      enabled: true,
      minProfitBps: this.config.minProfitBps,
      maxGasGwei: 100,
      maxSlippageBps: this.config.maxSlippageBps,
    })

    // DEX Arbitrage (per chain)
    if (this.config.enableArbitrage) {
      for (const chainId of this.config.evmChains) {
        const strategy = new DexArbitrageStrategy(
          chainId,
          baseStrategyConfig('DEX_ARBITRAGE'),
        )
        this.dexArb.set(chainId, strategy)
      }
      log.info('DEX Arbitrage enabled')
    }

    // Cross-Chain Arbitrage
    if (this.config.enableCrossChain) {
      this.crossChainArb = new CrossChainArbStrategy(
        this.config.evmChains,
        baseStrategyConfig('CROSS_CHAIN_ARBITRAGE'),
      )
      console.log('   ✓ Cross-Chain Arbitrage enabled')
    }

    // Solana Arbitrage
    if (this.config.enableSolanaArb && this.solanaConnection) {
      this.solanaArb = new SolanaArbStrategy(
        baseStrategyConfig('CROSS_CHAIN_ARBITRAGE'),
        this.config.evmChains,
      )
      await this.solanaArb.initialize(
        this.solanaConnection.rpcEndpoint,
        this.config.solanaPrivateKey,
      )
      log.info('Solana Arbitrage enabled')
    }

    // Liquidity Management
    if (this.config.enableLiquidity) {
      const lpConfig: LiquidityManagerConfig = {
        type: 'LIQUIDITY',
        enabled: true,
        minProfitBps: this.config.minProfitBps,
        maxGasGwei: this.config.maxGasGwei ?? 100,
        maxSlippageBps: this.config.maxSlippageBps,
        evmChains: this.config.evmChains,
        solanaNetwork: this.config.solanaNetwork,
        rebalanceThresholdPercent: 5,
        minPositionValueUsd: 100,
        maxPositionValueUsd: 100000,
        autoCompound: true,
        autoRebalance: false, // Manual approval
        targetAprPercent: 20,
        ...this.config.lpConfig,
      }

      this.liquidityManager = new LiquidityManager(lpConfig)
      await this.liquidityManager.initialize({
        solanaRpcUrl: this.solanaConnection?.rpcEndpoint,
        solanaPrivateKey: this.config.solanaPrivateKey,
      })
      console.log('   ✓ Liquidity Management enabled')
    }

    // XLP (Cross-chain Liquidity Provider) integration
    if (
      this.config.enableXLP &&
      this.config.evmPrivateKey &&
      this.config.xlpConfig
    ) {
      log.info('Initializing XLP (Cross-chain Liquidity Provider)')

      for (const chainId of this.config.evmChains) {
        const rpcUrl = process.env[`RPC_URL_${chainId}`]
        const federatedLiquidity = process.env[
          `FEDERATED_LIQUIDITY_${chainId}`
        ] as Address | undefined
        const liquidityAggregator = process.env[
          `LIQUIDITY_AGGREGATOR_${chainId}`
        ] as Address | undefined

        if (rpcUrl && federatedLiquidity && liquidityAggregator) {
          const xlpManager = new XLPManager({
            chainId,
            rpcUrl,
            privateKey: this.config.evmPrivateKey,
            federatedLiquidityAddress: federatedLiquidity,
            liquidityAggregatorAddress: liquidityAggregator,
          })

          this.xlpManagers.set(chainId, xlpManager)

          // Check if already registered as XLP
          const profile = await xlpManager.getXLPProfile()
          if (profile) {
            this.xlpProfile = profile
            console.log(
              `   Chain ${chainId}: XLP active, earned ${profile.totalEarned} total`,
            )
          } else {
            console.log(`   Chain ${chainId}: Not registered as XLP`)
          }
        }
      }

      if (this.xlpManagers.size > 0) {
        log.info('XLP enabled', { chainCount: this.xlpManagers.size })
      }
    }

    // OIF Solver integration
    if (this.config.enableSolver && this.config.evmPrivateKey) {
      console.log('🔮 Initializing OIF Solver...')

      const chainConfigs: Partial<OIFSolverConfig['chainConfigs']> = {}

      for (const chainId of this.config.evmChains) {
        const rpcUrl = process.env[`RPC_URL_${chainId}`]
        const inputSettler = process.env[`OIF_INPUT_SETTLER_${chainId}`] as
          | Address
          | undefined
        const outputSettler = process.env[`OIF_OUTPUT_SETTLER_${chainId}`] as
          | Address
          | undefined
        const solverRegistry = process.env[`OIF_SOLVER_REGISTRY_${chainId}`] as
          | Address
          | undefined

        if (rpcUrl && inputSettler && outputSettler && solverRegistry) {
          chainConfigs[chainId] = {
            rpcUrl,
            inputSettlerAddress: inputSettler,
            outputSettlerAddress: outputSettler,
            solverRegistryAddress: solverRegistry,
          }
        }
      }

      if (Object.keys(chainConfigs).length > 0) {
        this.oifSolver = new OIFSolver({
          name: this.config.oifSolverName ?? 'jeju-unified-bot',
          chainConfigs: chainConfigs as OIFSolverConfig['chainConfigs'],
          privateKey: this.config.evmPrivateKey,
          minProfitBps: this.config.minProfitBps,
          maxSlippageBps: this.config.maxSlippageBps,
        })

        log.info('OIF Solver enabled', {
          chainCount: Object.keys(chainConfigs).length,
        })
      }
    }

    // Yield Farming Strategy
    if (this.config.enableYieldFarming) {
      console.log('🌾 Initializing Yield Farming Strategy...')

      const rpcUrls: Record<string, string> = {
        'mainnet-beta':
          process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
        devnet: 'https://api.devnet.solana.com',
        localnet: 'http://127.0.0.1:8899',
      }

      this.yieldFarming = new YieldFarmingStrategy({
        type: 'YIELD_FARMING',
        enabled: true,
        maxGasGwei: 100,
        chains: this.config.evmChains,
        solanaNetwork: this.config.solanaNetwork,
        minApr: this.config.yieldFarmingConfig?.minApr ?? 1,
        maxRiskScore: this.config.yieldFarmingConfig?.maxRiskScore ?? 60,
        preferRealYield:
          this.config.yieldFarmingConfig?.preferRealYield ?? true,
        minTvl: this.config.yieldFarmingConfig?.minTvl ?? 1000000,
        maxPositionPercent:
          this.config.yieldFarmingConfig?.maxPositionPercent ?? 20,
        autoCompound: this.config.yieldFarmingConfig?.autoCompound ?? true,
        autoRebalance: this.config.yieldFarmingConfig?.autoRebalance ?? true,
        rebalanceThreshold:
          this.config.yieldFarmingConfig?.rebalanceThreshold ?? 10,
        maxProtocolExposure:
          this.config.yieldFarmingConfig?.maxProtocolExposure ?? 30,
        maxChainExposure:
          this.config.yieldFarmingConfig?.maxChainExposure ?? 50,
        minProfitBps: this.config.minProfitBps,
        maxSlippageBps: this.config.maxSlippageBps,
      })

      await this.yieldFarming.initialize(rpcUrls[this.config.solanaNetwork])

      // Listen for opportunities
      this.yieldFarming.on('opportunities', (opps: YieldOpportunity[]) => {
        log.debug('Found yield farming opportunities', { count: opps.length })
        this.emit('yield-opportunities', opps)
      })

      console.log('   ✓ Yield Farming enabled')
    }
  }

  private async initializeEngine(): Promise<void> {
    // Risk manager
    this.riskManager = new RiskManager({
      maxPositionSizeWei: this.config.maxPositionSize,
      maxDailyLossWei: BigInt(1e18), // 1 ETH
      maxWeeklyLossWei: BigInt(5e18),
      maxConcurrentExposureWei: BigInt(50e18),
      minProfitBps: this.config.minProfitBps,
      minNetProfitWei: 0n,
      minBuilderInclusionRate: 0.5,
      maxSlippageBps: this.config.maxSlippageBps,
      reorgRiskMultiplier: 0.9,
      maxConsecutiveFails: 5,
      cooldownAfterFailMs: 60_000,
    })

    log.info('Engine initialized')
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.startTime = Date.now()

    console.log('🚀 Starting Unified Bot...')

    // Start strategies
    if (this.config.enableSolanaArb) {
      this.solanaArb?.start()
      this.solanaArb?.on('opportunity', (opp: CrossChainArbOpportunity) => {
        this.handleOpportunity('solana-arb', opp)
      })
    }

    if (this.config.enableLiquidity) {
      this.liquidityManager?.start()
      this.liquidityManager?.on(
        'rebalance-opportunities',
        (actions: RebalanceAction[]) => {
          this.handleRebalanceOpportunities(actions)
        },
      )
    }

    if (this.config.enableYieldFarming) {
      this.yieldFarming?.start()
    }

    // Start monitoring loop
    this.monitorLoop()

    log.info('Bot started')
    this.emit('started')
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    console.log('🛑 Stopping Unified Bot...')

    this.solanaArb?.stop()
    this.liquidityManager?.stop()
    this.yieldFarming?.stop()

    log.info('Bot stopped')
    this.emit('stopped')
  }

  /**
   * Get bot statistics
   */
  getStats(): BotStats {
    const activeStrategies: string[] = []
    if (this.config.enableArbitrage) activeStrategies.push('dex-arb')
    if (this.config.enableCrossChain) activeStrategies.push('cross-chain')
    if (this.config.enableSolanaArb) activeStrategies.push('solana-arb')
    if (this.config.enableLiquidity) activeStrategies.push('liquidity')
    if (this.config.enableXLP && this.xlpManagers.size > 0)
      activeStrategies.push('xlp')
    if (this.config.enableSolver && this.oifSolver)
      activeStrategies.push('oif-solver')
    if (this.config.enableYieldFarming && this.yieldFarming)
      activeStrategies.push('yield-farming')

    const successfulTrades = this.trades.filter((t) => t.success).length

    return {
      uptime: this.running ? Date.now() - this.startTime : 0,
      totalProfitUsd: this.totalProfitUsd,
      totalTrades: this.trades.length,
      successRate:
        this.trades.length > 0 ? successfulTrades / this.trades.length : 0,
      activeStrategies,
      pendingOpportunities: this.getPendingOpportunityCount(),
      liquidityPositions: this.liquidityManager?.getPositions().length ?? 0,
      lastTradeAt: this.trades[this.trades.length - 1]?.timestamp ?? 0,
      // XLP stats
      xlpActive: this.xlpProfile?.isActive ?? false,
      xlpTotalEarned: this.xlpProfile?.totalEarned.toString() ?? '0',
      xlpPendingRequests: 0, // Updated asynchronously
      // OIF stats
      oifActive: this.oifSolver !== null,
      oifOpenIntents: 0, // Updated asynchronously
      oifProfitableIntents: 0, // Updated asynchronously
      // Yield farming stats
      yieldFarmingActive: this.yieldFarming !== null,
      yieldOpportunities: this.yieldFarming?.getAllOpportunities().length ?? 0,
      avgYieldApr: this.yieldFarming?.getStats().avgRealYieldApr ?? 0,
    }
  }

  /**
   * Get XLP stats (async)
   */
  async getXLPStats(): Promise<{
    pendingRequests: LiquidityRequest[]
    totalEthLiquidity: bigint
    totalTokenLiquidity: bigint
    activeXLPs: number
  }> {
    if (this.xlpManagers.size === 0) {
      return {
        pendingRequests: [],
        totalEthLiquidity: 0n,
        totalTokenLiquidity: 0n,
        activeXLPs: 0,
      }
    }

    // Get stats from first available manager
    const manager = this.xlpManagers.values().next().value
    if (!manager) {
      return {
        pendingRequests: [],
        totalEthLiquidity: 0n,
        totalTokenLiquidity: 0n,
        activeXLPs: 0,
      }
    }

    const [pendingRequests, liquidity, activeXLPs] = await Promise.all([
      manager.getPendingRequests(),
      manager.getTotalFederatedLiquidity(),
      manager.getActiveXLPs(),
    ])

    return {
      pendingRequests,
      totalEthLiquidity: liquidity.totalEth,
      totalTokenLiquidity: liquidity.totalToken,
      activeXLPs: activeXLPs.length,
    }
  }

  /**
   * Get OIF solver stats (async)
   */
  async getOIFStats(): Promise<{
    totalIntents: number
    profitableIntents: number
    totalPotentialProfit: bigint
    avgProfitBps: number
  }> {
    if (!this.oifSolver) {
      return {
        totalIntents: 0,
        profitableIntents: 0,
        totalPotentialProfit: 0n,
        avgProfitBps: 0,
      }
    }

    return this.oifSolver.getStats()
  }

  /**
   * Fulfill an XLP liquidity request
   */
  async fulfillXLPRequest(
    chainId: ChainId,
    requestId: `0x${string}`,
  ): Promise<`0x${string}` | null> {
    const manager = this.xlpManagers.get(chainId)
    if (!manager) return null

    return manager.fulfillRequest(requestId, '0x' as `0x${string}`)
  }

  /**
   * Fill an OIF intent
   */
  async fillOIFIntent(intent: OpenIntent): Promise<`0x${string}` | null> {
    if (!this.oifSolver) return null

    return this.oifSolver.fillIntent(intent, '0x' as `0x${string}`)
  }

  /**
   * Get yield farming opportunities
   */
  getYieldOpportunities(limit = 20): YieldOpportunity[] {
    if (!this.yieldFarming) return []
    return this.yieldFarming.getBestOpportunities(limit)
  }

  /**
   * Get yield farming stats
   */
  getYieldStats(): {
    totalOpportunities: number
    byChain: Record<string, number>
    byProtocol: Record<string, number>
    avgApr: number
    avgRealYieldApr: number
    bestOpportunity: YieldOpportunity | null
    totalTvl: number
  } | null {
    if (!this.yieldFarming) return null
    return this.yieldFarming.getStats()
  }

  /**
   * Verify yield for an opportunity
   */
  async verifyYield(opportunityId: string): Promise<{
    verified: boolean
    onChainApr: number
    reportedApr: number
    discrepancy: number
    method: string
  }> {
    if (!this.yieldFarming) throw new Error('Yield farming not enabled')
    return this.yieldFarming.verifyApr(opportunityId)
  }

  /**
   * Get all pending opportunities
   */
  getOpportunities(): {
    dexArb: ArbitrageOpportunity[]
    crossChain: CrossChainArbOpportunity[]
    solanaArb: CrossChainArbOpportunity[]
  } {
    const dexArb: ArbitrageOpportunity[] = []
    for (const strategy of this.dexArb.values()) {
      dexArb.push(...strategy.getOpportunities())
    }

    return {
      dexArb,
      crossChain: this.crossChainArb?.getOpportunities() ?? [],
      solanaArb: this.solanaArb?.getOpportunities() ?? [],
    }
  }

  /**
   * Get liquidity positions
   */
  getLiquidityPositions(): UnifiedPosition[] {
    return this.liquidityManager?.getPositions() ?? []
  }

  /**
   * Get liquidity pool recommendations
   */
  async getPoolRecommendations(params?: { minTvl?: number; minApr?: number }) {
    return this.liquidityManager?.getPoolRecommendations(params) ?? []
  }

  /**
   * Get pending rebalance actions
   */
  async getRebalanceActions(): Promise<RebalanceAction[]> {
    return this.liquidityManager?.getRebalanceActions() ?? []
  }

  /**
   * Execute a specific rebalance action
   */
  async executeRebalance(
    action: RebalanceAction,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!this.liquidityManager) {
      return { success: false, error: 'Liquidity manager not initialized' }
    }
    return this.liquidityManager.executeAction(action)
  }

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(params: {
    chain: 'evm' | 'solana'
    dex: string
    poolId: string
    amountA: string
    amountB: string
  }) {
    if (!this.liquidityManager) {
      return { success: false, error: 'Liquidity manager not initialized' }
    }

    return this.liquidityManager.addLiquidity({
      chain: params.chain,
      dex: params.dex,
      poolId: params.poolId,
      amountA: BigInt(params.amountA),
      amountB: BigInt(params.amountB),
    })
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit = 100): TradeResult[] {
    return this.trades.slice(-limit)
  }

  /**
   * Get Solana DEX quotes
   */
  async getSolanaQuotes(inputMint: string, outputMint: string, amount: string) {
    if (!this.solanaDex) {
      return []
    }
    return this.solanaDex.getAllQuotes(inputMint, outputMint, BigInt(amount))
  }

  /**
   * Execute Solana swap
   */
  async executeSolanaSwap(
    inputMint: string,
    outputMint: string,
    amount: string,
  ) {
    if (!this.solanaDex || !this.solanaKeypair) {
      return { success: false, error: 'Solana not initialized' }
    }

    const txHash = await this.solanaDex.executeBestSwap(
      inputMint,
      outputMint,
      BigInt(amount),
      this.solanaKeypair,
    )

    return { success: true, txHash }
  }

  // ============ Private Methods ============

  private getPendingOpportunityCount(): number {
    let count = 0
    for (const strategy of this.dexArb.values()) {
      count += strategy.getOpportunities().length
    }
    count += this.crossChainArb?.getOpportunities().length ?? 0
    count += this.solanaArb?.getOpportunities().length ?? 0
    return count
  }

  private handleOpportunity(
    strategy: string,
    opp: ArbitrageOpportunity | CrossChainArbOpportunity,
  ): void {
    log.debug('Opportunity detected', {
      strategy,
      type: opp.type,
      profitUsd: opp.netProfitUsd ?? 'N/A',
    })
    this.emit('opportunity', { strategy, opportunity: opp })
  }

  private handleRebalanceOpportunities(actions: RebalanceAction[]): void {
    log.debug('Rebalance opportunities detected', { count: actions.length })
    this.emit('rebalance', actions)
  }

  private async monitorLoop(): Promise<void> {
    while (this.running) {
      // Collect opportunities and log summary every minute
      if (Date.now() % 60000 < 10000) {
        const stats = this.getStats()
        log.info('Bot status', {
          trades: stats.totalTrades,
          profitUsd: stats.totalProfitUsd.toFixed(2),
          pending: stats.pendingOpportunities,
          lpPositions: stats.liquidityPositions,
        })
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}
