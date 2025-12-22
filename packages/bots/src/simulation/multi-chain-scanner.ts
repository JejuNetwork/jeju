/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Multi-Chain Opportunity Scanner
 *
 * Scans for arbitrage and MEV opportunities across:
 * - EVM Chains: Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche
 * - Solana: Jupiter aggregator, Raydium, Orca
 *
 * Features:
 * - Real-time cross-chain price monitoring
 * - Bridge cost analysis
 * - Latency-aware opportunity scoring
 * - Historical opportunity analysis
 */

import { createPublicClient, http } from 'viem'
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains'

// ============ Types ============

export interface ChainPrice {
  chainId: number | string
  chainName: string
  token: string
  price: number
  dex: string
  liquidity: bigint
  timestamp: number
}

export interface CrossChainOpportunity {
  id: string
  token: string
  buyChain: ChainPrice
  sellChain: ChainPrice
  spreadBps: number
  estimatedProfitUsd: number
  bridgeCostUsd: number
  bridgeTimeMinutes: number
  netProfitUsd: number
  riskScore: number // 0-100, higher = riskier
  expiresAt: number
}

export interface SameChainOpportunity {
  id: string
  chainId: number
  token: string
  buyDex: string
  sellDex: string
  buyPrice: number
  sellPrice: number
  spreadBps: number
  estimatedProfitUsd: number
  gasCostUsd: number
  netProfitUsd: number
  path: string[]
}

export interface ScanResult {
  timestamp: number
  crossChainOpportunities: CrossChainOpportunity[]
  sameChainOpportunities: SameChainOpportunity[]
  chainStatus: ChainStatus[]
  totalOpportunityValue: number
}

export interface ChainStatus {
  chainId: number | string
  name: string
  blockNumber: bigint
  gasPrice: bigint
  lastUpdate: number
  healthy: boolean
}

export interface ScannerConfig {
  chains: Array<{
    chainId: number | string
    rpcUrl: string
    name: string
  }>
  tokens: string[]
  minSpreadBps: number
  minProfitUsd: number
  scanIntervalMs: number
  heliusApiKey?: string
}

// ============ Constants ============

const EVM_CHAINS = {
  1: { chain: mainnet, name: 'Ethereum' },
  8453: { chain: base, name: 'Base' },
  42161: { chain: arbitrum, name: 'Arbitrum' },
  10: { chain: optimism, name: 'Optimism' },
  137: { chain: polygon, name: 'Polygon' },
  56: { chain: bsc, name: 'BSC' },
  43114: { chain: avalanche, name: 'Avalanche' },
}

const DEX_ROUTERS: Record<number, Record<string, string>> = {
  1: {
    'uniswap-v3': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    'uniswap-v2': '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    sushiswap: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    curve: '0x99a58482BD75cbab83b27EC03CA68fF489b5788f',
  },
  8453: {
    'uniswap-v3': '0x2626664c2603336E57B271c5C0b26F421741e481',
    aerodrome: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  },
  42161: {
    'uniswap-v3': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    sushiswap: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    camelot: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
  },
}

const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  1: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  8453: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  42161: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },
}

// Bridge costs and times (estimates)
const BRIDGE_ESTIMATES: Record<
  string,
  { costUsd: number; timeMinutes: number }
> = {
  '1-8453': { costUsd: 5, timeMinutes: 5 }, // Eth -> Base (official bridge)
  '1-42161': { costUsd: 3, timeMinutes: 10 }, // Eth -> Arbitrum
  '1-10': { costUsd: 4, timeMinutes: 10 }, // Eth -> Optimism
  '8453-42161': { costUsd: 2, timeMinutes: 3 }, // Base -> Arbitrum (via Across)
  '42161-10': { costUsd: 2, timeMinutes: 3 }, // Arb -> OP
  'solana-1': { costUsd: 15, timeMinutes: 20 }, // Solana -> Eth (via Wormhole)
  'solana-8453': { costUsd: 8, timeMinutes: 15 },
}

// ============ Multi-Chain Scanner ============

// biome-ignore lint: viem types require this flexibility
type AnyPublicClient = ReturnType<typeof createPublicClient>

export class MultiChainScanner {
  private config: ScannerConfig
  private clients: Map<number, AnyPublicClient> = new Map()
  private priceCache: Map<string, ChainPrice> = new Map()
  private lastScan: ScanResult | null = null
  private scanning: boolean = false

  constructor(config: ScannerConfig) {
    this.config = config
    this.initializeClients()
  }

