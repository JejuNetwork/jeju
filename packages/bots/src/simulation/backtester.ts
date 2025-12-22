/**
 * TFMM Strategy Backtester
 */

import { OracleAggregator } from '../oracles'
import { WEIGHT_PRECISION } from '../schemas'
import type {
  BaseTFMMStrategy,
  StrategyContext,
} from '../strategies/tfmm/base-strategy'
import { CompositeStrategy } from '../strategies/tfmm/composite-strategy'
import { MeanReversionStrategy } from '../strategies/tfmm/mean-reversion-strategy'
import { MomentumStrategy } from '../strategies/tfmm/momentum-strategy'
import { VolatilityStrategy } from '../strategies/tfmm/volatility-strategy'
import type {
  BacktestResult,
  PortfolioSnapshot,
  TFMMRiskParameters,
  Token,
} from '../types'

// Re-export for index.ts
export type { BacktestResult } from '../types'

export interface BacktestConfig {
  strategy: 'momentum' | 'mean-reversion' | 'volatility' | 'composite'
  strategyParams?: Record<string, number>
  tokens: Token[]
  initialWeights: number[]
  startDate: Date
  endDate: Date
  initialCapitalUsd: number
  rebalanceIntervalHours: number
  tradingFeeBps: number
  slippageBps: number
  priceData: PriceDataPoint[]
}

export interface PriceDataPoint {
  date: Date
  timestamp: number
  prices: Record<string, number>
}

