/**
 * Unit tests for perpetual market formatting functions
 * Tests price, size, PnL, and funding rate formatting
 */

import { describe, expect, test } from 'bun:test'
import {
  formatFundingRate,
  formatPnL,
  formatPrice,
  formatSize,
  PositionSide,
} from '../usePerps'

// PRICE FORMATTING TESTS

describe('formatPrice', () => {
  test('should format whole number prices', () => {
    // Price is stored with 8 decimals (1e8)
    const price = 350000000000n // $3500.00
    expect(formatPrice(price)).toBe('3,500.00')
  })

  test('should format prices with decimals', () => {
    const price = 123456789012n // $1234.56789012
    expect(formatPrice(price, 2)).toBe('1,234.57')
  })

  test('should format small prices', () => {
    const price = 100000n // $0.001
    expect(formatPrice(price, 4)).toBe('0.0010')
  })

  test('should handle zero price', () => {
    const price = 0n
    expect(formatPrice(price)).toBe('0.00')
  })

  test('should respect decimal parameter', () => {
    const price = 123456789012n

    expect(formatPrice(price, 0)).toBe('1,235')
    expect(formatPrice(price, 4)).toBe('1,234.5679')
  })

  test('should format large prices', () => {
    const price = 10000000000000n // $100,000
    expect(formatPrice(price)).toBe('100,000.00')
  })
})

// SIZE FORMATTING TESTS

describe('formatSize', () => {
  test('should format whole number sizes', () => {
    // Size is stored with 8 decimals
    const size = 100000000n // 1.0
    expect(formatSize(size)).toBe('1.0000')
  })

  test('should format fractional sizes', () => {
    const size = 12345678n // 0.12345678
    expect(formatSize(size)).toBe('0.1235')
  })

  test('should format large sizes', () => {
    const size = 10000000000000n // 100,000
    expect(formatSize(size)).toBe('100,000.0000')
  })

  test('should handle zero size', () => {
    const size = 0n
    expect(formatSize(size)).toBe('0.0000')
  })

  test('should respect decimal parameter', () => {
    const size = 123456789n // 1.23456789

    expect(formatSize(size, 2)).toBe('1.23')
    expect(formatSize(size, 6)).toBe('1.234568')
  })
})

// PNL FORMATTING TESTS

describe('formatPnL', () => {
  test('should format positive PnL with + prefix', () => {
    // PnL is stored with 18 decimals
    const pnl = 1000n * 10n ** 18n // +$1000
    const result = formatPnL(pnl)

    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$1,000.00')
  })

  test('should format negative PnL without + prefix', () => {
    const pnl = -(500n * 10n ** 18n) // -$500
    const result = formatPnL(pnl)

    expect(result.isProfit).toBe(false)
    // Implementation uses Math.abs, so negative shows as positive value but isProfit is false
    expect(result.value).toBe('$500.00')
  })

  test('should format zero PnL as profit (neutral)', () => {
    const pnl = 0n
    const result = formatPnL(pnl)

    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$0.00')
  })

  test('should format small PnL', () => {
    const pnl = 1n * 10n ** 15n // $0.001
    const result = formatPnL(pnl)

    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$0.00')
  })

  test('should format large PnL', () => {
    const pnl = 1000000n * 10n ** 18n // $1,000,000
    const result = formatPnL(pnl)

    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$1,000,000.00')
  })

  test('should handle fractional PnL', () => {
    const pnl = 12345n * 10n ** 14n // $1.2345
    const result = formatPnL(pnl)

    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$1.23')
  })
})

// FUNDING RATE FORMATTING TESTS

describe('formatFundingRate', () => {
  test('should format positive funding rate with + prefix', () => {
    // Funding rate: rateNumber = rate / 1e16
    // For 0.01%, we need rate = 0.01 * 1e16 = 1e14
    const rate = 1n * 10n ** 14n // 0.01%
    expect(formatFundingRate(rate)).toBe('+0.0100%')
  })

  test('should format negative funding rate', () => {
    // For -0.05%, we need rate = -0.05 * 1e16 = -5e14
    const rate = -(5n * 10n ** 14n) // -0.05%
    expect(formatFundingRate(rate)).toBe('-0.0500%')
  })

  test('should format zero funding rate', () => {
    const rate = 0n
    expect(formatFundingRate(rate)).toBe('+0.0000%')
  })

  test('should format large funding rate', () => {
    // For 1%, we need rate = 1 * 1e16 = 1e16
    const rate = 1n * 10n ** 16n // 1%
    expect(formatFundingRate(rate)).toBe('+1.0000%')
  })

  test('should format very small funding rate', () => {
    // For 0.0001%, we need rate = 0.0001 * 1e16 = 1e12
    const rate = 1n * 10n ** 12n // 0.0001%
    expect(formatFundingRate(rate)).toBe('+0.0001%')
  })
})

// POSITION SIDE ENUM TESTS

describe('PositionSide', () => {
  test('should have Long as 0', () => {
    expect(PositionSide.Long).toBe(0)
  })

  test('should have Short as 1', () => {
    expect(PositionSide.Short).toBe(1)
  })
})

// EDGE CASES AND PROPERTY TESTS

describe('Edge cases', () => {
  test('formatPrice should handle maximum safe BigInt values', () => {
    const maxSafe = 9007199254740991n * 10n ** 8n // ~90 trillion dollars
    const result = formatPrice(maxSafe)

    // Should not throw, result should be a formatted string
    expect(typeof result).toBe('string')
    expect(result.includes(',')).toBe(true)
  })

  test('formatPnL should handle very large negative values', () => {
    const largeLoss = -(1000000000n * 10n ** 18n) // -$1 billion
    const result = formatPnL(largeLoss)

    expect(result.isProfit).toBe(false)
    expect(result.value.includes('$')).toBe(true)
  })

  test('funding rate formatting should be consistent for equal positive and negative rates', () => {
    const positiveRate = 50n * 10n ** 14n
    const negativeRate = -(50n * 10n ** 14n)

    const posResult = formatFundingRate(positiveRate)
    const negResult = formatFundingRate(negativeRate)

    // Should have same numeric value, different sign
    expect(posResult.replace('+', '')).toBe(negResult.replace('-', ''))
  })
})

// CONSISTENCY TESTS

describe('Consistency tests', () => {
  test('formatPrice should be consistent for same input', () => {
    const price = 350000000000n

    const result1 = formatPrice(price)
    const result2 = formatPrice(price)

    expect(result1).toBe(result2)
  })

  test('formatSize should be consistent for same input', () => {
    const size = 100000000n

    const result1 = formatSize(size)
    const result2 = formatSize(size)

    expect(result1).toBe(result2)
  })

  test('formatPnL should be consistent for same input', () => {
    const pnl = 1000n * 10n ** 18n

    const result1 = formatPnL(pnl)
    const result2 = formatPnL(pnl)

    expect(result1.value).toBe(result2.value)
    expect(result1.isProfit).toBe(result2.isProfit)
  })
})
