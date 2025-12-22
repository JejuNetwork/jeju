/**
 * TFMM Rebalancer
 *
 * Orchestrates weight updates for TFMM pools:
 * - Monitors pool state
 * - Fetches oracle prices
 * - Runs strategy calculations
 * - Submits weight update transactions
 * - Handles gas optimization
 */

import { EventEmitter } from 'node:events'
import type { EVMChainId } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { OracleAggregator } from '../../oracles'
import { KeyedMutex } from '../../shared'
import type { TFMMRiskParameters, TFMMWeightUpdate, Token } from '../../types'
import type { StrategyContext, WeightCalculation } from './base-strategy'
import { type CompositeConfig, CompositeStrategy } from './composite-strategy'

// ============ Constants ============

// Maximum update history entries to prevent memory leaks
const MAX_UPDATE_HISTORY = 10000

// ============ Contract ABIs ============

const TFMM_POOL_ABI = parseAbi([
  'function getNormalizedWeights() view returns (uint256[])',
  'function getTokens() view returns (address[])',
  'function updateWeights(uint256[] calldata newWeights, uint256 blocksToTarget) external',
  'function lastUpdateBlock() view returns (uint256)',
  'function strategyRule() view returns (address)',
  'function getGuardRails() view returns (uint256 minWeight, uint256 maxWeight, uint256 maxWeightChangeBps)',
  'function getBalances() view returns (uint256[])',
  'function owner() view returns (address)',
])

// ============ Types ============

export interface TFMMRebalancerConfig {
  chainId: EVMChainId
  rpcUrl: string
  privateKey: string
  weightRunnerAddress?: Address
  updateIntervalMs: number
  minConfidenceThreshold: number
  maxGasPrice: bigint
  gasBuffer: number // Multiplier for gas estimate (1.2 = 20% buffer)
  strategyConfig?: Partial<CompositeConfig>
}

export interface RebalanceResult {
  pool: Address
  success: boolean
  txHash?: string
  oldWeights: bigint[]
  newWeights: bigint[]
  gasUsed?: bigint
  error?: string
  calculation: WeightCalculation
}

interface ManagedPool {
  address: Address
  tokens: Token[]
  lastUpdate: number
  updateInterval: number
  enabled: boolean
}

// ============ Rebalancer ============

export class TFMMRebalancer extends EventEmitter {
  private config: TFMMRebalancerConfig
  private publicClient: PublicClient
  private walletClient: WalletClient
  private account: PrivateKeyAccount
  private chain: Chain
  private oracle: OracleAggregator
  private strategy: CompositeStrategy
  private pools: Map<Address, ManagedPool> = new Map()
  private running = false
  private updateLoop: ReturnType<typeof setInterval> | null = null
  private updateHistory: TFMMWeightUpdate[] = []
  // Mutex to prevent concurrent operations on the same pool
  private poolMutex = new KeyedMutex()

  constructor(config: TFMMRebalancerConfig) {
    super()
    this.config = config

    // Validate private key format before use
    if (!config.privateKey.match(/^0x[a-fA-F0-9]{64}$/)) {
      throw new Error(
        'Invalid private key format: must be 0x-prefixed 64 hex characters',
      )
    }
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`)

    this.chain = {
      id: config.chainId,
      name: `Chain ${config.chainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    // Initialize oracle and strategy
    this.oracle = new OracleAggregator({ [config.chainId]: config.rpcUrl })
    this.strategy = new CompositeStrategy(this.oracle, config.strategyConfig)
  }

  /**
   * Register a TFMM pool to manage
   */
  async registerPool(
    poolAddress: Address,
    updateIntervalMs?: number,
  ): Promise<void> {
    // Fetch pool info
    const tokens = (await this.publicClient.readContract({
      address: poolAddress,
      abi: TFMM_POOL_ABI,
      functionName: 'getTokens',
    })) as Address[]

    // Build token info (would need to fetch symbols/decimals in production)
    const tokenInfos: Token[] = tokens.map((addr, i) => ({
      address: addr,
      symbol: `TOKEN${i}`,
      decimals: 18,
      chainId: this.config.chainId,
    }))

    this.pools.set(poolAddress, {
      address: poolAddress,
      tokens: tokenInfos,
      lastUpdate: 0,
      updateInterval:
        updateIntervalMs !== undefined
          ? updateIntervalMs
          : this.config.updateIntervalMs,
      enabled: true,
    })

    this.emit('pool-registered', { address: poolAddress, tokens: tokenInfos })
  }

  /**
   * Unregister a pool
   */
  unregisterPool(poolAddress: Address): void {
    this.pools.delete(poolAddress)
    this.emit('pool-unregistered', { address: poolAddress })
  }

  /**
   * Start the rebalancer
   */
  start(): void {
    if (this.running) return
    this.running = true

    // Start update loop
    this.updateLoop = setInterval(() => this.checkAndUpdate(), 10000) // Check every 10s

    // Run initial check
    this.checkAndUpdate()

    this.emit('started')
  }

  /**
   * Stop the rebalancer
   */
  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.updateLoop) {
      clearInterval(this.updateLoop)
      this.updateLoop = null
    }

