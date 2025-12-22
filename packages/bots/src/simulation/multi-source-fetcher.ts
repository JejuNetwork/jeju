/**
 * Multi-Source Historical Data Fetcher
 *
 * Aggregates data from multiple premium and free sources:
 * - DeFi Llama (TVL, prices, yields)
 * - Helius (Solana transactions, prices)
 * - Alchemy (EVM transaction history, gas)
 * - Codex (Indexed blockchain data)
 * - CoinGecko (Additional price source)
 *
 * Features:
 * - Cross-chain MEV opportunity detection
 * - Historical gas price analysis
 * - DEX pool state reconstruction
 * - Stress test scenario data (2020 COVID, 2022 Terra/FTX)
 */

import type { Token } from '../types'
import type { PriceDataPoint } from './backtester'

// ============ Types ============

export interface GasDataPoint {
  timestamp: number
  chainId: number
  baseFee: bigint
  priorityFee: bigint
  blockUtilization: number
  blockNumber: bigint
}

export interface PoolStateSnapshot {
  timestamp: number
  chainId: number
  poolAddress: string
  dex: string
  token0: string
  token1: string
  reserve0: bigint
  reserve1: bigint
  fee: number
  liquidity: bigint
  sqrtPriceX96?: bigint // V3 pools
  tick?: number
}

export interface MEVOpportunity {
  timestamp: number
  chainId: number
  type: 'arbitrage' | 'sandwich' | 'liquidation'
  profitUsd: number
  gasUsed: bigint
  gasPriceGwei: number
  executedBy: string
  txHash: string
  successful: boolean
}

export interface StressTestScenario {
  name: string
  description: string
  startDate: Date
  endDate: Date
  peakDrawdown: number
  maxGasGwei: number
  events: string[]
}

export interface DataSourceConfig {
  defiLlamaApiKey?: string
  heliusApiKey?: string
  alchemyApiKey?: string
  codexApiKey?: string
  coingeckoApiKey?: string
}

// ============ Constants ============

const DEFI_LLAMA_BASE = 'https://api.llama.fi'
const DEFI_LLAMA_COINS = 'https://coins.llama.fi'
const HELIUS_BASE = 'https://api.helius.xyz/v0'
const CODEX_BASE = 'https://graph.codex.io/graphql'

// Chain IDs for multi-chain support
export const SUPPORTED_CHAINS = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
  solana: 'solana-mainnet',
} as const

// Token address mappings per chain
const TOKEN_ADDRESSES: Record<number | string, Record<string, string>> = {
  1: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EesdfDcD5F8a01',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  },
  8453: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  },
  42161: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },
  'solana-mainnet': {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  },
}

// Historical stress test scenarios
export const STRESS_SCENARIOS: StressTestScenario[] = [
  {
    name: 'COVID Crash March 2020',
    description:
      'Black Thursday - ETH dropped 50%+ in 24h, MakerDAO liquidations cascade',
    startDate: new Date('2020-03-11'),
    endDate: new Date('2020-03-15'),
    peakDrawdown: 0.55,
    maxGasGwei: 500,
    events: [
      'ETH flash crash to $90',
      'MakerDAO $4M bad debt',
      'Uniswap V2 record volume',
      'Oracle delays',
    ],
  },
  {
    name: 'Terra/Luna Collapse May 2022',
    description: 'UST depeg caused cascading liquidations across all DeFi',
    startDate: new Date('2022-05-07'),
    endDate: new Date('2022-05-14'),
    peakDrawdown: 0.68,
    maxGasGwei: 1500,
    events: [
      'UST depeg to $0.10',
      'LUNA hyperinflation',
      'Anchor withdrawal run',
      'Cross-chain contagion',
      'CEX halts',
    ],
  },
  {
    name: 'FTX Collapse November 2022',
    description: 'FTX/Alameda insolvency caused market-wide panic',
    startDate: new Date('2022-11-06'),
    endDate: new Date('2022-11-14'),
    peakDrawdown: 0.35,
    maxGasGwei: 300,
    events: [
      'FTT collapse',
      'CEX withdrawal runs',
      'USDC/USDT premium',
      'Solana ecosystem crash',
      'Bridge congestion',
    ],
  },
  {
    name: 'SVB/USDC Depeg March 2023',
    description: 'USDC briefly depegged due to SVB exposure fears',
    startDate: new Date('2023-03-10'),
    endDate: new Date('2023-03-13'),
    peakDrawdown: 0.12,
    maxGasGwei: 200,
    events: [
      'USDC $0.87 low',
      'DAI depeg',
      'Curve 3pool imbalance',
      'Arb opportunities on stables',
    ],
  },
]

