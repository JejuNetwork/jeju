import { type Connection, type Keypair, PublicKey } from '@solana/web3.js'
import { createJupiterAdapter, type JupiterAdapter } from '../jupiter'
import { createMeteoraAdapter, type MeteoraAdapter } from '../meteora'
import { createOrcaAdapter, type OrcaAdapter } from '../orca'
import { createPumpSwapAdapter, type PumpSwapAdapter } from '../pumpswap'
import { createRaydiumAdapter, type RaydiumAdapter } from '../raydium'
import type {
  BondingCurveParams,
  BondingCurveState,
  DexAdapter,
  DexType,
  LPPosition,
  PoolInfo,
  SwapParams,
  SwapQuote,
  SwapTransaction,
} from '../types'
import { USDC_MINT, WSOL_MINT } from '../types'

export interface AggregatorConfig {
  connection: Connection
  enabledDexes?: DexType[]
  preferJupiter?: boolean
  maxPriceImpact?: number
}

export interface AggregatedQuote extends SwapQuote {
  alternativeQuotes: SwapQuote[]
  bestSource: DexType
}

export interface AggregatorSwapResult {
  signature: string
  inputAmount: bigint
  outputAmount: bigint
  dex: DexType
}

export class SolanaDexAggregator {
  private connection: Connection
  private jupiter: JupiterAdapter
  private raydium: RaydiumAdapter
  private meteora: MeteoraAdapter
  private orca: OrcaAdapter
  private pumpswap: PumpSwapAdapter
  private enabledDexes: Set<DexType>
  private preferJupiter: boolean
  private maxPriceImpact: number

  constructor(config: AggregatorConfig) {
    this.connection = config.connection
    this.preferJupiter = config.preferJupiter ?? true
    this.maxPriceImpact = config.maxPriceImpact ?? 5

    this.jupiter = createJupiterAdapter(config.connection)
    this.raydium = createRaydiumAdapter(config.connection)
    this.meteora = createMeteoraAdapter(config.connection)
    this.orca = createOrcaAdapter(config.connection)
    this.pumpswap = createPumpSwapAdapter(config.connection)

    this.enabledDexes = new Set(
      config.enabledDexes ?? [
        'jupiter',
        'raydium',
        'meteora',
        'orca',
        'pumpswap',
      ],
    )
  }

  async getBestQuote(params: SwapParams): Promise<AggregatedQuote> {
    const quotes: SwapQuote[] = []
    const errors: { dex: DexType; error: string }[] = []

    const isBondingCurveToken =
      (await this.isBondingCurveToken(params.outputMint)) ||
      (await this.isBondingCurveToken(params.inputMint))

    const quotePromises: Promise<SwapQuote | null>[] = []

    if (
      this.preferJupiter &&
      this.enabledDexes.has('jupiter') &&
      !isBondingCurveToken
    ) {
      quotePromises.push(
        this.jupiter.getQuote(params).catch((e) => {
          errors.push({ dex: 'jupiter', error: e.message })
          return null
        }),
      )
    }

    if (this.enabledDexes.has('raydium') && !isBondingCurveToken) {
      quotePromises.push(
        this.raydium.getQuote(params).catch((e) => {
          errors.push({ dex: 'raydium', error: e.message })
          return null
        }),
      )
    }

    if (this.enabledDexes.has('meteora') && !isBondingCurveToken) {
      quotePromises.push(
        this.meteora.getQuote(params).catch((e) => {
          errors.push({ dex: 'meteora', error: e.message })
          return null
        }),
      )
    }

    if (this.enabledDexes.has('orca') && !isBondingCurveToken) {
      quotePromises.push(
        this.orca.getQuote(params).catch((e) => {
          errors.push({ dex: 'orca', error: e.message })
          return null
        }),
      )
    }

    if (this.enabledDexes.has('pumpswap') && isBondingCurveToken) {
      quotePromises.push(
        this.pumpswap.getQuote(params).catch((e) => {
          errors.push({ dex: 'pumpswap', error: e.message })
          return null
        }),
      )
    }

    const results = await Promise.all(quotePromises)

    for (const quote of results) {
      if (quote && quote.priceImpactPct <= this.maxPriceImpact) {
        quotes.push(quote)
      }
    }

    if (quotes.length === 0) {
      const errorMessages = errors.map((e) => `${e.dex}: ${e.error}`).join('; ')
      throw new Error(`No valid quotes found. Errors: ${errorMessages}`)
    }

    quotes.sort((a, b) => Number(b.outputAmount - a.outputAmount))

    const bestQuote = quotes[0]

    return {
      ...bestQuote,
      alternativeQuotes: quotes.slice(1),
      bestSource: bestQuote.dex,
    }
  }

  async getAllQuotes(params: SwapParams): Promise<SwapQuote[]> {
    const quote = await this.getBestQuote(params)
    return [quote, ...quote.alternativeQuotes]
  }

