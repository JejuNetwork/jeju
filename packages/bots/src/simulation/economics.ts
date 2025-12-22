/**
 * Economic Factors & Market Impact Model
 *
 * Realistic modeling of:
 * - Slippage based on liquidity depth and order size
 * - Market impact (permanent and temporary)
 * - Gas costs and priority fee dynamics
 * - MEV/frontrunning risk
 * - Bridge costs and timing
 * - Impermanent loss
 */

// ============ Types ============

export interface LiquidityPool {
  reserve0: bigint
  reserve1: bigint
  fee: number // In basis points
  token0Decimals: number
  token1Decimals: number
}

export interface OrderBookDepth {
  bids: Array<{ price: number; size: number }>
  asks: Array<{ price: number; size: number }>
}

export interface SlippageResult {
  expectedSlippageBps: number
  worstCaseSlippageBps: number
  priceImpactBps: number
  effectivePrice: number
  liquidityDepthUsd: number
}

export interface MarketImpactResult {
  temporaryImpactBps: number
  permanentImpactBps: number
  totalImpactBps: number
  recoveryTimeMs: number
}

export interface GasCostEstimate {
  baseFeeGwei: number
  priorityFeeGwei: number
  totalGasUnits: bigint
  totalCostEth: number
  totalCostUsd: number
  congestionLevel: 'low' | 'medium' | 'high' | 'extreme'
}

export interface TradeEconomics {
  grossProfitUsd: number
  slippageCostUsd: number
  gasCostUsd: number
  bridgeCostUsd: number
  mevRiskCostUsd: number
  opportunityCostUsd: number
  netProfitUsd: number
  returnBps: number
  breakEvenProbability: number
}

export interface EconomicConfig {
  ethPriceUsd: number
  gasMultiplier: number // For safety margin
  mevRiskFactor: number // 0-1, probability of getting frontrun
  liquidityConfidence: number // 0-1, confidence in liquidity data
}

// ============ Constants ============

// Almgren-Chriss market impact parameters (calibrated from empirical data)
const MARKET_IMPACT_PARAMS = {
  // Temporary impact coefficient (order flow)
  eta: 0.142,
  // Permanent impact coefficient (information)
  gamma: 0.314,
  // Volatility scaling
  sigma: 0.02,
  // Daily volume fraction
  adv: 0.1,
}

// Gas costs by operation type (in gas units)
export const GAS_COSTS = {
  simpleSwap: 150000n,
  uniswapV2Swap: 120000n,
  uniswapV3Swap: 180000n,
  curveSwap: 200000n,
  balancerSwap: 150000n,
  flashLoanAave: 250000n,
  flashLoanBalancer: 200000n,
  multiHop2: 300000n,
  multiHop3: 450000n,
  multiHop4: 600000n,
  bridgeInitiate: 100000n,
  bridgeClaim: 80000n,
  approval: 46000n,
}

// Bridge costs and times
const BRIDGE_ECONOMICS: Record<string, { fixedCostUsd: number; percentageFee: number; timeMinutes: number }> = {
  'stargate': { fixedCostUsd: 2, percentageFee: 0.0006, timeMinutes: 5 },
  'across': { fixedCostUsd: 1, percentageFee: 0.0004, timeMinutes: 3 },
  'hop': { fixedCostUsd: 1.5, percentageFee: 0.0005, timeMinutes: 10 },
  'wormhole': { fixedCostUsd: 5, percentageFee: 0.001, timeMinutes: 15 },
  'layerzero': { fixedCostUsd: 3, percentageFee: 0.0008, timeMinutes: 5 },
  'official-l2': { fixedCostUsd: 5, percentageFee: 0, timeMinutes: 7 * 24 * 60 }, // 7 days for L1->L2 official
}

// ============ Slippage Model ============

