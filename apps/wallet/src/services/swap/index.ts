/**
 * Network Swap Service
 * Token swaps via the network solver network
 */

import { expectValid } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { API_URLS, fetchApi, postApi } from '../../lib/eden'
import {
  CrossChainSwapQuotesResponseSchema,
  CrossChainSwapResponseSchema,
  SwapQuotesResponseSchema,
  SwapSubmitResponseSchema,
  SwapTxDataResponseSchema,
  TokenListResponseSchema,
} from '../../schemas/api-responses'
import type { Token } from '../../sdk/types'
import type { SupportedChainId } from '../rpc'

const JEJU_SOLVER_URL = API_URLS.solver

interface SwapQuote {
  id: string
  inputToken: Token
  outputToken: Token
  inputAmount: bigint
  outputAmount: bigint
  priceImpact: number
  route: SwapRoute[]
  estimatedGas: bigint
  fee: { amount: bigint; token: Token }
  validUntil: number
  provider: string
}

interface SwapRoute {
  protocol: string
  pool: Address
  tokenIn: Address
  tokenOut: Address
  fee?: number
}

interface SwapParams {
  inputToken: Token
  outputToken: Token
  inputAmount: bigint
  slippage: number // Percentage, e.g., 0.5 for 0.5%
  recipient?: Address
  deadline?: number
}

interface SwapResult {
  txHash: Hex
  inputAmount: bigint
  outputAmount: bigint
  route: SwapRoute[]
  gasUsed: bigint
  status: 'pending' | 'success' | 'failed'
}

// Cross-chain swap using OIF
interface CrossChainSwapParams {
  inputToken: Token
  outputToken: Token
  inputAmount: bigint
  slippage: number
  sourceChainId: SupportedChainId
  destinationChainId: SupportedChainId
  recipient?: Address
}

interface CrossChainSwapQuote extends SwapQuote {
  sourceChainId: SupportedChainId
  destinationChainId: SupportedChainId
  bridgeFee: bigint
  estimatedTime: number // seconds
  intentId?: Hex
}

class SwapService {
  private recentToTokens: Token[] = []
  private defaultSlippage = 0.5
  private preferMevProtection = true

  async getQuote(params: SwapParams): Promise<SwapQuote[]> {
    const { inputToken, outputToken, inputAmount, slippage } = params

    const response = await postApi<SwapQuote[]>(JEJU_SOLVER_URL, '/quote', {
      inputToken: {
        chainId: inputToken.chainId,
        address: inputToken.address,
      },
      outputToken: {
        chainId: outputToken.chainId,
        address: outputToken.address,
      },
      inputAmount: inputAmount.toString(),
      slippage,
      mevProtection: this.preferMevProtection,
    })

    const quotes = expectValid(
      SwapQuotesResponseSchema,
      response,
      'swap quotes',
    )
    return quotes.map((q) => ({
      ...q,
      inputAmount: BigInt(q.inputAmount),
      outputAmount: BigInt(q.outputAmount),
      estimatedGas: BigInt(q.estimatedGas),
      fee: { ...q.fee, amount: BigInt(q.fee.amount) },
    }))
  }

  async getCrossChainQuote(
    params: CrossChainSwapParams,
  ): Promise<CrossChainSwapQuote[]> {
    const {
      inputToken,
      outputToken,
      inputAmount,
      slippage,
      sourceChainId,
      destinationChainId,
    } = params

    const response = await postApi<CrossChainSwapQuote[]>(
      JEJU_SOLVER_URL,
      '/cross-chain/quote',
      {
        inputToken: {
          chainId: inputToken.chainId,
          address: inputToken.address,
        },
        outputToken: {
          chainId: outputToken.chainId,
          address: outputToken.address,
        },
        inputAmount: inputAmount.toString(),
        slippage,
        sourceChainId,
        destinationChainId,
      },
    )

    const validated = expectValid(
      CrossChainSwapQuotesResponseSchema,
      response,
      'cross-chain swap quotes',
    )
    return validated.map((q) => ({
      ...q,
      inputAmount: BigInt(q.inputAmount),
      outputAmount: BigInt(q.outputAmount),
      estimatedGas: BigInt(q.estimatedGas),
      fee: { ...q.fee, amount: BigInt(q.fee.amount) },
      bridgeFee: BigInt(q.bridgeFee),
      sourceChainId: q.sourceChainId as SupportedChainId,
      destinationChainId: q.destinationChainId as SupportedChainId,
    }))
  }

