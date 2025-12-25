/**
 * Tests for perpetual trading business logic
 */

import { describe, expect, it } from 'bun:test'
import {
  calculateCurrentLeverage,
  calculateFee,
  calculateLiquidationPrice,
  calculateNotional,
  // Calculation functions
  calculateRequiredMargin,
  calculateUnrealizedPnL,
  DEFAULT_TAKER_FEE_BPS,
  FUNDING_RATE_DECIMALS,
  FUNDING_RATE_SCALE,
  formatFundingRate,
  formatLeverage,
  formatPnL,
  // Formatting functions
  formatPrice,
  formatSize,
  getBaseAsset,
  // UI helper functions
  getTradeButtonText,
  isAtLiquidationRisk,
  isTradeButtonDisabled,
  LEVERAGE_DECIMALS,
  LEVERAGE_SCALE,
  leverageToBigInt,
  leverageToNumber,
  MAINTENANCE_MARGIN_FACTOR,
  // Constants
  MARKET_IDS,
  MAX_LEVERAGE,
  PNL_DECIMALS,
  PNL_SCALE,
  // Enum
  PositionSide,
  PRICE_DECIMALS,
  PRICE_SCALE,
  // Conversion functions
  priceToBigInt,
  priceToNumber,
  SIZE_DECIMALS,
  SIZE_SCALE,
  sizeToBigInt,
  sizeToNumber,
  validateMargin,
  // Validation functions
  validatePositionParams,
} from '../perps'

// CONSTANTS TESTS

describe('perps constants', () => {
  it('has correct MARKET_IDS', () => {
    expect(MARKET_IDS.BTC_PERP).toBeDefined()
    expect(MARKET_IDS.ETH_PERP).toBeDefined()
    expect(MARKET_IDS.BTC_PERP.startsWith('0x')).toBe(true)
    expect(MARKET_IDS.ETH_PERP.startsWith('0x')).toBe(true)
  })

  it('has correct decimal scales', () => {
    expect(PRICE_DECIMALS).toBe(8)
    expect(PRICE_SCALE).toBe(10n ** 8n)
    expect(SIZE_DECIMALS).toBe(8)
    expect(SIZE_SCALE).toBe(10n ** 8n)
    expect(PNL_DECIMALS).toBe(18)
    expect(PNL_SCALE).toBe(10n ** 18n)
    expect(FUNDING_RATE_DECIMALS).toBe(16)
    expect(FUNDING_RATE_SCALE).toBe(10n ** 16n)
    expect(LEVERAGE_DECIMALS).toBe(18)
    expect(LEVERAGE_SCALE).toBe(10n ** 18n)
  })

  it('has correct trading constants', () => {
    expect(MAX_LEVERAGE).toBe(100)
    expect(DEFAULT_TAKER_FEE_BPS).toBe(5n)
    expect(MAINTENANCE_MARGIN_FACTOR).toBe(0.95)
  })
})

// POSITION SIDE ENUM TESTS

describe('PositionSide', () => {
  it('has Long as 0', () => {
    expect(PositionSide.Long).toBe(0)
  })

  it('has Short as 1', () => {
    expect(PositionSide.Short).toBe(1)
  })
})

// FORMATTING TESTS

describe('formatPrice', () => {
  it('formats whole number prices', () => {
    const price = 350000000000n // $3500.00
    expect(formatPrice(price)).toBe('3,500.00')
  })

  it('formats prices with decimals', () => {
    const price = 123456789012n // $1234.56789012
    expect(formatPrice(price, 2)).toBe('1,234.57')
  })

  it('formats small prices', () => {
    const price = 100000n // $0.001
    expect(formatPrice(price, 4)).toBe('0.0010')
  })

  it('handles zero price', () => {
    const price = 0n
    expect(formatPrice(price)).toBe('0.00')
  })

  it('respects decimal parameter', () => {
    const price = 123456789012n
    expect(formatPrice(price, 0)).toBe('1,235')
    expect(formatPrice(price, 4)).toBe('1,234.5679')
  })

  it('formats large prices', () => {
    const price = 10000000000000n // $100,000
    expect(formatPrice(price)).toBe('100,000.00')
  })
})

describe('formatSize', () => {
  it('formats whole number sizes', () => {
    const size = 100000000n // 1.0
    expect(formatSize(size)).toBe('1.0000')
  })

  it('formats fractional sizes', () => {
    const size = 12345678n // 0.12345678
    expect(formatSize(size)).toBe('0.1235')
  })

  it('formats large sizes', () => {
    const size = 10000000000000n // 100,000
    expect(formatSize(size)).toBe('100,000.0000')
  })

  it('handles zero size', () => {
    const size = 0n
    expect(formatSize(size)).toBe('0.0000')
  })

  it('respects decimal parameter', () => {
    const size = 123456789n // 1.23456789
    expect(formatSize(size, 2)).toBe('1.23')
    expect(formatSize(size, 6)).toBe('1.234568')
  })
})