export class SlippageModel {
  /**
   * Calculate slippage for AMM (constant product) swap
   * Uses the x*y=k invariant
   */
  static calculateAMMSlippage(
    pool: LiquidityPool,
    amountIn: bigint,
    isBuyToken0: boolean,
  ): SlippageResult {
    const reserveIn = isBuyToken0 ? pool.reserve1 : pool.reserve0
    const reserveOut = isBuyToken0 ? pool.reserve0 : pool.reserve1
    const decimalsIn = isBuyToken0 ? pool.token1Decimals : pool.token0Decimals
    const decimalsOut = isBuyToken0 ? pool.token0Decimals : pool.token1Decimals

    // Spot price before swap
    const spotPrice = Number(reserveOut) / Number(reserveIn) * 
      Math.pow(10, decimalsIn - decimalsOut)

    // Apply fee
    const amountInAfterFee = amountIn * BigInt(10000 - pool.fee) / 10000n

    // Calculate output using constant product formula
    // amountOut = reserveOut * amountIn / (reserveIn + amountIn)
    const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)

    // Effective price
    const effectivePrice = Number(amountIn) / Number(amountOut) * 
      Math.pow(10, decimalsOut - decimalsIn)

    // Price impact = (effective - spot) / spot
    const priceImpactBps = ((effectivePrice - spotPrice) / spotPrice) * 10000

    // Slippage includes both price impact and fee
    const expectedSlippageBps = priceImpactBps + pool.fee

    // Worst case: add 50% buffer for concurrent trades
    const worstCaseSlippageBps = expectedSlippageBps * 1.5

    // Liquidity depth: how much can be traded for 1% impact
    const liquidityForOnePercent = Number(reserveIn) * 0.005 // sqrt(1.01) - 1 ≈ 0.005
    const liquidityDepthUsd = liquidityForOnePercent * spotPrice

    return {
      expectedSlippageBps,
      worstCaseSlippageBps,
      priceImpactBps,
      effectivePrice,
      liquidityDepthUsd,
    }
  }

  /**
   * Calculate slippage from order book depth
   */
  static calculateOrderBookSlippage(
    orderBook: OrderBookDepth,
    amountUsd: number,
    isBuy: boolean,
  ): SlippageResult {
    const orders = isBuy ? orderBook.asks : orderBook.bids
    if (orders.length === 0) {
      return {
        expectedSlippageBps: 1000, // 10% default if no data
        worstCaseSlippageBps: 2000,
        priceImpactBps: 1000,
        effectivePrice: 0,
        liquidityDepthUsd: 0,
      }
    }

    const midPrice = (orderBook.bids[0]?.price ?? 0 + (orderBook.asks[0]?.price ?? 0)) / 2
    let remainingAmount = amountUsd
    let totalCost = 0
    let totalFilled = 0

    for (const order of orders) {
      const orderValue = order.price * order.size
      if (remainingAmount <= orderValue) {
        totalFilled += remainingAmount / order.price
        totalCost += remainingAmount
        remainingAmount = 0
        break
      } else {
        totalFilled += order.size
        totalCost += orderValue
        remainingAmount -= orderValue
      }
    }

    if (remainingAmount > 0) {
      // Not enough liquidity - use last price with penalty
      const lastPrice = orders[orders.length - 1]?.price ?? midPrice
      const penaltyPrice = isBuy ? lastPrice * 1.05 : lastPrice * 0.95
      totalFilled += remainingAmount / penaltyPrice
      totalCost += remainingAmount
    }

    const effectivePrice = totalCost / totalFilled
    const priceImpactBps = Math.abs((effectivePrice - midPrice) / midPrice) * 10000

    // Calculate total depth
    const totalDepth = orders.reduce((sum, o) => sum + o.price * o.size, 0)

    return {
      expectedSlippageBps: priceImpactBps,
      worstCaseSlippageBps: priceImpactBps * 1.5,
      priceImpactBps,
      effectivePrice,
      liquidityDepthUsd: totalDepth,
    }
  }

  /**
   * Estimate slippage based on trade size and typical pool liquidity
   * For when we don't have exact pool data
   */
  static estimateSlippage(
    tradeSizeUsd: number,
    poolTvlUsd: number,
    feeBps: number = 30,
  ): SlippageResult {
    // Rule of thumb: slippage ≈ tradeSize / (2 * poolLiquidity)
    // This comes from constant product formula linearization
    const impactRatio = tradeSizeUsd / (2 * poolTvlUsd)
    const priceImpactBps = impactRatio * 10000

    return {
      expectedSlippageBps: priceImpactBps + feeBps,
      worstCaseSlippageBps: (priceImpactBps + feeBps) * 1.5,
      priceImpactBps,
      effectivePrice: 1 + impactRatio, // Normalized
      liquidityDepthUsd: poolTvlUsd * 0.01, // 1% of TVL
    }
  }
}

