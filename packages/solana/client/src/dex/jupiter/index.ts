/**
 * Jupiter Aggregator Integration
 */

import { expectValid } from '@jejunetwork/types'
import {
  type Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  type JupiterQuoteResponse,
  JupiterQuoteResponseSchema,
  JupiterSwapResponseSchema,
  type JupiterToken,
  JupiterTokenListSchema,
} from '../schemas'
import type {
  AddLiquidityParams,
  AddLiquidityQuote,
  DexAdapter,
  DexType,
  LPPosition,
  PoolInfo,
  RemoveLiquidityParams,
  RemoveLiquidityQuote,
  SwapParams,
  SwapQuote,
  SwapRoute,
  SwapTransaction,
} from '../types'

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote'
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap'
const JUPITER_TOKENS_API = 'https://token.jup.ag/all'

export class JupiterAdapter implements DexAdapter {
  readonly name = 'jupiter' as const
  private connection: Connection
  private tokenCache: Map<string, JupiterToken> = new Map()

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const url = new URL(JUPITER_QUOTE_API)
    url.searchParams.set('inputMint', params.inputMint.toBase58())
    url.searchParams.set('outputMint', params.outputMint.toBase58())
    url.searchParams.set('amount', params.amount.toString())
    url.searchParams.set('slippageBps', params.slippageBps.toString())
    url.searchParams.set('onlyDirectRoutes', 'false')
    url.searchParams.set('asLegacyTransaction', 'false')

