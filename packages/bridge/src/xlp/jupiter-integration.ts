/**
 * Jupiter DEX Integration for XLP
 * Enables instant Solana swaps as part of cross-chain liquidity operations
 */

import { EventEmitter } from 'node:events'
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js'
import { createLogger } from '../utils/logger.js'
import {
  JupiterPriceResponseSchema,
  JupiterQuoteFullSchema,
  JupiterSwapResponseSchema,
  JupiterTokenListSchema,
} from '../utils/validation.js'

const log = createLogger('jupiter')

const JUPITER_API_V6 = 'https://quote-api.jup.ag/v6'
const JUPITER_PRICE_API = 'https://price.jup.ag/v6'

// Retry configuration for Jupiter API calls
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
    return true // Network errors (fetch failed, connection refused)
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
 * Fetch with retry logic for Jupiter API
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
        const retryAfter = response.headers.get('retry-after')
        delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay

        if (attempt < RETRY_CONFIG.maxAttempts - 1) {
          log.warn('Jupiter API error, retrying', {
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

      log.warn('Jupiter API network error, retrying', {
        error: lastError.message,
        attempt: attempt + 1,
        delay,
      })
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs)
    }
  }

  throw lastError ?? new Error('Jupiter API request failed after retries')
}

// Common Solana token mints
const SOLANA_TOKENS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapT8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FsqcVc7eHvqZN9Y1FMx6ByGu',
  WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  WBTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  JUP: 'JUPyiwrYJFskUPiHa7hkeepFNjGXvMPGM2TQ5sUtjHA',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
}

export interface JupiterQuote {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: 'ExactIn' | 'ExactOut'
  slippageBps: number
  priceImpactPct: number
  routePlan: JupiterRoutePlan[]
  contextSlot: number
  timeTaken: number
}

export interface JupiterRoutePlan {
  swapInfo: {
    ammKey: string
    label: string
    inputMint: string
    outputMint: string
    inAmount: string
    outAmount: string
    feeAmount: string
    feeMint: string
  }
  percent: number
}

export interface JupiterSwapResult {
  signature: string
  inputAmount: bigint
  outputAmount: bigint
  priceImpact: number
  fee: bigint
}

export interface JupiterPrice {
  id: string
  mintSymbol: string
  vsToken: string
  vsTokenSymbol: string
  price: number
}

export interface JupiterConfig {
  rpcUrl: string
  keypair?: Uint8Array
  slippageBps?: number
  priorityFeeLamports?: number
  dynamicComputeUnitLimit?: boolean
}

export class JupiterClient extends EventEmitter {
  private connection: Connection
  private keypair: Keypair | null = null
  private defaultSlippageBps: number
  private priorityFeeLamports: number
  private dynamicComputeUnitLimit: boolean

  constructor(config: JupiterConfig) {
    super()
    this.connection = new Connection(config.rpcUrl, 'confirmed')
    this.defaultSlippageBps = config.slippageBps || 50 // 0.5% default
    this.priorityFeeLamports = config.priorityFeeLamports || 10000
    this.dynamicComputeUnitLimit = config.dynamicComputeUnitLimit ?? true

    if (config.keypair) {
      this.keypair = Keypair.fromSecretKey(config.keypair)
    }
  }