describe('formatPnL', () => {
  it('formats positive PnL with + prefix', () => {
    const pnl = 1000n * 10n ** 18n // +$1000
    const result = formatPnL(pnl)
    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$1,000.00')
  })

  it('formats negative PnL without + prefix', () => {
    const pnl = -(500n * 10n ** 18n) // -$500
    const result = formatPnL(pnl)
    expect(result.isProfit).toBe(false)
    expect(result.value).toBe('$500.00')
  })

  it('formats zero PnL as profit (neutral)', () => {
    const pnl = 0n
    const result = formatPnL(pnl)
    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$0.00')
  })

  it('formats small PnL', () => {
    const pnl = 1n * 10n ** 15n // $0.001
    const result = formatPnL(pnl)
    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$0.00')
  })

  it('formats large PnL', () => {
    const pnl = 1000000n * 10n ** 18n // $1,000,000
    const result = formatPnL(pnl)
    expect(result.isProfit).toBe(true)
    expect(result.value).toBe('+$1,000,000.00')
  })
})

describe('formatFundingRate', () => {
  it('formats positive funding rate with + prefix', () => {
    const rate = 1n * 10n ** 14n // 0.01%
    expect(formatFundingRate(rate)).toBe('+0.0100%')
  })

  it('formats negative funding rate', () => {
    const rate = -(5n * 10n ** 14n) // -0.05%
    expect(formatFundingRate(rate)).toBe('-0.0500%')
  })

  it('formats zero funding rate', () => {
    const rate = 0n
    expect(formatFundingRate(rate)).toBe('+0.0000%')
  })

  it('formats large funding rate', () => {
    const rate = 1n * 10n ** 16n // 1%
    expect(formatFundingRate(rate)).toBe('+1.0000%')
  })
})

describe('formatLeverage', () => {
  it('formats leverage multiplier', () => {
    const leverage = 10n * 10n ** 18n // 10x
    expect(formatLeverage(leverage)).toBe('10.0x')
  })

  it('formats fractional leverage', () => {
    const leverage = 25n * 10n ** 17n // 2.5x
    expect(formatLeverage(leverage)).toBe('2.5x')
  })

  it('handles zero leverage', () => {
    expect(formatLeverage(0n)).toBe('0.0x')
  })
})

// CALCULATION TESTS

describe('calculateRequiredMargin', () => {
  it('calculates margin correctly', () => {
    const margin = calculateRequiredMargin(1, 50000, 10)
    expect(margin).toBe(5000) // 1 * 50000 / 10 = 5000
  })

  it('returns 0 for zero leverage', () => {
    expect(calculateRequiredMargin(1, 50000, 0)).toBe(0)
  })

  it('handles high leverage', () => {
    const margin = calculateRequiredMargin(1, 50000, 100)
    expect(margin).toBe(500)
  })
})

describe('calculateLiquidationPrice', () => {
  it('calculates long liquidation price', () => {
    const liqPrice = calculateLiquidationPrice(50000, 10, PositionSide.Long)
    // (1 - 1/10 * 0.95) = 0.905, so 50000 * 0.905 = 45250
    expect(liqPrice).toBeCloseTo(45250, 0)
  })

  it('calculates short liquidation price', () => {
    const liqPrice = calculateLiquidationPrice(50000, 10, PositionSide.Short)
    // (1 + 1/10 * 0.95) = 1.095, so 50000 * 1.095 = 54750
    expect(liqPrice).toBeCloseTo(54750, 0)
  })

  it('returns 0 for zero leverage', () => {
    expect(calculateLiquidationPrice(50000, 0, PositionSide.Long)).toBe(0)
  })

  it('accepts custom maintenance margin factor', () => {
    const liqPrice = calculateLiquidationPrice(
      50000,
      10,
      PositionSide.Long,
      0.9,
    )
    expect(liqPrice).toBeCloseTo(45500, 0)
  })
})

describe('calculateFee', () => {
  it('calculates fee correctly', () => {
    const fee = calculateFee(1, 50000, 5) // 5 bps = 0.05%
    expect(fee).toBe(25) // 50000 * 5 / 10000 = 25
  })

  it('uses default fee when not specified', () => {
    const fee = calculateFee(1, 50000)
    expect(fee).toBe(25) // Default is 5 bps, so 50000 * 5 / 10000 = 25
  })

  it('handles zero size', () => {
    expect(calculateFee(0, 50000, 5)).toBe(0)
  })
})

