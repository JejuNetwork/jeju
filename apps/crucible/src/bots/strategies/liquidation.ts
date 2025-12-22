import { createPublicClient, http, type PublicClient } from 'viem'
import type {
  ChainConfig,
  ChainId,
  LiquidationOpportunity,
  StrategyConfig,
} from '../autocrat-types-source'
import { PERPETUAL_MARKET_ABI } from '../lib/contracts'

interface Position {
  positionId: string
  trader: string
  marketId: string
  side: 'LONG' | 'SHORT'
  size: bigint
  margin: bigint
  marginToken: string
  entryPrice: bigint
  lastCheck: number
}

interface MarketConfig {
  marketId: string
  symbol: string
  maintenanceMarginBps: number
  liquidationBonus: number
}

const POSITION_CHECK_INTERVAL_MS = 5000
const MIN_LIQUIDATION_PROFIT = BigInt(1e16)

// Cascade detection thresholds
const CASCADE_PRICE_DROP_THRESHOLD = 0.05 // 5% price drop triggers cascade check

interface CascadeAnalysis {
  marketId: string
  currentPrice: bigint
  nearLiquidationVolume: bigint
  totalExposure: bigint
  cascadeProbability: number
  expectedPriceImpact: number
  cascadePositions: Position[]
}

export class LiquidationStrategy {
  private client: PublicClient | null = null
  private perpetualMarketAddress: string = ''
  private positions: Map<string, Position> = new Map()
  private markets: Map<string, MarketConfig> = new Map()
  private opportunities: Map<string, LiquidationOpportunity> = new Map()
  private monitorInterval: ReturnType<typeof setInterval> | null = null
  private config: StrategyConfig
  private chainId: ChainId

  // Cascade detection state
  private marketPrices: Map<string, { price: bigint; timestamp: number }> =
    new Map()
  private cascadeAlerts: Map<string, CascadeAnalysis> = new Map()

  constructor(chainId: ChainId, config: StrategyConfig) {
    this.chainId = chainId
    this.config = config
  }

  /**
   * Initialize with chain config and perpetual market address
   */
  async initialize(
    chainConfig: ChainConfig,
    perpetualMarketAddress: string,
    markets: MarketConfig[],
  ): Promise<void> {
    console.log(`⚡ Initializing liquidation strategy`)
    console.log(`   PerpetualMarket: ${perpetualMarketAddress}`)

    this.perpetualMarketAddress = perpetualMarketAddress

    const chain = {
      id: chainConfig.chainId,
      name: chainConfig.name,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    }

    this.client = createPublicClient({
      chain,
      transport: http(chainConfig.rpcUrl),
    })

    for (const market of markets) {
      this.markets.set(market.marketId, market)
    }

    console.log(`   Monitoring ${markets.length} markets`)
  }