// ============ Multi-Source Fetcher ============

// Cache entry type - stores arbitrary serializable data with expiration
interface CacheEntry<T = Map<number, number> | number | object> {
  data: T
  expiry: number
}

export class MultiSourceFetcher {
  private config: DataSourceConfig
  // Generic cache for API responses - uses type assertion on retrieval
  private cache: Map<string, CacheEntry> = new Map()
  private rateLimits: Map<string, { remaining: number; reset: number }> =
    new Map()

  constructor(config: DataSourceConfig = {}) {
    this.config = {
      defiLlamaApiKey: config.defiLlamaApiKey ?? process.env.DEFILLAMA_API_KEY,
      heliusApiKey: config.heliusApiKey ?? process.env.HELIUS_API_KEY,
      alchemyApiKey: config.alchemyApiKey ?? process.env.ALCHEMY_API_KEY,
      codexApiKey: config.codexApiKey ?? process.env.CODEX_API_KEY,
      coingeckoApiKey: config.coingeckoApiKey ?? process.env.COINGECKO_API_KEY,
    }
  }

  // ============ DeFi Llama Integration ============

  /**
   * Fetch historical prices from DeFi Llama (free, no API key needed)
   */
  async fetchDefiLlamaPrices(
    tokens: Token[],
    startDate: Date,
    endDate: Date,
    intervalMs: number = 3600000, // Hourly
  ): Promise<PriceDataPoint[]> {
    const dataPoints: PriceDataPoint[] = []
    const tokenPrices = new Map<string, Map<number, number>>()

    for (const token of tokens) {
      const address = this.getTokenLlamaId(token)
      if (!address) continue

      const prices = await this.fetchLlamaHistoricalPrices(
        address,
        startDate,
        endDate,
      )
      tokenPrices.set(token.symbol, prices)
    }

    // Merge into data points at specified intervals
    for (
      let ts = startDate.getTime();
      ts <= endDate.getTime();
      ts += intervalMs
    ) {
      const prices: Record<string, number> = {}
      let hasAll = true

      for (const token of tokens) {
        const tokenMap = tokenPrices.get(token.symbol)
        if (!tokenMap) {
          hasAll = false
          break
        }

        const price = this.findClosestPrice(tokenMap, ts, intervalMs)
        if (price === null) {
          hasAll = false
          break
        }
        prices[token.symbol] = price
      }

      if (hasAll) {
        dataPoints.push({ date: new Date(ts), timestamp: ts, prices })
      }
    }

    return dataPoints
  }

