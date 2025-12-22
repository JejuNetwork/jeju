import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'
import {
  calculateMinShares,
  calculatePositionValue,
  calculatePotentialPayout,
  calculateRealizedPnL,
  calculateUnrealizedPnL,
  formatShareAmount,
  isWinningPosition,
  validateSlippage,
  validateTradeAmount,
} from '../positionUtils'

describe('Position Value Calculations', () => {
  test('should calculate position value correctly', () => {
    const shares = parseEther('100')
    const price = BigInt(60 * 1e16) // 60%

    const value = calculatePositionValue(shares, price)

    // 100 shares at 60% = 60 tokens
    expect(value).toBe(parseEther('60'))
  })

  test('should return 0 for zero shares', () => {
    const price = BigInt(50 * 1e16)
    expect(calculatePositionValue(0n, price)).toBe(0n)
  })

  test('should return 0 for zero price', () => {
    const shares = parseEther('100')
    expect(calculatePositionValue(shares, 0n)).toBe(0n)
  })

  test('should handle 100% price correctly', () => {
    const shares = parseEther('50')
    const price = BigInt(100 * 1e16) // 100%

    const value = calculatePositionValue(shares, price)

    expect(value).toBe(parseEther('50'))
  })

  test('should handle fractional prices', () => {
    const shares = parseEther('100')
    const price = BigInt(33.33 * 1e16) // 33.33%

    const value = calculatePositionValue(shares, price)

    // Allow for small rounding differences
    const expected = parseEther('33.33')
    expect(Number(value)).toBeCloseTo(Number(expected), -14)
  })
})

describe('Potential Payout', () => {
  test('should return shares as potential payout (1:1)', () => {
    const shares = parseEther('100')
    expect(calculatePotentialPayout(shares)).toBe(shares)
  })

  test('should handle zero shares', () => {
    expect(calculatePotentialPayout(0n)).toBe(0n)
  })
})

describe('P&L Calculations', () => {
  test('should calculate positive realized P&L', () => {
    const totalReceived = parseEther('150')
    const totalSpent = parseEther('100')

    const pnl = calculateRealizedPnL(totalReceived, totalSpent)

    expect(pnl).toBe(parseEther('50'))
  })

  test('should calculate negative realized P&L', () => {
    const totalReceived = parseEther('50')
    const totalSpent = parseEther('100')

    const pnl = calculateRealizedPnL(totalReceived, totalSpent)

    expect(pnl).toBe(-parseEther('50'))
  })

  test('should calculate zero realized P&L for breakeven', () => {
    const amount = parseEther('100')
    expect(calculateRealizedPnL(amount, amount)).toBe(0n)
  })

  test('should calculate positive unrealized P&L', () => {
    const currentValue = parseEther('120')
    const totalSpent = parseEther('100')

    const pnl = calculateUnrealizedPnL(currentValue, totalSpent)

    expect(pnl).toBe(parseEther('20'))
  })

  test('should calculate negative unrealized P&L', () => {
    const currentValue = parseEther('80')
    const totalSpent = parseEther('100')

    const pnl = calculateUnrealizedPnL(currentValue, totalSpent)

    expect(pnl).toBe(-parseEther('20'))
  })
})

describe('Winning Position Check', () => {
  test('should identify YES position as winner when YES wins', () => {
    expect(isWinningPosition(true, false, true)).toBe(true)
  })

  test('should identify NO position as winner when NO wins', () => {
    expect(isWinningPosition(false, true, false)).toBe(true)
  })

  test('should identify YES position as loser when NO wins', () => {
    expect(isWinningPosition(true, false, false)).toBe(false)
  })

  test('should identify NO position as loser when YES wins', () => {
    expect(isWinningPosition(false, true, true)).toBe(false)
  })

  test('should handle position with both YES and NO shares', () => {
    // Has both, YES wins -> still a winner (has YES)
    expect(isWinningPosition(true, true, true)).toBe(true)
    // Has both, NO wins -> still a winner (has NO)
    expect(isWinningPosition(true, true, false)).toBe(true)
  })

  test('should handle position with no shares', () => {
    expect(isWinningPosition(false, false, true)).toBe(false)
    expect(isWinningPosition(false, false, false)).toBe(false)
  })
})

describe('Format Share Amount', () => {
  test('should format shares with default decimals', () => {
    const shares = parseEther('1234.56')
    const formatted = formatShareAmount(shares)

    expect(formatted).toContain('1,234.56')
  })

  test('should format shares with custom decimals', () => {
    const shares = parseEther('100.123456')

    expect(formatShareAmount(shares, 0)).toContain('100')
    expect(formatShareAmount(shares, 4)).toContain('100.1235')
  })

  test('should handle zero shares', () => {
    expect(formatShareAmount(0n, 2)).toContain('0.00')
  })

  test('should handle large numbers', () => {
    const shares = parseEther('1000000')
    const formatted = formatShareAmount(shares, 0)

    expect(formatted).toContain('1,000,000')
  })
})

describe('Trade Amount Validation', () => {
  test('should accept valid trade amount', () => {
    const amount = parseEther('1')
    expect(validateTradeAmount(amount)).toBe(true)
  })

  test('should reject zero amount', () => {
    expect(() => validateTradeAmount(0n)).toThrow(
      'Trade amount must be positive',
    )
  })

  test('should reject negative amount', () => {
    expect(() => validateTradeAmount(-1n)).toThrow(
      'Trade amount must be positive',
    )
  })

  test('should reject amount below minimum', () => {
    const tooSmall = parseEther('0.0001')
    expect(() => validateTradeAmount(tooSmall)).toThrow('Minimum trade amount')
  })

  test('should accept minimum trade amount', () => {
    const minAmount = parseEther('0.001')
    expect(validateTradeAmount(minAmount)).toBe(true)
  })
})

describe('Slippage Validation', () => {
  test('should accept valid slippage', () => {
    expect(validateSlippage(100n)).toBe(true) // 1%
    expect(validateSlippage(500n)).toBe(true) // 5%
    expect(validateSlippage(5000n)).toBe(true) // 50%
  })

  test('should accept zero slippage', () => {
    expect(validateSlippage(0n)).toBe(true)
  })

  test('should reject negative slippage', () => {
    expect(() => validateSlippage(-1n)).toThrow('Slippage cannot be negative')
  })

  test('should reject slippage over 50%', () => {
    expect(() => validateSlippage(5001n)).toThrow('Slippage cannot exceed 50%')
  })
})

describe('Calculate Minimum Shares', () => {
  test('should calculate min shares with 5% slippage', () => {
    const expectedShares = parseEther('100')
    const slippageBps = 500n // 5%

    const minShares = calculateMinShares(expectedShares, slippageBps)

    expect(minShares).toBe(parseEther('95'))
  })

  test('should calculate min shares with 0% slippage', () => {
    const expectedShares = parseEther('100')

    const minShares = calculateMinShares(expectedShares, 0n)

    expect(minShares).toBe(expectedShares)
  })

  test('should throw for invalid slippage', () => {
    const expectedShares = parseEther('100')

    expect(() => calculateMinShares(expectedShares, 6000n)).toThrow(
      'Slippage cannot exceed 50%',
    )
  })
})
