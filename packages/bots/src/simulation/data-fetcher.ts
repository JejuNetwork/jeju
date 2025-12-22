/**
 * Historical Data Fetcher
 */

import { expectValid } from '@jejunetwork/types'
import { CoinGeckoMarketChartSchema } from '../schemas'
import type { Token } from '../types'
import type { PriceDataPoint } from './backtester'

export interface PriceCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const MAX_CACHE_ENTRIES = 100

const COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BTC: 'bitcoin',
  WBTC: 'wrapped-bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  ARB: 'arbitrum',
  OP: 'optimism',
  SOL: 'solana',
  BNB: 'binancecoin',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
}

export class HistoricalDataFetcher {
  private baseUrl = 'https://api.coingecko.com/api/v3'
  private cache: Map<string, PriceDataPoint[]> = new Map()

  async fetchPrices(
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number = 86400000, // Daily by default
  ): Promise<PriceDataPoint[]> {
    const cacheKey = `${tokens.map((t) => t.symbol).join('-')}-${startDate.getTime()}-${endDate.getTime()}`

    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    const tokenPrices = new Map<string, Map<number, number>>()

    for (const token of tokens) {
      const geckoId = COINGECKO_IDS[token.symbol]
      if (!geckoId) {
        console.warn(`No CoinGecko ID for ${token.symbol}, skipping`)
        continue
      }

      const prices = await this.fetchTokenPrices(geckoId, startDate, endDate)
      tokenPrices.set(token.symbol, prices)
    }

    const dataPoints = this.mergeTokenPrices(
      tokenPrices,
      tokens,
      startDate,
      endDate,
      intervalMs,
    )

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(cacheKey, dataPoints)
    return dataPoints
  }

  private async fetchTokenPrices(
    geckoId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Map<number, number>> {
    const fromTimestamp = Math.floor(startDate.getTime() / 1000)
    const toTimestamp = Math.floor(endDate.getTime() / 1000)

    const url = `${this.baseUrl}/coins/${geckoId}/market_chart/range?vs_currency=usd&from=${fromTimestamp}&to=${toTimestamp}`

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`)
    }

    const data = expectValid(
      CoinGeckoMarketChartSchema,
      await response.json(),
      `CoinGecko price data for ${geckoId}`,
    )

    const priceMap = new Map<number, number>()
    for (const [timestamp, price] of data.prices) {
      priceMap.set(timestamp, price)
    }

    return priceMap
  }

  private mergeTokenPrices(
    tokenPrices: Map<string, Map<number, number>>,
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number,
  ): PriceDataPoint[] {
    const dataPoints: PriceDataPoint[] = []

    for (
      let ts = startDate.getTime();
      ts <= endDate.getTime();
      ts += intervalMs
    ) {
      const prices: Record<string, number> = {}
      let hasAllPrices = true

      for (const token of tokens) {
        const tokenPriceMap = tokenPrices.get(token.symbol)
        if (!tokenPriceMap) {
          hasAllPrices = false
          break
        }

        let closestPrice = 0
        let closestDiff = Infinity

        for (const [priceTs, price] of tokenPriceMap) {
          const diff = Math.abs(priceTs - ts)
          if (diff < closestDiff && diff < 86400000) {
            closestDiff = diff
            closestPrice = price
          }
        }

        if (closestPrice === 0) {
          hasAllPrices = false
          break
        }

        prices[token.symbol] = closestPrice
      }

      if (hasAllPrices) {
        dataPoints.push({
          date: new Date(ts),
          timestamp: ts,
          prices,
        })
      }
    }

    return dataPoints
  }

  async fetchCandles(
    _protocol: string,
    _pool: string,
    _startDate: Date,
    _endDate: Date,
  ): Promise<PriceCandle[]> {
    return []
  }

  generateSyntheticData(
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number,
    params: {
      initialPrices: Record<string, number>
      volatilities: Record<string, number>
      correlations?: number[][]
      trend?: number // Daily drift (e.g., 0.001 for +0.1% per day)
    },
  ): PriceDataPoint[] {
    const dataPoints: PriceDataPoint[] = []
    const numPeriods = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / intervalMs,
    )
    const currentPrices = { ...params.initialPrices }

    for (let i = 0; i < numPeriods; i++) {
      const timestamp = startDate.getTime() + i * intervalMs
      const prices: Record<string, number> = {}

      const tokenVolatilities = tokens.map((t) => {
        const vol = params.volatilities[t.symbol]
        if (vol === undefined) {
          throw new Error(`Missing volatility for token ${t.symbol}`)
        }
        return vol
      })

      const returns = this.generateCorrelatedReturns(
        tokenVolatilities,
        params.correlations,
      )

      const drift = params.trend !== undefined ? params.trend : 0

      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j]
        const dailyVol = tokenVolatilities[j] / Math.sqrt(365)

        currentPrices[token.symbol] *= Math.exp(
          (drift - dailyVol ** 2 / 2) * (intervalMs / 86400000) +
            dailyVol * Math.sqrt(intervalMs / 86400000) * returns[j],
        )

        prices[token.symbol] = currentPrices[token.symbol]
      }

      dataPoints.push({
        date: new Date(timestamp),
        timestamp,
        prices,
      })
    }

    return dataPoints
  }

  private generateCorrelatedReturns(
    volatilities: number[],
    correlations?: number[][],
  ): number[] {
    const n = volatilities.length
    const z: number[] = []
    for (let i = 0; i < n; i++) {
      z.push(this.randomNormal())
    }

    if (!correlations) {
      return z
    }

    const L = this.choleskyDecomposition(correlations)
    const correlated: number[] = []
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let j = 0; j <= i; j++) {
        sum += L[i][j] * z[j]
      }
      correlated.push(sum)
    }

    return correlated
  }

  private randomNormal(): number {
    const u1 = Math.random()
    const u2 = Math.random()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  private choleskyDecomposition(matrix: number[][]): number[][] {
    const n = matrix.length
    const L: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0))

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k]
        }

        if (i === j) {
          L[i][j] = Math.sqrt(matrix[i][i] - sum)
        } else {
          L[i][j] = (matrix[i][j] - sum) / L[j][j]
        }
      }
    }

    return L
  }

  clearCache(): void {
    this.cache.clear()
  }
}