// ============ Market Impact Model ============

export class MarketImpactModel {
  /**
   * Almgren-Chriss market impact model
   * Used by institutional traders for optimal execution
   */
  static calculateImpact(
    tradeSizeUsd: number,
    dailyVolumeUsd: number,
    volatility: number, // Daily volatility as decimal
    executionTimeHours: number,
  ): MarketImpactResult {
    const { eta, gamma } = MARKET_IMPACT_PARAMS

    // Participation rate
    const participationRate = tradeSizeUsd / (dailyVolumeUsd * (executionTimeHours / 24))

    // Temporary impact: proportional to trading rate
    // I_temp = eta * sigma * sqrt(tradingRate / avgDailyVolume)
    const temporaryImpact = eta * volatility * Math.sqrt(participationRate)

    // Permanent impact: proportional to order size
    // I_perm = gamma * sigma * (orderSize / avgDailyVolume)
    const permanentImpact = gamma * volatility * (tradeSizeUsd / dailyVolumeUsd)

    // Total impact
    const totalImpact = temporaryImpact + permanentImpact

    // Recovery time (temporary impact dissipates)
    const recoveryTimeMs = executionTimeHours * 3600 * 1000 * 0.5 // Half-life

    return {
      temporaryImpactBps: temporaryImpact * 10000,
      permanentImpactBps: permanentImpact * 10000,
      totalImpactBps: totalImpact * 10000,
      recoveryTimeMs,
    }
  }

  /**
   * Quick estimate for typical DeFi trades
   */
  static quickEstimate(
    tradeSizeUsd: number,
    marketCapUsd: number,
  ): MarketImpactResult {
    // Simplified model: impact scales with sqrt of trade size relative to market
    const relativeTrade = tradeSizeUsd / marketCapUsd
    const impact = Math.sqrt(relativeTrade) * 0.1 // 10% for full market cap trade

    return {
      temporaryImpactBps: impact * 10000 * 0.7, // 70% temporary
      permanentImpactBps: impact * 10000 * 0.3, // 30% permanent
      totalImpactBps: impact * 10000,
      recoveryTimeMs: 300000, // 5 minutes
    }
  }
}

// ============ Gas Cost Model ============

export class GasCostModel {
  /**
   * Estimate gas costs for a trade
   */
  static estimate(
    operation: keyof typeof GAS_COSTS,
    chainId: number,
    config: EconomicConfig,
  ): GasCostEstimate {
    const gasUnits = GAS_COSTS[operation]

    // Base fee by chain (approximate averages)
    const baseFees: Record<number, number> = {
      1: 30,      // Ethereum mainnet
      8453: 0.01, // Base
      42161: 0.1, // Arbitrum
      10: 0.01,   // Optimism
      137: 50,    // Polygon
      56: 3,      // BSC
      43114: 25,  // Avalanche
    }

    const baseFeeGwei = (baseFees[chainId] ?? 30) * config.gasMultiplier

    // Priority fee scales with congestion
    const priorityFeeGwei = baseFeeGwei * 0.1 // 10% of base

    // Calculate total
    const totalGwei = baseFeeGwei + priorityFeeGwei
    const totalCostEth = Number(gasUnits) * totalGwei * 1e-9
    const totalCostUsd = totalCostEth * config.ethPriceUsd

    // Determine congestion level
    let congestionLevel: GasCostEstimate['congestionLevel']
    if (baseFeeGwei < 20) congestionLevel = 'low'
    else if (baseFeeGwei < 50) congestionLevel = 'medium'
    else if (baseFeeGwei < 150) congestionLevel = 'high'
    else congestionLevel = 'extreme'

    return {
      baseFeeGwei,
      priorityFeeGwei,
      totalGasUnits: gasUnits,
      totalCostEth,
      totalCostUsd,
      congestionLevel,
    }
  }