  /**
   * Get quote for a swap
   */
  async getQuote(params: {
    inputMint: string
    outputMint: string
    amount: string
    slippageBps?: number
    swapMode?: 'ExactIn' | 'ExactOut'
    onlyDirectRoutes?: boolean
    asLegacyTransaction?: boolean
    maxAccounts?: number
  }): Promise<JupiterQuote> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: (params.slippageBps || this.defaultSlippageBps).toString(),
      swapMode: params.swapMode || 'ExactIn',
      onlyDirectRoutes: (params.onlyDirectRoutes || false).toString(),
      asLegacyTransaction: (params.asLegacyTransaction || false).toString(),
    })

    if (params.maxAccounts) {
      queryParams.set('maxAccounts', params.maxAccounts.toString())
    }

    const response = await fetchWithRetry(`${JUPITER_API_V6}/quote?${queryParams}`)
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jupiter quote failed: ${error}`)
    }

    const rawData: unknown = await response.json()
    return JupiterQuoteFullSchema.parse(rawData)
  }

  /**
   * Get best quote across multiple routes
   */
  async getBestQuote(params: {
    inputMint: string
    outputMint: string
    amount: string
    slippageBps?: number
  }): Promise<JupiterQuote> {
    // Jupiter API automatically returns best route
    return this.getQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      onlyDirectRoutes: false,
    })
  }

  /**
   * Execute a swap
   */
  async swap(
    quote: JupiterQuote,
    userPublicKey?: string,
  ): Promise<JupiterSwapResult> {
    const pubkey = userPublicKey || this.keypair?.publicKey.toBase58()
    if (!pubkey) {
      throw new Error('No user public key provided and no keypair configured')
    }

    // Get swap transaction
    const swapResponse = await fetchWithRetry(`${JUPITER_API_V6}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: pubkey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: this.dynamicComputeUnitLimit,
        prioritizationFeeLamports: this.priorityFeeLamports,
      }),
    })

    if (!swapResponse.ok) {
      const error = await swapResponse.text()
      throw new Error(`Jupiter swap failed: ${error}`)
    }

    const rawSwapData: unknown = await swapResponse.json()
    const swapData = JupiterSwapResponseSchema.parse(rawSwapData)
    const swapTransaction = swapData.swapTransaction

    // Deserialize and sign
    const transactionBuf = Buffer.from(swapTransaction, 'base64')
    const transaction = VersionedTransaction.deserialize(transactionBuf)

    if (!this.keypair) {
      throw new Error('Cannot sign transaction: no keypair configured')
    }

    transaction.sign([this.keypair])

    // Send and confirm
    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    })

    await this.connection.confirmTransaction(signature, 'confirmed')

    this.emit('swapCompleted', {
      signature,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
    })

    return {
      signature,
      inputAmount: BigInt(quote.inAmount),
      outputAmount: BigInt(quote.outAmount),
      priceImpact: quote.priceImpactPct,
      fee: this.calculateTotalFees(quote),
    }
  }

  /**
   * Get swap transaction without executing
   */
  async getSwapTransaction(
    quote: JupiterQuote,
    userPublicKey: string,
  ): Promise<{
    transaction: VersionedTransaction
    lastValidBlockHeight: number
  }> {
    const swapResponse = await fetchWithRetry(`${JUPITER_API_V6}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: this.dynamicComputeUnitLimit,
        prioritizationFeeLamports: this.priorityFeeLamports,
      }),
    })

    if (!swapResponse.ok) {
      const error = await swapResponse.text()
      throw new Error(`Jupiter swap transaction failed: ${error}`)
    }

    const rawSwapData: unknown = await swapResponse.json()
    const swapData = JupiterSwapResponseSchema.parse(rawSwapData)
    const transactionBuf = Buffer.from(swapData.swapTransaction, 'base64')
    const transaction = VersionedTransaction.deserialize(transactionBuf)

    if (swapData.lastValidBlockHeight === undefined) {
      throw new Error('Jupiter API did not return lastValidBlockHeight')
    }

    return {
      transaction,
      lastValidBlockHeight: swapData.lastValidBlockHeight,
    }
  }

  /**
   * Get token price in USD
   */
  async getPrice(tokenMint: string): Promise<number> {
    const response = await fetchWithRetry(`${JUPITER_PRICE_API}/price?ids=${tokenMint}`)
    if (!response.ok) {
      throw new Error(`Jupiter price API failed: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = JupiterPriceResponseSchema.parse(rawData)
    const priceData = data.data[tokenMint]
    if (!priceData) {
      throw new Error(`Price not found for ${tokenMint}`)
    }

    return priceData.price
  }

  /**
   * Get multiple token prices
   */
  async getPrices(tokenMints: string[]): Promise<Record<string, number>> {
    const response = await fetchWithRetry(
      `${JUPITER_PRICE_API}/price?ids=${tokenMints.join(',')}`,
    )
    if (!response.ok) {
      throw new Error(`Jupiter price API failed: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = JupiterPriceResponseSchema.parse(rawData)
    const prices: Record<string, number> = {}

    for (const mint of tokenMints) {
      if (data.data[mint]) {
        prices[mint] = data.data[mint].price
      }
    }

    return prices
  }

  /**
   * Get all tradeable tokens
   */
  async getTokenList(): Promise<
    { address: string; symbol: string; name: string; decimals: number }[]
  > {
    const response = await fetchWithRetry('https://token.jup.ag/all')
    if (!response.ok) {
      throw new Error(`Jupiter token list failed: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    return JupiterTokenListSchema.parse(rawData)
  }

  /**
   * Get token mint by symbol
   */
  getTokenMint(symbol: string): string | undefined {
    return SOLANA_TOKENS[symbol.toUpperCase()]
  }

  /**
   * Check if swap route exists
   */
  async hasRoute(inputMint: string, outputMint: string): Promise<boolean> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount: '1000000', // 1 USDC equivalent
      slippageBps: 1000, // 10% for route check
    })

    return quote.routePlan.length > 0
  }

  /**
   * Calculate output amount after slippage
   */
  calculateMinOutput(quote: JupiterQuote): bigint {
    const output = BigInt(quote.outAmount)
    const slippageMultiplier = BigInt(10000 - quote.slippageBps)
    return (output * slippageMultiplier) / 10000n
  }

  /**
   * Calculate total fees from route
   */
  private calculateTotalFees(quote: JupiterQuote): bigint {
    let totalFees = 0n
    for (const step of quote.routePlan) {
      totalFees += BigInt(step.swapInfo.feeAmount)
    }
    return totalFees
  }
}

