/**
 * OIF Integration for Cross-Chain Payments
 *
 * Connects the payment system with Open Intents Framework for:
 * - Real-time cross-chain quotes from solvers
 * - Optimal route selection
 * - Intent creation and tracking
 *
 * This enables users to pay with tokens on ANY chain, with the system
 * automatically routing via OIF when needed.
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import type { TokenBalance } from './multi-chain-discovery'

export interface CrossChainQuote {
  quoteId: string
  sourceChain: number
  destinationChain: number
  sourceToken: Address
  destinationToken: Address
  inputAmount: bigint
  outputAmount: bigint
  fee: bigint
  feePercent: number
  estimatedTime: number // seconds
  solver: Address
  solverReputation: number
  validUntil: number // timestamp
  route: string
}

export interface IntentRequest {
  user: Address
  sourceChain: number
  destinationChain: number
  sourceToken: Address
  destinationToken: Address
  amount: bigint
  recipient?: Address
  maxSlippage?: number // basis points
  deadline?: number // seconds from now
}

export interface Intent {
  intentId: string
  user: Address
  sourceChain: number
  destinationChain: number
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'expired'
  solver?: Address
  fillTxHash?: string
  createdAt: number
  filledAt?: number
}

export interface OIFConfig {
  aggregatorUrl: string
  defaultTimeout?: number
  maxRetries?: number
}

interface OIFQuoteResponse {
  quoteId: string
  sourceChainId: number
  destinationChainId: number
  sourceToken: string
  destinationToken: string
  inputAmount: string
  outputAmount: string
  fee: string
  feePercent: number
  estimatedFillTimeSeconds: number
  solver: string
  solverReputation: number
  validUntil: number
}

interface OIFIntentResponse {
  intentId: string
  user: string
  sourceChainId: number
  destinationChainId: number
  inputs: Array<{ token: string; amount: string }>
  outputs: Array<{ token: string; amount: string }>
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'expired'
  solver?: string
  fillTxHash?: string
  createdAt: number
  filledAt?: number
}

export class OIFClient {
  private config: Required<OIFConfig>

  constructor(config: OIFConfig) {
    this.config = {
      aggregatorUrl: config.aggregatorUrl,
      defaultTimeout: config.defaultTimeout || 30000,
      maxRetries: config.maxRetries || 3,
    }
  }

  /**
   * Get quotes for a cross-chain transfer
   */
  async getQuotes(request: IntentRequest): Promise<CrossChainQuote[]> {
    // Actual OIF API uses /intents/quote endpoint
    const url = `${this.config.aggregatorUrl}/intents/quote`

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceChain: request.sourceChain,
        destinationChain: request.destinationChain,
        sourceToken: request.sourceToken,
        destinationToken: request.destinationToken,
        amount: request.amount.toString(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to get quotes: ${response.statusText}`)
    }

    // OIF API returns array directly, not wrapped in { quotes: [...] }
    const data = (await response.json()) as OIFQuoteResponse[]
    const quotes = Array.isArray(data) ? data : []
    return quotes.map((q) => this.parseQuote(q))
  }

  /**
   * Get the best quote for a transfer
   */
  async getBestQuote(request: IntentRequest): Promise<CrossChainQuote | null> {
    const quotes = await this.getQuotes(request)
    if (quotes.length === 0) return null

    // Sort by output amount (highest first)
    quotes.sort((a, b) => {
      if (a.outputAmount > b.outputAmount) return -1
      if (a.outputAmount < b.outputAmount) return 1
      return 0
    })

    return quotes[0]
  }

  /**
   * Create an intent for cross-chain transfer
   */
  async createIntent(request: IntentRequest): Promise<Intent> {
    const url = `${this.config.aggregatorUrl}/intents`

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceChain: request.sourceChain,
        destinationChain: request.destinationChain,
        sourceToken: request.sourceToken,
        destinationToken: request.destinationToken,
        amount: request.amount.toString(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create intent: ${response.statusText}`)
    }

    const data = (await response.json()) as OIFIntentResponse
    return this.parseIntent(data)
  }

  /**
   * Get intent status
   */
  async getIntent(intentId: string): Promise<Intent | null> {
    const url = `${this.config.aggregatorUrl}/intents/${intentId}`

    const response = await this.fetchWithRetry(url)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get intent: ${response.statusText}`)
    }

    const data = (await response.json()) as OIFIntentResponse
    return this.parseIntent(data)
  }

  /**
   * Get user's intents
   */
  async getUserIntents(user: Address): Promise<Intent[]> {
    const url = `${this.config.aggregatorUrl}/intents?user=${user}`

    const response = await this.fetchWithRetry(url)
    if (!response.ok) {
      throw new Error(`Failed to get user intents: ${response.statusText}`)
    }

    // OIF API returns array directly
    const data = (await response.json()) as OIFIntentResponse[]
    const intents = Array.isArray(data) ? data : []
    return intents.map((i) => this.parseIntent(i))
  }

  /**
   * Cancel an intent
   */
  async cancelIntent(intentId: string, user: Address): Promise<boolean> {
    const url = `${this.config.aggregatorUrl}/intents/${intentId}/cancel`

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user }),
    })

    return response.ok
  }

  /**
   * Get available routes
   */
  async getRoutes(
    sourceChain?: number,
    destChain?: number,
  ): Promise<
    Array<{
      sourceChain: number
      destChain: number
      supportedTokens: Address[]
      avgFeePercent: number
      avgFillTime: number
    }>
  > {
    let url = `${this.config.aggregatorUrl}/routes`
    const params = new URLSearchParams()
    if (sourceChain) params.set('sourceChain', sourceChain.toString())
    if (destChain) params.set('destinationChain', destChain.toString())
    if (params.toString()) url += `?${params}`

    const response = await this.fetchWithRetry(url)
    if (!response.ok) {
      throw new Error(`Failed to get routes: ${response.statusText}`)
    }

    // OIF API returns array directly
    const data = await response.json()
    return Array.isArray(data) ? data : []
  }
  private async fetchWithRetry(
    url: string,
    options?: RequestInit,
  ): Promise<Response> {
    let lastError: Error | null = null

    for (let i = 0; i < this.config.maxRetries; i++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.defaultTimeout,
        )

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        return response
      } catch (e) {
        lastError = e as Error
        if (i < this.config.maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1))) // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Request failed')
  }

  private parseQuote(data: OIFQuoteResponse): CrossChainQuote {
    return {
      quoteId: data.quoteId,
      sourceChain: data.sourceChainId,
      destinationChain: data.destinationChainId,
      sourceToken: data.sourceToken as Address,
      destinationToken: data.destinationToken as Address,
      inputAmount: BigInt(data.inputAmount),
      outputAmount: BigInt(data.outputAmount),
      fee: BigInt(data.fee),
      feePercent: data.feePercent,
      estimatedTime: data.estimatedFillTimeSeconds,
      solver: data.solver as Address,
      solverReputation: data.solverReputation,
      validUntil: data.validUntil,
      route: `${data.sourceChainId} → ${data.destinationChainId}`,
    }
  }

  private parseIntent(data: OIFIntentResponse): Intent {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
    return {
      intentId: data.intentId,
      user: data.user as Address,
      sourceChain: data.sourceChainId,
      destinationChain: data.destinationChainId,
      inputToken: (data.inputs[0]?.token as Address) || ZERO_ADDRESS,
      inputAmount: BigInt(data.inputs[0]?.amount || '0'),
      outputToken: (data.outputs[0]?.token as Address) || ZERO_ADDRESS,
      outputAmount: BigInt(data.outputs[0]?.amount || '0'),
      status: data.status,
      solver: data.solver as Address | undefined,
      fillTxHash: data.fillTxHash,
      createdAt: data.createdAt,
      filledAt: data.filledAt,
    }
  }
}

export interface CrossChainPaymentOption {
  type: 'local' | 'cross-chain'
  sourceChain: number
  token: Address
  symbol: string
  amount: bigint
  fee: bigint
  totalCost: bigint
  estimatedTime: number
  quote?: CrossChainQuote
}

/**
 * Find the best payment option across all chains
 */
export async function findBestCrossChainPayment(
  oifClient: OIFClient,
  user: Address,
  targetChain: number,
  targetAmount: bigint,
  userBalances: TokenBalance[],
): Promise<CrossChainPaymentOption | null> {
  const options: CrossChainPaymentOption[] = []

  // Check local balances first
  const localBalances = userBalances.filter((b) => b.chainId === targetChain)
  for (const balance of localBalances) {
    if (balance.balance >= targetAmount) {
      options.push({
        type: 'local',
        sourceChain: targetChain,
        token: balance.address,
        symbol: balance.symbol,
        amount: targetAmount,
        fee: 0n,
        totalCost: targetAmount,
        estimatedTime: 0,
      })
    }
  }

  // Check cross-chain options
  const otherChainBalances = userBalances.filter(
    (b) => b.chainId !== targetChain,
  )

  for (const balance of otherChainBalances) {
    try {
      const quote = await oifClient.getBestQuote({
        user,
        sourceChain: balance.chainId,
        destinationChain: targetChain,
        sourceToken: balance.address,
        destinationToken:
          '0x0000000000000000000000000000000000000000' as Address, // ETH
        amount: balance.balance,
      })

      if (quote && quote.outputAmount >= targetAmount) {
        // Calculate how much we actually need to send
        const ratio = Number(targetAmount) / Number(quote.outputAmount)
        const neededInput = BigInt(Math.ceil(Number(quote.inputAmount) * ratio))

        if (balance.balance >= neededInput) {
          options.push({
            type: 'cross-chain',
            sourceChain: balance.chainId,
            token: balance.address,
            symbol: balance.symbol,
            amount: neededInput,
            fee: BigInt(Math.ceil(Number(quote.fee) * ratio)),
            totalCost: neededInput,
            estimatedTime: quote.estimatedTime,
            quote,
          })
        }
      }
    } catch (e) {
      // Skip failed quotes
      console.debug(
        `Failed to get quote for ${balance.symbol} on chain ${balance.chainId}:`,
        e,
      )
    }
  }

  if (options.length === 0) return null

  // Sort by total cost (lowest first), then by time (fastest first)
  options.sort((a, b) => {
    // Strongly prefer local options
    if (a.type === 'local' && b.type !== 'local') return -1
    if (a.type !== 'local' && b.type === 'local') return 1

    // Then by cost
    if (a.totalCost < b.totalCost) return -1
    if (a.totalCost > b.totalCost) return 1

    // Then by time
    return a.estimatedTime - b.estimatedTime
  })

  return options[0]
}
let globalOIFClient: OIFClient | null = null

/**
 * Get global OIF client
 */
export function getOIFClient(): OIFClient {
  if (!globalOIFClient) {
    // OIF is now served by Gateway A2A server on /api
    const aggregatorUrl =
      process.env.OIF_AGGREGATOR_URL ||
      `${getCoreAppUrl('NODE_EXPLORER_UI')}/api`
    globalOIFClient = new OIFClient({ aggregatorUrl })
  }
  return globalOIFClient
}

/**
 * Create a custom OIF client
 */
export function createOIFClient(config: OIFConfig): OIFClient {
  return new OIFClient(config)
}

/**
 * Quick helper to get best cross-chain quote
 */
export async function getBestCrossChainQuote(
  user: Address,
  sourceChain: number,
  destChain: number,
  amount: bigint,
  sourceToken: Address = '0x0000000000000000000000000000000000000000' as Address,
): Promise<CrossChainQuote | null> {
  return getOIFClient().getBestQuote({
    user,
    sourceChain,
    destinationChain: destChain,
    sourceToken,
    destinationToken: '0x0000000000000000000000000000000000000000' as Address,
    amount,
  })
}
