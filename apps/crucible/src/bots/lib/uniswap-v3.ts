/**
 * Uniswap V3 Support - Concentrated Liquidity
 *
 * Implements:
 * - Tick-based price calculations
 * - Liquidity math for concentrated positions
 * - Swap output calculations across ticks
 * - Pool state management
 */

// Constants
const Q96 = 2n ** 96n
const _Q128 = 2n ** 128n
const MAX_TICK = 887272
const MIN_TICK = -887272

// Fee tiers (in hundredths of a bip)
export const FEE_TIERS = {
  LOWEST: 100, // 0.01%
  LOW: 500, // 0.05%
  MEDIUM: 3000, // 0.30%
  HIGH: 10000, // 1.00%
} as const

export type FeeTier = (typeof FEE_TIERS)[keyof typeof FEE_TIERS]

// Tick spacing by fee tier
const TICK_SPACINGS: Record<FeeTier, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
}

export interface V3PoolState {
  address: string
  token0: string
  token1: string
  fee: FeeTier
  tickSpacing: number
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  feeGrowthGlobal0X128: bigint
  feeGrowthGlobal1X128: bigint
}

export interface TickData {
  tick: number
  liquidityNet: bigint
  liquidityGross: bigint
  initialized: boolean
}

/**
 * Convert tick to sqrtPriceX96
 *
 * sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} out of range`)
  }

  const absTick = Math.abs(tick)

  // Use precomputed values for efficiency
  // These are sqrt(1.0001^(2^i)) * 2^96 for i = 0..19
  let ratio = absTick & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : Q96
  if (absTick & 0x2)
    ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 96n
  if (absTick & 0x4)
    ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 96n
  if (absTick & 0x8)
    ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 96n
  if (absTick & 0x10)
    ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 96n
  if (absTick & 0x20)
    ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 96n
  if (absTick & 0x40)
    ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 96n
  if (absTick & 0x80)
    ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 96n
  if (absTick & 0x100)
    ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 96n
  if (absTick & 0x200)
    ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 96n
  if (absTick & 0x400)
    ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 96n
  if (absTick & 0x800)
    ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 96n
  if (absTick & 0x1000)
    ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 96n
  if (absTick & 0x2000)
    ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 96n
  if (absTick & 0x4000)
    ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 96n
  if (absTick & 0x8000)
    ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 96n
  if (absTick & 0x10000)
    ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 96n
  if (absTick & 0x20000)
    ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 96n
  if (absTick & 0x40000)
    ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 96n
  if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 96n

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio

  // Round up in division
  return ratio >> 32n
}

/**
 * Convert sqrtPriceX96 to tick
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  // Compute log_sqrt(1.0001)(sqrtPriceX96 / 2^96)
  // = 2 * log_1.0001(sqrtPriceX96 / 2^96)

  const _sqrtRatioX128 = sqrtPriceX96 << 32n

  // Binary search approximation
  let tick = 0
  let lo = MIN_TICK
  let hi = MAX_TICK

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const midSqrtPrice = tickToSqrtPriceX96(mid)

    if (midSqrtPrice <= sqrtPriceX96) {
      tick = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return tick
}

/**
 * Get price from sqrtPriceX96
 *
 * price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
 * Returns price with 18 decimals
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): bigint {
  const price =
    (sqrtPriceX96 * sqrtPriceX96 * BigInt(10 ** decimals0)) / (Q96 * Q96)
  return price / BigInt(10 ** (decimals1 - 18)) // Normalize to 18 decimals
}

/**
 * Calculate amount0 delta for a liquidity change
 *
 * Δtoken0 = L * (1/√P_lower - 1/√P_upper)
 */
export function getAmount0Delta(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
  }

  const numerator = liquidity * (sqrtPriceBX96 - sqrtPriceAX96)
  const denominator = sqrtPriceBX96 * sqrtPriceAX96

  if (roundUp) {
    return (numerator * Q96 + denominator - 1n) / denominator
  }
  return (numerator * Q96) / denominator
}

/**
 * Calculate amount1 delta for a liquidity change
 *
 * Δtoken1 = L * (√P_upper - √P_lower)
 */
