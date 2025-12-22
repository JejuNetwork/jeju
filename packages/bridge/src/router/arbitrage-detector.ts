/**
 * Cross-Chain Arbitrage Detector
 *
 * Monitors price differences across chains and DEXs to find profitable opportunities:
 *
 * 1. EVM ↔ Solana Arbitrage
 *    - Compare Jupiter/Raydium prices vs Uniswap/Curve
 *    - Use ZK bridge for trustless settlement
 *
 * 2. Hyperliquid Orderbook Arbitrage
 *    - Compare HyperCore CLOB prices vs AMM prices
 *    - Use CCIP for fast bridging
 *
 * 3. Cross-DEX Arbitrage
 *    - Monitor price differences between Aster, Raydium, etc.
 *    - Execute atomic swaps where possible
 *
 * 4. Jito Integration for Solana MEV
 *    - Bundle transactions with Jito for priority execution
 *    - Capture MEV on Solana side
 */

// ============ Types ============

export interface PriceQuote {
  chain: string
  dex: string
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOut: bigint
  priceImpactBps: number
  timestamp: number
}

export interface ArbOpportunity {
  id: string
  type: 'solana_evm' | 'hyperliquid' | 'cross_dex' | 'jito_mev'
  buyChain: string
  sellChain: string
  token: string
  buyPrice: bigint
  sellPrice: bigint
  priceDiffBps: number
  estimatedProfitUsd: number
  bridgeCostUsd: number
  netProfitUsd: number
  expiresAt: number
  route: ArbRoute
}

export interface ArbRoute {
  steps: ArbStep[]
  totalGasEstimate: bigint
  totalTimeSeconds: number
}

export interface ArbStep {
  action: 'swap' | 'bridge' | 'withdraw' | 'deposit'
  chain: string
  protocol: string
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  expectedAmountOut: bigint
}

export interface JitoBundle {
  transactions: JitoTransaction[]
  tip: bigint
  expiresSlot: number
}

export interface JitoTransaction {
  signature: string
  data: Uint8Array
  signers: string[]
}

const JUPITER_API = 'https://quote-api.jup.ag/v6'
const HYPERLIQUID_API = 'https://api.hyperliquid.xyz'

const SOLANA_TOKENS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
}

import { createLogger } from '../utils/logger.js'
import { createPublicClient, http } from 'viem'
import { arbitrum, base, mainnet, optimism } from 'viem/chains'
import {
  HyperliquidAllMidsResponseSchema,
  JitoBundleResponseSchema,
  JitoTipFloorResponseSchema,
  JupiterArbQuoteResponseSchema,
  OneInchQuoteResponseSchema,
} from '../utils/validation.js'

const log = createLogger('arbitrage')

// Retry configuration for external API calls
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
}

/**
 * Check if error is retryable (network errors, 5xx, rate limits)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true // Network errors
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('unable to connect')
    ) {
      return true
    }
  }
  return false
}

/**
 * Fetch with retry logic for external APIs
 */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  let lastError: Error | undefined
  let delay = RETRY_CONFIG.initialDelayMs

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options)

      // Retry on 5xx or 429 (rate limit)
      if (response.status >= 500 || response.status === 429) {
        if (attempt < RETRY_CONFIG.maxAttempts - 1) {
          log.warn('API error, retrying', {
            url,
            status: response.status,
            attempt: attempt + 1,
            delay,
          })
          await new Promise((r) => setTimeout(r, delay))
          delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs)
          continue
        }
      }

      return response
    } catch (error) {
      lastError = error as Error

      if (!isRetryableError(error) || attempt === RETRY_CONFIG.maxAttempts - 1) {
        throw error
      }

      log.warn('Network error, retrying', {
        url,
        error: lastError.message,
        attempt: attempt + 1,
        delay,
      })
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs)
    }
  }

  throw lastError ?? new Error('API request failed after retries')
}

// ============ Arbitrage Detector ============

export class ArbitrageDetector {
  private opportunities: Map<string, ArbOpportunity> = new Map()
  private minProfitBps: number
  private running = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private jitoBlockEngineUrl = 'https://mainnet.block-engine.jito.wtf'

  constructor(config: { minProfitBps?: number } = {}) {
    this.minProfitBps = config.minProfitBps ?? 100 // 1% default
  }