describe('calculateUnrealizedPnL', () => {
  it('calculates positive long PnL', () => {
    const pnl = calculateUnrealizedPnL(1, 50000, 55000, PositionSide.Long)
    expect(pnl).toBe(5000) // (55000 - 50000) * 1 = 5000
  })

  it('calculates negative long PnL', () => {
    const pnl = calculateUnrealizedPnL(1, 50000, 45000, PositionSide.Long)
    expect(pnl).toBe(-5000)
  })

  it('calculates positive short PnL', () => {
    const pnl = calculateUnrealizedPnL(1, 50000, 45000, PositionSide.Short)
    expect(pnl).toBe(5000) // Price went down, short profits
  })

  it('calculates negative short PnL', () => {
    const pnl = calculateUnrealizedPnL(1, 50000, 55000, PositionSide.Short)
    expect(pnl).toBe(-5000)
  })
})

describe('calculateNotional', () => {
  it('calculates notional value', () => {
    expect(calculateNotional(1, 50000)).toBe(50000)
    expect(calculateNotional(0.5, 50000)).toBe(25000)
  })
})

describe('calculateCurrentLeverage', () => {
  it('calculates current leverage', () => {
    expect(calculateCurrentLeverage(50000, 5000)).toBe(10)
    expect(calculateCurrentLeverage(50000, 2500)).toBe(20)
  })

  it('returns 0 for zero margin', () => {
    expect(calculateCurrentLeverage(50000, 0)).toBe(0)
  })
})

describe('isAtLiquidationRisk', () => {
  it('returns true when below threshold', () => {
    const healthFactor = 5n * 10n ** 17n // 0.5
    expect(isAtLiquidationRisk(healthFactor)).toBe(true)
  })

  it('returns false when above threshold', () => {
    const healthFactor = 15n * 10n ** 17n // 1.5
    expect(isAtLiquidationRisk(healthFactor)).toBe(false)
  })

  it('returns false when at threshold', () => {
    const healthFactor = 10n ** 18n // 1.0
    expect(isAtLiquidationRisk(healthFactor)).toBe(false)
  })

  it('accepts custom threshold', () => {
    const healthFactor = 11n * 10n ** 17n // 1.1
    const threshold = 12n * 10n ** 17n // 1.2
    expect(isAtLiquidationRisk(healthFactor, threshold)).toBe(true)
  })
})

// CONVERSION TESTS

describe('price conversions', () => {
  it('priceToBigInt converts correctly', () => {
    expect(priceToBigInt(3500)).toBe(350000000000n)
    expect(priceToBigInt(0.01)).toBe(1000000n)
  })

  it('priceToNumber converts correctly', () => {
    expect(priceToNumber(350000000000n)).toBe(3500)
    expect(priceToNumber(1000000n)).toBe(0.01)
  })

  it('round-trip conversion is accurate', () => {
    const original = 12345.67
    const bigint = priceToBigInt(original)
    const result = priceToNumber(bigint)
    expect(result).toBeCloseTo(original, 2)
  })
})

describe('size conversions', () => {
  it('sizeToBigInt converts correctly', () => {
    expect(sizeToBigInt(1)).toBe(100000000n)
    expect(sizeToBigInt(0.5)).toBe(50000000n)
  })

  it('sizeToNumber converts correctly', () => {
    expect(sizeToNumber(100000000n)).toBe(1)
    expect(sizeToNumber(50000000n)).toBe(0.5)
  })
})

describe('leverage conversions', () => {
  it('leverageToBigInt converts correctly', () => {
    expect(leverageToBigInt(10)).toBe(10n * 10n ** 18n)
    expect(leverageToBigInt(2.5)).toBe(25n * 10n ** 17n)
  })

  it('leverageToNumber converts correctly', () => {
    expect(leverageToNumber(10n * 10n ** 18n)).toBe(10)
    expect(leverageToNumber(25n * 10n ** 17n)).toBe(2.5)
  })
})

// VALIDATION TESTS

