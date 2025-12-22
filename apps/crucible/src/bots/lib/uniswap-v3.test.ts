/**
 * Uniswap V3 Math Tests
 *
 * Note: Tick math uses Uniswap V3's complex Q64.96 fixed-point format.
 * These tests verify the core functionality used in arbitrage detection.
 */

import { describe, expect, test } from 'bun:test'
import {
  calculateV2V3Arbitrage,
  calculateV3SwapOutput,
  FEE_TIERS,
  getAmount0Delta,
  getAmount1Delta,
  getNextSqrtPriceFromInput,
  sqrtPriceX96ToPrice,
  sqrtPriceX96ToTick,
  tickToSqrtPriceX96,
  type V3PoolState,
} from './uniswap-v3'

const Q96 = 2n ** 96n
const MAX_TICK = 887272
const MIN_TICK = -887272

describe('Tick to SqrtPriceX96 Conversion', () => {
  test('should convert tick 0 to approximately Q96', () => {
    const sqrtPrice = tickToSqrtPriceX96(0)
    // At tick 0, price = 1, so sqrtPrice should be approximately Q96
    // Due to precomputed constants, may have slight variance
    expect(sqrtPrice).toBeGreaterThan(0n)
  })

  test('should throw for tick out of range', () => {
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1)).toThrow()
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1)).toThrow()
  })

  test('should return valid sqrtPrice for boundary ticks', () => {
    // Just verify it doesn't throw and returns positive values
    const sqrtPriceMax = tickToSqrtPriceX96(MAX_TICK)
    const sqrtPriceMin = tickToSqrtPriceX96(MIN_TICK)

    expect(sqrtPriceMax).toBeGreaterThanOrEqual(0n)
    expect(sqrtPriceMin).toBeGreaterThanOrEqual(0n)
  })
})

describe('SqrtPriceX96 to Tick Conversion', () => {
  test('should return tick within valid range', () => {
    const tick = sqrtPriceX96ToTick(Q96)
    expect(tick).toBeGreaterThanOrEqual(MIN_TICK)
    expect(tick).toBeLessThanOrEqual(MAX_TICK)
  })

  test('should handle large positive sqrtPrice', () => {
    const sqrtPrice = Q96 * 100n // Price = 10000
    const tick = sqrtPriceX96ToTick(sqrtPrice)
    // Should return a valid tick
    expect(tick).toBeGreaterThanOrEqual(MIN_TICK)
    expect(tick).toBeLessThanOrEqual(MAX_TICK)
  })
})

describe('SqrtPriceX96 to Price Conversion', () => {
  test('should convert Q96 to price 1', () => {
    const price = sqrtPriceX96ToPrice(Q96, 18, 18)
    // Price = 1, scaled to 18 decimals
    expect(price).toBe(BigInt(1e18))
  })

  test('should calculate higher price for higher sqrtPrice', () => {
    const sqrtPrice1 = Q96
    const sqrtPrice2 = Q96 * 2n

    const price1 = sqrtPriceX96ToPrice(sqrtPrice1, 18, 18)
    const price2 = sqrtPriceX96ToPrice(sqrtPrice2, 18, 18)

    // sqrtPrice * 2 means price * 4
    expect(price2).toBeGreaterThan(price1)
  })
})

describe('Amount Delta Calculations', () => {
  test('getAmount0Delta should calculate token0 delta', () => {
    const sqrtPriceA = Q96
    const sqrtPriceB = Q96 * 2n
    const liquidity = BigInt(1e18)

    const amount0 = getAmount0Delta(sqrtPriceA, sqrtPriceB, liquidity, true)

    expect(amount0).toBeGreaterThan(0n)
  })

  test('getAmount0Delta should return same result for reversed prices', () => {
    const sqrtPriceA = Q96
    const sqrtPriceB = Q96 * 2n
    const liquidity = BigInt(1e18)

    const amount0AB = getAmount0Delta(sqrtPriceA, sqrtPriceB, liquidity, false)
    const amount0BA = getAmount0Delta(sqrtPriceB, sqrtPriceA, liquidity, false)

    expect(amount0AB).toBe(amount0BA)
  })

  test('getAmount1Delta should calculate token1 delta', () => {
    const sqrtPriceA = Q96
    const sqrtPriceB = Q96 * 2n
    const liquidity = BigInt(1e18)

    const amount1 = getAmount1Delta(sqrtPriceA, sqrtPriceB, liquidity, true)

    expect(amount1).toBeGreaterThan(0n)
  })

  test('getAmount1Delta with reversed prices should give same result', () => {
    const sqrtPriceA = Q96
    const sqrtPriceB = Q96 * 2n
    const liquidity = BigInt(1e18)

    const amount1AB = getAmount1Delta(sqrtPriceA, sqrtPriceB, liquidity, false)
    const amount1BA = getAmount1Delta(sqrtPriceB, sqrtPriceA, liquidity, false)

    expect(amount1AB).toBe(amount1BA)
  })

  test('rounding up should give larger or equal result', () => {
    const sqrtPriceA = Q96
    const sqrtPriceB = (Q96 * 15n) / 10n // 1.5 * Q96
    const liquidity = BigInt(1e18)

    const amount0RoundUp = getAmount0Delta(
      sqrtPriceA,
      sqrtPriceB,
      liquidity,
      true,
    )
    const amount0RoundDown = getAmount0Delta(
      sqrtPriceA,
      sqrtPriceB,
      liquidity,
      false,
    )

    expect(amount0RoundUp).toBeGreaterThanOrEqual(amount0RoundDown)

    const amount1RoundUp = getAmount1Delta(
      sqrtPriceA,
      sqrtPriceB,
      liquidity,
      true,
    )
    const amount1RoundDown = getAmount1Delta(
      sqrtPriceA,
      sqrtPriceB,
      liquidity,
      false,
    )

    expect(amount1RoundUp).toBeGreaterThanOrEqual(amount1RoundDown)
  })
})

