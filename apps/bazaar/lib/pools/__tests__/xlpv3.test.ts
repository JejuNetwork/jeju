/**
 * Unit tests for XLP V3 utility functions
 * Tests priceToSqrtPriceX96 and related V3 math
 */

import { describe, expect, test } from 'bun:test'
import { priceToSqrtPriceX96, V3_FEE_TIERS } from '../useXLPV3'
import { sqrtPriceX96ToPrice } from '../utils'

const Q96 = 2n ** 96n

// =============================================================================
// PRICE TO SQRT PRICE CONVERSION TESTS
// =============================================================================

describe('priceToSqrtPriceX96', () => {
  test('should convert price 1.0 to Q96', () => {
    const sqrtPriceX96 = priceToSqrtPriceX96(1.0)

    // sqrt(1) * 2^96 = 2^96
    expect(sqrtPriceX96).toBe(Q96)
  })

  test('should convert price 4.0 to 2 * Q96', () => {
    const sqrtPriceX96 = priceToSqrtPriceX96(4.0)

    // sqrt(4) * 2^96 = 2 * 2^96
    expect(sqrtPriceX96).toBe(Q96 * 2n)
  })

  test('should convert price 0.25 to Q96 / 2', () => {
    const sqrtPriceX96 = priceToSqrtPriceX96(0.25)

    // sqrt(0.25) * 2^96 = 0.5 * 2^96 = 2^95
    expect(sqrtPriceX96).toBe(Q96 / 2n)
  })

  test('should handle ETH/USDC price (~3500)', () => {
    const ethUsdcPrice = 3500
    const sqrtPriceX96 = priceToSqrtPriceX96(ethUsdcPrice)

    // Convert back to verify
    const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

    expect(priceBack).toBeCloseTo(3500, -1) // Within 10
  })

  test('should handle very small prices (stablecoins)', () => {
    const price = 1.0001 // Slight premium
    const sqrtPriceX96 = priceToSqrtPriceX96(price)
    const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

    expect(priceBack).toBeCloseTo(1.0001, 4)
  })

  test('should handle very large prices', () => {
    const price = 100000 // $100k
    const sqrtPriceX96 = priceToSqrtPriceX96(price)
    const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

    expect(priceBack).toBeCloseTo(price, -2)
  })

  test('should maintain precision for common prices', () => {
    const testPrices = [0.5, 1.0, 2.0, 10.0, 100.0, 1000.0, 3500.0]

    for (const price of testPrices) {
      const sqrtPriceX96 = priceToSqrtPriceX96(price)
      const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

      // Should be within 0.1% of original
      const errorPct = Math.abs((priceBack - price) / price) * 100
      expect(errorPct).toBeLessThan(0.1)
    }
  })
})

// =============================================================================
// FEE TIER CONSTANTS TESTS
// =============================================================================

describe('V3_FEE_TIERS', () => {
  test('should have correct LOWEST fee tier (0.05%)', () => {
    expect(V3_FEE_TIERS.LOWEST).toBe(500)
  })

  test('should have correct LOW fee tier (0.3%)', () => {
    expect(V3_FEE_TIERS.LOW).toBe(3000)
  })

  test('should have correct HIGH fee tier (1%)', () => {
    expect(V3_FEE_TIERS.HIGH).toBe(10000)
  })

  test('fee tiers should be in ascending order', () => {
    expect(V3_FEE_TIERS.LOWEST).toBeLessThan(V3_FEE_TIERS.LOW)
    expect(V3_FEE_TIERS.LOW).toBeLessThan(V3_FEE_TIERS.HIGH)
  })
})

// =============================================================================
// ROUNDTRIP TESTS
// =============================================================================