export class Backtester {
  async run(config: BacktestConfig): Promise<BacktestResult> {
    const strategy = this.createStrategy(config.strategy, config.strategyParams)
    let weights = config.initialWeights.map((w) => BigInt(Math.floor(w * 1e18)))
    let balances = this.calculateInitialBalances(
      config.initialCapitalUsd,
      config.initialWeights,
      config.priceData[0].prices,
      config.tokens,
    )

    const snapshots: PortfolioSnapshot[] = []
    let cumulativeFees = 0
    let rebalanceCount = 0
    let lastRebalance = config.priceData[0].timestamp

    const riskParams: TFMMRiskParameters = {
      minWeight: WEIGHT_PRECISION / 20n, // 5%
      maxWeight: (WEIGHT_PRECISION * 95n) / 100n, // 95%
      maxWeightChangeBps: 500,
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 3600,
      maxPriceDeviationBps: 500,
    }

    for (let i = 0; i < config.priceData.length; i++) {
      const dataPoint = config.priceData[i]
      const prices = config.tokens.map((t) => ({
        token: t.address, // Use address to match strategy lookups
        price: BigInt(Math.floor(dataPoint.prices[t.symbol] * 1e8)),
        decimals: 8,
        timestamp: dataPoint.timestamp,
        source: 'historical' as const,
      }))
      strategy.updatePriceHistory(prices)

      const hoursSinceRebalance =
        (dataPoint.timestamp - lastRebalance) / 3600000

      if (hoursSinceRebalance >= config.rebalanceIntervalHours && i > 0) {
        const ctx: StrategyContext = {
          pool: '0x0',
          tokens: config.tokens,
          currentWeights: weights,
          prices,
          priceHistory: [],
          riskParams,
          blockNumber: BigInt(i),
          timestamp: dataPoint.timestamp,
        }

        const calculation = await strategy.calculateWeights(ctx)
        const rebalanceCost = this.calculateRebalanceCost(
          weights,
          calculation.newWeights,
          balances,
          config.tradingFeeBps,
          config.slippageBps,
          dataPoint.prices,
          config.tokens,
        )

        cumulativeFees += rebalanceCost
        weights = calculation.newWeights
        balances = this.rebalanceBalances(
          balances,
          weights,
          dataPoint.prices,
          config.tokens,
        )

        rebalanceCount++
        lastRebalance = dataPoint.timestamp
      }

      const previousPrices =
        i > 0 ? config.priceData[i - 1].prices : dataPoint.prices
      balances = this.updateBalancesForPriceChange(
        balances,
        previousPrices,
        dataPoint.prices,
        config.tokens,
      )

      const valueUsd = this.calculatePortfolioValue(
        balances,
        dataPoint.prices,
        config.tokens,
      )

      const holdValue = this.calculateHoldValue(
        config.initialCapitalUsd,
        config.initialWeights,
        config.priceData[0].prices,
        dataPoint.prices,
        config.tokens,
      )
      const ilPercent = ((holdValue - valueUsd) / holdValue) * 100

      snapshots.push({
        date: dataPoint.date,
        timestamp: dataPoint.timestamp,
        weights: weights.map((w) => Number(w) / 1e18),
        balances,
        valueUsd,
        cumulativeFeesUsd: cumulativeFees,
        impermanentLossPercent: ilPercent,
        rebalanceCount,
      })
    }

    const returns = snapshots.map((s, i) =>
      i === 0
        ? 0
        : (s.valueUsd - snapshots[i - 1].valueUsd) / snapshots[i - 1].valueUsd,
    )

    const totalReturn =
      (snapshots[snapshots.length - 1].valueUsd - config.initialCapitalUsd) /
      config.initialCapitalUsd
    const periodDays =
      (config.endDate.getTime() - config.startDate.getTime()) /
      (1000 * 60 * 60 * 24)
    const annualizedReturn = (1 + totalReturn) ** (365 / periodDays) - 1

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) /
        returns.length,
    )
    const riskFreeRate = 0.05 / 365
    const sharpeRatio = stdDev > 0 ? (meanReturn - riskFreeRate) / stdDev : 0
    const annualizedSharpe = sharpeRatio * Math.sqrt(365)

    let maxDrawdown = 0
    let peak = snapshots[0].valueUsd
    for (const snap of snapshots) {
      if (snap.valueUsd > peak) peak = snap.valueUsd
      const drawdown = (peak - snap.valueUsd) / peak
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }

    let wins = 0
    let trades = 0
    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].rebalanceCount > snapshots[i - 1].rebalanceCount) {
        trades++
        if (snapshots[i].valueUsd > snapshots[i - 1].valueUsd) {
          wins++
        }
      }
    }
    const winRate = trades > 0 ? wins / trades : 0

    const finalSnapshot = snapshots[snapshots.length - 1]
    const holdValue = this.calculateHoldValue(
      config.initialCapitalUsd,
      config.initialWeights,
      config.priceData[0].prices,
      config.priceData[config.priceData.length - 1].prices,
      config.tokens,
    )
    const impermanentLoss = (holdValue - finalSnapshot.valueUsd) / holdValue

    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio: annualizedSharpe,
      maxDrawdown,
      volatility: stdDev * Math.sqrt(365),
      winRate,
      totalTrades: rebalanceCount,
      totalFees: cumulativeFees,
      impermanentLoss,
      netProfit: finalSnapshot.valueUsd - config.initialCapitalUsd,
      snapshots,
    }
  }

  async compare(
    baseConfig: Omit<BacktestConfig, 'strategy'>,
    strategies: ('momentum' | 'mean-reversion' | 'volatility' | 'composite')[],
  ): Promise<Map<string, BacktestResult>> {
    const results = new Map<string, BacktestResult>()

    for (const strategy of strategies) {
      const config: BacktestConfig = { ...baseConfig, strategy }
      const result = await this.run(config)
      results.set(strategy, result)
    }

    const holdResult = this.calculateBuyAndHold(baseConfig)
    results.set('buy-and-hold', holdResult)

    return results
  }

  private createStrategy(
    type: string,
    params?: Record<string, number>,
  ): BaseTFMMStrategy {
    const oracle = new OracleAggregator({})

    switch (type) {
      case 'momentum':
        return new MomentumStrategy(oracle, params)
      case 'mean-reversion':
        return new MeanReversionStrategy(oracle, params)
      case 'volatility':
        return new VolatilityStrategy(oracle, params)
      default:
        return new CompositeStrategy(oracle, params)
    }
  }

  private calculateInitialBalances(
    capitalUsd: number,
    weights: number[],
    prices: Record<string, number>,
    tokens: Token[],
  ): bigint[] {
    return tokens.map((token, i) => {
      const allocationUsd = capitalUsd * weights[i]
      const price = prices[token.symbol]
      const amount = allocationUsd / price
      return BigInt(Math.floor(amount * 10 ** token.decimals))
    })
  }

  private calculatePortfolioValue(
    balances: bigint[],
    prices: Record<string, number>,
    tokens: Token[],
  ): number {
    let total = 0
    for (let i = 0; i < tokens.length; i++) {
      const balance = Number(balances[i]) / 10 ** tokens[i].decimals
      total += balance * prices[tokens[i].symbol]
    }
    return total
  }

  private calculateHoldValue(
    initialCapital: number,
    initialWeights: number[],
    initialPrices: Record<string, number>,
    currentPrices: Record<string, number>,
    tokens: Token[],
  ): number {
    let total = 0
    for (let i = 0; i < tokens.length; i++) {
      const allocation = initialCapital * initialWeights[i]
      const initialAmount = allocation / initialPrices[tokens[i].symbol]
      total += initialAmount * currentPrices[tokens[i].symbol]
    }
    return total
  }

  private calculateRebalanceCost(
    oldWeights: bigint[],
    newWeights: bigint[],
    balances: bigint[],
    feeBps: number,
    slippageBps: number,
    prices: Record<string, number>,
    tokens: Token[],
  ): number {
    let turnover = 0
    const portfolioValue = this.calculatePortfolioValue(
      balances,
      prices,
      tokens,
    )

    for (let i = 0; i < oldWeights.length; i++) {
      const oldWeight = Number(oldWeights[i]) / 1e18
      const newWeight = Number(newWeights[i]) / 1e18
      turnover += Math.abs(newWeight - oldWeight)
    }

    const tradedValue = (portfolioValue * turnover) / 2
    const feeCost = (tradedValue * feeBps) / 10000
    const slippageCost = (tradedValue * slippageBps) / 10000

    return feeCost + slippageCost
  }

  private rebalanceBalances(
    balances: bigint[],
    newWeights: bigint[],
    prices: Record<string, number>,
    tokens: Token[],
  ): bigint[] {
    const portfolioValue = this.calculatePortfolioValue(
      balances,
      prices,
      tokens,
    )

    return tokens.map((token, i) => {
      const targetValue = (portfolioValue * Number(newWeights[i])) / 1e18
      const amount = targetValue / prices[token.symbol]
      return BigInt(Math.floor(amount * 10 ** token.decimals))
    })
  }

  private updateBalancesForPriceChange(
    balances: bigint[],
    _previousPrices: Record<string, number>,
    _currentPrices: Record<string, number>,
    _tokens: Token[],
  ): bigint[] {
    return balances
  }

  private calculateBuyAndHold(
    config: Omit<BacktestConfig, 'strategy'>,
  ): BacktestResult {
    const snapshots: PortfolioSnapshot[] = []
    const initialPrices = config.priceData[0].prices

    for (const dataPoint of config.priceData) {
      const valueUsd = this.calculateHoldValue(
        config.initialCapitalUsd,
        config.initialWeights,
        initialPrices,
        dataPoint.prices,
        config.tokens,
      )

      snapshots.push({
        date: dataPoint.date,
        timestamp: dataPoint.timestamp,
        weights: config.initialWeights,
        balances: [],
        valueUsd,
        cumulativeFeesUsd: 0,
        impermanentLossPercent: 0,
        rebalanceCount: 0,
      })
    }

    const finalValue = snapshots[snapshots.length - 1].valueUsd
    const totalReturn =
      (finalValue - config.initialCapitalUsd) / config.initialCapitalUsd
    const periodDays =
      (config.endDate.getTime() - config.startDate.getTime()) /
      (1000 * 60 * 60 * 24)
    const annualizedReturn = (1 + totalReturn) ** (365 / periodDays) - 1

    const returns = snapshots.map((s, i) =>
      i === 0
        ? 0
        : (s.valueUsd - snapshots[i - 1].valueUsd) / snapshots[i - 1].valueUsd,
    )

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) /
        returns.length,
    )
    const sharpeRatio =
      stdDev > 0 ? ((meanReturn - 0.05 / 365) / stdDev) * Math.sqrt(365) : 0

    let maxDrawdown = 0
    let peak = snapshots[0].valueUsd
    for (const snap of snapshots) {
      if (snap.valueUsd > peak) peak = snap.valueUsd
      const drawdown = (peak - snap.valueUsd) / peak
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }

    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      volatility: stdDev * Math.sqrt(365),
      winRate: 0,
      totalTrades: 0,
      totalFees: 0,
      impermanentLoss: 0,
      netProfit: finalValue - config.initialCapitalUsd,
      snapshots,
    }
  }
}
