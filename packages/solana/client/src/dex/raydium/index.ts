import { expectValid } from '@jejunetwork/types'
import { type Connection, PublicKey } from '@solana/web3.js'
import {
  RaydiumCLMMPositionsResponseSchema,
  RaydiumLPPositionsResponseSchema,
  RaydiumPoolDetailResponseSchema,
  RaydiumPoolListResponseSchema,
} from '../schemas'
import type {
  AddLiquidityParams,
  AddLiquidityQuote,
  CLPosition,
  ConcentratedLiquidityParams,
  DexAdapter,
  LPPosition,
  PoolInfo,
  RemoveLiquidityParams,
  RemoveLiquidityQuote,
  SwapParams,
  SwapQuote,
  SwapTransaction,
} from '../types'
import {
  buildPlaceholderTransaction,
  buildSwapQuote,
  calculateAMMSwap,
  getSwapReserves,
  poolMatchesFilter,
} from '../utils'

const RAYDIUM_API_BASE = 'https://api-v3.raydium.io'

export class RaydiumAdapter implements DexAdapter {
  readonly name = 'raydium' as const
  private connection: Connection
  private poolCache: Map<string, PoolInfo> = new Map()

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const pools = await this.getPools(params.inputMint, params.outputMint)
    if (pools.length === 0) {
      throw new Error(
        `No Raydium pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`,
      )
    }

    const pool = pools.sort((a, b) => Number(b.tvl - a.tvl))[0]
    const { inputReserve, outputReserve } = getSwapReserves(
      pool,
      params.inputMint,
    )

    const ammResult = calculateAMMSwap({
      inputAmount: params.amount,
      inputReserve,
      outputReserve,
      feeBps: Math.floor(pool.fee * 10000),
      slippageBps: params.slippageBps,
    })

