/**
 * DEX event processor
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import {
  CandleInterval,
  DEX,
  DEXPool,
  PoolDailyCandle,
  PoolHourlyCandle,
  Swap,
  Token,
  TokenCandle,
} from './model'
import type { ProcessorContext } from './processor'
import {
  type BlockHeader,
  createAccountFactory,
  type LogData,
} from './utils/entities'
import { decodeLogData, isEventInSet } from './utils/hex'

const PAIR_CREATED_V2: Hex =
  '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9'
const SWAP_V2: Hex =
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
const SYNC_V2: Hex =
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'
const MINT_V2: Hex =
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f'
const BURN_V2: Hex =
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496'
const POOL_CREATED_V3: Hex =
  '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'
const SWAP_V3: Hex =
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
const MINT_V3: Hex =
  '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde'
const BURN_V3: Hex =
  '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c'

const DEX_EVENT_SIGNATURES: Set<Hex> = new Set([
  PAIR_CREATED_V2,
  SWAP_V2,
  SYNC_V2,
  MINT_V2,
  BURN_V2,
  POOL_CREATED_V3,
  SWAP_V3,
  MINT_V3,
  BURN_V3,
])

const DEX_FACTORIES: Record<
  number,
  Record<string, { name: string; version: string }>
> = {
  1: {
    '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f': {
      name: 'Uniswap V2',
      version: 'v2',
    },
    '0x1f98431c8ad98523631ae4a59f267346ea31f984': {
      name: 'Uniswap V3',
      version: 'v3',
    },
    '0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac': {
      name: 'Sushiswap',
      version: 'v2',
    },
  },
  42161: {
    '0x1f98431c8ad98523631ae4a59f267346ea31f984': {
      name: 'Uniswap V3',
      version: 'v3',
    },
    '0x6eccab422d763ac031210895c81787e87b43a652': {
      name: 'Camelot',
      version: 'v2',
    },
  },
  8453: {
    '0x33128a8fc17869897dce68ed026d694621f6fdfd': {
      name: 'Uniswap V3',
      version: 'v3',
    },
    '0x420dd381b31aef6683db6b902084cb0ffece40da': {
      name: 'Aerodrome',
      version: 'v2',
    },
  },
  10: {
    '0x1f98431c8ad98523631ae4a59f267346ea31f984': {
      name: 'Uniswap V3',
      version: 'v3',
    },
    '0xf1046053aa5682b4f9a81b5481394da16be5ff5a': {
      name: 'Velodrome',
      version: 'v2',
    },
  },
}

const STABLECOINS: Record<number, Set<string>> = {
  1: new Set([
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0x6b175474e89094c44da98b954eedeac495271d0f',
  ]),
  42161: new Set([
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  ]),
  8453: new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']),
  10: new Set([
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
  ]),
}

const WETH: Record<number, string> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  8453: '0x4200000000000000000000000000000000000006',
  10: '0x4200000000000000000000000000000000000006',
}

function isStablecoin(chainId: number, address: string): boolean {
  return STABLECOINS[chainId]?.has(address.toLowerCase()) ?? false
}

function _isWETH(chainId: number, address: string): boolean {
  return WETH[chainId]?.toLowerCase() === address.toLowerCase()
}

function calculatePriceFromAmounts(
  amountIn: bigint,
  amountOut: bigint,
  decimalsIn: number,
  decimalsOut: number,
): string {
  if (amountIn === 0n) return '0'
  // Price = amountOut / amountIn, adjusted for decimals
  const adjustedIn = amountIn * BigInt(10 ** decimalsOut)
  const adjustedOut = amountOut * BigInt(10 ** decimalsIn)
  // Return as string with 18 decimal precision
  const price = (adjustedOut * BigInt(10 ** 18)) / adjustedIn
  return price.toString()
}

function getPeriodStart(timestamp: Date, interval: CandleInterval): Date {
  const ts = timestamp.getTime()
  let periodMs: number

  switch (interval) {
    case CandleInterval.MINUTE_1:
      periodMs = 60 * 1000
      break
    case CandleInterval.MINUTE_5:
      periodMs = 5 * 60 * 1000
      break
    case CandleInterval.MINUTE_15:
      periodMs = 15 * 60 * 1000
      break
    case CandleInterval.HOUR_1:
      periodMs = 60 * 60 * 1000
      break
    case CandleInterval.HOUR_4:
      periodMs = 4 * 60 * 60 * 1000
      break
    case CandleInterval.DAY_1:
      periodMs = 24 * 60 * 60 * 1000
      break
    case CandleInterval.WEEK_1:
      periodMs = 7 * 24 * 60 * 60 * 1000
      break
    default:
      periodMs = 60 * 60 * 1000
  }

  return new Date(Math.floor(ts / periodMs) * periodMs)
}

export function isDEXEvent(topic0: string): boolean {
  return isEventInSet(topic0, DEX_EVENT_SIGNATURES)
}

export async function processDEXEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const tokens = new Map<string, Token>()
  const pools = new Map<string, DEXPool>()
  const dexes = new Map<string, DEX>()
  const swaps = new Map<string, Swap>()
  const candles = new Map<string, TokenCandle>()
  const hourlyCandles = new Map<string, PoolHourlyCandle>()
  const dailyCandles = new Map<string, PoolDailyCandle>()

  const accountFactory = createAccountFactory()
  const chainId = parseInt(process.env.CHAIN_ID ?? '1', 10)

  for (const block of ctx.blocks) {
    const header = block.header
    const timestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const topic0 = log.topics[0]
      if (!topic0 || !isDEXEvent(topic0)) continue

      // Process based on event type
      if (topic0 === PAIR_CREATED_V2) {
        await processPairCreatedV2(
          ctx,
          log,
          header,
          timestamp,
          chainId,
          tokens,
          pools,
          dexes,
          accountFactory,
        )
      } else if (topic0 === POOL_CREATED_V3) {
        await processPoolCreatedV3(
          ctx,
          log,
          header,
          timestamp,
          chainId,
          tokens,
          pools,
          dexes,
          accountFactory,
        )
      } else if (topic0 === SWAP_V2) {
        await processSwapV2(
          ctx,
          log,
          header,
          timestamp,
          chainId,
          tokens,
          pools,
          swaps,
          candles,
          hourlyCandles,
          dailyCandles,
          accountFactory,
        )
      } else if (topic0 === SWAP_V3) {
        await processSwapV3(
          ctx,
          log,
          header,
          timestamp,
          chainId,
          tokens,
          pools,
          swaps,
          candles,
          hourlyCandles,
          dailyCandles,
          accountFactory,
        )
      } else if (topic0 === SYNC_V2) {
        await processSyncV2(ctx, log, chainId, pools)
      }
    }
  }

  // Batch save all entities
  await ctx.store.upsert(Array.from(dexes.values()))
  await ctx.store.upsert(Array.from(tokens.values()))
  await ctx.store.upsert(Array.from(pools.values()))
  await ctx.store.upsert(Array.from(swaps.values()))
  await ctx.store.upsert(Array.from(candles.values()))
  await ctx.store.upsert(Array.from(hourlyCandles.values()))
  await ctx.store.upsert(Array.from(dailyCandles.values()))

  if (swaps.size > 0) {
    ctx.log.info(`Processed ${swaps.size} DEX swaps, ${pools.size} pools`)
  }
}

async function processPairCreatedV2(
  ctx: ProcessorContext<Store>,
  log: LogData,
  _header: BlockHeader,
  timestamp: Date,
  chainId: number,
  tokens: Map<string, Token>,
  pools: Map<string, DEXPool>,
  dexes: Map<string, DEX>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): Promise<void> {
  // Decode: PairCreated(address token0, address token1, address pair, uint256 pairIndex)
  const decoded = decodeLogData(
    [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'pair', type: 'address' },
      { name: 'pairIndex', type: 'uint256' },
    ] as const,
    log.data,
  )

  const [token0Addr, token1Addr, pairAddr] = decoded
  const factoryAddr = log.address.toLowerCase()

  // Get or create DEX
  const dexInfo = DEX_FACTORIES[chainId]?.[factoryAddr]
  const dexId = `${chainId}-${dexInfo?.name ?? 'Unknown'}`

  let dex = dexes.get(dexId) || (await ctx.store.get(DEX, dexId))
  if (!dex) {
    dex = new DEX({
      id: dexId,
      name: dexInfo?.name ?? 'Unknown DEX',
      chainId,
      factory: factoryAddr,
      version: dexInfo?.version ?? 'v2',
      poolCount: 0,
      totalVolumeUSD: '0',
      totalLiquidityUSD: '0',
      totalTxCount: 0,
      createdAt: timestamp,
      lastUpdated: timestamp,
    })
  }
  dex.poolCount += 1
  dex.lastUpdated = timestamp
  dexes.set(dexId, dex)

  // Get or create tokens
  const token0 = await getOrCreateToken(
    ctx,
    tokens,
    chainId,
    token0Addr,
    timestamp,
    accountFactory,
  )
  const token1 = await getOrCreateToken(
    ctx,
    tokens,
    chainId,
    token1Addr,
    timestamp,
    accountFactory,
  )
  token0.poolCount += 1
  token1.poolCount += 1

  // Create pool
  const poolId = `${chainId}-${pairAddr.toLowerCase()}`
  const pool = new DEXPool({
    id: poolId,
    address: pairAddr.toLowerCase(),
    chainId,
    dex,
    token0,
    token1,
    fee: 30, // 0.3% default for V2
    reserve0: 0n,
    reserve1: 0n,
    totalLiquidity: 0n,
    liquidityUSD: '0',
    token0Price: '0',
    token1Price: '0',
    volumeToken0: 0n,
    volumeToken1: 0n,
    volumeUSD: '0',
    txCount: 0,
    feesUSD: '0',
    isActive: true,
    createdAt: timestamp,
    lastUpdated: timestamp,
  })

  pools.set(poolId, pool)
  ctx.log.info(
    `New pool: ${dex.name} ${token0.symbol}/${token1.symbol} at ${pairAddr}`,
  )
}

async function processPoolCreatedV3(
  ctx: ProcessorContext<Store>,
  log: LogData,
  _header: BlockHeader,
  timestamp: Date,
  chainId: number,
  tokens: Map<string, Token>,
  pools: Map<string, DEXPool>,
  dexes: Map<string, DEX>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): Promise<void> {
  // Decode: PoolCreated(address token0, address token1, uint24 fee, int24 tickSpacing, address pool)
  const decoded = decodeLogData(
    [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'pool', type: 'address' },
    ] as const,
    log.data,
  )

  const [token0Addr, token1Addr, fee, , poolAddr] = decoded
  const factoryAddr = log.address.toLowerCase()

  const dexInfo = DEX_FACTORIES[chainId]?.[factoryAddr]
  const dexId = `${chainId}-${dexInfo?.name ?? 'Uniswap V3'}`

  let dex = dexes.get(dexId) || (await ctx.store.get(DEX, dexId))
  if (!dex) {
    dex = new DEX({
      id: dexId,
      name: dexInfo?.name ?? 'Uniswap V3',
      chainId,
      factory: factoryAddr,
      version: 'v3',
      poolCount: 0,
      totalVolumeUSD: '0',
      totalLiquidityUSD: '0',
      totalTxCount: 0,
      createdAt: timestamp,
      lastUpdated: timestamp,
    })
  }
  dex.poolCount += 1
  dex.lastUpdated = timestamp
  dexes.set(dexId, dex)

  const token0 = await getOrCreateToken(
    ctx,
    tokens,
    chainId,
    token0Addr,
    timestamp,
    accountFactory,
  )
  const token1 = await getOrCreateToken(
    ctx,
    tokens,
    chainId,
    token1Addr,
    timestamp,
    accountFactory,
  )
  token0.poolCount += 1
  token1.poolCount += 1

  const poolId = `${chainId}-${poolAddr.toLowerCase()}`
  const pool = new DEXPool({
    id: poolId,
    address: poolAddr.toLowerCase(),
    chainId,
    dex,
    token0,
    token1,
    fee: Number(fee), // V3 fee in hundredths of bps (e.g., 3000 = 0.3%)
    reserve0: 0n,
    reserve1: 0n,
    totalLiquidity: 0n,
    liquidityUSD: '0',
    token0Price: '0',
    token1Price: '0',
    sqrtPriceX96: 0n,
    tick: 0,
    volumeToken0: 0n,
    volumeToken1: 0n,
    volumeUSD: '0',
    txCount: 0,
    feesUSD: '0',
    isActive: true,
    createdAt: timestamp,
    lastUpdated: timestamp,
  })

  pools.set(poolId, pool)
  ctx.log.info(
    `New V3 pool: ${dex.name} ${token0.symbol}/${token1.symbol} fee=${fee}`,
  )
}

async function processSwapV2(
  ctx: ProcessorContext<Store>,
  log: LogData,
  header: BlockHeader,
  timestamp: Date,
  chainId: number,
  tokens: Map<string, Token>,
  pools: Map<string, DEXPool>,
  swaps: Map<string, Swap>,
  candles: Map<string, TokenCandle>,
  hourlyCandles: Map<string, PoolHourlyCandle>,
  dailyCandles: Map<string, PoolDailyCandle>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): Promise<void> {
  // Decode: Swap(address sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address to)
  const decoded = decodeLogData(
    [
      { name: 'sender', type: 'address' },
      { name: 'amount0In', type: 'uint256' },
      { name: 'amount1In', type: 'uint256' },
      { name: 'amount0Out', type: 'uint256' },
      { name: 'amount1Out', type: 'uint256' },
      { name: 'to', type: 'address' },
    ] as const,
    log.data,
  )

  const [senderAddr, amount0In, amount1In, amount0Out, amount1Out, toAddr] =
    decoded
  const poolAddr = log.address.toLowerCase()
  const poolId = `${chainId}-${poolAddr}`

  // Get pool from cache or DB
  const pool = pools.get(poolId) || (await ctx.store.get(DEXPool, poolId))
  if (!pool) {
    // Pool not indexed yet - skip this swap
    return
  }

  const token0 =
    tokens.get(pool.token0.id) || (await ctx.store.get(Token, pool.token0.id))
  const token1 =
    tokens.get(pool.token1.id) || (await ctx.store.get(Token, pool.token1.id))
  if (!token0 || !token1) return

  // Determine swap direction and amounts
  const isToken0In = amount0In > 0n
  const amountIn = isToken0In ? amount0In : amount1In
  const amountOut = isToken0In ? amount1Out : amount0Out
  const tokenIn = isToken0In ? token0 : token1
  const tokenOut = isToken0In ? token1 : token0

  // Calculate price
  const price = calculatePriceFromAmounts(
    amountIn,
    amountOut,
    tokenIn.decimals,
    tokenOut.decimals,
  )

  // Calculate USD value if one token is stablecoin
  let amountInUSD = '0'
  let amountOutUSD = '0'
  if (isStablecoin(chainId, tokenIn.address)) {
    amountInUSD = (Number(amountIn) / 10 ** tokenIn.decimals).toString()
    amountOutUSD = amountInUSD // Approximate
  } else if (isStablecoin(chainId, tokenOut.address)) {
    amountOutUSD = (Number(amountOut) / 10 ** tokenOut.decimals).toString()
    amountInUSD = amountOutUSD
  }

  // Create swap entity
  const txHash = log.topics[0]?.slice(0, 66) || 'unknown' // Simplified - would need actual tx hash
  const swapId = `${txHash}-${log.logIndex}`
  const sender = accountFactory.getOrCreate(
    senderAddr,
    header.height,
    timestamp,
  )
  const recipient = accountFactory.getOrCreate(toAddr, header.height, timestamp)

  const swap = new Swap({
    id: swapId,
    pool,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    amountInUSD,
    amountOutUSD,
    priceIn: tokenIn.priceUSD,
    priceOut: tokenOut.priceUSD,
    sender,
    recipient,
    timestamp,
    blockNumber: header.height,
    logIndex: log.logIndex,
  })
  swaps.set(swapId, swap)

  // Update pool stats
  pool.volumeToken0 += isToken0In ? amount0In : amount0Out
  pool.volumeToken1 += isToken0In ? amount1Out : amount1In
  pool.txCount += 1
  pool.lastUpdated = timestamp

  // Update token0/token1 prices based on swap
  if (amount0In > 0n && amount1Out > 0n) {
    pool.token0Price = calculatePriceFromAmounts(
      amount0In,
      amount1Out,
      token0.decimals,
      token1.decimals,
    )
  } else if (amount1In > 0n && amount0Out > 0n) {
    pool.token1Price = calculatePriceFromAmounts(
      amount1In,
      amount0Out,
      token1.decimals,
      token0.decimals,
    )
  }
  pools.set(poolId, pool)

  // Update token prices and volume
  tokenIn.volume24h += amountIn
  tokenIn.txCount24h += 1
  tokenIn.lastSwapAt = timestamp
  tokenIn.lastUpdated = timestamp

  tokenOut.volume24h += amountOut
  tokenOut.txCount24h += 1
  tokenOut.lastSwapAt = timestamp
  tokenOut.lastUpdated = timestamp

  // Update USD prices based on stablecoin swaps
  if (isStablecoin(chainId, tokenIn.address)) {
    // tokenOut price = amountIn / amountOut
    const priceUSD =
      (Number(amountIn) / Number(amountOut)) *
      10 ** (tokenOut.decimals - tokenIn.decimals)
    tokenOut.priceUSD = priceUSD.toString()
  } else if (isStablecoin(chainId, tokenOut.address)) {
    // tokenIn price = amountOut / amountIn
    const priceUSD =
      (Number(amountOut) / Number(amountIn)) *
      10 ** (tokenIn.decimals - tokenOut.decimals)
    tokenIn.priceUSD = priceUSD.toString()
  }

  tokens.set(token0.id, token0)
  tokens.set(token1.id, token1)

  // Update candles
  await updateCandles(
    candles,
    hourlyCandles,
    dailyCandles,
    tokenIn,
    tokenOut,
    pool,
    price,
    amountIn,
    amountOut,
    amountInUSD,
    timestamp,
    chainId,
  )
}

async function processSwapV3(
  ctx: ProcessorContext<Store>,
  log: LogData,
  header: BlockHeader,
  timestamp: Date,
  chainId: number,
  tokens: Map<string, Token>,
  pools: Map<string, DEXPool>,
  swaps: Map<string, Swap>,
  _candles: Map<string, TokenCandle>,
  _hourlyCandles: Map<string, PoolHourlyCandle>,
  _dailyCandles: Map<string, PoolDailyCandle>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): Promise<void> {
  // Decode: Swap(address sender, address recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  const decoded = decodeLogData(
    [
      { name: 'sender', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount0', type: 'int256' },
      { name: 'amount1', type: 'int256' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'tick', type: 'int24' },
    ] as const,
    log.data,
  )

  const [
    senderAddr,
    recipientAddr,
    amount0,
    amount1,
    sqrtPriceX96,
    liquidity,
    tick,
  ] = decoded
  const poolAddr = log.address.toLowerCase()
  const poolId = `${chainId}-${poolAddr}`

  const pool = pools.get(poolId) || (await ctx.store.get(DEXPool, poolId))
  if (!pool) return

  const token0 =
    tokens.get(pool.token0.id) || (await ctx.store.get(Token, pool.token0.id))
  const token1 =
    tokens.get(pool.token1.id) || (await ctx.store.get(Token, pool.token1.id))
  if (!token0 || !token1) return

  // V3: positive amount means token goes out of pool, negative means in
  const isToken0In = amount0 < 0n
  const amountIn = isToken0In ? -amount0 : -amount1
  const amountOut = isToken0In ? amount1 : amount0
  const tokenIn = isToken0In ? token0 : token1
  const tokenOut = isToken0In ? token1 : token0

  calculatePriceFromAmounts(
    amountIn > 0n ? amountIn : -amountIn,
    amountOut > 0n ? amountOut : -amountOut,
    tokenIn.decimals,
    tokenOut.decimals,
  )

  // Create swap
  const txHash = log.topics[0]?.slice(0, 66) || 'unknown'
  const swapId = `${txHash}-${log.logIndex}`
  const sender = accountFactory.getOrCreate(
    senderAddr,
    header.height,
    timestamp,
  )
  const recipient = accountFactory.getOrCreate(
    recipientAddr,
    header.height,
    timestamp,
  )

  const swap = new Swap({
    id: swapId,
    pool,
    tokenIn,
    tokenOut,
    amountIn: amountIn > 0n ? amountIn : -amountIn,
    amountOut: amountOut > 0n ? amountOut : -amountOut,
    sender,
    recipient,
    timestamp,
    blockNumber: header.height,
    logIndex: log.logIndex,
  })
  swaps.set(swapId, swap)

  // Update pool V3 state
  pool.sqrtPriceX96 = sqrtPriceX96
  pool.tick = Number(tick)
  pool.totalLiquidity = liquidity
  pool.txCount += 1
  pool.lastUpdated = timestamp

  // Calculate token prices from sqrtPriceX96
  // price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)
  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96
  const rawPrice = sqrtPrice * sqrtPrice
  const adjustedPrice = rawPrice * 10 ** (token0.decimals - token1.decimals)
  pool.token0Price = adjustedPrice.toString()
  pool.token1Price = (1 / adjustedPrice).toString()

  pools.set(poolId, pool)

  // Update tokens
  tokenIn.volume24h += amountIn > 0n ? amountIn : -amountIn
  tokenIn.txCount24h += 1
  tokenIn.lastSwapAt = timestamp
  tokenIn.lastUpdated = timestamp

  tokenOut.volume24h += amountOut > 0n ? amountOut : -amountOut
  tokenOut.txCount24h += 1
  tokenOut.lastSwapAt = timestamp
  tokenOut.lastUpdated = timestamp

  tokens.set(token0.id, token0)
  tokens.set(token1.id, token1)
}

async function processSyncV2(
  ctx: ProcessorContext<Store>,
  log: LogData,
  chainId: number,
  pools: Map<string, DEXPool>,
): Promise<void> {
  // Decode: Sync(uint112 reserve0, uint112 reserve1)
  const decoded = decodeLogData(
    [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
    ],
    log.data,
  )

  const [reserve0, reserve1] = decoded
  const poolId = `${chainId}-${log.address.toLowerCase()}`

  const pool = pools.get(poolId) || (await ctx.store.get(DEXPool, poolId))
  if (!pool) return

  pool.reserve0 = reserve0
  pool.reserve1 = reserve1
  pool.totalLiquidity = reserve0 + reserve1 // Simplified - should use sqrt(reserve0 * reserve1)

  pools.set(poolId, pool)
}

async function getOrCreateToken(
  ctx: ProcessorContext<Store>,
  tokens: Map<string, Token>,
  chainId: number,
  address: string,
  timestamp: Date,
  _accountFactory: ReturnType<typeof createAccountFactory>,
): Promise<Token> {
  const tokenId = `${chainId}-${address.toLowerCase()}`

  let token = tokens.get(tokenId)
  if (token) return token

  token = await ctx.store.get(Token, tokenId)
  if (token) {
    tokens.set(tokenId, token)
    return token
  }

  // Create new token - decimals/name/symbol would need RPC call
  // For now, use placeholders (would be enriched by a separate token metadata job)
  token = new Token({
    id: tokenId,
    address: address.toLowerCase(),
    chainId,
    symbol: 'UNKNOWN',
    name: 'Unknown Token',
    decimals: 18,
    totalSupply: 0n,
    volume24h: 0n,
    volumeUSD24h: '0',
    txCount24h: 0,
    liquidity: 0n,
    liquidityUSD: '0',
    holderCount: 0,
    poolCount: 0,
    verified: false,
    createdAt: timestamp,
    lastUpdated: timestamp,
  })

  tokens.set(tokenId, token)
  return token
}

async function updateCandles(
  candles: Map<string, TokenCandle>,
  hourlyCandles: Map<string, PoolHourlyCandle>,
  dailyCandles: Map<string, PoolDailyCandle>,
  tokenIn: Token,
  _tokenOut: Token,
  pool: DEXPool,
  _price: string,
  amountIn: bigint,
  _amountOut: bigint,
  _amountUSD: string,
  timestamp: Date,
  chainId: number,
): Promise<void> {
  // Update token candles at multiple intervals
  const intervals = [
    CandleInterval.MINUTE_1,
    CandleInterval.MINUTE_5,
    CandleInterval.MINUTE_15,
    CandleInterval.HOUR_1,
    CandleInterval.HOUR_4,
    CandleInterval.DAY_1,
  ]

  for (const interval of intervals) {
    const periodStart = getPeriodStart(timestamp, interval)

    // Update tokenIn candle
    const candleInId = `${tokenIn.id}-${interval}-${periodStart.getTime()}`
    let candleIn = candles.get(candleInId)
    if (!candleIn) {
      candleIn = new TokenCandle({
        id: candleInId,
        token: tokenIn,
        chainId,
        interval,
        periodStart,
        open: tokenIn.priceUSD || '0',
        high: tokenIn.priceUSD || '0',
        low: tokenIn.priceUSD || '0',
        close: tokenIn.priceUSD || '0',
        volume: 0n,
        volumeUSD: '0',
        txCount: 0,
        buyCount: 0,
        sellCount: 0,
        priceChange: '0',
        priceChangeBps: 0,
        lastUpdated: timestamp,
      })
    }

    // Update candle OHLCV
    const currentPrice = tokenIn.priceUSD || '0'
    if (parseFloat(currentPrice) > parseFloat(candleIn.high)) {
      candleIn.high = currentPrice
    }
    if (
      parseFloat(currentPrice) < parseFloat(candleIn.low) ||
      candleIn.low === '0'
    ) {
      candleIn.low = currentPrice
    }
    candleIn.close = currentPrice
    candleIn.volume += amountIn
    candleIn.txCount += 1
    candleIn.sellCount += 1 // tokenIn is being sold
    candleIn.lastUpdated = timestamp

    // Calculate price change
    if (parseFloat(candleIn.open) > 0) {
      const change =
        (parseFloat(candleIn.close) - parseFloat(candleIn.open)) /
        parseFloat(candleIn.open)
      candleIn.priceChange = change.toString()
      candleIn.priceChangeBps = Math.round(change * 10000)
    }

    candles.set(candleInId, candleIn)
  }

  // Update hourly pool candle
  const hourStart = getPeriodStart(timestamp, CandleInterval.HOUR_1)
  const hourlyId = `${pool.id}-${hourStart.getTime()}`
  let hourly = hourlyCandles.get(hourlyId)
  if (!hourly) {
    hourly = new PoolHourlyCandle({
      id: hourlyId,
      pool,
      periodStart: hourStart,
      reserve0: pool.reserve0,
      reserve1: pool.reserve1,
      liquidityUSD: pool.liquidityUSD,
      volumeToken0: 0n,
      volumeToken1: 0n,
      volumeUSD: '0',
      txCount: 0,
      open: pool.token0Price,
      close: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
    })
  }
  hourly.reserve0 = pool.reserve0
  hourly.reserve1 = pool.reserve1
  hourly.volumeToken0 += amountIn
  hourly.txCount += 1
  hourly.close = pool.token0Price
  if (parseFloat(pool.token0Price) > parseFloat(hourly.high)) {
    hourly.high = pool.token0Price
  }
  if (
    parseFloat(pool.token0Price) < parseFloat(hourly.low) ||
    hourly.low === '0'
  ) {
    hourly.low = pool.token0Price
  }
  hourlyCandles.set(hourlyId, hourly)

  // Update daily pool candle
  const dayStart = getPeriodStart(timestamp, CandleInterval.DAY_1)
  const dailyId = `${pool.id}-${dayStart.getTime()}`
  let daily = dailyCandles.get(dailyId)
  if (!daily) {
    daily = new PoolDailyCandle({
      id: dailyId,
      pool,
      periodStart: dayStart,
      reserve0: pool.reserve0,
      reserve1: pool.reserve1,
      liquidityUSD: pool.liquidityUSD,
      volumeToken0: 0n,
      volumeToken1: 0n,
      volumeUSD: '0',
      txCount: 0,
      open: pool.token0Price,
      close: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      feesUSD: '0',
      uniqueTraders: 0,
    })
  }
  daily.reserve0 = pool.reserve0
  daily.reserve1 = pool.reserve1
  daily.volumeToken0 += amountIn
  daily.txCount += 1
  daily.close = pool.token0Price
  dailyCandles.set(dailyId, daily)
}