  /**
   * Calculate gas cost for multi-hop swap
   */
  static multiHopCost(hops: number, chainId: number, config: EconomicConfig): GasCostEstimate {
    const operation = hops <= 2 ? 'multiHop2' 
      : hops <= 3 ? 'multiHop3' 
      : 'multiHop4'
    return this.estimate(operation, chainId, config)
  }
}

// ============ Bridge Economics ============

export class BridgeEconomics {
  /**
   * Calculate total bridge cost including time value
   */
  static calculateCost(
    bridge: keyof typeof BRIDGE_ECONOMICS,
    amountUsd: number,
    hourlyOpportunityCost: number = 0.01, // 1% per hour opportunity cost
  ): { totalCostUsd: number; timeMinutes: number; breakdown: Record<string, number> } {
    const params = BRIDGE_ECONOMICS[bridge]
    if (!params) {
      return {
        totalCostUsd: amountUsd * 0.01, // 1% default
        timeMinutes: 60,
        breakdown: { unknown: amountUsd * 0.01 },
      }
    }

    const fixedCost = params.fixedCostUsd
    const percentageCost = amountUsd * params.percentageFee
    const timeCost = amountUsd * hourlyOpportunityCost * (params.timeMinutes / 60)

    return {
      totalCostUsd: fixedCost + percentageCost + timeCost,
      timeMinutes: params.timeMinutes,
      breakdown: {
        fixed: fixedCost,
        percentage: percentageCost,
        opportunity: timeCost,
      },
    }
  }

  /**
   * Find cheapest bridge for a given route
   */
  static findCheapest(
    amountUsd: number,
    maxTimeMinutes: number = 60,
    hourlyOpportunityCost: number = 0.01,
  ): { bridge: string; cost: number; time: number } {
    let cheapest = { bridge: '', cost: Infinity, time: 0 }

    for (const [bridge, params] of Object.entries(BRIDGE_ECONOMICS)) {
      if (params.timeMinutes > maxTimeMinutes) continue

      const cost = this.calculateCost(bridge, amountUsd, hourlyOpportunityCost)
      if (cost.totalCostUsd < cheapest.cost) {
        cheapest = { bridge, cost: cost.totalCostUsd, time: params.timeMinutes }
      }
    }

    return cheapest
  }
}

// ============ MEV Risk Model ============

export class MEVRiskModel {
  /**
   * Estimate MEV extraction risk for a trade
   */
  static estimateRisk(
    tradeSizeUsd: number,
    expectedProfitBps: number,
    isPrivateMempool: boolean,
  ): { riskFactor: number; expectedLossUsd: number; mitigations: string[] } {
    // Base risk factors
    let riskFactor = 0

    // Size-based risk: larger trades are more attractive targets
    if (tradeSizeUsd > 100000) riskFactor += 0.3
    else if (tradeSizeUsd > 10000) riskFactor += 0.15
    else riskFactor += 0.05

    // Profit-based risk: higher profit = more attractive
    if (expectedProfitBps > 100) riskFactor += 0.2
    else if (expectedProfitBps > 50) riskFactor += 0.1

    // Private mempool protection
    if (isPrivateMempool) {
      riskFactor *= 0.1 // 90% reduction
    }

    // Cap at 80%
    riskFactor = Math.min(riskFactor, 0.8)

    // Expected loss if frontrun
    const profitAtRisk = tradeSizeUsd * (expectedProfitBps / 10000)
    const expectedLossUsd = profitAtRisk * riskFactor

    // Mitigations
    const mitigations: string[] = []
    if (!isPrivateMempool) {
      mitigations.push('Use Flashbots Protect or private mempool')
    }
    if (tradeSizeUsd > 10000) {
      mitigations.push('Split into smaller trades')
    }
    if (expectedProfitBps > 50) {
      mitigations.push('Use tighter slippage tolerance')
    }

    return { riskFactor, expectedLossUsd, mitigations }
  }
}