/**
 * XLP Jupiter Filler - Uses Jupiter for instant Solana-side fills
 */
export class XLPJupiterFiller extends EventEmitter {
  private jupiter: JupiterClient
  private running = false
  private fillInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: JupiterConfig) {
    super()
    this.jupiter = new JupiterClient(config)
  }

  /**
   * Fill a cross-chain order using Jupiter
   */
  async fillOrder(params: {
    orderId: string
    inputMint: string
    outputMint: string
    inputAmount: string
    recipient: string
    maxSlippageBps?: number
  }): Promise<{
    success: boolean
    signature?: string
    outputAmount?: bigint
    error?: string
  }> {
    // Get best quote
    const quote = await this.jupiter.getQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.inputAmount,
      slippageBps: params.maxSlippageBps || 100,
    })

    // Check price impact
    if (quote.priceImpactPct > 5) {
      log.warn('High price impact', { priceImpactPct: quote.priceImpactPct })
      return {
        success: false,
        error: `Price impact too high: ${quote.priceImpactPct}%`,
      }
    }

    // Execute swap
    const result = await this.jupiter.swap(quote, params.recipient)

    this.emit('orderFilled', {
      orderId: params.orderId,
      signature: result.signature,
      inputAmount: params.inputAmount,
      outputAmount: result.outputAmount.toString(),
      priceImpact: result.priceImpact,
    })

    return {
      success: true,
      signature: result.signature,
      outputAmount: result.outputAmount,
    }
  }

  /**
   * Get quote for cross-chain swap via Solana
   */
  async getXLPQuote(params: {
    sourceChainId: number
    destChainId: number
    inputToken: string // Symbol
    outputToken: string // Symbol
    amount: string
  }): Promise<{
    inputAmount: string
    outputAmount: string
    priceImpact: number
    route: string
    estimatedTime: number
  }> {
    const inputMint = this.jupiter.getTokenMint(params.inputToken)
    const outputMint = this.jupiter.getTokenMint(params.outputToken)

    if (!inputMint || !outputMint) {
      throw new Error(
        `Token not found: ${params.inputToken} or ${params.outputToken}`,
      )
    }

    const quote = await this.jupiter.getQuote({
      inputMint,
      outputMint,
      amount: params.amount,
    })

    // Build route description
    const routeLabels = quote.routePlan.map((r) => r.swapInfo.label).join(' → ')

    return {
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      route: routeLabels,
      estimatedTime: 1, // ~1 second on Solana
    }
  }

  /**
   * Start automatic order filling
   */
  start(): void {
    if (this.running) return
    this.running = true

    this.fillInterval = setInterval(async () => {
      await this.checkPendingOrders()
    }, 2000)

    log.info('Filler started')
  }

  /**
   * Stop automatic order filling
   */
  stop(): void {
    this.running = false
    if (this.fillInterval) {
      clearInterval(this.fillInterval)
      this.fillInterval = null
    }
    log.info('Filler stopped')
  }

  /**
   * Check and fill pending orders
   */
  private async checkPendingOrders(): Promise<void> {
    // This would query pending XLP orders from the bridge
    // and fill profitable ones using Jupiter
    this.emit('checkingOrders', { timestamp: Date.now() })
  }
}

export function createJupiterClient(config: JupiterConfig): JupiterClient {
  return new JupiterClient(config)
}

export function createXLPJupiterFiller(
  config: JupiterConfig,
): XLPJupiterFiller {
  return new XLPJupiterFiller(config)
}

export { SOLANA_TOKENS }