describe('validatePositionParams', () => {
  it('accepts valid params', () => {
    const result = validatePositionParams(1, 10, 100)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('rejects zero size', () => {
    const result = validatePositionParams(0, 10, 100)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Position size must be positive')
  })

  it('rejects negative size', () => {
    const result = validatePositionParams(-1, 10, 100)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Position size must be positive')
  })

  it('rejects zero leverage', () => {
    const result = validatePositionParams(1, 0, 100)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Leverage must be positive')
  })

  it('rejects leverage above max', () => {
    const result = validatePositionParams(1, 150, 100)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Leverage cannot exceed 100x')
  })

  it('uses default max leverage', () => {
    const result = validatePositionParams(1, 150)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Leverage cannot exceed 100x')
  })
})

describe('validateMargin', () => {
  it('accepts valid margin', () => {
    const result = validateMargin(1000n)
    expect(result.valid).toBe(true)
  })

  it('rejects zero margin', () => {
    const result = validateMargin(0n)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Margin must be positive')
  })

  it('rejects margin below minimum', () => {
    const result = validateMargin(500n, 1000n)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Margin below minimum')
  })

  it('accepts margin at minimum', () => {
    const result = validateMargin(1000n, 1000n)
    expect(result.valid).toBe(true)
  })
})

// UI HELPER TESTS

describe('getTradeButtonText', () => {
  it('shows Connect Wallet when disconnected', () => {
    expect(
      getTradeButtonText(false, false, true, PositionSide.Long, 'BTC'),
    ).toBe('Connect Wallet')
  })

  it('shows Opening Position when loading', () => {
    expect(getTradeButtonText(true, true, true, PositionSide.Long, 'BTC')).toBe(
      'Opening Position...',
    )
  })

  it('shows Enter Size when no valid size', () => {
    expect(
      getTradeButtonText(true, false, false, PositionSide.Long, 'BTC'),
    ).toBe('Enter Size')
  })

  it('shows Long {symbol} for long positions', () => {
    expect(
      getTradeButtonText(true, false, true, PositionSide.Long, 'BTC'),
    ).toBe('Long BTC')
  })

  it('shows Short {symbol} for short positions', () => {
    expect(
      getTradeButtonText(true, false, true, PositionSide.Short, 'ETH'),
    ).toBe('Short ETH')
  })
})

describe('isTradeButtonDisabled', () => {
  it('disabled when disconnected', () => {
    expect(isTradeButtonDisabled(false, false, true)).toBe(true)
  })

  it('disabled when loading', () => {
    expect(isTradeButtonDisabled(true, true, true)).toBe(true)
  })

  it('disabled when no valid size', () => {
    expect(isTradeButtonDisabled(true, false, false)).toBe(true)
  })

  it('enabled when all conditions met', () => {
    expect(isTradeButtonDisabled(true, false, true)).toBe(false)
  })
})

describe('getBaseAsset', () => {
  it('extracts base asset from perp symbol', () => {
    expect(getBaseAsset('BTC-PERP')).toBe('BTC')
    expect(getBaseAsset('ETH-PERP')).toBe('ETH')
  })

  it('returns original string if no dash', () => {
    expect(getBaseAsset('BTCUSDT')).toBe('BTCUSDT')
  })

  it('handles multiple dashes', () => {
    expect(getBaseAsset('SOL-PERP-USDC')).toBe('SOL')
  })
})

// EDGE CASES AND CONSISTENCY TESTS

describe('edge cases', () => {
  it('formatPrice handles maximum safe BigInt values', () => {
    const maxSafe = 9007199254740991n * 10n ** 8n
    const result = formatPrice(maxSafe)
    expect(typeof result).toBe('string')
    expect(result.includes(',')).toBe(true)
  })

  it('formatPnL handles very large negative values', () => {
    const largeLoss = -(1000000000n * 10n ** 18n)
    const result = formatPnL(largeLoss)
    expect(result.isProfit).toBe(false)
    expect(result.value.includes('$')).toBe(true)
  })

  it('funding rate formatting is consistent for positive and negative', () => {
    const positiveRate = 50n * 10n ** 14n
    const negativeRate = -(50n * 10n ** 14n)

    const posResult = formatFundingRate(positiveRate)
    const negResult = formatFundingRate(negativeRate)

    expect(posResult.replace('+', '')).toBe(negResult.replace('-', ''))
  })
})

describe('consistency tests', () => {
  it('formatPrice is consistent for same input', () => {
    const price = 350000000000n
    expect(formatPrice(price)).toBe(formatPrice(price))
  })

  it('formatSize is consistent for same input', () => {
    const size = 100000000n
    expect(formatSize(size)).toBe(formatSize(size))
  })

  it('formatPnL is consistent for same input', () => {
    const pnl = 1000n * 10n ** 18n
    const result1 = formatPnL(pnl)
    const result2 = formatPnL(pnl)
    expect(result1.value).toBe(result2.value)
    expect(result1.isProfit).toBe(result2.isProfit)
  })

  it('calculations are deterministic', () => {
    const margin1 = calculateRequiredMargin(1, 50000, 10)
    const margin2 = calculateRequiredMargin(1, 50000, 10)
    expect(margin1).toBe(margin2)

    const liqPrice1 = calculateLiquidationPrice(50000, 10, PositionSide.Long)
    const liqPrice2 = calculateLiquidationPrice(50000, 10, PositionSide.Long)
    expect(liqPrice1).toBe(liqPrice2)
  })
})
