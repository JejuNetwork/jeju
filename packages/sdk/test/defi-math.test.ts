/**
 * DeFi Math Unit Tests
 *
 * Tests financial calculations used throughout the SDK:
 * - Slippage calculations
 * - Price impact calculations
 * - AMM math (constant product)
 * - Fee calculations
 * - Decimal conversions
 */

import { describe, expect, test } from 'bun:test'

// ============================================================================
// Extracted Math Functions (Pure functions for testing)
// ============================================================================

/**
 * Calculate minimum amount out given slippage tolerance
 * Used in: src/defi/index.ts lines 303-305, 393-396
 *
 * @param amountOut - Expected output amount
 * @param slippageBps - Slippage tolerance in basis points (1 bp = 0.01%)
 * @returns Minimum acceptable output amount
 */
function calculateAmountOutMin(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error('Slippage must be between 0 and 10000 bps')
  }
  return (amountOut * BigInt(10000 - slippageBps)) / 10000n
}

/**
 * Calculate liquidity to remove given percentage
 * Used in: src/defi/index.ts line 429
 *
 * @param totalLiquidity - Total liquidity in position
 * @param percentage - Percentage to remove (0-100)
 * @returns Amount of liquidity to remove
 */
function calculateLiquidityToRemove(
  totalLiquidity: bigint,
  percentage: number,
): bigint {
  if (percentage < 0 || percentage > 100) {
    throw new Error('Percentage must be between 0 and 100')
  }
  return (totalLiquidity * BigInt(percentage)) / 100n
}

/**
 * Convert price between feeds with different decimals
 * Used in: src/oracle/index.ts lines 548-552
 *
 * @param amount - Amount to convert
 * @param fromPrice - Price from source feed
 * @param toPrice - Price from destination feed
 * @param fromDecimals - Decimals of source price
 * @param toDecimals - Decimals of destination price
 * @returns Converted amount
 */
function convertPrice(
  amount: bigint,
  fromPrice: bigint,
  toPrice: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  if (toPrice === 0n) {
    throw new Error('Cannot divide by zero price')
  }

  const decimalDiff = toDecimals - fromDecimals
  if (decimalDiff >= 0) {
    const decimalAdjustment = 10n ** BigInt(decimalDiff)
    return (amount * fromPrice * decimalAdjustment) / toPrice
  } else {
    const decimalAdjustment = 10n ** BigInt(-decimalDiff)
    return (amount * fromPrice) / (toPrice * decimalAdjustment)
  }
}

/**
 * Uniswap V2 constant product formula: getAmountOut
 * Given input amount, calculates output amount
 *
 * @param amountIn - Input token amount
 * @param reserveIn - Reserve of input token
 * @param reserveOut - Reserve of output token
 * @param feeBps - Fee in basis points (e.g., 30 for 0.3%)
 * @returns Output token amount
 */
function getAmountOutV2(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = 30,
): bigint {
  if (amountIn <= 0n) throw new Error('Insufficient input amount')
  if (reserveIn <= 0n || reserveOut <= 0n)
    throw new Error('Insufficient liquidity')

  const amountInWithFee = amountIn * BigInt(10000 - feeBps)
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * 10000n + amountInWithFee
  return numerator / denominator
}

/**
 * Uniswap V2 constant product formula: getAmountIn
 * Given output amount, calculates required input amount
 *
 * @param amountOut - Desired output token amount
 * @param reserveIn - Reserve of input token
 * @param reserveOut - Reserve of output token
 * @param feeBps - Fee in basis points (e.g., 30 for 0.3%)
 * @returns Required input token amount
 */
function getAmountInV2(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = 30,
): bigint {
  if (amountOut <= 0n) throw new Error('Insufficient output amount')
  if (reserveIn <= 0n || reserveOut <= 0n)
    throw new Error('Insufficient liquidity')
  if (amountOut >= reserveOut) throw new Error('Insufficient liquidity')

  const numerator = reserveIn * amountOut * 10000n
  const denominator = (reserveOut - amountOut) * BigInt(10000 - feeBps)
  return numerator / denominator + 1n
}