export function getAmount1Delta(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
  }

  const diff = sqrtPriceBX96 - sqrtPriceAX96

  if (roundUp) {
    return (liquidity * diff + Q96 - 1n) / Q96
  }
  return (liquidity * diff) / Q96
}

/**
 * Calculate the next sqrt price after a swap
 */
export function getNextSqrtPriceFromInput(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  if (zeroForOne) {
    // amount0 in, amount1 out
    // sqrtPrice_new = liquidity * sqrtPrice / (liquidity + amount0 * sqrtPrice)
    const product = amountIn * sqrtPriceX96
    const denominator = liquidity * Q96 + product
    return (liquidity * sqrtPriceX96 * Q96) / denominator
  } else {
    // amount1 in, amount0 out
    // sqrtPrice_new = sqrtPrice + amount1 / liquidity
    return sqrtPriceX96 + (amountIn * Q96) / liquidity
  }
}

/**
 * Calculate swap output for a V3 pool
 *
 * This is a simplified version - real implementation needs tick traversal
 */
export function calculateV3SwapOutput(
  pool: V3PoolState,
  amountIn: bigint,
  zeroForOne: boolean,
  _ticks?: TickData[],
): {
  amountOut: bigint
  sqrtPriceX96After: bigint
  tickAfter: number
  feeAmount: bigint
} {
  const feeAmount = (amountIn * BigInt(pool.fee)) / 1000000n
  const amountInLessFee = amountIn - feeAmount

  // Simple case: within single tick range
  // For production, implement full tick traversal
  const sqrtPriceX96After = getNextSqrtPriceFromInput(
    pool.sqrtPriceX96,
    pool.liquidity,
    amountInLessFee,
    zeroForOne,
  )

  const tickAfter = sqrtPriceX96ToTick(sqrtPriceX96After)

  // Calculate output amount
  let amountOut: bigint
  if (zeroForOne) {
    amountOut = getAmount1Delta(
      sqrtPriceX96After,
      pool.sqrtPriceX96,
      pool.liquidity,
      false,
    )
  } else {
    amountOut = getAmount0Delta(
      pool.sqrtPriceX96,
      sqrtPriceX96After,
      pool.liquidity,
      false,
    )
  }

  return {
    amountOut,
    sqrtPriceX96After,
    tickAfter,
    feeAmount,
  }
}

/**
 * Calculate optimal arbitrage between V2 and V3 pools
 */