describe('Price roundtrip conversion', () => {
  test('should roundtrip common trading prices', () => {
    const prices = [
      0.0001, // Low cap token
      0.01, // Small cap token
      1.0, // Stablecoin
      10.0, // Mid token
      100.0, // High value token
      1000.0, // Very high value
      3500.0, // ETH price
      50000.0, // BTC price
    ]

    for (const originalPrice of prices) {
      const sqrtPriceX96 = priceToSqrtPriceX96(originalPrice)
      const recoveredPrice = sqrtPriceX96ToPrice(sqrtPriceX96)

      // Allow 0.01% error for floating point
      const relativeError =
        Math.abs(recoveredPrice - originalPrice) / originalPrice
      expect(relativeError).toBeLessThan(0.0001)
    }
  })

  test('should maintain ordering after conversion', () => {
    const prices = [0.1, 1.0, 10.0, 100.0]
    const sqrtPrices = prices.map(priceToSqrtPriceX96)

    for (let i = 1; i < sqrtPrices.length; i++) {
      expect(sqrtPrices[i]).toBeGreaterThan(sqrtPrices[i - 1])
    }
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge cases', () => {
  test('should handle price very close to zero', () => {
    const price = 0.00000001
    const sqrtPriceX96 = priceToSqrtPriceX96(price)

    expect(sqrtPriceX96).toBeGreaterThan(0n)
  })

  test('should handle price of exactly 1', () => {
    const sqrtPriceX96 = priceToSqrtPriceX96(1.0)

    expect(sqrtPriceX96).toBe(Q96)
  })

  test('should handle powers of 10', () => {
    const powers = [-4, -3, -2, -1, 0, 1, 2, 3, 4]

    for (const power of powers) {
      const price = 10 ** power
      const sqrtPriceX96 = priceToSqrtPriceX96(price)
      const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

      expect(priceBack).toBeCloseTo(price, Math.max(0, -power))
    }
  })
})

// =============================================================================
// MATHEMATICAL PROPERTY TESTS
// =============================================================================

describe('Mathematical properties', () => {
  test('doubling price should double sqrtPriceX96 squared', () => {
    const price1 = 100
    const price2 = 200

    const sqrtPrice1 = priceToSqrtPriceX96(price1)
    const sqrtPrice2 = priceToSqrtPriceX96(price2)

    // sqrtPrice2 / sqrtPrice1 should be sqrt(2) ≈ 1.414
    const ratio = Number(sqrtPrice2) / Number(sqrtPrice1)
    expect(ratio).toBeCloseTo(Math.sqrt(2), 5)
  })

  test('price ratio should equal sqrtPriceX96 ratio squared', () => {
    const priceA = 25
    const priceB = 100

    const sqrtPriceA = priceToSqrtPriceX96(priceA)
    const sqrtPriceB = priceToSqrtPriceX96(priceB)

    const priceRatio = priceB / priceA // 4
    const sqrtPriceRatio = Number(sqrtPriceB) / Number(sqrtPriceA)
    const sqrtPriceRatioSquared = sqrtPriceRatio * sqrtPriceRatio

    expect(sqrtPriceRatioSquared).toBeCloseTo(priceRatio, 5)
  })

  test('sqrtPriceX96 of inverse prices should be reciprocal (approximately)', () => {
    const price = 4.0
    const inversePrice = 1 / price

    const sqrtPrice = priceToSqrtPriceX96(price)
    const sqrtInversePrice = priceToSqrtPriceX96(inversePrice)

    // sqrtPrice = sqrt(price) * Q96, sqrtInversePrice = sqrt(1/price) * Q96
    // sqrtPrice * sqrtInversePrice = sqrt(price) * sqrt(1/price) * Q96 * Q96 = Q96^2
    // So (sqrtPrice * sqrtInversePrice) / Q96 should ≈ Q96
    const product = (sqrtPrice * sqrtInversePrice) / Q96
    const expectedRatio = Number(product) / Number(Q96)
    expect(expectedRatio).toBeCloseTo(1.0, 2)
  })
})

// =============================================================================
// REAL-WORLD POOL SCENARIOS
// =============================================================================

describe('Real-world pool scenarios', () => {
  test('should calculate correct sqrtPriceX96 for ETH/USDC pool', () => {
    // ETH = $3500 USDC
    // If USDC is token0 (lower address) and ETH is token1
    // Price = ETH/USDC = 3500
    const ethUsdcPrice = 3500

    const sqrtPriceX96 = priceToSqrtPriceX96(ethUsdcPrice)
    const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

    expect(priceBack).toBeCloseTo(3500, -1)
  })

  test('should calculate correct sqrtPriceX96 for stablecoin pair', () => {
    // USDC/DAI should be ~1.0
    const usdcDaiPrice = 1.0

    const sqrtPriceX96 = priceToSqrtPriceX96(usdcDaiPrice)
    expect(sqrtPriceX96).toBe(Q96)
  })

  test('should calculate correct sqrtPriceX96 for BTC/ETH pair', () => {
    // BTC = ~14 ETH
    const btcEthPrice = 14

    const sqrtPriceX96 = priceToSqrtPriceX96(btcEthPrice)
    const priceBack = sqrtPriceX96ToPrice(sqrtPriceX96)

    expect(priceBack).toBeCloseTo(14, 1)
  })
})