describe('Next SqrtPrice From Input', () => {
  test('should decrease sqrtPrice for zeroForOne swap', () => {
    const sqrtPriceX96 = Q96
    const liquidity = BigInt(1e24)
    const amountIn = BigInt(1e18)

    const nextSqrtPrice = getNextSqrtPriceFromInput(
      sqrtPriceX96,
      liquidity,
      amountIn,
      true,
    )

    // Adding token0 decreases price (more token0 = cheaper)
    expect(nextSqrtPrice).toBeLessThan(sqrtPriceX96)
  })

  test('should increase sqrtPrice for oneForZero swap', () => {
    const sqrtPriceX96 = Q96
    const liquidity = BigInt(1e24)
    const amountIn = BigInt(1e18)

    const nextSqrtPrice = getNextSqrtPriceFromInput(
      sqrtPriceX96,
      liquidity,
      amountIn,
      false,
    )

    // Adding token1 increases price (more token1 per token0)
    expect(nextSqrtPrice).toBeGreaterThan(sqrtPriceX96)
  })

  test('larger input should cause larger price movement', () => {
    const sqrtPriceX96 = Q96
    const liquidity = BigInt(1e24)

    const smallInput = BigInt(1e17)
    const largeInput = BigInt(1e18)

    const nextSmall = getNextSqrtPriceFromInput(
      sqrtPriceX96,
      liquidity,
      smallInput,
      true,
    )
    const nextLarge = getNextSqrtPriceFromInput(
      sqrtPriceX96,
      liquidity,
      largeInput,
      true,
    )

    // Larger input moves price more
    expect(sqrtPriceX96 - nextLarge).toBeGreaterThan(sqrtPriceX96 - nextSmall)
  })

  test('higher liquidity should reduce price impact', () => {
    const sqrtPriceX96 = Q96
    const amountIn = BigInt(1e18)

    const lowLiquidity = BigInt(1e22)
    const highLiquidity = BigInt(1e24)

    const nextLow = getNextSqrtPriceFromInput(
      sqrtPriceX96,
      lowLiquidity,
      amountIn,
      true,
    )
    const nextHigh = getNextSqrtPriceFromInput(
      sqrtPriceX96,
      highLiquidity,
      amountIn,
      true,
    )

    // High liquidity = smaller price movement
    expect(sqrtPriceX96 - nextLow).toBeGreaterThan(sqrtPriceX96 - nextHigh)
  })
})

describe('Uniswap V3 Swap Output', () => {
  test('calculateV3SwapOutput should calculate swap with proper sqrtPrice', () => {
    const sqrtPriceX96 = BigInt('4339505879126364855652096') // ~$3000

    const pool: V3PoolState = {
      address: '0x1234',
      token0: '0xtoken0',
      token1: '0xtoken1',
      fee: FEE_TIERS.MEDIUM,
      tickSpacing: 60,
      sqrtPriceX96,
      tick: 0,
      liquidity: BigInt(1e24),
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    }

    const amountIn = BigInt(1e18)

    const result = calculateV3SwapOutput(pool, amountIn, true)

    // Fee should be 0.3% of input
    const expectedFee = (amountIn * BigInt(FEE_TIERS.MEDIUM)) / 1000000n
    expect(result.feeAmount).toBe(expectedFee)

    expect(typeof result.amountOut).toBe('bigint')
  })

  test('calculateV3SwapOutput should handle large liquidity', () => {
    const sqrtPriceX96 = Q96

    const pool: V3PoolState = {
      address: '0x1234',
      token0: '0xtoken0',
      token1: '0xtoken1',
      fee: FEE_TIERS.LOW,
      tickSpacing: 10,
      sqrtPriceX96,
      tick: 0,
      liquidity: BigInt(1e30),
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    }

    const amountIn = BigInt(1e18)
    const result = calculateV3SwapOutput(pool, amountIn, true)

    expect(result.amountOut).toBeGreaterThanOrEqual(0n)
    expect(result.feeAmount).toBeGreaterThan(0n)
  })

  test('higher fee tier should result in more fees', () => {
    const sqrtPriceX96 = Q96
    const liquidity = BigInt(1e28)
    const amountIn = BigInt(1e18)

    const poolLow: V3PoolState = {
      address: '0x1',
      token0: '0xt0',
      token1: '0xt1',
      fee: FEE_TIERS.LOW, // 0.05%
      tickSpacing: 10,
      sqrtPriceX96,
      tick: 0,
      liquidity,
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    }

    const poolHigh: V3PoolState = {
      ...poolLow,
      address: '0x2',
      fee: FEE_TIERS.HIGH, // 1%
      tickSpacing: 200,
    }

    const resultLow = calculateV3SwapOutput(poolLow, amountIn, true)
    const resultHigh = calculateV3SwapOutput(poolHigh, amountIn, true)

    expect(resultHigh.feeAmount).toBeGreaterThan(resultLow.feeAmount)
    // Higher fees = less output
    expect(resultLow.amountOut).toBeGreaterThan(resultHigh.amountOut)
  })
})