// ============ Complete Trade Economics ============

export class TradeEconomicsCalculator {
  private config: EconomicConfig

  constructor(config: EconomicConfig) {
    this.config = config
  }

  /**
   * Calculate complete economics for a trade
   */
  calculate(params: {
    tradeSizeUsd: number
    expectedSpreadBps: number
    poolTvlUsd: number
    chainId: number
    hops: number
    bridge?: keyof typeof BRIDGE_ECONOMICS
    isPrivateMempool: boolean
    executionTimeHours?: number
    dailyVolumeUsd?: number
  }): TradeEconomics {
    const {
      tradeSizeUsd,
      expectedSpreadBps,
      poolTvlUsd,
      chainId,
      hops,
      bridge,
      isPrivateMempool,
      executionTimeHours = 0.01, // Instant
      dailyVolumeUsd = poolTvlUsd * 10, // Estimate
    } = params

    // 1. Gross profit from spread
    const grossProfitUsd = tradeSizeUsd * (expectedSpreadBps / 10000)

    // 2. Slippage cost
    const slippage = SlippageModel.estimateSlippage(tradeSizeUsd, poolTvlUsd)
    const slippageCostUsd = tradeSizeUsd * (slippage.expectedSlippageBps / 10000)

    // 3. Market impact
    const impact = MarketImpactModel.calculateImpact(
      tradeSizeUsd,
      dailyVolumeUsd,
      0.02, // 2% daily vol
      executionTimeHours,
    )
    const marketImpactCostUsd = tradeSizeUsd * (impact.totalImpactBps / 10000)

    // 4. Gas cost
    const gasCost = GasCostModel.multiHopCost(hops, chainId, this.config)
    const gasCostUsd = gasCost.totalCostUsd

    // 5. Bridge cost (if applicable)
    let bridgeCostUsd = 0
    if (bridge) {
      const bridgeCost = BridgeEconomics.calculateCost(bridge, tradeSizeUsd)
      bridgeCostUsd = bridgeCost.totalCostUsd
    }

    // 6. MEV risk
    const mevRisk = MEVRiskModel.estimateRisk(
      tradeSizeUsd,
      expectedSpreadBps,
      isPrivateMempool,
    )
    const mevRiskCostUsd = mevRisk.expectedLossUsd * this.config.mevRiskFactor

    // 7. Opportunity cost (capital locked during execution)
    const opportunityCostUsd = tradeSizeUsd * 0.0001 * executionTimeHours // 0.01% per hour

    // Net profit
    const totalCosts = slippageCostUsd + marketImpactCostUsd + gasCostUsd + 
      bridgeCostUsd + mevRiskCostUsd + opportunityCostUsd
    const netProfitUsd = grossProfitUsd - totalCosts

    // Return in bps
    const returnBps = (netProfitUsd / tradeSizeUsd) * 10000

    // Break-even probability (simplified model)
    // Assumes normal distribution of outcomes
    const expectedReturn = netProfitUsd
    const volatilityUsd = tradeSizeUsd * (slippage.worstCaseSlippageBps / 10000)
    const zScore = expectedReturn / volatilityUsd
    const breakEvenProbability = 0.5 * (1 + this.erf(zScore / Math.sqrt(2)))

    return {
      grossProfitUsd,
      slippageCostUsd: slippageCostUsd + marketImpactCostUsd,
      gasCostUsd,
      bridgeCostUsd,
      mevRiskCostUsd,
      opportunityCostUsd,
      netProfitUsd,
      returnBps,
      breakEvenProbability,
    }
  }