  private initializeClients(): void {
    for (const chainConfig of this.config.chains) {
      if (typeof chainConfig.chainId === 'number') {
        const evmChain =
          EVM_CHAINS[chainConfig.chainId as keyof typeof EVM_CHAINS]
        if (evmChain) {
          const client = createPublicClient({
            chain: evmChain.chain,
            transport: http(chainConfig.rpcUrl),
          })
          this.clients.set(chainConfig.chainId, client)
        }
      }
    }
  }

  /**
   * Run a single scan across all chains
   */
  async scan(): Promise<ScanResult> {
    if (this.scanning) {
      throw new Error('Scan already in progress')
    }

    this.scanning = true
    const startTime = Date.now()

    try {
      console.log('\n🔍 Starting multi-chain scan...')

      // Fetch prices from all chains
      const prices = await this.fetchAllPrices()

      // Get chain status
      const chainStatus = await this.getChainStatus()

      // Find cross-chain opportunities
      const crossChainOpps = this.findCrossChainOpportunities(prices)

      // Find same-chain opportunities
      const sameChainOpps = await this.findSameChainOpportunities(prices)

      const totalValue =
        crossChainOpps.reduce((sum, o) => sum + o.netProfitUsd, 0) +
        sameChainOpps.reduce((sum, o) => sum + o.netProfitUsd, 0)

      this.lastScan = {
        timestamp: startTime,
        crossChainOpportunities: crossChainOpps,
        sameChainOpportunities: sameChainOpps,
        chainStatus,
        totalOpportunityValue: totalValue,
      }

      console.log(`Scan completed in ${Date.now() - startTime}ms`)
      console.log(
        `Found ${crossChainOpps.length} cross-chain, ${sameChainOpps.length} same-chain opportunities`,
      )
      console.log(`Total opportunity value: $${totalValue.toFixed(2)}`)

      return this.lastScan
    } finally {
      this.scanning = false
    }
  }

  /**
   * Start continuous scanning
   */
  startContinuousScan(onScan: (result: ScanResult) => void): () => void {
    let running = true

    const loop = async () => {
      while (running) {
        try {
          const result = await this.scan()
          onScan(result)
        } catch (error) {
          console.error('Scan error:', error)
        }

        await new Promise((r) => setTimeout(r, this.config.scanIntervalMs))
      }
    }

    loop()

    return () => {
      running = false
    }
  }

  /**
   * Fetch prices from all configured chains
   */
  private async fetchAllPrices(): Promise<ChainPrice[]> {
    const prices: ChainPrice[] = []

    // Fetch EVM chain prices
    for (const chainConfig of this.config.chains) {
      if (typeof chainConfig.chainId !== 'number') continue

      const client = this.clients.get(chainConfig.chainId)
      if (!client) continue

      for (const token of this.config.tokens) {
        const chainPrices = await this.fetchChainPrices(
          chainConfig.chainId,
          chainConfig.name,
          token,
          client,
        )
        prices.push(...chainPrices)
      }
    }

    // Fetch Solana prices if configured
    if (this.config.heliusApiKey) {
      const solanaPrices = await this.fetchSolanaPrices()
      prices.push(...solanaPrices)
    }

    return prices
  }

  private async fetchChainPrices(
    chainId: number,
    chainName: string,
    token: string,
    _client: AnyPublicClient,
  ): Promise<ChainPrice[]> {
    const prices: ChainPrice[] = []
    const tokenAddress = TOKEN_ADDRESSES[chainId]?.[token]
    if (!tokenAddress) return prices

    const dexes = DEX_ROUTERS[chainId]
    if (!dexes) return prices

    // Fetch from each DEX
    for (const [dexName] of Object.entries(dexes)) {
      try {
        // In production, would call router contracts or use aggregator APIs
        // For now, simulate with slight variations
        const basePrice = this.getBasePrice(token)
        const variance = (Math.random() - 0.5) * 0.002 // +/- 0.1%
        const price = basePrice * (1 + variance)

        prices.push({
          chainId,
          chainName,
          token,
          price,
          dex: dexName,
          liquidity: BigInt(Math.floor(Math.random() * 10000000)),
          timestamp: Date.now(),
        })

        // Cache the price
        this.priceCache.set(
          `${chainId}-${token}-${dexName}`,
          prices[prices.length - 1],
        )
      } catch (error) {
        console.error(
          `Error fetching ${token} price on ${chainName}/${dexName}:`,
          error,
        )
      }
    }

    return prices
  }