    const response = await fetch(url.toString())
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jupiter quote failed: ${error}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      JupiterQuoteResponseSchema,
      rawData,
      'Jupiter quote response',
    )

    let totalFee = 0n
    for (const step of data.routePlan) {
      totalFee += BigInt(step.swapInfo.feeAmount)
    }

    const route: SwapRoute[] = data.routePlan.map((step) => ({
      dex: this.labelToDex(step.swapInfo.label),
      poolAddress: new PublicKey(step.swapInfo.ammKey),
      inputMint: new PublicKey(step.swapInfo.inputMint),
      outputMint: new PublicKey(step.swapInfo.outputMint),
      inputAmount: BigInt(step.swapInfo.inAmount),
      outputAmount: BigInt(step.swapInfo.outAmount),
    }))

    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: BigInt(data.inAmount),
      outputAmount: BigInt(data.outAmount),
      minOutputAmount: BigInt(data.otherAmountThreshold),
      priceImpactPct: parseFloat(data.priceImpactPct),
      fee: totalFee,
      route,
      dex: 'jupiter',
    }
  }

  async buildSwapTransaction(quote: SwapQuote): Promise<SwapTransaction> {
    const quoteResponse = await this.getJupiterQuoteRaw(
      quote.inputMint,
      quote.outputMint,
      quote.inputAmount,
    )

    if (quote.route.length === 0) {
      throw new Error('Quote has no route')
    }

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: quote.route[0].inputMint.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jupiter swap build failed: ${error}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      JupiterSwapResponseSchema,
      rawData,
      'Jupiter swap response',
    )

    const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64')
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf)

    return {
      transaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
    }
  }

  async buildSwapTransactionForUser(
    quote: SwapQuote,
    userPublicKey: PublicKey,
  ): Promise<SwapTransaction> {
    const quoteResponse = await this.getJupiterQuoteRaw(
      quote.inputMint,
      quote.outputMint,
      quote.inputAmount,
    )

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userPublicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jupiter swap build failed: ${error}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      JupiterSwapResponseSchema,
      rawData,
      'Jupiter swap response',
    )

    const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64')
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf)

    return {
      transaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
    }
  }

  private async getJupiterQuoteRaw(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint,
  ): Promise<JupiterQuoteResponse> {
    const url = new URL(JUPITER_QUOTE_API)
    url.searchParams.set('inputMint', inputMint.toBase58())
    url.searchParams.set('outputMint', outputMint.toBase58())
    url.searchParams.set('amount', amount.toString())
    url.searchParams.set('slippageBps', '50')

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    return expectValid(
      JupiterQuoteResponseSchema,
      rawData,
      'Jupiter quote response',
    )
  }

  private labelToDex(label: string): DexType {
    const normalized = label.toLowerCase()
    if (normalized.includes('raydium')) return 'raydium'
    if (normalized.includes('meteora')) return 'meteora'
    if (normalized.includes('orca') || normalized.includes('whirlpool'))
      return 'orca'
    if (normalized.includes('pump')) return 'pumpswap'
    return 'jupiter'
  }

  async getPools(
    _tokenA?: PublicKey,
    _tokenB?: PublicKey,
  ): Promise<PoolInfo[]> {
    return []
  }

  async getPoolInfo(_pool: PublicKey): Promise<PoolInfo> {
    throw new Error(
      'Jupiter is an aggregator - use specific DEX adapter for pool info',
    )
  }

  async getAddLiquidityQuote(
    _params: AddLiquidityParams,
  ): Promise<AddLiquidityQuote> {
    throw new Error(
      'Jupiter is an aggregator - use specific DEX adapter for liquidity',
    )
  }

  async buildAddLiquidityTransaction(
    _quote: AddLiquidityQuote,
    _params: AddLiquidityParams,
  ): Promise<SwapTransaction> {
    throw new Error(
      'Jupiter is an aggregator - use specific DEX adapter for liquidity',
    )
  }

  async getRemoveLiquidityQuote(
    _params: RemoveLiquidityParams,
  ): Promise<RemoveLiquidityQuote> {
    throw new Error(
      'Jupiter is an aggregator - use specific DEX adapter for liquidity',
    )
  }

  async buildRemoveLiquidityTransaction(
    _quote: RemoveLiquidityQuote,
    _params: RemoveLiquidityParams,
  ): Promise<SwapTransaction> {
    throw new Error(
      'Jupiter is an aggregator - use specific DEX adapter for liquidity',
    )
  }

  async getLPPositions(_userPublicKey: PublicKey): Promise<LPPosition[]> {
    return []
  }

  async getTokenList(): Promise<Map<string, JupiterToken>> {
    if (this.tokenCache.size > 0) {
      return this.tokenCache
    }

    const response = await fetch(JUPITER_TOKENS_API)
    if (!response.ok) {
      throw new Error('Failed to fetch Jupiter token list')
    }

    const rawData = await response.json()
    const tokens = expectValid(
      JupiterTokenListSchema,
      rawData,
      'Jupiter token list',
    )

    const tokenMap = new Map<string, JupiterToken>()
    for (const token of tokens) {
      tokenMap.set(token.address, token)
    }

    this.tokenCache = tokenMap
    return tokenMap
  }

  async getPrice(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint = 1_000_000n,
  ): Promise<number> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: 50,
      userPublicKey: PublicKey.default,
    })

    const inputDecimals = await this.getTokenDecimals(inputMint)
    const outputDecimals = await this.getTokenDecimals(outputMint)

    const inputNormalized = Number(quote.inputAmount) / 10 ** inputDecimals
    const outputNormalized = Number(quote.outputAmount) / 10 ** outputDecimals

    return outputNormalized / inputNormalized
  }

  private async getTokenDecimals(mint: PublicKey): Promise<number> {
    const cached = this.tokenCache.get(mint.toBase58())
    if (cached) return cached.decimals

    const accountInfo = await this.connection.getParsedAccountInfo(mint)
    if (!accountInfo.value) {
      throw new Error(`Token mint not found: ${mint.toBase58()}`)
    }

    const data = accountInfo.value.data
    if ('parsed' in data) {
      return data.parsed.info.decimals
    }

    throw new Error(`Could not parse token decimals: ${mint.toBase58()}`)
  }
}

export function createJupiterAdapter(connection: Connection): JupiterAdapter {
  return new JupiterAdapter(connection)
}