  /**
   * Find optimal trade size
   */
  findOptimalSize(params: {
    minSize: number
    maxSize: number
    expectedSpreadBps: number
    poolTvlUsd: number
    chainId: number
    hops: number
    isPrivateMempool: boolean
  }): { optimalSize: number; maxProfit: number } {
    let optimalSize = params.minSize
    let maxProfit = -Infinity

    // Binary search for optimal size
    for (let size = params.minSize; size <= params.maxSize; size *= 1.1) {
      const economics = this.calculate({
        tradeSizeUsd: size,
        expectedSpreadBps: params.expectedSpreadBps,
        poolTvlUsd: params.poolTvlUsd,
        chainId: params.chainId,
        hops: params.hops,
        isPrivateMempool: params.isPrivateMempool,
      })

      if (economics.netProfitUsd > maxProfit) {
        maxProfit = economics.netProfitUsd
        optimalSize = size
      }
    }

    return { optimalSize, maxProfit }
  }

  // Error function approximation
  private erf(x: number): number {
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x < 0 ? -1 : 1
    x = Math.abs(x)
    const t = 1 / (1 + p * x)
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
    return sign * y
  }
}

// ============ Impermanent Loss Calculator ============

export class ImpermanentLossCalculator {
  /**
   * Calculate impermanent loss for a 50/50 LP position
   */
  static calculate(priceRatio: number): { ilPercent: number; ilBps: number } {
    // IL formula: 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
    const sqrtRatio = Math.sqrt(priceRatio)
    const il = 2 * sqrtRatio / (1 + priceRatio) - 1

    return {
      ilPercent: il * 100,
      ilBps: il * 10000,
    }
  }

  /**
   * Calculate IL for weighted pool (e.g., 80/20)
   */
  static calculateWeighted(
    priceRatio: number,
    weight: number, // Weight of first token (0-1)
  ): { ilPercent: number; ilBps: number } {
    // Generalized IL formula for weighted pools
    const ratio = priceRatio
    const w = weight

    // Value if held: w * 1 + (1-w) * ratio
    const holdValue = w + (1 - w) * ratio

    // Value in pool: (ratio^(1-w)) for normalized pool
    const poolValue = Math.pow(ratio, 1 - w)

    const il = poolValue / holdValue - 1

    return {
      ilPercent: il * 100,
      ilBps: il * 10000,
    }
  }

  /**
   * Estimate IL over time given volatility
   */
  static estimateExpectedIL(
    volatility: number, // Annual volatility
    days: number,
  ): { expectedIlBps: number; p95IlBps: number } {
    // Expected price ratio after time t with volatility sigma
    // ln(S_t/S_0) ~ N(0, sigma^2 * t)
    const timeYears = days / 365
    const expectedLogRatio = volatility * Math.sqrt(timeYears)

    // Mean of |ln(ratio)| for normal distribution
    const expectedAbsLogRatio = expectedLogRatio * Math.sqrt(2 / Math.PI)
    const expectedRatio = Math.exp(expectedAbsLogRatio)

    const expectedIl = this.calculate(expectedRatio)

    // 95th percentile
    const p95LogRatio = expectedLogRatio * 1.96
    const p95Ratio = Math.exp(p95LogRatio)
    const p95Il = this.calculate(p95Ratio)

    return {
      expectedIlBps: Math.abs(expectedIl.ilBps),
      p95IlBps: Math.abs(p95Il.ilBps),
    }
  }
}

// ============ Exports ============

export function createEconomicsCalculator(config: Partial<EconomicConfig> = {}): TradeEconomicsCalculator {
  const fullConfig: EconomicConfig = {
    ethPriceUsd: config.ethPriceUsd ?? 3500,
    gasMultiplier: config.gasMultiplier ?? 1.2,
    mevRiskFactor: config.mevRiskFactor ?? 0.5,
    liquidityConfidence: config.liquidityConfidence ?? 0.8,
  }
  return new TradeEconomicsCalculator(fullConfig)
}