export function calculateV2V3Arbitrage(
  // V2 pool
  v2Reserve0: bigint,
  v2Reserve1: bigint,
  v2Fee: bigint, // 997 for 0.3%
  // V3 pool
  v3SqrtPriceX96: bigint,
  v3Liquidity: bigint,
  v3Fee: FeeTier,
  // Direction: true = buy token1 from V2, sell to V3
  buyFromV2: boolean,
): {
  optimalInput: bigint
  expectedProfit: bigint
} {
  // Get V2 price
  const v2Price = (v2Reserve1 * BigInt(1e18)) / v2Reserve0

  // Get V3 price
  const v3Price = (v3SqrtPriceX96 * v3SqrtPriceX96 * BigInt(1e18)) / (Q96 * Q96)

  // Check if arbitrage exists
  if (buyFromV2) {
    // V2 cheaper than V3
    if (v2Price >= v3Price) {
      return { optimalInput: 0n, expectedProfit: 0n }
    }
  } else {
    // V3 cheaper than V2
    if (v3Price >= v2Price) {
      return { optimalInput: 0n, expectedProfit: 0n }
    }
  }

  // Binary search for optimal input
  // Start with 0.1% of V2 reserves
  let low = v2Reserve0 / 1000n
  let high = v2Reserve0 / 10n // Max 10% of reserves
  let bestInput = 0n
  let bestProfit = 0n

  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2n

    // Calculate profit at mid
    let profit: bigint
    if (buyFromV2) {
      // Buy token1 from V2, sell to V3
      const v2Out =
        (mid * v2Fee * v2Reserve1) / (v2Reserve0 * 1000n + mid * v2Fee)
      const v3Out = calculateV3SwapOutput(
        {
          address: '',
          token0: '',
          token1: '',
          fee: v3Fee,
          tickSpacing: TICK_SPACINGS[v3Fee],
          sqrtPriceX96: v3SqrtPriceX96,
          tick: sqrtPriceX96ToTick(v3SqrtPriceX96),
          liquidity: v3Liquidity,
          feeGrowthGlobal0X128: 0n,
          feeGrowthGlobal1X128: 0n,
        },
        v2Out,
        false, // token1 -> token0
      )
      profit = v3Out.amountOut - mid
    } else {
      // Buy from V3, sell to V2
      const v3Out = calculateV3SwapOutput(
        {
          address: '',
          token0: '',
          token1: '',
          fee: v3Fee,
          tickSpacing: TICK_SPACINGS[v3Fee],
          sqrtPriceX96: v3SqrtPriceX96,
          tick: sqrtPriceX96ToTick(v3SqrtPriceX96),
          liquidity: v3Liquidity,
          feeGrowthGlobal0X128: 0n,
          feeGrowthGlobal1X128: 0n,
        },
        mid,
        true, // token0 -> token1
      )
      const v2Out =
        (v3Out.amountOut * v2Fee * v2Reserve0) /
        (v2Reserve1 * 1000n + v3Out.amountOut * v2Fee)
      profit = v2Out - mid
    }

    if (profit > bestProfit) {
      bestProfit = profit
      bestInput = mid
    }

    // Adjust search bounds
    const midPlus = mid + mid / 100n
    let profitPlus: bigint
    if (buyFromV2) {
      const v2Out =
        (midPlus * v2Fee * v2Reserve1) / (v2Reserve0 * 1000n + midPlus * v2Fee)
      const v3Out = calculateV3SwapOutput(
        {
          address: '',
          token0: '',
          token1: '',
          fee: v3Fee,
          tickSpacing: TICK_SPACINGS[v3Fee],
          sqrtPriceX96: v3SqrtPriceX96,
          tick: sqrtPriceX96ToTick(v3SqrtPriceX96),
          liquidity: v3Liquidity,
          feeGrowthGlobal0X128: 0n,
          feeGrowthGlobal1X128: 0n,
        },
        v2Out,
        false,
      )
      profitPlus = v3Out.amountOut - midPlus
    } else {
      const v3Out = calculateV3SwapOutput(
        {
          address: '',
          token0: '',
          token1: '',
          fee: v3Fee,
          tickSpacing: TICK_SPACINGS[v3Fee],
          sqrtPriceX96: v3SqrtPriceX96,
          tick: sqrtPriceX96ToTick(v3SqrtPriceX96),
          liquidity: v3Liquidity,
          feeGrowthGlobal0X128: 0n,
          feeGrowthGlobal1X128: 0n,
        },
        midPlus,
        true,
      )
      const v2Out =
        (v3Out.amountOut * v2Fee * v2Reserve0) /
        (v2Reserve1 * 1000n + v3Out.amountOut * v2Fee)
      profitPlus = v2Out - midPlus
    }

    if (profitPlus > profit) {
      low = mid
    } else {
      high = mid
    }
  }

  return {
    optimalInput: bestInput,
    expectedProfit: bestProfit > 0n ? bestProfit : 0n,
  }
}

// Uniswap V3 Pool ABI (minimal)
export const UNISWAP_V3_POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'liquidity',
    inputs: [],
    outputs: [{ type: 'uint128' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'fee',
    inputs: [],
    outputs: [{ type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tickSpacing',
    inputs: [],
    outputs: [{ type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ticks',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [
      { name: 'liquidityGross', type: 'uint128' },
      { name: 'liquidityNet', type: 'int128' },
      { name: 'feeGrowthOutside0X128', type: 'uint256' },
      { name: 'feeGrowthOutside1X128', type: 'uint256' },
      { name: 'tickCumulativeOutside', type: 'int56' },
      { name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
      { name: 'secondsOutside', type: 'uint32' },
      { name: 'initialized', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

// Uniswap V3 Factory ABI
export const UNISWAP_V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const

// Uniswap V3 Router ABI (for swaps)
export const UNISWAP_V3_ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'exactInput',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const
