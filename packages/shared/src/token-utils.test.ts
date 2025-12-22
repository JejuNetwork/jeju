/**
 * Token Utilities Tests
 *
 * Tests for token amount formatting, USD calculations, and significance checks.
 * These are critical financial calculations that need thorough testing.
 */

import { describe, expect, test } from 'bun:test'
import {
  calculateUsdValue,
  formatTokenAmount,
  formatTokenUsd,
  formatTokenWithSymbol,
  isSignificantAmount,
  parseTokenAmount,
} from './token-utils'

describe('formatTokenAmount', () => {
  describe('standard cases', () => {
    test('formats 1 token with 18 decimals', () => {
      const amount = 1000000000000000000n // 1e18
      expect(formatTokenAmount(amount, 18)).toBe('1')
    })

    test('formats fractional token amounts', () => {
      const amount = 1500000000000000000n // 1.5e18
      expect(formatTokenAmount(amount, 18)).toBe('1.5')
    })

    test('formats with specified display decimals', () => {
      const amount = 1234567890000000000n
      expect(formatTokenAmount(amount, 18, 2)).toBe('1.23')
    })

    test('formats zero correctly', () => {
      expect(formatTokenAmount(0n, 18)).toBe('0')
    })

    test('accepts string input', () => {
      expect(formatTokenAmount('1000000000000000000', 18)).toBe('1')
    })

    test('accepts number input', () => {
      expect(formatTokenAmount(1000000000000000000, 18)).toBe('1')
    })
  })

  describe('different decimals', () => {
    test('formats USDC with 6 decimals', () => {
      const amount = 1000000n // 1 USDC
      expect(formatTokenAmount(amount, 6)).toBe('1')
    })

    test('formats fractional USDC', () => {
      const amount = 1234567n
      expect(formatTokenAmount(amount, 6, 2)).toBe('1.23')
    })

    test('formats WBTC with 8 decimals', () => {
      const amount = 100000000n // 1 WBTC
      expect(formatTokenAmount(amount, 8)).toBe('1')
    })
  })

  describe('edge cases', () => {
    test('shows < prefix for very small amounts', () => {
      const tiny = 1n // 1 wei
      expect(formatTokenAmount(tiny, 18, 4)).toBe('<0.0001')
    })

    test('removes trailing zeros', () => {
      const amount = 1000000000000000000n // exactly 1
      expect(formatTokenAmount(amount, 18, 8)).toBe('1')
    })

    test('handles large token amounts', () => {
      const amount = 1000000000000000000000000n // 1 million tokens
      expect(formatTokenAmount(amount, 18)).toBe('1000000')
    })

    test('handles very small but displayable amounts', () => {
      const amount = 10000000000000n // 0.00001
      expect(formatTokenAmount(amount, 18, 5)).toBe('0.00001')
    })
  })

  describe('property-based tests', () => {
    test('formatted amount never starts with decimal point', () => {
      for (let i = 0; i < 100; i++) {
        const randomWei = BigInt(Math.floor(Math.random() * 1e15))
        const formatted = formatTokenAmount(randomWei, 18, 4)
        expect(formatted.startsWith('.')).toBe(false)
      }
    })

    test('output is a valid number string or starts with <', () => {
      for (let i = 0; i < 100; i++) {
        const randomWei = BigInt(Math.floor(Math.random() * 1e18))
        const formatted = formatTokenAmount(randomWei, 18, 4)
        if (!formatted.startsWith('<')) {
          expect(Number.isNaN(parseFloat(formatted))).toBe(false)
        }
      }
    })
  })
})

describe('parseTokenAmount', () => {
  test('parses whole number', () => {
    expect(parseTokenAmount('1', 18)).toBe(1000000000000000000n)
  })

  test('parses decimal amount', () => {
    expect(parseTokenAmount('1.5', 18)).toBe(1500000000000000000n)
  })

  test('parses USDC amount', () => {
    expect(parseTokenAmount('100', 6)).toBe(100000000n)
  })

  test('parses small amounts', () => {
    expect(parseTokenAmount('0.001', 18)).toBe(1000000000000000n)
  })

  test('parses zero', () => {
    expect(parseTokenAmount('0', 18)).toBe(0n)
  })
})

describe('formatTokenUsd', () => {
  test('formats positive USD amount', () => {
    expect(formatTokenUsd(1234.56)).toBe('$1,234.56')
  })

  test('formats zero', () => {
    expect(formatTokenUsd(0)).toBe('$0.00')
  })

  test('formats amounts less than a cent with < prefix', () => {
    expect(formatTokenUsd(0.001)).toBe('<$0.01')
  })

  test('uses custom decimal places', () => {
    expect(formatTokenUsd(1234.5678, 4)).toBe('$1,234.5678')
  })

  test('formats exactly $0.01', () => {
    expect(formatTokenUsd(0.01)).toBe('$0.01')
  })

  test('formats large amounts', () => {
    expect(formatTokenUsd(1000000)).toBe('$1,000,000.00')
  })
})