  /**
   * Start monitoring positions
   */
  start(): void {
    if (this.monitorInterval) return

    console.log(`   Starting position monitoring...`)

    this.monitorInterval = setInterval(
      () => this.checkPositions(),
      POSITION_CHECK_INTERVAL_MS,
    )
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }
  }

  /**
   * Add a position to monitor
   */
  addPosition(position: Position): void {
    this.positions.set(position.positionId, position)
  }

  /**
   * Remove a position from monitoring
   */
  removePosition(positionId: string): void {
    this.positions.delete(positionId)
    this.opportunities.delete(positionId)
  }

  /**
   * Handle position opened event
   */
  onPositionOpened(
    positionId: string,
    trader: string,
    marketId: string,
    side: number,
    size: bigint,
    margin: bigint,
    entryPrice: bigint,
    marginToken: string,
  ): void {
    const position: Position = {
      positionId,
      trader,
      marketId,
      side: side === 0 ? 'LONG' : 'SHORT',
      size,
      margin,
      marginToken,
      entryPrice,
      lastCheck: Date.now(),
    }

    this.addPosition(position)
  }

  /**
   * Handle position closed event
   */
  onPositionClosed(positionId: string): void {
    this.removePosition(positionId)
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): LiquidationOpportunity[] {
    return Array.from(this.opportunities.values())
      .filter((o) => o.status === 'DETECTED')
      .sort((a, b) =>
        Number(BigInt(b.expectedProfit) - BigInt(a.expectedProfit)),
      )
  }

  /**
   * Mark opportunity as executing
   */
  markExecuting(opportunityId: string): void {
    const opp = this.opportunities.get(opportunityId)
    if (opp) {
      opp.status = 'EXECUTING'
    }
  }

  /**
   * Mark opportunity as completed/failed
   */
  markCompleted(opportunityId: string, success: boolean): void {
    const opp = this.opportunities.get(opportunityId)
    if (opp) {
      opp.status = success ? 'COMPLETED' : 'FAILED'
    }

    // Remove position if liquidated
    if (success) {
      this.positions.delete(opportunityId)
    }
  }

  // ============ Private Methods ============

  private async checkPositions(): Promise<void> {
    if (!this.client || !this.perpetualMarketAddress) return

    const now = Date.now()
    const positionsToCheck = Array.from(this.positions.values()).filter(
      (p) => now - p.lastCheck > POSITION_CHECK_INTERVAL_MS,
    )

    for (const position of positionsToCheck) {
      await this.checkPosition(position)
    }
  }

  private async checkPosition(position: Position): Promise<void> {
    if (!this.client) return

    const result = (await this.client.readContract({
      address: this.perpetualMarketAddress as `0x${string}`,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'isLiquidatable',
      args: [position.positionId as `0x${string}`],
    })) as [boolean, bigint]

    const [canLiquidate, healthFactor] = result

    position.lastCheck = Date.now()

    if (canLiquidate) {
      await this.createLiquidationOpportunity(position, healthFactor)
    } else {
      // Remove existing opportunity if position is no longer liquidatable
      this.opportunities.delete(position.positionId)
    }
  }

  private async createLiquidationOpportunity(
    position: Position,
    healthFactor: bigint,
  ): Promise<void> {
    // Already have this opportunity
    if (this.opportunities.has(position.positionId)) return

    const market = this.markets.get(position.marketId)
    if (!market) return

    // Calculate expected profit
    // Liquidation bonus is typically 5% of margin
    const liquidationBonus =
      (position.margin * BigInt(market.liquidationBonus)) / 10000n

    // Estimate gas cost
    const gasEstimate = 500000n // Liquidation is gas-intensive
    if (!this.client) throw new Error('Client not initialized')
    const gasPrice = await this.client.getGasPrice()
    const gasCost = gasEstimate * gasPrice

    // Net profit
    const netProfit = liquidationBonus - gasCost

    if (netProfit < MIN_LIQUIDATION_PROFIT) return

    // Check against config minimum
    const profitBps = Number((netProfit * 10000n) / position.margin)
    if (profitBps < this.config.minProfitBps) return

    const opportunity: LiquidationOpportunity = {
      id: position.positionId,
      type: 'LIQUIDATION',
      chainId: this.chainId,
      protocol: 'PERPETUAL_MARKET',
      positionId: position.positionId,
      borrower: position.trader,
      collateralToken: {
        address: position.marginToken,
        symbol: '',
        decimals: 18,
        chainId: this.chainId,
      },
      debtToken: {
        address: position.marginToken,
        symbol: '',
        decimals: 18,
        chainId: this.chainId,
      },
      collateralAmount: position.margin.toString(),
      debtAmount: position.size.toString(),
      healthFactor: healthFactor.toString(),
      liquidationBonus: liquidationBonus.toString(),
      expectedProfit: netProfit.toString(),
      gasEstimate: (gasEstimate * gasPrice).toString(),
      netProfitWei: netProfit.toString(),
      detectedAt: Date.now(),
      status: 'DETECTED',
    }

    this.opportunities.set(position.positionId, opportunity)

    console.log(
      `⚡ Liquidation detected: ${position.positionId.slice(0, 10)}... ` +
        `Health: ${Number(healthFactor) / 1e18}, Profit: ${Number(netProfit) / 1e18} ETH`,
    )
  }

  // ============ Cascade Detection ============

  /**
   * Analyze market for potential liquidation cascade
   * A cascade occurs when large liquidations cause price drops,
   * which trigger more liquidations, creating a feedback loop.
   */
  async analyzeCascadeRisk(marketId: string): Promise<CascadeAnalysis | null> {
    if (!this.client) return null

    const market = this.markets.get(marketId)
    if (!market) return null

    // Get current price
    const priceResult = (await this.client.readContract({
      address: this.perpetualMarketAddress as `0x${string}`,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getMarkPrice',
      args: [marketId as `0x${string}`],
    })) as bigint

    const currentPrice = priceResult
    const previousPrice = this.marketPrices.get(marketId)
    this.marketPrices.set(marketId, {
      price: currentPrice,
      timestamp: Date.now(),
    })

    // Calculate price change
    let priceDropPercent = 0
    if (previousPrice && previousPrice.price > 0n) {
      priceDropPercent =
        Number(previousPrice.price - currentPrice) / Number(previousPrice.price)
    }

    // Find positions near liquidation in this market
    const marketPositions = Array.from(this.positions.values()).filter(
      (p) => p.marketId === marketId,
    )

    let nearLiquidationVolume = 0n
    let totalExposure = 0n
    const cascadePositions: Position[] = []

    for (const position of marketPositions) {
      totalExposure += position.size

      // Estimate health factor based on position
      const pnl = this.estimatePnL(position, currentPrice)
      const effectiveMargin = position.margin + pnl
      const maintenanceMargin =
        (position.size * BigInt(market.maintenanceMarginBps)) / 10000n

      // Check if near liquidation (health factor < 1.2)
      if (
        effectiveMargin > 0n &&
        effectiveMargin < (maintenanceMargin * 12n) / 10n
      ) {
        nearLiquidationVolume += position.size
        cascadePositions.push(position)
      }
    }

    // Calculate cascade probability based on:
    // 1. Volume of positions near liquidation
    // 2. Recent price movement
    // 3. Market liquidity (approximated)
    const volumeRatio =
      totalExposure > 0n
        ? Number(nearLiquidationVolume) / Number(totalExposure)
        : 0

    let cascadeProbability = 0

    // High volume near liquidation increases cascade risk
    if (volumeRatio > 0.1) cascadeProbability += 20
    if (volumeRatio > 0.2) cascadeProbability += 30
    if (volumeRatio > 0.3) cascadeProbability += 40

    // Price drop increases cascade risk
    if (priceDropPercent > CASCADE_PRICE_DROP_THRESHOLD) {
      cascadeProbability += 30
    }

    // Estimate price impact from cascade liquidations
    // Rough estimate: 1% price impact per $1M liquidation volume (adjust based on market)
    const volumeUsd = Number(nearLiquidationVolume) / 1e18
    const expectedPriceImpact = (volumeUsd / 1000000) * 0.01

    if (cascadeProbability > 30 || cascadePositions.length >= 3) {
      const analysis: CascadeAnalysis = {
        marketId,
        currentPrice,
        nearLiquidationVolume,
        totalExposure,
        cascadeProbability,
        expectedPriceImpact,
        cascadePositions,
      }

      this.cascadeAlerts.set(marketId, analysis)

      console.log(
        `🔥 CASCADE ALERT: ${market.symbol} ` +
          `Probability: ${cascadeProbability}% | ` +
          `${cascadePositions.length} positions at risk | ` +
          `Volume: $${(volumeUsd).toFixed(0)}`,
      )

      return analysis
    }

    return null
  }

  /**
   * Get all cascade alerts
   */
  getCascadeAlerts(): CascadeAnalysis[] {
    return Array.from(this.cascadeAlerts.values())
      .filter((a) => a.cascadeProbability >= 30)
      .sort((a, b) => b.cascadeProbability - a.cascadeProbability)
  }

  /**
   * Simulate cascade scenario to estimate total liquidation profit
   */
  simulateCascade(
    analysis: CascadeAnalysis,
    priceDropPercent: number,
  ): {
    totalLiquidations: number
    totalProfit: bigint
    priceAfterCascade: bigint
  } {
    const market = this.markets.get(analysis.marketId)
    if (!market) {
      return {
        totalLiquidations: 0,
        totalProfit: 0n,
        priceAfterCascade: analysis.currentPrice,
      }
    }

    // Simulate price drop
    const priceAfterDrop =
      (analysis.currentPrice *
        BigInt(Math.floor((1 - priceDropPercent) * 10000))) /
      10000n

    let totalLiquidations = 0
    let totalProfit = 0n

    // Check which positions would be liquidated at new price
    const marketPositions = Array.from(this.positions.values()).filter(
      (p) => p.marketId === analysis.marketId,
    )

    for (const position of marketPositions) {
      const pnl = this.estimatePnL(position, priceAfterDrop)
      const effectiveMargin = position.margin + pnl
      const maintenanceMargin =
        (position.size * BigInt(market.maintenanceMarginBps)) / 10000n

      if (effectiveMargin <= maintenanceMargin) {
        totalLiquidations++
        // Liquidation profit is the bonus
        const bonus =
          ((effectiveMargin > 0n ? effectiveMargin : 0n) *
            BigInt(market.liquidationBonus)) /
          10000n
        totalProfit += bonus
      }
    }

    return {
      totalLiquidations,
      totalProfit,
      priceAfterCascade: priceAfterDrop,
    }
  }

  /**
   * Check all markets for cascade risk
   */
  async scanForCascades(): Promise<CascadeAnalysis[]> {
    const alerts: CascadeAnalysis[] = []

    for (const marketId of this.markets.keys()) {
      const analysis = await this.analyzeCascadeRisk(marketId)
      if (analysis) {
        alerts.push(analysis)
      }
    }

    return alerts
  }

  private estimatePnL(position: Position, currentPrice: bigint): bigint {
    const priceDelta = currentPrice - position.entryPrice

    if (position.side === 'LONG') {
      // Long: profit when price goes up
      return (position.size * priceDelta) / position.entryPrice
    } else {
      // Short: profit when price goes down
      return (
        (position.size * (position.entryPrice - currentPrice)) /
        position.entryPrice
      )
    }
  }
}