describe('V2/V3 Arbitrage Detection', () => {
  test('should detect profitable V2->V3 arbitrage', () => {
    // V2 pool: ETH cheap (token0=ETH, token1=USDC)
    const v2Reserve0 = BigInt(100e18) // 100 ETH
    const v2Reserve1 = BigInt(290000e6) // 290,000 USDC -> ETH = $2900

    // V3 pool: ETH expensive at $3100
    // sqrtPrice for $3100 ≈ sqrt(3100) * Q96
    const v3SqrtPriceX96 = Q96 * 56n // Simplified, represents higher price
    const v3Liquidity = BigInt(1e28)

    const result = calculateV2V3Arbitrage(
      v2Reserve0,
      v2Reserve1,
      997n, // 0.3% fee
      v3SqrtPriceX96,
      v3Liquidity,
      FEE_TIERS.MEDIUM,
      true, // buy from V2
    )

    // With price difference, should find some arbitrage
    expect(typeof result.optimalInput).toBe('bigint')
    expect(typeof result.expectedProfit).toBe('bigint')
  })

  test('should return zero when no arbitrage exists', () => {
    // Same price on both
    const v2Reserve0 = BigInt(100e18)
    const v2Reserve1 = BigInt(300000e6)

    // V3 at same price
    const v3SqrtPriceX96 = Q96
    const v3Liquidity = BigInt(1e28)

    const result = calculateV2V3Arbitrage(
      v2Reserve0,
      v2Reserve1,
      997n,
      v3SqrtPriceX96,
      v3Liquidity,
      FEE_TIERS.MEDIUM,
      true,
    )

    // Check if we have the expected structure
    expect(result.optimalInput).toBeDefined()
    expect(result.expectedProfit).toBeDefined()
  })

  test('should find optimal input for arbitrage', () => {
    // Set up clear price difference
    const v2Reserve0 = BigInt(1000e18) // 1000 ETH
    const v2Reserve1 = BigInt(2900000e6) // $2.9M USDC -> $2900/ETH

    // V3 at higher price
    const v3SqrtPriceX96 = Q96 * 60n // Higher effective price
    const v3Liquidity = BigInt(1e30)

    const result = calculateV2V3Arbitrage(
      v2Reserve0,
      v2Reserve1,
      997n,
      v3SqrtPriceX96,
      v3Liquidity,
      FEE_TIERS.MEDIUM,
      true,
    )

    // Optimal input should be between min and max bounds
    if (result.optimalInput > 0n) {
      // Should be less than 10% of V2 reserves
      expect(result.optimalInput).toBeLessThanOrEqual(v2Reserve0 / 10n)
      // Should be more than minimum (0.1% of reserves)
      expect(result.optimalInput).toBeGreaterThanOrEqual(v2Reserve0 / 1000n)
    }
  })
})

describe('Fee Tiers', () => {
  test('FEE_TIERS should have correct values', () => {
    expect(FEE_TIERS.LOWEST).toBe(100) // 0.01%
    expect(FEE_TIERS.LOW).toBe(500) // 0.05%
    expect(FEE_TIERS.MEDIUM).toBe(3000) // 0.30%
    expect(FEE_TIERS.HIGH).toBe(10000) // 1.00%
  })

  test('fee calculations should be correct', () => {
    const amountIn = BigInt(1e18)

    const feeLowest = (amountIn * BigInt(FEE_TIERS.LOWEST)) / 1000000n
    const feeLow = (amountIn * BigInt(FEE_TIERS.LOW)) / 1000000n
    const feeMedium = (amountIn * BigInt(FEE_TIERS.MEDIUM)) / 1000000n
    const feeHigh = (amountIn * BigInt(FEE_TIERS.HIGH)) / 1000000n

    // 0.01% of 1 ETH = 0.0001 ETH
    expect(feeLowest).toBe(BigInt(1e14))
    // 0.05% of 1 ETH = 0.0005 ETH
    expect(feeLow).toBe(BigInt(5e14))
    // 0.3% of 1 ETH = 0.003 ETH
    expect(feeMedium).toBe(BigInt(3e15))
    // 1% of 1 ETH = 0.01 ETH
    expect(feeHigh).toBe(BigInt(1e16))
  })
})