  private async fetchSolanaPrices(): Promise<ChainPrice[]> {
    if (!this.config.heliusApiKey) return []

    const prices: ChainPrice[] = []

    // Use Jupiter API for Solana prices
    for (const token of this.config.tokens) {
      if (token === 'WETH') continue // Map to SOL on Solana

      try {
        const response = await fetch(
          `https://price.jup.ag/v4/price?ids=${this.getSolanaTokenId(token)}`,
        )

        if (response.ok) {
          const data = (await response.json()) as {
            data: Record<string, { price: number }>
          }
          const tokenId = this.getSolanaTokenId(token)
          const price = data.data?.[tokenId]?.price

          if (price) {
            prices.push({
              chainId: 'solana',
              chainName: 'Solana',
              token,
              price,
              dex: 'jupiter',
              liquidity: 0n,
              timestamp: Date.now(),
            })
          }
        }
      } catch (error) {
        console.error(`Error fetching Solana ${token} price:`, error)
      }
    }

    return prices
  }

  private findCrossChainOpportunities(
    prices: ChainPrice[],
  ): CrossChainOpportunity[] {
    const opportunities: CrossChainOpportunity[] = []

    // Group prices by token
    const byToken = new Map<string, ChainPrice[]>()
    for (const price of prices) {
      const existing = byToken.get(price.token) ?? []
      existing.push(price)
      byToken.set(price.token, existing)
    }

    // Find cross-chain spreads
    for (const [token, tokenPrices] of byToken) {
      if (tokenPrices.length < 2) continue

      // Sort by price
      tokenPrices.sort((a, b) => a.price - b.price)

      const cheapest = tokenPrices[0]
      const mostExpensive = tokenPrices[tokenPrices.length - 1]

      const spreadBps =
        ((mostExpensive.price - cheapest.price) / cheapest.price) * 10000

      if (spreadBps >= this.config.minSpreadBps) {
        const bridgeKey = `${cheapest.chainId}-${mostExpensive.chainId}`
        const bridge = BRIDGE_ESTIMATES[bridgeKey] ?? {
          costUsd: 10,
          timeMinutes: 15,
        }

        // Assume $10k trade size
        const tradeSize = 10000
        const grossProfitUsd = tradeSize * (spreadBps / 10000)
        const netProfitUsd = grossProfitUsd - bridge.costUsd

        if (netProfitUsd >= this.config.minProfitUsd) {
          const riskScore = this.calculateRiskScore(
            cheapest,
            mostExpensive,
            bridge,
          )

          opportunities.push({
            id: `cross-${token}-${Date.now()}`,
            token,
            buyChain: cheapest,
            sellChain: mostExpensive,
            spreadBps,
            estimatedProfitUsd: grossProfitUsd,
            bridgeCostUsd: bridge.costUsd,
            bridgeTimeMinutes: bridge.timeMinutes,
            netProfitUsd,
            riskScore,
            expiresAt: Date.now() + 60000, // 1 minute expiry
          })
        }
      }
    }

    // Sort by net profit
    opportunities.sort((a, b) => b.netProfitUsd - a.netProfitUsd)

    return opportunities
  }

  private async findSameChainOpportunities(
    prices: ChainPrice[],
  ): Promise<SameChainOpportunity[]> {
    const opportunities: SameChainOpportunity[] = []

    // Group by chain and token
    const byChainToken = new Map<string, ChainPrice[]>()
    for (const price of prices) {
      const key = `${price.chainId}-${price.token}`
      const existing = byChainToken.get(key) ?? []
      existing.push(price)
      byChainToken.set(key, existing)
    }

    // Find same-chain DEX spreads
    for (const [key, chainPrices] of byChainToken) {
      if (chainPrices.length < 2) continue

      const [chainIdStr, token] = key.split('-')
      const chainId = parseInt(chainIdStr, 10)

      // Sort by price
      chainPrices.sort((a, b) => a.price - b.price)

      for (let i = 0; i < chainPrices.length - 1; i++) {
        for (let j = i + 1; j < chainPrices.length; j++) {
          const buy = chainPrices[i]
          const sell = chainPrices[j]

          const spreadBps = ((sell.price - buy.price) / buy.price) * 10000

          if (spreadBps >= this.config.minSpreadBps) {
            // Estimate gas cost
            const gasCostUsd = this.estimateGasCost(chainId)

            const tradeSize = 5000 // Smaller for same-chain
            const grossProfitUsd = tradeSize * (spreadBps / 10000)
            const netProfitUsd = grossProfitUsd - gasCostUsd

            if (netProfitUsd >= this.config.minProfitUsd) {
              opportunities.push({
                id: `same-${chainId}-${token}-${Date.now()}-${i}-${j}`,
                chainId,
                token,
                buyDex: buy.dex,
                sellDex: sell.dex,
                buyPrice: buy.price,
                sellPrice: sell.price,
                spreadBps,
                estimatedProfitUsd: grossProfitUsd,
                gasCostUsd,
                netProfitUsd,
                path: [buy.dex, sell.dex],
              })
            }
          }
        }
      }
    }

    opportunities.sort((a, b) => b.netProfitUsd - a.netProfitUsd)
    return opportunities
  }