    this.emit('stopped')
  }

  /**
   * Check pools and update if needed
   */
  private async checkAndUpdate(): Promise<void> {
    const now = Date.now()

    for (const [address, pool] of this.pools) {
      if (!pool.enabled) continue

      const timeSinceUpdate = now - pool.lastUpdate
      if (timeSinceUpdate < pool.updateInterval) continue

      // Check gas price
      const gasPrice = await this.publicClient.getGasPrice()
      if (gasPrice > this.config.maxGasPrice) {
        continue
      }

      // Perform update
      const result = await this.rebalancePool(address)

      if (result.success) {
        pool.lastUpdate = now
        this.emit('rebalance-success', result)
      } else {
        this.emit('rebalance-failed', result)
      }
    }
  }

  /**
   * Rebalance a specific pool
   */
  async rebalancePool(poolAddress: Address): Promise<RebalanceResult> {
    const pool = this.pools.get(poolAddress)
    if (!pool) {
      return {
        pool: poolAddress,
        success: false,
        oldWeights: [],
        newWeights: [],
        error: 'Pool not registered',
        calculation: {
          newWeights: [],
          blocksToTarget: 0n,
          confidence: 0,
          signals: [],
        },
      }
    }

    // Acquire mutex to prevent concurrent rebalancing of the same pool
    const release = await this.poolMutex.acquire(poolAddress)

    try {
      return await this._doRebalancePool(poolAddress, pool)
    } finally {
      release()
    }
  }

  /**
   * Internal rebalance implementation (mutex protected)
   */
  private async _doRebalancePool(
    poolAddress: Address,
    pool: ManagedPool,
  ): Promise<RebalanceResult> {
    console.log(`Rebalancing pool ${poolAddress}...`)

    // Fetch current state
    const [currentWeights, _balances, _lastUpdateBlock, guardRailsRaw] =
      await Promise.all([
        this.publicClient.readContract({
          address: poolAddress,
          abi: TFMM_POOL_ABI,
          functionName: 'getNormalizedWeights',
        }) as Promise<bigint[]>,
        this.publicClient.readContract({
          address: poolAddress,
          abi: TFMM_POOL_ABI,
          functionName: 'getBalances',
        }) as Promise<bigint[]>,
        this.publicClient.readContract({
          address: poolAddress,
          abi: TFMM_POOL_ABI,
          functionName: 'lastUpdateBlock',
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: poolAddress,
          abi: TFMM_POOL_ABI,
          functionName: 'getGuardRails',
        }) as Promise<readonly [bigint, bigint, bigint]>,
      ])

    const blockNumber = await this.publicClient.getBlockNumber()

    // Fetch oracle prices
    const prices = await this.oracle.getPrices(
      pool.tokens.map((t) => t.symbol),
      this.config.chainId,
      60,
    )

    const pricesArray = pool.tokens.map((t) => {
      const price = prices.get(t.symbol)
      if (!price) throw new Error(`Missing price for token ${t.symbol}`)
      return price
    })

    // Update strategy price history
    this.strategy.updatePriceHistory(pricesArray)

    // Build strategy context
    const riskParams: TFMMRiskParameters = {
      minWeight: guardRailsRaw[0],
      maxWeight: guardRailsRaw[1],
      maxWeightChangeBps: Number(guardRailsRaw[2]),
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 60,
      maxPriceDeviationBps: 500,
    }

    const ctx: StrategyContext = {
      pool: poolAddress,
      tokens: pool.tokens,
      currentWeights,
      prices: pricesArray,
      priceHistory: [],
      riskParams,
      blockNumber,
      timestamp: Date.now(),
    }

    // Calculate new weights
    const calculation = await this.strategy.calculateWeights(ctx)

    // Check confidence threshold
    if (calculation.confidence < this.config.minConfidenceThreshold) {
      console.log(
        `Confidence ${calculation.confidence} below threshold, skipping`,
      )
      return {
        pool: poolAddress,
        success: false,
        oldWeights: currentWeights,
        newWeights: calculation.newWeights,
        error: `Confidence ${calculation.confidence} below threshold`,
        calculation,
      }
    }

    // Check if weights actually changed
    const weightsChanged = calculation.newWeights.some(
      (w, i) => w !== currentWeights[i],
    )

    if (!weightsChanged) {
      console.log('Weights unchanged, skipping update')
      return {
        pool: poolAddress,
        success: true,
        oldWeights: currentWeights,
        newWeights: currentWeights,
        calculation,
      }
    }

    // Submit transaction
    const hash = await this.walletClient.writeContract({
      address: poolAddress,
      abi: TFMM_POOL_ABI,
      functionName: 'updateWeights',
      args: [calculation.newWeights, calculation.blocksToTarget],
      chain: this.chain,
      account: this.account,
    })

    console.log(`Weight update tx submitted: ${hash}`)

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })

    // Record update
    const update: TFMMWeightUpdate = {
      pool: poolAddress,
      oldWeights: currentWeights,
      newWeights: calculation.newWeights,
      blocksToTarget: calculation.blocksToTarget,
      timestamp: Date.now(),
      blockNumber: receipt.blockNumber,
      txHash: hash,
    }
    this.updateHistory.push(update)

    // Prevent unbounded memory growth - trim oldest entries
    if (this.updateHistory.length > MAX_UPDATE_HISTORY) {
      this.updateHistory = this.updateHistory.slice(-MAX_UPDATE_HISTORY)
    }

    console.log(`Weight update confirmed in block ${receipt.blockNumber}`)

    return {
      pool: poolAddress,
      success: true,
      txHash: hash,
      oldWeights: currentWeights,
      newWeights: calculation.newWeights,
      gasUsed: receipt.gasUsed,
      calculation,
    }
  }

  /**
   * Force an immediate update (bypass interval check)
   */
  async forceUpdate(poolAddress: Address): Promise<RebalanceResult> {
    return this.rebalancePool(poolAddress)
  }

  /**
   * Get update history
   */
  getUpdateHistory(poolAddress?: Address): TFMMWeightUpdate[] {
    if (poolAddress) {
      return this.updateHistory.filter((u) => u.pool === poolAddress)
    }
    return this.updateHistory
  }

  /**
   * Get current strategy configuration
   */
  getStrategyConfig(): CompositeConfig {
    return this.strategy.getConfig()
  }

  /**
   * Update strategy configuration
   */
  updateStrategyConfig(config: Partial<CompositeConfig>): void {
    this.strategy.updateConfig(config)
  }

  /**
   * Get managed pools
   */
  getPools(): ManagedPool[] {
    return Array.from(this.pools.values())
  }

  /**
   * Enable/disable a pool
   */
  setPoolEnabled(poolAddress: Address, enabled: boolean): void {
    const pool = this.pools.get(poolAddress)
    if (pool) {
      pool.enabled = enabled
    }
  }

  /**
   * Get current market regime from strategy
   */
  getMarketRegime(): string {
    return this.strategy.getRegime()
  }

  /**
   * Get stats
   */
  getStats(): {
    poolCount: number
    enabledPools: number
    totalUpdates: number
    lastUpdateTime: number
    regime: string
  } {
    const enabledPools = Array.from(this.pools.values()).filter(
      (p) => p.enabled,
    ).length
    const lastUpdate =
      this.updateHistory.length > 0
        ? this.updateHistory[this.updateHistory.length - 1]
        : null

    return {
      poolCount: this.pools.size,
      enabledPools,
      totalUpdates: this.updateHistory.length,
      lastUpdateTime: lastUpdate ? lastUpdate.timestamp : 0,
      regime: this.strategy.getRegime(),
    }
  }
}
