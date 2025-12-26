/**
 * Historical Data Fetcher
 *
 * Fetches price data from CoinGecko and other sources.
 * Supports routing through DWS for decentralized API access.
 */

import { expectValid } from '@jejunetwork/types'
import { type DWSClient, getDWSClient } from '../dws'
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

export interface HistoricalDataFetcherConfig {
  /** Use DWS for API access (decentralized, rate-limit protected) */
  useDWS?: boolean
  /** DWS client instance (uses shared instance if not provided) */
  dwsClient?: DWSClient
  /** Direct CoinGecko API URL (fallback if DWS not available) */
  baseUrl?: string
}

export class HistoricalDataFetcher {
  private baseUrl: string
  private cache: Map<string, PriceDataPoint[]> = new Map()
  private useDWS: boolean
  private dwsClient: DWSClient | null

  constructor(config: HistoricalDataFetcherConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.coingecko.com/api/v3'
    this.useDWS = config.useDWS ?? false
    this.dwsClient = config.dwsClient ?? null
  }

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

    let data: { prices: [number, number][] }

    if (this.useDWS) {
      // Use DWS for decentralized API access
      const client = this.dwsClient ?? getDWSClient()
      const response = await client.request<{
        prices: [number, number][]
        market_caps: [number, number][]
        total_volumes: [number, number][]
      }>({
        providerId: 'coingecko',
        endpoint: `/coins/${geckoId}/market_chart/range`,
        queryParams: {
          vs_currency: 'usd',
          from: fromTimestamp.toString(),
          to: toTimestamp.toString(),
        },
      })

      data = expectValid(
        CoinGeckoMarketChartSchema,
        response.data,
        `CoinGecko price data for ${geckoId}`,
      )
    } else {
      // Direct API access
      const url = `${this.baseUrl}/coins/${geckoId}/market_chart/range?vs_currency=usd&from=${fromTimestamp}&to=${toTimestamp}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`)
      }

      data = expectValid(
        CoinGeckoMarketChartSchema,
        await response.json(),
        `CoinGecko price data for ${geckoId}`,
      )
    }

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

  /**
   * Fetch OHLCV candle data from protocol-specific sources
   */
  async fetchCandles(
    protocol: string,
    pool: string,
    startDate: Date,
    endDate: Date,
    intervalMinutes = 60,
  ): Promise<PriceCandle[]> {
    if (protocol === 'uniswap-v3' || protocol === 'uniswap-v2') {
      return this.fetchUniswapCandles(pool, startDate, endDate, intervalMinutes)
    }
    if (protocol === 'coingecko') {
      return this.fetchCoinGeckoCandles(pool, startDate, endDate)
    }
    throw new Error(`Unsupported protocol: ${protocol}`)
  }

  /**
   * Fetch candles from Uniswap subgraph
   */
  private async fetchUniswapCandles(
    poolAddress: string,
    startDate: Date,
    endDate: Date,
    intervalMinutes: number,
  ): Promise<PriceCandle[]> {
    const UNISWAP_V3_SUBGRAPH =
      'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'

    const startTimestamp = Math.floor(startDate.getTime() / 1000)
    const endTimestamp = Math.floor(endDate.getTime() / 1000)

    // Query pool hour data
    const query = `{
      poolHourDatas(
        where: {
          pool: "${poolAddress.toLowerCase()}"
          periodStartUnix_gte: ${startTimestamp}
          periodStartUnix_lte: ${endTimestamp}
        }
        orderBy: periodStartUnix
        orderDirection: asc
        first: 1000
      ) {
        periodStartUnix
        open
        high
        low
        close
        volumeUSD
      }
    }`

    const response = await fetch(UNISWAP_V3_SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      throw new Error(`Uniswap subgraph error: ${response.status}`)
    }

    const json = (await response.json()) as {
      data?: {
        poolHourDatas: Array<{
          periodStartUnix: number
          open: string
          high: string
          low: string
          close: string
          volumeUSD: string
        }>
      }
    }

    if (!json.data?.poolHourDatas) {
      return []
    }

    const hourlyCandles = json.data.poolHourDatas.map((d) => ({
      timestamp: d.periodStartUnix * 1000,
      open: parseFloat(d.open),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      close: parseFloat(d.close),
      volume: parseFloat(d.volumeUSD),
    }))

    // Aggregate to requested interval if needed
    if (intervalMinutes === 60) {
      return hourlyCandles
    }

    return this.aggregateCandles(hourlyCandles, intervalMinutes)
  }

  /**
   * Fetch candles from CoinGecko (uses token ID as pool)
   */
  private async fetchCoinGeckoCandles(
    tokenId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PriceCandle[]> {
    const fromTimestamp = Math.floor(startDate.getTime() / 1000)
    const toTimestamp = Math.floor(endDate.getTime() / 1000)

    const url = `${this.baseUrl}/coins/${tokenId}/market_chart/range?vs_currency=usd&from=${fromTimestamp}&to=${toTimestamp}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`)
    }

    const data = expectValid(
      CoinGeckoMarketChartSchema,
      await response.json(),
      `CoinGecko candle data for ${tokenId}`,
    )

    // CoinGecko returns price points, we need to construct OHLCV
    // Group by day for daily candles
    const dailyData = new Map<number, { prices: number[]; volumes: number[] }>()

    for (const [timestamp, price] of data.prices) {
      const dayStart = Math.floor(timestamp / 86400000) * 86400000
      const existing = dailyData.get(dayStart)
      if (existing) {
        existing.prices.push(price)
      } else {
        dailyData.set(dayStart, { prices: [price], volumes: [] })
      }
    }

    for (const [timestamp, volume] of data.total_volumes) {
      const dayStart = Math.floor(timestamp / 86400000) * 86400000
      const existing = dailyData.get(dayStart)
      if (existing) {
        existing.volumes.push(volume)
      }
    }

    const candles: PriceCandle[] = []

    for (const [timestamp, { prices, volumes }] of dailyData) {
      if (prices.length === 0) continue

      candles.push({
        timestamp,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume:
          volumes.length > 0
            ? volumes.reduce((a, b) => a + b, 0) / volumes.length
            : 0,
      })
    }

    return candles.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Aggregate hourly candles to larger intervals
   */
  private aggregateCandles(
    hourlyCandles: PriceCandle[],
    intervalMinutes: number,
  ): PriceCandle[] {
    if (hourlyCandles.length === 0) return []

    const intervalMs = intervalMinutes * 60 * 1000
    const aggregated: PriceCandle[] = []

    let currentPeriodStart =
      Math.floor(hourlyCandles[0].timestamp / intervalMs) * intervalMs
    let currentCandles: PriceCandle[] = []

    for (const candle of hourlyCandles) {
      const periodStart = Math.floor(candle.timestamp / intervalMs) * intervalMs

      if (periodStart !== currentPeriodStart && currentCandles.length > 0) {
        aggregated.push(this.mergeCandles(currentPeriodStart, currentCandles))
        currentCandles = []
        currentPeriodStart = periodStart
      }

      currentCandles.push(candle)
    }

    if (currentCandles.length > 0) {
      aggregated.push(this.mergeCandles(currentPeriodStart, currentCandles))
    }

    return aggregated
  }

  private mergeCandles(timestamp: number, candles: PriceCandle[]): PriceCandle {
    return {
      timestamp,
      open: candles[0].open,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
      close: candles[candles.length - 1].close,
      volume: candles.reduce((sum, c) => sum + c.volume, 0),
    }
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