  private async getChainStatus(): Promise<ChainStatus[]> {
    const status: ChainStatus[] = []

    for (const [chainId, client] of this.clients) {
      try {
        const [blockNumber, gasPrice] = await Promise.all([
          client.getBlockNumber(),
          client.getGasPrice(),
        ])

        const chainConfig = this.config.chains.find(
          (c) => c.chainId === chainId,
        )

        status.push({
          chainId,
          name: chainConfig?.name ?? `Chain ${chainId}`,
          blockNumber,
          gasPrice,
          lastUpdate: Date.now(),
          healthy: true,
        })
      } catch (_error) {
        const chainConfig = this.config.chains.find(
          (c) => c.chainId === chainId,
        )

        status.push({
          chainId,
          name: chainConfig?.name ?? `Chain ${chainId}`,
          blockNumber: 0n,
          gasPrice: 0n,
          lastUpdate: Date.now(),
          healthy: false,
        })
      }
    }

    return status
  }

  private getBasePrice(token: string): number {
    const prices: Record<string, number> = {
      WETH: 3500,
      ETH: 3500,
      USDC: 1,
      USDT: 1,
      DAI: 1,
      WBTC: 95000,
      BTC: 95000,
      ARB: 1.2,
      OP: 2.5,
      SOL: 200,
    }
    return prices[token] ?? 1
  }

  private getSolanaTokenId(token: string): string {
    const ids: Record<string, string> = {
      SOL: 'So11111111111111111111111111111111111111112',
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    }
    return ids[token] ?? token
  }

  private estimateGasCost(chainId: number): number {
    // Gas cost in USD for typical swap
    const costs: Record<number, number> = {
      1: 15, // Ethereum
      8453: 0.1, // Base
      42161: 0.3, // Arbitrum
      10: 0.2, // Optimism
      137: 0.05, // Polygon
      56: 0.1, // BSC
      43114: 0.5, // Avalanche
    }
    return costs[chainId] ?? 1
  }

  private calculateRiskScore(
    buyChain: ChainPrice,
    sellChain: ChainPrice,
    bridge: { costUsd: number; timeMinutes: number },
  ): number {
    let score = 0

    // Bridge time risk (longer = riskier)
    score += Math.min(bridge.timeMinutes * 2, 40)

    // Liquidity risk
    const minLiquidity =
      buyChain.liquidity < sellChain.liquidity
        ? buyChain.liquidity
        : sellChain.liquidity
    if (minLiquidity < 100000n) score += 30
    else if (minLiquidity < 1000000n) score += 15

    // Chain risk (Solana = higher risk)
    if (buyChain.chainId === 'solana' || sellChain.chainId === 'solana') {
      score += 20
    }

    // Stale price risk
    const maxAge = Math.max(
      Date.now() - buyChain.timestamp,
      Date.now() - sellChain.timestamp,
    )
    if (maxAge > 30000) score += 20

    return Math.min(score, 100)
  }

  /**
   * Get historical opportunity analysis
   */
  async analyzeHistoricalOpportunities(hours: number = 24): Promise<{
    totalOpportunities: number
    avgSpreadBps: number
    avgProfitUsd: number
    byToken: Record<string, { count: number; avgProfit: number }>
    byChainPair: Record<string, { count: number; avgProfit: number }>
  }> {
    // Would integrate with historical data storage
    // For now, return simulated analysis

    return {
      totalOpportunities: Math.floor(hours * 5),
      avgSpreadBps: 15,
      avgProfitUsd: 25,
      byToken: {
        WETH: { count: 40, avgProfit: 30 },
        USDC: { count: 35, avgProfit: 15 },
        WBTC: { count: 25, avgProfit: 45 },
      },
      byChainPair: {
        'Ethereum-Base': { count: 30, avgProfit: 20 },
        'Ethereum-Arbitrum': { count: 25, avgProfit: 35 },
        'Base-Arbitrum': { count: 20, avgProfit: 15 },
      },
    }
  }
}

// ============ Exports ============

export function createScanner(
  config: Partial<ScannerConfig> = {},
): MultiChainScanner {
  const defaultConfig: ScannerConfig = {
    chains: [
      { chainId: 1, rpcUrl: 'https://eth.llamarpc.com', name: 'Ethereum' },
      { chainId: 8453, rpcUrl: 'https://mainnet.base.org', name: 'Base' },
      {
        chainId: 42161,
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        name: 'Arbitrum',
      },
    ],
    tokens: ['WETH', 'USDC', 'WBTC'],
    minSpreadBps: 10,
    minProfitUsd: 5,
    scanIntervalMs: 10000,
    ...config,
  }

  return new MultiChainScanner(defaultConfig)
}