/**
 * Calculate price impact for a trade
 *
 * @param amountIn - Input amount
 * @param amountOut - Output amount
 * @param reserveIn - Reserve of input token
 * @param reserveOut - Reserve of output token
 * @returns Price impact as a decimal (e.g., 0.05 for 5%)
 */
function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): number {
  // Spot price before trade
  const spotPrice = Number(reserveOut) / Number(reserveIn)
  // Execution price
  const executionPrice = Number(amountOut) / Number(amountIn)
  // Price impact = (spotPrice - executionPrice) / spotPrice
  return (spotPrice - executionPrice) / spotPrice
}

/**
 * Calculate LP token amount for adding liquidity
 * First liquidity: sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
 * Subsequent: min((amount0 * totalSupply) / reserve0, (amount1 * totalSupply) / reserve1)
 *
 * @param amount0 - Amount of token0 to add
 * @param amount1 - Amount of token1 to add
 * @param reserve0 - Current reserve of token0
 * @param reserve1 - Current reserve of token1
 * @param totalSupply - Current total LP supply
 * @returns LP tokens to mint
 */
function calculateLPTokens(
  amount0: bigint,
  amount1: bigint,
  reserve0: bigint,
  reserve1: bigint,
  totalSupply: bigint,
): bigint {
  const MINIMUM_LIQUIDITY = 1000n

  if (totalSupply === 0n) {
    // First liquidity provider
    const product = amount0 * amount1
    // sqrt using Newton's method
    const liquidity = sqrt(product)
    if (liquidity <= MINIMUM_LIQUIDITY) {
      throw new Error('Initial liquidity too low')
    }
    return liquidity - MINIMUM_LIQUIDITY
  } else {
    // Subsequent liquidity
    const liquidity0 = (amount0 * totalSupply) / reserve0
    const liquidity1 = (amount1 * totalSupply) / reserve1
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1
  }
}

/**
 * Integer square root using Newton's method
 */
function sqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('Cannot sqrt negative number')
  if (n === 0n) return 0n
  if (n === 1n) return 1n

  let x = n
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + n / x) / 2n
  }
  return x
}

/**
 * Calculate fee amount from a transaction
 * @param amount - Transaction amount
 * @param feeBps - Fee in basis points
 * @returns Fee amount
 */
function calculateFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / 10000n
}

/**
 * Convert from decimals to base units
 */
function toBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals))
}

/**
 * Convert from base units to decimals
 */
function fromBaseUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals
}

// ============================================================================
// Tests
// ============================================================================