  async executeSwap(
    quote: SwapQuote,
    signer: { signTransaction: (tx: object) => Promise<Hex> },
  ): Promise<SwapResult> {
    // Get transaction data from solver
    const txData = await postApi<{
      to: Address
      data: Hex
      value: string
      gasLimit: string
    }>(JEJU_SOLVER_URL, '/swap', { quoteId: quote.id })

    const validated = expectValid(
      SwapTxDataResponseSchema,
      txData,
      'swap transaction data',
    )

    // Sign and send transaction
    const signedTx = await signer.signTransaction({
      to: validated.to,
      data: validated.data,
      value: BigInt(validated.value),
      gasLimit: BigInt(validated.gasLimit),
    })

    // Submit to the network (MEV-protected)
    const result = await postApi<{ txHash: Hex }>(JEJU_SOLVER_URL, '/submit', {
      signedTx,
      mevProtection: this.preferMevProtection,
    })

    const submitResult = expectValid(
      SwapSubmitResponseSchema,
      result,
      'swap submit response',
    )

    // Track recent tokens
    this.addRecentToken(quote.outputToken)

    return {
      txHash: submitResult.txHash,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      route: quote.route,
      gasUsed: quote.estimatedGas,
      status: 'pending',
    }
  }

  async executeCrossChainSwap(
    quote: CrossChainSwapQuote,
    signer: { signTransaction: (tx: object) => Promise<Hex> },
  ): Promise<{ intentId: Hex; status: string }> {
    // Cross-chain swaps use network OIF
    const response = await postApi<{ intentData: object; intentId: Hex }>(
      JEJU_SOLVER_URL,
      '/cross-chain/swap',
      { quoteId: quote.id },
    )

    const { intentData, intentId } = expectValid(
      CrossChainSwapResponseSchema,
      response,
      'cross-chain swap response',
    )

    // Sign intent
    const signedTx = await signer.signTransaction(intentData)

    // Submit intent
    await postApi(JEJU_SOLVER_URL, '/cross-chain/submit', {
      signedTx,
      intentId,
    })

    return { intentId, status: 'pending' }
  }

  // Token list management
  async getPopularTokens(chainId: SupportedChainId): Promise<Token[]> {
    const response = await fetchApi<Token[]>(
      JEJU_SOLVER_URL,
      `/tokens/${chainId}/popular`,
    )
    return expectValid(TokenListResponseSchema, response, 'popular tokens')
  }

  async searchTokens(
    chainId: SupportedChainId,
    query: string,
  ): Promise<Token[]> {
    const response = await fetchApi<Token[]>(
      JEJU_SOLVER_URL,
      `/tokens/${chainId}/search?q=${encodeURIComponent(query)}`,
    )
    return expectValid(
      TokenListResponseSchema,
      response,
      'token search results',
    )
  }

  getRecentTokens(): Token[] {
    return this.recentToTokens.slice(0, 10)
  }

  private addRecentToken(token: Token) {
    this.recentToTokens = [
      token,
      ...this.recentToTokens.filter((t) => t.address !== token.address),
    ].slice(0, 10)
  }

  // Settings
  setSlippage(slippage: number) {
    this.defaultSlippage = slippage
  }

  getSlippage(): number {
    return this.defaultSlippage
  }

  setMevProtection(enabled: boolean) {
    this.preferMevProtection = enabled
  }

  getMevProtection(): boolean {
    return this.preferMevProtection
  }

  // Calculate minimum output
  calculateMinOutput(expectedOutput: bigint, slippagePercent: number): bigint {
    const slippageBps = BigInt(Math.floor(slippagePercent * 100))
    return (expectedOutput * (10000n - slippageBps)) / 10000n
  }

  // Format amounts for display
  formatAmount(amount: bigint, decimals: number, maxDecimals = 4): string {
    const value = Number(amount) / 10 ** decimals
    if (value < 0.0001) return '< 0.0001'
    return value.toLocaleString(undefined, {
      maximumFractionDigits: maxDecimals,
    })
  }
}

export const swapService = new SwapService()
export { SwapService }
export type {
  Token,
  SwapQuote,
  SwapParams,
  SwapResult,
  CrossChainSwapParams,
  CrossChainSwapQuote,
}