    return buildSwapQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: params.amount,
      pool,
      ammResult,
      dex: 'raydium',
    })
  }

  async buildSwapTransaction(_quote: SwapQuote): Promise<SwapTransaction> {
    throw new Error(
      'Use Jupiter adapter for swap execution - it routes through Raydium automatically',
    )
  }

  async getPools(tokenA?: PublicKey, tokenB?: PublicKey): Promise<PoolInfo[]> {
    const url = new URL(`${RAYDIUM_API_BASE}/pools/info/list`)
    url.searchParams.set('poolType', 'all')
    url.searchParams.set('poolSortField', 'tvl')
    url.searchParams.set('sortType', 'desc')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('page', '1')

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Raydium API error: ${response.statusText}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      RaydiumPoolListResponseSchema,
      rawData,
      'Raydium pool list',
    )
    const pools: PoolInfo[] = []

    for (const pool of data.data.data) {
      const mintA = new PublicKey(pool.mintA.address)
      const mintB = new PublicKey(pool.mintB.address)

      if (!poolMatchesFilter(mintA, mintB, { tokenA, tokenB })) continue

      const poolInfo: PoolInfo = {
        address: new PublicKey(pool.id),
        dex: 'raydium',
        poolType: pool.type === 'Concentrated' ? 'clmm' : 'cpmm',
        tokenA: {
          mint: mintA,
          decimals: pool.mintA.decimals,
          symbol: pool.mintA.symbol,
        },
        tokenB: {
          mint: mintB,
          decimals: pool.mintB.decimals,
          symbol: pool.mintB.symbol,
        },
        reserveA: BigInt(
          Math.floor(pool.mintAmountA * 10 ** pool.mintA.decimals),
        ),
        reserveB: BigInt(
          Math.floor(pool.mintAmountB * 10 ** pool.mintB.decimals),
        ),
        fee: pool.feeRate,
        tvl: BigInt(Math.floor(pool.tvl * 1e6)),
        apy: pool.apr.fee + pool.apr.reward,
      }

      pools.push(poolInfo)
      this.poolCache.set(pool.id, poolInfo)
    }

    return pools
  }

  async getPoolInfo(pool: PublicKey): Promise<PoolInfo> {
    const cached = this.poolCache.get(pool.toBase58())
    if (cached) return cached

    const url = `${RAYDIUM_API_BASE}/pools/info/ids?ids=${pool.toBase58()}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      RaydiumPoolDetailResponseSchema,
      rawData,
      'Raydium pool detail',
    )

    if (data.data.length === 0) {
      throw new Error(`Pool not found: ${pool.toBase58()}`)
    }

    const p = data.data[0]
    const poolInfo: PoolInfo = {
      address: pool,
      dex: 'raydium',
      poolType: p.type === 'Concentrated' ? 'clmm' : 'cpmm',
      tokenA: {
        mint: new PublicKey(p.mintA.address),
        decimals: p.mintA.decimals,
        symbol: p.mintA.symbol,
      },
      tokenB: {
        mint: new PublicKey(p.mintB.address),
        decimals: p.mintB.decimals,
        symbol: p.mintB.symbol,
      },
      reserveA: BigInt(Math.floor(p.mintAmountA * 10 ** p.mintA.decimals)),
      reserveB: BigInt(Math.floor(p.mintAmountB * 10 ** p.mintB.decimals)),
      fee: p.feeRate,
      tvl: BigInt(Math.floor(p.tvl * 1e6)),
      apy: p.apr.fee + p.apr.reward,
    }

    this.poolCache.set(pool.toBase58(), poolInfo)
    return poolInfo
  }

  async getAddLiquidityQuote(
    params: AddLiquidityParams,
  ): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool)

    const ratioA = (params.tokenAAmount * 10000n) / pool.reserveA
    const ratioB = (params.tokenBAmount * 10000n) / pool.reserveB
    const minRatio = ratioA < ratioB ? ratioA : ratioB

    const adjustedA = (pool.reserveA * minRatio) / 10000n
    const adjustedB = (pool.reserveB * minRatio) / 10000n

    return {
      pool: params.pool,
      tokenAAmount: adjustedA,
      tokenBAmount: adjustedB,
      lpTokenAmount: minRatio,
      shareOfPool: Number(minRatio) / 10000,
    }
  }

  async buildAddLiquidityTransaction(
    _quote: AddLiquidityQuote,
    params: AddLiquidityParams,
  ): Promise<SwapTransaction> {
    return buildPlaceholderTransaction(this.connection, params.userPublicKey)
  }

  async getRemoveLiquidityQuote(
    params: RemoveLiquidityParams,
  ): Promise<RemoveLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool)
    const shareRatio = Number(params.lpAmount) / 1e9

    return {
      pool: params.pool,
      lpAmount: params.lpAmount,
      tokenAAmount: BigInt(Math.floor(Number(pool.reserveA) * shareRatio)),
      tokenBAmount: BigInt(Math.floor(Number(pool.reserveB) * shareRatio)),
    }
  }

  async buildRemoveLiquidityTransaction(
    _quote: RemoveLiquidityQuote,
    params: RemoveLiquidityParams,
  ): Promise<SwapTransaction> {
    return buildPlaceholderTransaction(this.connection, params.userPublicKey)
  }

  async getLPPositions(userPublicKey: PublicKey): Promise<LPPosition[]> {
    const url = `${RAYDIUM_API_BASE}/pools/info/lp?owner=${userPublicKey.toBase58()}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Raydium LP positions API error: ${response.statusText}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      RaydiumLPPositionsResponseSchema,
      rawData,
      'Raydium LP positions',
    )

    return data.data.map((pos) => ({
      pool: new PublicKey(pos.poolId),
      lpMint: new PublicKey(pos.lpMint),
      lpBalance: BigInt(pos.lpAmount),
      tokenAValue: BigInt(pos.tokenAAmount),
      tokenBValue: BigInt(pos.tokenBAmount),
      unclaimedFees: { tokenA: 0n, tokenB: 0n },
    }))
  }

  async createCLMMPosition(
    params: ConcentratedLiquidityParams,
  ): Promise<SwapTransaction> {
    const pool = await this.getPoolInfo(params.pool)

    if (pool.poolType !== 'clmm') {
      throw new Error('Pool is not a CLMM pool')
    }

    return buildPlaceholderTransaction(this.connection, params.userPublicKey)
  }

  async getCLMMPositions(userPublicKey: PublicKey): Promise<CLPosition[]> {
    const url = `${RAYDIUM_API_BASE}/pools/info/clmm/positions?owner=${userPublicKey.toBase58()}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Raydium CLMM positions API error: ${response.statusText}`,
      )
    }

    const rawData = await response.json()
    const data = expectValid(
      RaydiumCLMMPositionsResponseSchema,
      rawData,
      'Raydium CLMM positions',
    )

    return data.data.map((pos) => ({
      positionMint: new PublicKey(pos.nftMint),
      pool: new PublicKey(pos.poolId),
      tickLower: pos.tickLower,
      tickUpper: pos.tickUpper,
      liquidity: BigInt(pos.liquidity),
      tokenAOwed: BigInt(pos.tokenFeesOwedA),
      tokenBOwed: BigInt(pos.tokenFeesOwedB),
      feeGrowthA: 0n,
      feeGrowthB: 0n,
    }))
  }
}

export function createRaydiumAdapter(connection: Connection): RaydiumAdapter {
  return new RaydiumAdapter(connection)
}