describe('calculateUsdValue', () => {
  test('calculates USD value for 18 decimal token', () => {
    const amount = 1000000000000000000n // 1 token
    const priceUsd = 2000 // $2000/token
    expect(calculateUsdValue(amount, 18, priceUsd)).toBe(2000)
  })

  test('calculates USD value for 6 decimal token', () => {
    const amount = 1000000n // 1 USDC
    const priceUsd = 1
    expect(calculateUsdValue(amount, 6, priceUsd)).toBe(1)
  })

  test('calculates fractional amounts', () => {
    const amount = 500000000000000000n // 0.5 token
    const priceUsd = 100
    expect(calculateUsdValue(amount, 18, priceUsd)).toBe(50)
  })

  test('handles zero amount', () => {
    expect(calculateUsdValue(0n, 18, 1000)).toBe(0)
  })

  test('handles zero price', () => {
    expect(calculateUsdValue(1000000000000000000n, 18, 0)).toBe(0)
  })

  test('calculates large values accurately', () => {
    const amount = 1000000000000000000000n // 1000 tokens
    const priceUsd = 50000 // $50k each
    expect(calculateUsdValue(amount, 18, priceUsd)).toBe(50000000)
  })
})

describe('formatTokenWithSymbol', () => {
  test('formats with symbol', () => {
    const amount = 1000000000000000000n
    expect(formatTokenWithSymbol(amount, 18, 'ETH')).toBe('1 ETH')
  })

  test('formats fractional with symbol', () => {
    const amount = 1500000000000000000n
    expect(formatTokenWithSymbol(amount, 18, 'ETH', 2)).toBe('1.5 ETH')
  })

  test('formats USDC', () => {
    const amount = 1234560000n // 1234.56 USDC
    expect(formatTokenWithSymbol(amount, 6, 'USDC', 2)).toBe('1234.56 USDC')
  })
})

describe('isSignificantAmount', () => {
  describe('significance thresholds', () => {
    test('returns true for amounts above threshold', () => {
      const amount = 1000000000000000000n // 1 ETH
      const priceUsd = 2000
      expect(isSignificantAmount(amount, 18, 1, priceUsd)).toBe(true)
    })

    test('returns false for amounts below threshold', () => {
      const amount = 1000000000000000n // 0.001 ETH = $2
      const priceUsd = 2000
      expect(isSignificantAmount(amount, 18, 10, priceUsd)).toBe(false)
    })

    test('returns true for amounts exactly at threshold', () => {
      const amount = 1000000000000000000n // 1 token = $10
      const priceUsd = 10
      expect(isSignificantAmount(amount, 18, 10, priceUsd)).toBe(true)
    })
  })

  describe('dust filtering', () => {
    test('filters out dust amounts', () => {
      const dust = 100n // very tiny amount
      expect(isSignificantAmount(dust, 18, 0.01, 2000)).toBe(false)
    })

    test('keeps non-dust amounts', () => {
      const nonDust = 10000000000000000n // 0.01 ETH
      expect(isSignificantAmount(nonDust, 18, 0.01, 2000)).toBe(true)
    })
  })

  describe('different token decimals', () => {
    test('correctly handles USDC (6 decimals)', () => {
      const oneUsdc = 1000000n
      expect(isSignificantAmount(oneUsdc, 6, 0.5, 1)).toBe(true)
      expect(isSignificantAmount(oneUsdc, 6, 2, 1)).toBe(false)
    })

    test('correctly handles tokens with 0 decimals', () => {
      const oneToken = 1n
      expect(isSignificantAmount(oneToken, 0, 10, 100)).toBe(true)
    })
  })

  describe('edge cases', () => {
    test('handles zero amount', () => {
      expect(isSignificantAmount(0n, 18, 0.01, 2000)).toBe(false)
    })

    test('handles zero price', () => {
      expect(isSignificantAmount(1000000000000000000n, 18, 0.01, 0)).toBe(false)
    })

    test('handles zero threshold', () => {
      expect(isSignificantAmount(1n, 18, 0, 2000)).toBe(true)
    })
  })

  describe('property-based tests', () => {
    test('higher amounts are more likely to be significant', () => {
      const priceUsd = 100
      const minUsd = 1

      for (let i = 0; i < 100; i++) {
        const smallAmount = BigInt(Math.floor(Math.random() * 1e15))
        const largeAmount = smallAmount + 1000000000000000000n

        const smallSignificant = isSignificantAmount(
          smallAmount,
          18,
          minUsd,
          priceUsd,
        )
        const largeSignificant = isSignificantAmount(
          largeAmount,
          18,
          minUsd,
          priceUsd,
        )

        // If small is significant, large must also be significant
        if (smallSignificant) {
          expect(largeSignificant).toBe(true)
        }
      }
    })
  })
})

describe('round-trip consistency', () => {
  test('parse and format are inverse operations', () => {
    const testCases = ['1', '10', '100', '0.1', '0.01', '1.5', '123.456']

    for (const original of testCases) {
      const parsed = parseTokenAmount(original, 18)
      const formatted = formatTokenAmount(parsed, 18, 6)
      expect(parseFloat(formatted)).toBeCloseTo(parseFloat(original), 5)
    }
  })
})