  async executeSwap(
    params: SwapParams,
    signer: Keypair,
  ): Promise<AggregatorSwapResult> {
    const quote = await this.getBestQuote(params)
    const swapTx = await this.buildSwapTransaction(quote, params.userPublicKey)

    swapTx.transaction.sign([signer])

    const signature = await this.connection.sendTransaction(
      swapTx.transaction,
      {
        maxRetries: 3,
        skipPreflight: false,
      },
    )

    await this.connection.confirmTransaction({
      signature,
      blockhash: (await this.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: swapTx.lastValidBlockHeight,
    })

    return {
      signature,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      dex: quote.dex,
    }
  }

  async buildSwapTransaction(
    quote: SwapQuote,
    userPublicKey: PublicKey,
  ): Promise<SwapTransaction> {
    if (
      quote.dex === 'jupiter' ||
      (this.preferJupiter && quote.dex !== 'pumpswap')
    ) {
      return this.jupiter.buildSwapTransactionForUser(quote, userPublicKey)
    }

    if (quote.dex === 'pumpswap') {
      return this.pumpswap.buildSwapTransaction(quote)
    }

    return this.jupiter.buildSwapTransactionForUser(quote, userPublicKey)
  }

  async findPools(tokenA: PublicKey, tokenB: PublicKey): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = []

    const poolPromises = [
      this.raydium.getPools(tokenA, tokenB).catch(() => []),
      this.meteora.getPools(tokenA, tokenB).catch(() => []),
      this.orca.getPools(tokenA, tokenB).catch(() => []),
    ]

    const results = await Promise.all(poolPromises)
    for (const result of results) {
      pools.push(...result)
    }

    return pools.sort((a, b) => Number(b.tvl - a.tvl))
  }

  async getBestPool(
    tokenA: PublicKey,
    tokenB: PublicKey,
  ): Promise<PoolInfo | null> {
    const pools = await this.findPools(tokenA, tokenB)
    return pools[0] ?? null
  }

  async getAllLPPositions(userPublicKey: PublicKey): Promise<
    {
      dex: DexType
      positions: LPPosition[]
    }[]
  > {
    const [raydiumPositions, meteoraPositions, orcaPositions] =
      await Promise.all([
        this.raydium.getLPPositions(userPublicKey),
        this.meteora.getLPPositions(userPublicKey),
        this.orca.getLPPositions(userPublicKey),
      ])

    const results: { dex: DexType; positions: LPPosition[] }[] = []

    if (raydiumPositions.length > 0) {
      results.push({ dex: 'raydium', positions: raydiumPositions })
    }
    if (meteoraPositions.length > 0) {
      results.push({ dex: 'meteora', positions: meteoraPositions })
    }
    if (orcaPositions.length > 0) {
      results.push({ dex: 'orca', positions: orcaPositions })
    }

    return results
  }

  async getRecommendedPools(
    tokenA: PublicKey,
    tokenB: PublicKey,
    options?: {
      preferredDex?: DexType
      minTvl?: bigint
      maxFee?: number
    },
  ): Promise<PoolInfo[]> {
    const pools = await this.findPools(tokenA, tokenB)

    return pools.filter((pool) => {
      if (options?.preferredDex && pool.dex !== options.preferredDex) {
        return false
      }
      if (options?.minTvl && pool.tvl < options.minTvl) {
        return false
      }
      if (options?.maxFee && pool.fee > options.maxFee) {
        return false
      }
      return true
    })
  }

  async getBondingCurve(
    tokenMint: PublicKey,
  ): Promise<BondingCurveState | null> {
    const curveAddress = this.pumpswap.deriveBondingCurveAddress(tokenMint)
    return this.pumpswap.getBondingCurve(curveAddress)
  }

  async isBondingCurveToken(tokenMint: PublicKey): Promise<boolean> {
    const curve = await this.getBondingCurve(tokenMint)
    return curve !== null && !curve.graduated
  }

  async createBondingCurveToken(
    params: BondingCurveParams,
    creator: PublicKey,
  ): Promise<{
    transaction: SwapTransaction
    tokenMint: PublicKey
    curveAddress: PublicKey
  }> {
    return this.pumpswap.createBondingCurve(params, creator)
  }

  async getPrice(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount?: bigint,
  ): Promise<number> {
    return this.jupiter.getPrice(inputMint, outputMint, amount)
  }

  async getPriceUSD(tokenMint: PublicKey): Promise<number> {
    const usdc = new PublicKey(USDC_MINT)

    if (tokenMint.equals(usdc)) {
      return 1
    }

    return this.jupiter.getPrice(tokenMint, usdc, 1_000_000n)
  }

  async getTokenMarketData(tokenMint: PublicKey): Promise<{
    priceUSD: number
    liquidityUSD: number
    volume24h: number
    topPools: PoolInfo[]
  }> {
    const [priceUSD, pools] = await Promise.all([
      this.getPriceUSD(tokenMint),
      this.findPools(tokenMint, new PublicKey(WSOL_MINT)),
    ])

    const topPools = pools.slice(0, 5)
    const totalTvl = pools.reduce((sum, p) => sum + p.tvl, 0n)

    return {
      priceUSD,
      liquidityUSD: Number(totalTvl) / 1e6,
      volume24h: 0,
      topPools,
    }
  }

  getAdapter(dex: DexType): DexAdapter {
    switch (dex) {
      case 'jupiter':
        return this.jupiter
      case 'raydium':
        return this.raydium
      case 'meteora':
        return this.meteora
      case 'orca':
        return this.orca
      case 'pumpswap':
        return this.pumpswap
      default:
        throw new Error(`Unknown DEX: ${dex}`)
    }
  }

  getConnection(): Connection {
    return this.connection
  }
}

export function createSolanaDexAggregator(
  config: AggregatorConfig,
): SolanaDexAggregator {
  return new SolanaDexAggregator(config)
}