  /**
   * Start monitoring for opportunities
   */
  start(): void {
    if (this.running) return
    this.running = true

    log.info('Starting cross-chain arbitrage detector')

    // Poll every 5 seconds
    this.pollInterval = setInterval(() => this.detectOpportunities(), 5000)

    // Initial poll
    this.detectOpportunities()
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.running = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): ArbOpportunity[] {
    const now = Date.now()

    // Clean expired
    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt < now) {
        this.opportunities.delete(id)
      }
    }

    return Array.from(this.opportunities.values())
      .filter((o) => o.netProfitUsd > 0)
      .sort((a, b) => b.netProfitUsd - a.netProfitUsd)
  }

  // ============ Detection Logic ============

  private async detectOpportunities(): Promise<void> {
    await Promise.all([
      this.detectSolanaEvmArb(),
      this.detectHyperliquidArb(),
      this.detectCrossChainArb(),
    ])
  }

  /**
   * Solana ↔ EVM Arbitrage
   * Uses ZK bridge for trustless settlement
   */
  private async detectSolanaEvmArb(): Promise<void> {
    const tokens = ['USDC', 'WETH']
    const evmChains = [1, 8453, 42161] // Ethereum, Base, Arbitrum

    for (const token of tokens) {
      // Get Solana price via Jupiter
      const solanaQuote = await this.getJupiterPrice(token)
      if (!solanaQuote) continue

      for (const chainId of evmChains) {
        // Get EVM price (would use actual DEX aggregator)
        const evmQuote = await this.getEvmPrice(token, chainId)
        if (!evmQuote) continue

        // Calculate price difference
        const priceDiff = this.calculatePriceDiff(solanaQuote, evmQuote)
        if (priceDiff.diffBps < this.minProfitBps) continue

        // Calculate profit after bridge costs
        const bridgeCost = this.getBridgeCost('solana', chainId)
        const grossProfit = (Number(priceDiff.diffBps) / 10000) * 10000 // Assume $10k trade
        const netProfit = grossProfit - bridgeCost

        if (netProfit <= 0) continue

        // Record opportunity
        const id = `sol-evm-${token}-${chainId}-${Date.now()}`
        const buyChain =
          priceDiff.buyLow === 'solana' ? 'solana' : `evm:${chainId}`
        const sellChain =
          priceDiff.buyLow === 'solana' ? `evm:${chainId}` : 'solana'

        this.opportunities.set(id, {
          id,
          type: 'solana_evm',
          buyChain,
          sellChain,
          token,
          buyPrice: priceDiff.lowPrice,
          sellPrice: priceDiff.highPrice,
          priceDiffBps: priceDiff.diffBps,
          estimatedProfitUsd: grossProfit,
          bridgeCostUsd: bridgeCost,
          netProfitUsd: netProfit,
          expiresAt: Date.now() + 30000,
          route: this.buildArbRoute(buyChain, sellChain, token),
        })

        log.debug('Solana-EVM opportunity', {
          token,
          diffBps: priceDiff.diffBps,
          netProfit: netProfit.toFixed(2),
        })
      }
    }
  }

  /**
   * Hyperliquid Arbitrage
   * Compare CLOB prices vs AMM prices
   */
  private async detectHyperliquidArb(): Promise<void> {
    const pairs = ['ETH-USDC', 'BTC-USDC', 'SOL-USDC']

    for (const pair of pairs) {
      // Get Hyperliquid orderbook mid price
      const hyperPrice = await this.getHyperliquidPrice(pair)
      if (!hyperPrice) continue

      // Get Base DEX price for comparison
      const baseToken = pair.split('-')[0]
      if (!baseToken) continue
      const baseQuote = await this.getEvmPrice(baseToken, 8453)
      if (!baseQuote) continue

      // Calculate opportunity
      const priceDiff = Number(hyperPrice) - Number(baseQuote.amountOut)
      const priceDiffBps =
        Math.abs(priceDiff / Number(baseQuote.amountOut)) * 10000

      if (priceDiffBps < this.minProfitBps) continue

      const bridgeCost = this.getBridgeCost(998, 8453) // Hyperliquid to Base
      const grossProfit = (priceDiffBps / 10000) * 10000
      const netProfit = grossProfit - bridgeCost

      if (netProfit <= 0) continue

      const id = `hyper-${pair}-${Date.now()}`
      const buyOnHyper = priceDiff < 0

      this.opportunities.set(id, {
        id,
        type: 'hyperliquid',
        buyChain: buyOnHyper ? 'hyperliquid' : 'evm:8453',
        sellChain: buyOnHyper ? 'evm:8453' : 'hyperliquid',
        token: pair,
        buyPrice: buyOnHyper
          ? BigInt(Math.floor(hyperPrice * 1e18))
          : baseQuote.amountOut,
        sellPrice: buyOnHyper
          ? baseQuote.amountOut
          : BigInt(Math.floor(hyperPrice * 1e18)),
        priceDiffBps: Math.floor(priceDiffBps),
        estimatedProfitUsd: grossProfit,
        bridgeCostUsd: bridgeCost,
        netProfitUsd: netProfit,
        expiresAt: Date.now() + 15000, // Shorter expiry for orderbook
        route: this.buildArbRoute(
          buyOnHyper ? 'hyperliquid' : 'evm:8453',
          buyOnHyper ? 'evm:8453' : 'hyperliquid',
          pair,
        ),
      })

      log.debug('Hyperliquid opportunity', {
        pair,
        diffBps: priceDiffBps.toFixed(0),
        netProfit: netProfit.toFixed(2),
      })
    }
  }

  /**
   * Cross-chain DEX arbitrage
   * Compare prices across EVM chains
   */
  private async detectCrossChainArb(): Promise<void> {
    const tokens = ['USDC', 'WETH']
    const chains = [1, 8453, 42161, 56] // ETH, Base, Arb, BSC

    for (const token of tokens) {
      const prices: Map<number, PriceQuote> = new Map()

      // Collect prices from all chains
      for (const chainId of chains) {
        const quote = await this.getEvmPrice(token, chainId)
        if (quote) {
          prices.set(chainId, quote)
        }
      }

      // Find best buy and sell
      let minPrice = { chainId: 0, price: BigInt(Number.MAX_SAFE_INTEGER) }
      let maxPrice = { chainId: 0, price: 0n }

      for (const [chainId, quote] of prices) {
        if (quote.amountOut < minPrice.price) {
          minPrice = { chainId, price: quote.amountOut }
        }
        if (quote.amountOut > maxPrice.price) {
          maxPrice = { chainId, price: quote.amountOut }
        }
      }

      if (minPrice.chainId === maxPrice.chainId) continue

      const priceDiffBps = Number(
        ((maxPrice.price - minPrice.price) * 10000n) / minPrice.price,
      )
      if (priceDiffBps < this.minProfitBps) continue

      const bridgeCost = this.getBridgeCost(minPrice.chainId, maxPrice.chainId)
      const grossProfit = (priceDiffBps / 10000) * 10000
      const netProfit = grossProfit - bridgeCost

      if (netProfit <= 0) continue

      const id = `xchain-${token}-${minPrice.chainId}-${maxPrice.chainId}-${Date.now()}`

      this.opportunities.set(id, {
        id,
        type: 'cross_dex',
        buyChain: `evm:${minPrice.chainId}`,
        sellChain: `evm:${maxPrice.chainId}`,
        token,
        buyPrice: minPrice.price,
        sellPrice: maxPrice.price,
        priceDiffBps,
        estimatedProfitUsd: grossProfit,
        bridgeCostUsd: bridgeCost,
        netProfitUsd: netProfit,
        expiresAt: Date.now() + 30000,
        route: this.buildArbRoute(
          `evm:${minPrice.chainId}`,
          `evm:${maxPrice.chainId}`,
          token,
        ),
      })

      log.debug('Cross-chain opportunity', {
        token,
        diffBps: priceDiffBps,
        route: `${minPrice.chainId}→${maxPrice.chainId}`,
        netProfit: netProfit.toFixed(2),
      })
    }
  }

  // ============ Price Fetching ============

  private async getJupiterPrice(token: string): Promise<PriceQuote | null> {
    const mint = SOLANA_TOKENS[token]
    if (!mint) return null

    const usdcMint = SOLANA_TOKENS.USDC
    const amount = token === 'USDC' ? '1000000' : '1000000000' // 1 USDC or 1 SOL

    const url = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${usdcMint}&amount=${amount}&slippageBps=50`

    try {
      const response = await fetchWithRetry(url)
      if (!response.ok) return null

      const rawData: unknown = await response.json()
      const data = JupiterArbQuoteResponseSchema.parse(rawData)

      return {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: token,
        tokenOut: 'USDC',
        amountIn: BigInt(data.inAmount),
        amountOut: BigInt(data.outAmount),
        priceImpactBps: parseFloat(data.priceImpactPct) * 100,
        timestamp: Date.now(),
      }
    } catch (error) {
      log.warn('Failed to get Jupiter price', { token, error: (error as Error).message })
      return null
    }
  }

  private async getEvmPrice(
    token: string,
    chainId: number,
  ): Promise<PriceQuote | null> {
    // Use 1inch API for EVM price quotes
    const ONE_INCH_API = `https://api.1inch.dev/swap/v6.0/${chainId}/quote`

    // Token addresses by chain
    const TOKEN_ADDRESSES: Record<string, Record<number, string>> = {
      WETH: {
        1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        10: '0x4200000000000000000000000000000000000006',
        8453: '0x4200000000000000000000000000000000000006',
      },
      USDC: {
        1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
    }

    const tokenAddress = TOKEN_ADDRESSES[token]?.[chainId]
    const usdcAddress = TOKEN_ADDRESSES.USDC[chainId]

    if (!tokenAddress || !usdcAddress) {
      return null
    }

    try {
      const apiKey = process.env.ONEINCH_API_KEY
      if (!apiKey) {
        // Fallback to Uniswap V3 quoter if no 1inch API key
        return this.getUniswapQuote(token, chainId, tokenAddress, usdcAddress)
      }

      const amount = token === 'USDC' ? '1000000' : '1000000000000000000' // 1 token
      const response = await fetchWithRetry(
        `${ONE_INCH_API}?src=${tokenAddress}&dst=${usdcAddress}&amount=${amount}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        },
      )

      if (!response.ok) {
        throw new Error(`1inch API error: ${response.status}`)
      }

      const rawData: unknown = await response.json()
      const data = OneInchQuoteResponseSchema.parse(rawData)

      return {
        chain: `evm:${chainId}`,
        dex: '1inch',
        tokenIn: token,
        tokenOut: 'USDC',
        amountIn: BigInt(amount),
        amountOut: BigInt(data.dstAmount),
        priceImpactBps: 10,
        timestamp: Date.now(),
      }
    } catch (error) {
      log.error('Failed to get EVM price', {
        token,
        chainId,
        error: String(error),
      })
      return null
    }
  }

  private async getUniswapQuote(
    token: string,
    chainId: number,
    tokenAddress: string,
    usdcAddress: string,
  ): Promise<PriceQuote | null> {
    // Uniswap V3 Quoter addresses
    const QUOTER_V2: Record<number, string> = {
      1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    }

    const quoterAddress = QUOTER_V2[chainId]
    if (!quoterAddress) return null

    try {

      const chains = {
        1: mainnet,
        42161: arbitrum,
        10: optimism,
        8453: base,
      } as const
      const chain = chains[chainId as keyof typeof chains]
      if (!chain) return null

      const client = createPublicClient({
        chain,
        transport: http(),
      })

      const amount = token === 'USDC' ? BigInt(1e6) : BigInt(1e18)

      // QuoterV2 quoteExactInputSingle
      const QUOTER_ABI = [
        {
          name: 'quoteExactInputSingle',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              name: 'params',
              type: 'tuple',
              components: [
                { name: 'tokenIn', type: 'address' },
                { name: 'tokenOut', type: 'address' },
                { name: 'amountIn', type: 'uint256' },
                { name: 'fee', type: 'uint24' },
                { name: 'sqrtPriceLimitX96', type: 'uint160' },
              ],
            },
          ],
          outputs: [
            { name: 'amountOut', type: 'uint256' },
            { name: 'sqrtPriceX96After', type: 'uint160' },
            { name: 'initializedTicksCrossed', type: 'uint32' },
            { name: 'gasEstimate', type: 'uint256' },
          ],
        },
      ] as const

      const result = await client.simulateContract({
        address: quoterAddress as `0x${string}`,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: tokenAddress as `0x${string}`,
            tokenOut: usdcAddress as `0x${string}`,
            amountIn: amount,
            fee: 3000, // 0.3% pool
            sqrtPriceLimitX96: 0n,
          },
        ],
      })

      return {
        chain: `evm:${chainId}`,
        dex: 'uniswap_v3',
        tokenIn: token,
        tokenOut: 'USDC',
        amountIn: amount,
        amountOut: result.result[0],
        priceImpactBps: 10,
        timestamp: Date.now(),
      }
    } catch (error) {
      log.error('Failed to get Uniswap quote', { token, error: String(error) })
      return null
    }
  }

  private async getHyperliquidPrice(pair: string): Promise<number | null> {
    try {
      const response = await fetchWithRetry(`${HYPERLIQUID_API}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      })

      if (!response.ok) return null

      const rawData: unknown = await response.json()
      const data = HyperliquidAllMidsResponseSchema.parse(rawData)
      const symbol = pair.split('-')[0]
      if (!symbol) return null

      const priceStr = data[symbol]
      if (!priceStr) return null

      return parseFloat(priceStr)
    } catch (error) {
      log.warn('Failed to get Hyperliquid price', { pair, error: (error as Error).message })
      return null
    }
  }

  // ============ Helpers ============

  private calculatePriceDiff(
    quote1: PriceQuote,
    quote2: PriceQuote,
  ): {
    diffBps: number
    lowPrice: bigint
    highPrice: bigint
    buyLow: string
  } {
    const price1 = Number(quote1.amountOut)
    const price2 = Number(quote2.amountOut)

    const minPrice = Math.min(price1, price2)
    const maxPrice = Math.max(price1, price2)
    const diffBps = Math.floor(((maxPrice - minPrice) / minPrice) * 10000)

    return {
      diffBps,
      lowPrice: BigInt(Math.floor(minPrice)),
      highPrice: BigInt(Math.floor(maxPrice)),
      buyLow: price1 < price2 ? quote1.chain : quote2.chain,
    }
  }

  private getBridgeCost(from: string | number, to: number): number {
    // Bridge costs in USD
    const solanaToEvm = 15
    const evmToSolana = 15
    const hyperliquidToEvm = 10
    const evmToEvm = 5

    if (from === 'solana' || from === 900001) return solanaToEvm
    if (to === 900001) return evmToSolana
    if (from === 998 || to === 998) return hyperliquidToEvm
    return evmToEvm
  }

  private buildArbRoute(
    buyChain: string,
    sellChain: string,
    token: string,
  ): ArbRoute {
    const steps: ArbStep[] = []

    // Step 1: Buy on source chain
    steps.push({
      action: 'swap',
      chain: buyChain,
      protocol: buyChain.startsWith('solana') ? 'jupiter' : 'uniswap',
      tokenIn: 'USDC',
      tokenOut: token,
      amountIn: 10000n * BigInt(1e6), // $10k
      expectedAmountOut: 0n, // Calculated at execution
    })

    // Step 2: Bridge
    steps.push({
      action: 'bridge',
      chain: buyChain,
      protocol: buyChain.startsWith('solana') ? 'zk_bridge' : 'ccip',
      tokenIn: token,
      tokenOut: token,
      amountIn: 0n,
      expectedAmountOut: 0n,
    })

    // Step 3: Sell on destination
    steps.push({
      action: 'swap',
      chain: sellChain,
      protocol: sellChain.startsWith('solana') ? 'jupiter' : 'uniswap',
      tokenIn: token,
      tokenOut: 'USDC',
      amountIn: 0n,
      expectedAmountOut: 0n,
    })

    return {
      steps,
      totalGasEstimate: 500000n,
      totalTimeSeconds:
        buyChain.startsWith('solana') || sellChain.startsWith('solana')
          ? 300
          : 120,
    }
  }

  // ============ Jito MEV Integration ============

  /**
   * Submit a Solana transaction bundle to Jito for MEV extraction
   */
  async submitJitoBundle(
    bundle: JitoBundle,
  ): Promise<{ bundleId: string; landed: boolean }> {
    try {
      const response = await fetchWithRetry(
        `${this.jitoBlockEngineUrl}/api/v1/bundles`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [
              bundle.transactions.map((tx) => tx.signature),
              { tip: bundle.tip.toString() },
            ],
          }),
        },
      )

      if (!response.ok) {
        return { bundleId: '', landed: false }
      }

      const rawData: unknown = await response.json()
      const data = JitoBundleResponseSchema.parse(rawData)
      return { bundleId: data.result.bundle_id, landed: true }
    } catch {
      return { bundleId: '', landed: false }
    }
  }

  /**
   * Get Jito tip floor for current slot
   */
  async getJitoTipFloor(): Promise<bigint> {
    try {
      const response = await fetchWithRetry(
        `${this.jitoBlockEngineUrl}/api/v1/bundles/tip_floor`,
      )
      if (!response.ok) return 1000n // Default 1000 lamports

      const rawData: unknown = await response.json()
      const data = JitoTipFloorResponseSchema.parse(rawData)
      return BigInt(data.tip_floor)
    } catch {
      return 1000n
    }
  }
}

// ============ Factory ============

export function createArbitrageDetector(config?: {
  minProfitBps?: number
}): ArbitrageDetector {
  return new ArbitrageDetector(config)
}