  private async fetchLlamaHistoricalPrices(
    tokenId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Map<number, number>> {
    const cacheKey = `llama-${tokenId}-${startDate.getTime()}-${endDate.getTime()}`
    const cached = this.getCached<Map<number, number>>(cacheKey)
    if (cached) return cached

    const url = `${DEFI_LLAMA_COINS}/chart/${tokenId}?start=${Math.floor(startDate.getTime() / 1000)}&span=${Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000)}&period=1h`

    const response = await this.fetchWithRateLimit('defillama', url)
    if (!response.ok) {
      console.warn(`DeFi Llama API error: ${response.status}`)
      return new Map()
    }

    const data = (await response.json()) as {
      coins: Record<
        string,
        { prices: Array<{ timestamp: number; price: number }> }
      >
    }
    const priceMap = new Map<number, number>()

    const coinData = data.coins?.[tokenId]
    if (coinData?.prices) {
      for (const point of coinData.prices) {
        priceMap.set(point.timestamp * 1000, point.price)
      }
    }

    this.setCache(cacheKey, priceMap, 3600000) // 1 hour cache
    return priceMap
  }

  /**
   * Fetch TVL history from DeFi Llama
   */
  async fetchProtocolTVL(
    protocol: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ timestamp: number; tvlUsd: number }>> {
    const url = `${DEFI_LLAMA_BASE}/protocol/${protocol}`

    const response = await this.fetchWithRateLimit('defillama', url)
    if (!response.ok) return []

    const data = (await response.json()) as {
      tvl: Array<{ date: number; totalLiquidityUSD: number }>
    }
    const startTs = startDate.getTime() / 1000
    const endTs = endDate.getTime() / 1000

    return (data.tvl ?? [])
      .filter((p) => p.date >= startTs && p.date <= endTs)
      .map((p) => ({ timestamp: p.date * 1000, tvlUsd: p.totalLiquidityUSD }))
  }

  /**
   * Fetch yield/APY history from DeFi Llama
   */
  async fetchYieldHistory(
    pool: string,
  ): Promise<Array<{ timestamp: number; apy: number; tvlUsd: number }>> {
    const url = `${DEFI_LLAMA_BASE}/yields/chart/${pool}`

    const response = await this.fetchWithRateLimit('defillama', url)
    if (!response.ok) return []

    const data = (await response.json()) as {
      data: Array<{ timestamp: string; apy: number; tvlUsd: number }>
    }

    return (data.data ?? []).map((p) => ({
      timestamp: new Date(p.timestamp).getTime(),
      apy: p.apy,
      tvlUsd: p.tvlUsd,
    }))
  }

  // ============ Helius Integration (Solana) ============

  /**
   * Fetch Solana historical transactions for MEV analysis
   */
  async fetchSolanaMEVHistory(
    wallet: string,
    startDate: Date,
    endDate: Date,
  ): Promise<MEVOpportunity[]> {
    if (!this.config.heliusApiKey) {
      console.warn('Helius API key not configured, skipping Solana MEV data')
      return []
    }

    const url = `${HELIUS_BASE}/addresses/${wallet}/transactions?api-key=${this.config.heliusApiKey}&type=SWAP`

    const response = await this.fetchWithRateLimit('helius', url)
    if (!response.ok) return []

    const txs = (await response.json()) as Array<{
      timestamp: number
      signature: string
      fee: number
      feePayer: string
      type: string
      slot: number
      tokenTransfers?: Array<{
        mint: string
        tokenAmount: number
        fromUserAccount: string
        toUserAccount: string
      }>
    }>
    const startTs = startDate.getTime() / 1000
    const endTs = endDate.getTime() / 1000

    return txs
      .filter((tx) => tx.timestamp >= startTs && tx.timestamp <= endTs)
      .map((tx) => ({
        timestamp: tx.timestamp * 1000,
        chainId: 0, // Solana
        type: 'arbitrage' as const,
        profitUsd: 0, // Would need to calculate from token transfers
        gasUsed: BigInt(tx.fee),
        gasPriceGwei: 0.000001, // Solana uses lamports
        executedBy: tx.feePayer,
        txHash: tx.signature,
        successful: true,
      }))
  }

  /**
   * Fetch Solana token prices via Helius
   */
  async fetchSolanaTokenPrices(
    mints: string[],
  ): Promise<Record<string, number>> {
    if (!this.config.heliusApiKey) return {}

    const url = `${HELIUS_BASE}/token-metadata?api-key=${this.config.heliusApiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mintAccounts: mints }),
    })

    if (!response.ok) return {}

    const data = (await response.json()) as Array<{
      account: string
      onChainData?: { price?: number }
    }>
    const prices: Record<string, number> = {}

    for (const token of data) {
      if (token.onChainData?.price) {
        prices[token.account] = token.onChainData.price
      }
    }

    return prices
  }

  // ============ Alchemy Integration (EVM) ============

  /**
   * Fetch historical gas prices from Alchemy
   */
  async fetchGasHistory(
    chainId: number,
    startBlock: bigint,
    endBlock: bigint,
    sampleInterval: number = 100,
  ): Promise<GasDataPoint[]> {
    if (!this.config.alchemyApiKey) {
      throw new Error(
        'ALCHEMY_API_KEY environment variable is required for gas history',
      )
    }

    const chainName = this.getAlchemyChainName(chainId)
    if (!chainName) return []

    const url = `https://${chainName}.g.alchemy.com/v2/${this.config.alchemyApiKey}`
    const gasData: GasDataPoint[] = []

    for (
      let block = startBlock;
      block <= endBlock;
      block += BigInt(sampleInterval)
    ) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBlockByNumber',
          params: [`0x${block.toString(16)}`, false],
        }),
      })

      if (!response.ok) continue

      const data = (await response.json()) as {
        result?: {
          timestamp: string
          baseFeePerGas?: string
          gasUsed: string
          gasLimit: string
        }
      }
      if (!data.result) continue

      const blockData = data.result
      gasData.push({
        timestamp: parseInt(blockData.timestamp, 16) * 1000,
        chainId,
        baseFee: BigInt(blockData.baseFeePerGas ?? '0'),
        priorityFee: BigInt(2e9), // Estimate 2 gwei priority
        blockUtilization:
          parseInt(blockData.gasUsed, 16) / parseInt(blockData.gasLimit, 16),
        blockNumber: block,
      })
    }

    return gasData
  }

  /**
   * Fetch historical DEX pool events for state reconstruction
   */
  async fetchPoolEvents(
    chainId: number,
    poolAddress: string,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<PoolStateSnapshot[]> {
    if (!this.config.alchemyApiKey) return []

    const chainName = this.getAlchemyChainName(chainId)
    if (!chainName) return []

    const url = `https://${chainName}.g.alchemy.com/v2/${this.config.alchemyApiKey}`

    // Sync event topic for Uniswap V2 style pools
    const syncTopic =
      '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [
          {
            address: poolAddress,
            topics: [syncTopic],
            fromBlock: `0x${startBlock.toString(16)}`,
            toBlock: `0x${endBlock.toString(16)}`,
          },
        ],
      }),
    })

    if (!response.ok) return []

    const data = (await response.json()) as {
      result?: Array<{
        blockNumber: string
        data: string
        transactionHash: string
      }>
    }
    if (!data.result) return []

    return data.result.map((log) => {
      // Decode Sync event: reserve0, reserve1
      const reserve0 = BigInt(`0x${log.data.slice(2, 66)}`)
      const reserve1 = BigInt(`0x${log.data.slice(66, 130)}`)

      return {
        timestamp: 0, // Would need block timestamp lookup
        chainId,
        poolAddress,
        dex: 'uniswap-v2',
        token0: '',
        token1: '',
        reserve0,
        reserve1,
        fee: 30, // 0.3% default
        liquidity: 0n,
      }
    })
  }

  // ============ Codex Integration ============

  /**
   * Fetch MEV data from Codex indexed data
   */
  async fetchCodexMEVData(
    chainId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<MEVOpportunity[]> {
    if (!this.config.codexApiKey) return []

    const query = `
      query MEVTransactions($chainId: Int!, $startTime: Int!, $endTime: Int!) {
        mevTransactions(
          chainId: $chainId
          startTime: $startTime
          endTime: $endTime
          first: 1000
        ) {
          nodes {
            timestamp
            txHash
            type
            profitUsd
            gasUsed
            gasPrice
            successful
            searcher
          }
        }
      }
    `

    const response = await fetch(CODEX_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.codexApiKey}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          chainId,
          startTime: Math.floor(startDate.getTime() / 1000),
          endTime: Math.floor(endDate.getTime() / 1000),
        },
      }),
    })

    if (!response.ok) return []

    const data = (await response.json()) as {
      data?: {
        mevTransactions?: {
          nodes: Array<{
            timestamp: number
            txHash: string
            type: string
            profitUsd: number
            gasUsed: string
            gasPrice: string
            successful: boolean
            searcher: string
          }>
        }
      }
    }

    return (data.data?.mevTransactions?.nodes ?? []).map((tx) => ({
      timestamp: tx.timestamp * 1000,
      chainId,
      type: tx.type as 'arbitrage' | 'sandwich' | 'liquidation',
      profitUsd: tx.profitUsd,
      gasUsed: BigInt(tx.gasUsed),
      gasPriceGwei: parseInt(tx.gasPrice, 10) / 1e9,
      executedBy: tx.searcher,
      txHash: tx.txHash,
      successful: tx.successful,
    }))
  }

  // ============ Stress Test Data ============

  /**
   * Fetch data for a specific stress test scenario
   */
  async fetchStressScenarioData(
    scenario: StressTestScenario,
    tokens: Token[],
  ): Promise<{
    prices: PriceDataPoint[]
    gas: GasDataPoint[]
    tvl: Array<{ timestamp: number; tvlUsd: number }>
  }> {
    console.log(`Fetching stress test data: ${scenario.name}`)

    const [prices, gas, tvl] = await Promise.all([
      this.fetchDefiLlamaPrices(
        tokens,
        scenario.startDate,
        scenario.endDate,
        3600000, // Hourly for stress tests
      ),
      this.fetchGasHistory(1, 0n, 0n), // Ethereum mainnet
      this.fetchProtocolTVL('aave-v2', scenario.startDate, scenario.endDate),
    ])

    return { prices, gas, tvl }
  }

  /**
   * Get all stress test scenarios
   */
  getStressScenarios(): StressTestScenario[] {
    return STRESS_SCENARIOS
  }

  // ============ Multi-Chain Opportunity Scanner ============

  /**
   * Scan for arbitrage opportunities across all supported chains
   */
  async scanCrossChainOpportunities(tokens: string[]): Promise<
    Array<{
      token: string
      sourceChain: number | string
      destChain: number | string
      sourcePrice: number
      destPrice: number
      spreadBps: number
      bridgeTimeEstimate: number
    }>
  > {
    const opportunities: Array<{
      token: string
      sourceChain: number | string
      destChain: number | string
      sourcePrice: number
      destPrice: number
      spreadBps: number
      bridgeTimeEstimate: number
    }> = []

    // Fetch current prices across all chains
    const chainPrices = new Map<string, Map<string | number, number>>()

    for (const token of tokens) {
      const pricesByChain = new Map<string | number, number>()

      for (const [chainName, chainId] of Object.entries(SUPPORTED_CHAINS)) {
        const addresses = TOKEN_ADDRESSES[chainId]
        if (!addresses?.[token]) continue

        const llamaId = `${chainName}:${addresses[token]}`
        const url = `${DEFI_LLAMA_COINS}/prices/current/${llamaId}`

        const response = await this.fetchWithRateLimit('defillama', url)
        if (!response.ok) continue

        const data = (await response.json()) as {
          coins?: Record<string, { price: number }>
        }
        if (data.coins?.[llamaId]) {
          pricesByChain.set(chainId, data.coins[llamaId].price)
        }
      }

      chainPrices.set(token, pricesByChain)
    }

    // Find opportunities
    for (const [token, priceMap] of chainPrices) {
      const chains = Array.from(priceMap.entries())

      for (let i = 0; i < chains.length; i++) {
        for (let j = i + 1; j < chains.length; j++) {
          const [chain1, price1] = chains[i]
          const [chain2, price2] = chains[j]

          const spreadBps = Math.abs(((price1 - price2) / price1) * 10000)

          if (spreadBps > 10) {
            // > 0.1% spread
            opportunities.push({
              token,
              sourceChain: price1 < price2 ? chain1 : chain2,
              destChain: price1 < price2 ? chain2 : chain1,
              sourcePrice: Math.min(price1, price2),
              destPrice: Math.max(price1, price2),
              spreadBps,
              bridgeTimeEstimate: this.estimateBridgeTime(chain1, chain2),
            })
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.spreadBps - a.spreadBps)
  }

  // ============ Helpers ============

  private getTokenLlamaId(token: Token): string | null {
    const chainMap: Record<number, string> = {
      1: 'ethereum',
      8453: 'base',
      42161: 'arbitrum',
      10: 'optimism',
      137: 'polygon',
      56: 'bsc',
    }

    const chainName = chainMap[token.chainId as number]
    if (!chainName) return null

    return `${chainName}:${token.address}`
  }

  private getAlchemyChainName(chainId: number): string | null {
    const chainMap: Record<number, string> = {
      1: 'eth-mainnet',
      8453: 'base-mainnet',
      42161: 'arb-mainnet',
      10: 'opt-mainnet',
      137: 'polygon-mainnet',
    }
    return chainMap[chainId] ?? null
  }

  private findClosestPrice(
    priceMap: Map<number, number>,
    targetTs: number,
    maxDiff: number,
  ): number | null {
    let closest = null
    let closestDiff = Infinity

    for (const [ts, price] of priceMap) {
      const diff = Math.abs(ts - targetTs)
      if (diff < closestDiff && diff <= maxDiff) {
        closestDiff = diff
        closest = price
      }
    }

    return closest
  }

  private estimateBridgeTime(
    chain1: number | string,
    chain2: number | string,
  ): number {
    // Rough estimates in seconds
    if (chain1 === 'solana-mainnet' || chain2 === 'solana-mainnet') {
      return 900 // 15 min for Solana bridges
    }
    if (chain1 === 1 || chain2 === 1) {
      return 300 // 5 min for mainnet bridges
    }
    return 120 // 2 min for L2-L2
  }

  private async fetchWithRateLimit(
    source: string,
    url: string,
  ): Promise<Response> {
    const limit = this.rateLimits.get(source)
    if (limit && limit.remaining <= 0 && Date.now() < limit.reset) {
      await new Promise((resolve) =>
        setTimeout(resolve, limit.reset - Date.now()),
      )
    }

    const response = await fetch(url)

    // Update rate limits from headers
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')

    if (remaining && reset) {
      this.rateLimits.set(source, {
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10) * 1000,
      })
    }

    return response
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry || Date.now() > entry.expiry) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data as T
  }

  private setCache<T extends Map<number, number> | number | object>(
    key: string,
    data: T,
    ttlMs: number,
  ): void {
    // Limit cache size
    if (this.cache.size > 500) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) this.cache.delete(oldestKey)
    }

    this.cache.set(key, { data, expiry: Date.now() + ttlMs })
  }

  clearCache(): void {
    this.cache.clear()
  }
}