describe('DeFi Math', () => {
  describe('calculateAmountOutMin (Slippage)', () => {
    test('0% slippage returns full amount', () => {
      const amountOut = 1000000000000000000n // 1 ETH
      const result = calculateAmountOutMin(amountOut, 0)
      expect(result).toBe(amountOut)
    })

    test('50 bps (0.5%) slippage', () => {
      const amountOut = 1000000000000000000n // 1 ETH
      const result = calculateAmountOutMin(amountOut, 50)
      // 1 ETH * (10000 - 50) / 10000 = 0.995 ETH
      expect(result).toBe(995000000000000000n)
    })

    test('100 bps (1%) slippage', () => {
      const amountOut = 1000000000000000000n
      const result = calculateAmountOutMin(amountOut, 100)
      expect(result).toBe(990000000000000000n)
    })

    test('500 bps (5%) slippage', () => {
      const amountOut = 1000000000000000000n
      const result = calculateAmountOutMin(amountOut, 500)
      expect(result).toBe(950000000000000000n)
    })

    test('100% slippage returns 0', () => {
      const amountOut = 1000000000000000000n
      const result = calculateAmountOutMin(amountOut, 10000)
      expect(result).toBe(0n)
    })

    test('handles small amounts without precision loss', () => {
      const amountOut = 100n // Very small
      const result = calculateAmountOutMin(amountOut, 100)
      // 100 * 9900 / 10000 = 99
      expect(result).toBe(99n)
    })

    test('handles very large amounts', () => {
      const amountOut = 10n ** 30n // 10^30 wei
      const result = calculateAmountOutMin(amountOut, 50)
      expect(result).toBe((amountOut * 9950n) / 10000n)
    })

    test('throws on negative slippage', () => {
      expect(() => calculateAmountOutMin(1000n, -1)).toThrow()
    })

    test('throws on slippage > 100%', () => {
      expect(() => calculateAmountOutMin(1000n, 10001)).toThrow()
    })

    test('property: result <= original amount', () => {
      for (let i = 0; i < 100; i++) {
        const amount = BigInt(Math.floor(Math.random() * 1e18))
        const slippage = Math.floor(Math.random() * 10001)
        const result = calculateAmountOutMin(amount, slippage)
        expect(result <= amount).toBe(true)
      }
    })

    test('property: higher slippage = lower minimum', () => {
      const amount = 1000000000000000000n
      let prevResult = amount
      for (let slippage = 0; slippage <= 10000; slippage += 100) {
        const result = calculateAmountOutMin(amount, slippage)
        expect(result <= prevResult).toBe(true)
        prevResult = result
      }
    })
  })

  describe('calculateLiquidityToRemove', () => {
    test('0% removes nothing', () => {
      const result = calculateLiquidityToRemove(1000000n, 0)
      expect(result).toBe(0n)
    })

    test('50% removes half', () => {
      const result = calculateLiquidityToRemove(1000000n, 50)
      expect(result).toBe(500000n)
    })

    test('100% removes all', () => {
      const result = calculateLiquidityToRemove(1000000n, 100)
      expect(result).toBe(1000000n)
    })

    test('handles odd numbers', () => {
      const result = calculateLiquidityToRemove(1000001n, 50)
      // 1000001 * 50 / 100 = 500000 (integer division)
      expect(result).toBe(500000n)
    })

    test('throws on negative percentage', () => {
      expect(() => calculateLiquidityToRemove(1000n, -1)).toThrow()
    })

    test('throws on percentage > 100', () => {
      expect(() => calculateLiquidityToRemove(1000n, 101)).toThrow()
    })
  })

  describe('convertPrice (Oracle)', () => {
    test('same decimals, same price = same amount', () => {
      const amount = 1000000000000000000n // 1 ETH
      const price = 200000000000n // $2000 (8 decimals)
      const result = convertPrice(amount, price, price, 8, 8)
      expect(result).toBe(amount)
    })

    test('ETH to USD conversion', () => {
      // 1 ETH at $2000 = 2000 USD
      const amount = 1000000000000000000n // 1 ETH (18 decimals)
      const ethPrice = 200000000000n // $2000 (8 decimals)
      const usdPrice = 100000000n // $1 (8 decimals)
      const result = convertPrice(amount, ethPrice, usdPrice, 8, 8)
      // Should be 2000 * 10^18 = 2000 USD in 18 decimal format
      expect(result).toBe(2000000000000000000000n)
    })

    test('handles different decimal precision', () => {
      const amount = 1000000n // 1 USDC (6 decimals)
      const price1 = 100000000n // $1 (8 decimals)
      const price2 = 200000000n // $2 (8 decimals)
      const result = convertPrice(amount, price1, price2, 8, 8)
      // 1 USDC at $1 = 0.5 of token at $2
      expect(result).toBe(500000n)
    })

    test('throws on zero price', () => {
      expect(() => convertPrice(1000n, 100n, 0n, 8, 8)).toThrow()
    })

    test('handles 6 to 18 decimal conversion', () => {
      const amount = 1000000n // 1 USDC
      const price = 100000000n // $1
      // Converting to same price but 18 decimals vs 6
      const result = convertPrice(amount, price, price, 6, 18)
      // Result should be scaled up by 10^12
      expect(result).toBe(1000000000000000000n)
    })

    test('handles 18 to 6 decimal conversion', () => {
      const amount = 1000000000000000000n // 1 token (18 decimals)
      const price = 100000000n // $1
      const result = convertPrice(amount, price, price, 18, 6)
      // Result should be scaled down by 10^12
      expect(result).toBe(1000000n)
    })
  })

  describe('getAmountOutV2 (AMM)', () => {
    const ETH = 10n ** 18n

    test('basic swap calculation', () => {
      const reserveIn = 1000n * ETH // 1000 ETH
      const reserveOut = 2000000n * 10n ** 6n // 2M USDC
      const amountIn = 1n * ETH // 1 ETH

      const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)

      // Without fee: 1 ETH should get ~2000 USDC
      // With 0.3% fee: slightly less
      expect(amountOut > 1990n * 10n ** 6n).toBe(true)
      expect(amountOut < 2000n * 10n ** 6n).toBe(true)
    })

    test('larger swap has more price impact', () => {
      const reserveIn = 1000n * ETH
      const reserveOut = 2000000n * 10n ** 6n

      const smallSwap = getAmountOutV2(1n * ETH, reserveIn, reserveOut)
      const largeSwap = getAmountOutV2(100n * ETH, reserveIn, reserveOut)

      // Price per unit should be worse for larger swap
      const pricePerUnitSmall = (smallSwap * ETH) / (1n * ETH)
      const pricePerUnitLarge = (largeSwap * ETH) / (100n * ETH)

      expect(pricePerUnitLarge < pricePerUnitSmall).toBe(true)
    })

    test('throws on zero input', () => {
      expect(() => getAmountOutV2(0n, 1000n, 2000n)).toThrow()
    })

    test('throws on zero reserves', () => {
      expect(() => getAmountOutV2(100n, 0n, 2000n)).toThrow()
      expect(() => getAmountOutV2(100n, 1000n, 0n)).toThrow()
    })

    test('higher fee = less output', () => {
      const reserveIn = 1000n * ETH
      const reserveOut = 2000000n * 10n ** 6n
      const amountIn = 10n * ETH

      const lowFee = getAmountOutV2(amountIn, reserveIn, reserveOut, 30)
      const highFee = getAmountOutV2(amountIn, reserveIn, reserveOut, 100)

      expect(lowFee > highFee).toBe(true)
    })

    test('constant product: k increases after swap (fee accumulation)', () => {
      const reserveIn = 1000n * ETH
      const reserveOut = 2000000n * 10n ** 6n
      const amountIn = 10n * ETH

      const kBefore = reserveIn * reserveOut
      const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)
      const newReserveIn = reserveIn + amountIn
      const newReserveOut = reserveOut - amountOut
      const kAfter = newReserveIn * newReserveOut

      // k should increase due to fees
      expect(kAfter > kBefore).toBe(true)
    })
  })

  describe('getAmountInV2 (AMM)', () => {
    const ETH = 10n ** 18n

    test('basic calculation', () => {
      const reserveIn = 1000n * ETH
      const reserveOut = 2000000n * 10n ** 6n
      const amountOut = 1000n * 10n ** 6n // 1000 USDC

      const amountIn = getAmountInV2(amountOut, reserveIn, reserveOut)

      // Should need slightly more than 0.5 ETH due to fee
      expect(amountIn > (5n * ETH) / 10n).toBe(true)
    })

    test('getAmountIn and getAmountOut are approximate inverses', () => {
      const reserveIn = 1000n * ETH
      const reserveOut = 2000000n * 10n ** 6n
      const amountIn = 10n * ETH

      const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)
      const calculatedIn = getAmountInV2(amountOut, reserveIn, reserveOut)

      // Due to integer division and the +1n in getAmountIn for ceiling,
      // calculatedIn should be very close to amountIn
      const diff =
        calculatedIn > amountIn
          ? calculatedIn - amountIn
          : amountIn - calculatedIn

      // Difference should be less than 0.1% of the original amount
      const tolerance = amountIn / 1000n // 0.1%
      expect(diff <= tolerance).toBe(true)
    })

    test('throws when trying to get more than reserve', () => {
      expect(() => getAmountInV2(2001n, 1000n, 2000n)).toThrow()
    })
  })

  describe('calculatePriceImpact', () => {
    test('small trade has minimal impact', () => {
      const reserveIn = 1000000n
      const reserveOut = 2000000n
      const amountIn = 1000n
      const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)

      const impact = calculatePriceImpact(
        amountIn,
        amountOut,
        reserveIn,
        reserveOut,
      )

      // Small trade should have < 1% impact
      expect(Math.abs(impact)).toBeLessThan(0.01)
    })

    test('large trade has significant impact', () => {
      const reserveIn = 1000000n
      const reserveOut = 2000000n
      const amountIn = 100000n // 10% of reserve
      const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)

      const impact = calculatePriceImpact(
        amountIn,
        amountOut,
        reserveIn,
        reserveOut,
      )

      // Large trade should have > 5% impact
      expect(impact).toBeGreaterThan(0.05)
    })

    test('price impact is always positive for buys', () => {
      for (let i = 1; i <= 100; i++) {
        const reserveIn = 1000000n
        const reserveOut = 2000000n
        const amountIn = BigInt(i * 1000)
        const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)

        const impact = calculatePriceImpact(
          amountIn,
          amountOut,
          reserveIn,
          reserveOut,
        )

        expect(impact).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('calculateFee', () => {
    test('0.3% fee calculation', () => {
      const amount = 1000000000000000000n // 1 ETH
      const fee = calculateFee(amount, 30)
      expect(fee).toBe(3000000000000000n) // 0.003 ETH
    })

    test('1% fee calculation', () => {
      const amount = 1000000n
      const fee = calculateFee(amount, 100)
      expect(fee).toBe(10000n)
    })

    test('0% fee returns 0', () => {
      const fee = calculateFee(1000000n, 0)
      expect(fee).toBe(0n)
    })

    test('100% fee returns full amount', () => {
      const amount = 1000000n
      const fee = calculateFee(amount, 10000)
      expect(fee).toBe(amount)
    })
  })

  describe('sqrt (Integer Square Root)', () => {
    test('perfect squares', () => {
      expect(sqrt(0n)).toBe(0n)
      expect(sqrt(1n)).toBe(1n)
      expect(sqrt(4n)).toBe(2n)
      expect(sqrt(9n)).toBe(3n)
      expect(sqrt(16n)).toBe(4n)
      expect(sqrt(100n)).toBe(10n)
      expect(sqrt(10000n)).toBe(100n)
    })

    test('non-perfect squares floor to integer', () => {
      expect(sqrt(2n)).toBe(1n)
      expect(sqrt(3n)).toBe(1n)
      expect(sqrt(5n)).toBe(2n)
      expect(sqrt(8n)).toBe(2n)
      expect(sqrt(10n)).toBe(3n)
    })

    test('large numbers', () => {
      const n = 10n ** 36n
      expect(sqrt(n)).toBe(10n ** 18n)
    })

    test('throws on negative', () => {
      expect(() => sqrt(-1n)).toThrow()
    })

    test('property: sqrt(n)^2 <= n < (sqrt(n)+1)^2', () => {
      for (let i = 0; i < 100; i++) {
        const n = BigInt(Math.floor(Math.random() * 1e12))
        const s = sqrt(n)
        expect(s * s <= n).toBe(true)
        expect((s + 1n) * (s + 1n) > n).toBe(true)
      }
    })
  })

  describe('calculateLPTokens', () => {
    test('first liquidity provider', () => {
      const amount0 = 1000000n
      const amount1 = 2000000n

      const lp = calculateLPTokens(amount0, amount1, 0n, 0n, 0n)

      // sqrt(1000000 * 2000000) - 1000 = sqrt(2*10^12) - 1000 = ~1414213 - 1000
      expect(lp).toBe(sqrt(amount0 * amount1) - 1000n)
    })

    test('subsequent liquidity proportional', () => {
      const reserve0 = 1000000n
      const reserve1 = 2000000n
      const totalSupply = 1000000n
      const amount0 = 100000n
      const amount1 = 200000n

      const lp = calculateLPTokens(
        amount0,
        amount1,
        reserve0,
        reserve1,
        totalSupply,
      )

      // Should get 10% of existing supply
      expect(lp).toBe(100000n)
    })

    test('uses minimum of ratios', () => {
      const reserve0 = 1000000n
      const reserve1 = 2000000n
      const totalSupply = 1000000n

      // Add disproportionate amounts
      const amount0 = 100000n
      const amount1 = 500000n // Too much token1

      const lp = calculateLPTokens(
        amount0,
        amount1,
        reserve0,
        reserve1,
        totalSupply,
      )

      // Should use token0 ratio (10%)
      expect(lp).toBe(100000n)
    })

    test('throws if initial liquidity too low', () => {
      expect(() => calculateLPTokens(10n, 10n, 0n, 0n, 0n)).toThrow()
    })
  })

  describe('Decimal Conversions', () => {
    test('toBaseUnits with 18 decimals', () => {
      expect(toBaseUnits(1, 18)).toBe(1000000000000000000n)
      expect(toBaseUnits(0.5, 18)).toBe(500000000000000000n)
      expect(toBaseUnits(1.5, 18)).toBe(1500000000000000000n)
    })

    test('toBaseUnits with 6 decimals', () => {
      expect(toBaseUnits(1, 6)).toBe(1000000n)
      expect(toBaseUnits(100, 6)).toBe(100000000n)
    })

    test('fromBaseUnits with 18 decimals', () => {
      expect(fromBaseUnits(1000000000000000000n, 18)).toBe(1)
      expect(fromBaseUnits(500000000000000000n, 18)).toBe(0.5)
    })

    test('fromBaseUnits with 6 decimals', () => {
      expect(fromBaseUnits(1000000n, 6)).toBe(1)
      expect(fromBaseUnits(1500000n, 6)).toBe(1.5)
    })

    test('round-trip conversion', () => {
      const original = 123.456
      const base = toBaseUnits(original, 18)
      const back = fromBaseUnits(base, 18)
      expect(Math.abs(back - original)).toBeLessThan(0.0000000001)
    })
  })

  describe('Edge Cases & Fuzzing', () => {
    test('fuzzing: slippage calculations are monotonic', () => {
      const amount = 10n ** 18n
      for (let i = 0; i < 100; i++) {
        const slippage1 = Math.floor(Math.random() * 5000)
        const slippage2 = slippage1 + Math.floor(Math.random() * 5000)

        const result1 = calculateAmountOutMin(amount, slippage1)
        const result2 = calculateAmountOutMin(amount, slippage2)

        expect(result1 >= result2).toBe(true)
      }
    })

    test('fuzzing: AMM preserves constant product invariant', () => {
      for (let i = 0; i < 50; i++) {
        const reserveIn = BigInt(Math.floor(Math.random() * 1e15) + 1e12)
        const reserveOut = BigInt(Math.floor(Math.random() * 1e15) + 1e12)
        const amountIn = BigInt(
          Math.floor(Math.random() * Number(reserveIn) * 0.1),
        )

        if (amountIn === 0n) continue

        const amountOut = getAmountOutV2(amountIn, reserveIn, reserveOut)
        const kBefore = reserveIn * reserveOut
        const kAfter = (reserveIn + amountIn) * (reserveOut - amountOut)

        // k should always increase (fee accumulation)
        expect(kAfter >= kBefore).toBe(true)
      }
    })

    test('fuzzing: sqrt is always correct', () => {
      for (let i = 0; i < 100; i++) {
        const n = BigInt(Math.floor(Math.random() * 1e18))
        const s = sqrt(n)

        // Verify: s^2 <= n < (s+1)^2
        expect(s * s <= n).toBe(true)
        expect((s + 1n) * (s + 1n) > n).toBe(true)
      }
    })
  })
})
