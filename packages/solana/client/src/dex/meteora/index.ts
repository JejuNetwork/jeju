import { expectValid } from '@jejunetwork/types'
import { type Connection, PublicKey } from '@solana/web3.js'
import {
  MeteoraPoolInfoSchema,
  MeteoraPoolListSchema,
  MeteoraPositionsListSchema,
} from '../schemas'
import type {
  AddLiquidityParams,
  AddLiquidityQuote,
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
  inferDecimals,
  poolMatchesFilter,
} from '../utils'

const METEORA_API_BASE = 'https://dlmm-api.meteora.ag'

export class MeteoraAdapter implements DexAdapter {
  readonly name = 'meteora' as const
  private connection: Connection
  private poolCache: Map<string, PoolInfo> = new Map()

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const pools = await this.getPools(params.inputMint, params.outputMint)
    if (pools.length === 0) {
      throw new Error(
        `No Meteora pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`,
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
      dex: 'meteora',
    })
  }

  async buildSwapTransaction(_quote: SwapQuote): Promise<SwapTransaction> {
    throw new Error(
      'Use Jupiter adapter for swap execution - it routes through Meteora automatically',
    )
  }

  async getPools(tokenA?: PublicKey, tokenB?: PublicKey): Promise<PoolInfo[]> {
    const url = `${METEORA_API_BASE}/pair/all`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Meteora API error: ${response.statusText}`)
    }

    const rawData = await response.json()
    const poolsData = expectValid(
      MeteoraPoolListSchema,
      rawData,
      'Meteora pool list',
    )
    const pools: PoolInfo[] = []

    for (const pool of poolsData) {
      if (pool.hide) continue

      const mintX = new PublicKey(pool.mint_x)
      const mintY = new PublicKey(pool.mint_y)

      if (!poolMatchesFilter(mintX, mintY, { tokenA, tokenB })) continue

      const [symbolX, symbolY] = pool.name.split('-')

      const poolInfo: PoolInfo = {
        address: new PublicKey(pool.address),
        dex: 'meteora',
        poolType: 'dlmm',
        tokenA: {
          mint: mintX,
          decimals: inferDecimals(pool.reserve_x_amount, pool.reserve_x),
          symbol: symbolX || mintX.toBase58().slice(0, 4),
        },
        tokenB: {
          mint: mintY,
          decimals: inferDecimals(pool.reserve_y_amount, pool.reserve_y),
          symbol: symbolY || mintY.toBase58().slice(0, 4),
        },
        reserveA: BigInt(pool.reserve_x),
        reserveB: BigInt(pool.reserve_y),
        fee: parseFloat(pool.base_fee_percentage) / 100,
        tvl: BigInt(Math.floor(parseFloat(pool.liquidity))),
        apy: pool.apy,
      }

      pools.push(poolInfo)
      this.poolCache.set(pool.address, poolInfo)
    }

    return pools
  }

  async getPoolInfo(pool: PublicKey): Promise<PoolInfo> {
    const cached = this.poolCache.get(pool.toBase58())
    if (cached) return cached

    const url = `${METEORA_API_BASE}/pair/${pool.toBase58()}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      MeteoraPoolInfoSchema,
      rawData,
      'Meteora pool info',
    )
    const [symbolX, symbolY] = data.name.split('-')

    const poolInfo: PoolInfo = {
      address: pool,
      dex: 'meteora',
      poolType: 'dlmm',
      tokenA: {
        mint: new PublicKey(data.mint_x),
        decimals: inferDecimals(data.reserve_x_amount, data.reserve_x),
        symbol: symbolX || '',
      },
      tokenB: {
        mint: new PublicKey(data.mint_y),
        decimals: inferDecimals(data.reserve_y_amount, data.reserve_y),
        symbol: symbolY || '',
      },
      reserveA: BigInt(data.reserve_x),
      reserveB: BigInt(data.reserve_y),
      fee: parseFloat(data.base_fee_percentage) / 100,
      tvl: BigInt(Math.floor(parseFloat(data.liquidity))),
      apy: data.apy,
    }

    this.poolCache.set(pool.toBase58(), poolInfo)
    return poolInfo
  }

  async getAddLiquidityQuote(
    params: AddLiquidityParams,
  ): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool)

    const shareA = (params.tokenAAmount * 10000n) / pool.reserveA
    const shareB = (params.tokenBAmount * 10000n) / pool.reserveB
    const minShare = shareA < shareB ? shareA : shareB

    return {
      pool: params.pool,
      tokenAAmount: (pool.reserveA * minShare) / 10000n,
      tokenBAmount: (pool.reserveB * minShare) / 10000n,
      lpTokenAmount: minShare,
      shareOfPool: Number(minShare) / 10000,
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
    const shareRatio = Number(params.lpAmount) / 10000

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
    const url = `${METEORA_API_BASE}/position/${userPublicKey.toBase58()}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Meteora positions API error: ${response.statusText}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      MeteoraPositionsListSchema,
      rawData,
      'Meteora positions',
    )

    return data.map((pos) => ({
      pool: new PublicKey(pos.pair_address),
      lpMint: new PublicKey(pos.address),
      lpBalance: BigInt(
        pos.position_bin_data.reduce(
          (sum, bin) => sum + BigInt(bin.position_liquidity),
          0n,
        ),
      ),
      tokenAValue: BigInt(pos.total_x_amount),
      tokenBValue: BigInt(pos.total_y_amount),
      unclaimedFees: {
        tokenA: BigInt(pos.fee_x),
        tokenB: BigInt(pos.fee_y),
      },
    }))
  }

  async getActiveBin(
    pool: PublicKey,
  ): Promise<{ binId: number; price: number }> {
    const poolInfo = await this.getPoolInfoDetailed(pool)
    return {
      binId: poolInfo.activeBinId,
      price: poolInfo.currentPrice,
    }
  }

  async getPoolInfoDetailed(pool: PublicKey): Promise<{
    address: PublicKey
    activeBinId: number
    binStep: number
    currentPrice: number
    liquidity: bigint
  }> {
    const url = `${METEORA_API_BASE}/pair/${pool.toBase58()}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`)
    }

    const rawData = await response.json()
    const data = expectValid(
      MeteoraPoolInfoSchema,
      rawData,
      'Meteora pool info',
    )

    return {
      address: pool,
      activeBinId: Math.floor(
        Math.log(data.current_price) / Math.log(1 + data.bin_step / 10000),
      ),
      binStep: data.bin_step,
      currentPrice: data.current_price,
      liquidity: BigInt(Math.floor(parseFloat(data.liquidity))),
    }
  }

  async createDLMMPosition(
    params: ConcentratedLiquidityParams,
  ): Promise<SwapTransaction> {
    await this.getPoolInfoDetailed(params.pool)
    return buildPlaceholderTransaction(this.connection, params.userPublicKey)
  }
}

export function createMeteoraAdapter(connection: Connection): MeteoraAdapter {
  return new MeteoraAdapter(connection)
}
