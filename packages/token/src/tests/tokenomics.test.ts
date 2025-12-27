/**
 * @fileoverview Comprehensive tests for tokenomics utilities
 * Tests token math, vesting calculations, fee distributions, and edge cases
 * Includes property-based/fuzz testing for mathematical functions
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  calculateVestingSchedule,
  createTokenEconomics,
  DEFAULT_FEE_DISTRIBUTION,
  formatTokens,
  formatWei,
  ONE_DAY,
  ONE_HOUR,
  ONE_MONTH,
  ONE_YEAR,
  percentToTokens,
  tokensToWei,
  validateAllocation,
  validateFeeDistribution,
  validateTokenEconomicsConfig,
  weiToTokens,
} from '../config/tokenomics'
import type {
  FeeDistribution,
  TokenAllocation,
  TokenEconomics,
  VestingConfig,
  VestingSchedule,
} from '../types'
import { ValidationError } from '../validation'

// TIME CONSTANTS

describe('Time Constants', () => {
  test('ONE_YEAR is correct in seconds', () => {
    expect(ONE_YEAR).toBe(365 * 24 * 60 * 60)
    expect(ONE_YEAR).toBe(31536000)
  })

  test('ONE_MONTH is correct (30 days)', () => {
    expect(ONE_MONTH).toBe(30 * 24 * 60 * 60)
    expect(ONE_MONTH).toBe(2592000)
  })

  test('ONE_DAY is correct', () => {
    expect(ONE_DAY).toBe(24 * 60 * 60)
    expect(ONE_DAY).toBe(86400)
  })

  test('ONE_HOUR is correct', () => {
    expect(ONE_HOUR).toBe(60 * 60)
    expect(ONE_HOUR).toBe(3600)
  })

  test('time constants are consistent', () => {
    expect(ONE_DAY).toBe(ONE_HOUR * 24)
    expect(ONE_MONTH).toBe(ONE_DAY * 30)
    // Year is 365 days, not 12 months (which would be 360 days)
    expect(ONE_YEAR).toBe(ONE_DAY * 365)
  })
})

// percentToTokens - CRITICAL MATH FUNCTION

describe('percentToTokens - Basic Calculations', () => {
  const totalSupply = 1_000_000_000n // 1 billion tokens

  test('100% equals total supply', () => {
    expect(percentToTokens(totalSupply, 100)).toBe(totalSupply)
  })

  test('50% equals half of supply', () => {
    expect(percentToTokens(totalSupply, 50)).toBe(500_000_000n)
  })

  test('25% equals quarter of supply', () => {
    expect(percentToTokens(totalSupply, 25)).toBe(250_000_000n)
  })

  test('10% equals one tenth of supply', () => {
    expect(percentToTokens(totalSupply, 10)).toBe(100_000_000n)
  })

  test('1% equals one hundredth of supply', () => {
    expect(percentToTokens(totalSupply, 1)).toBe(10_000_000n)
  })

  test('0% equals zero', () => {
    expect(percentToTokens(totalSupply, 0)).toBe(0n)
  })
})

describe('percentToTokens - Fractional Percentages', () => {
  const totalSupply = 1_000_000_000n

  test('0.5% (half percent)', () => {
    // 0.5% of 1B = 5M
    expect(percentToTokens(totalSupply, 0.5)).toBe(5_000_000n)
  })

  test('0.1% (one tenth of a percent)', () => {
    // 0.1% of 1B = 1M
    expect(percentToTokens(totalSupply, 0.1)).toBe(1_000_000n)
  })

  test('0.01% (one hundredth of a percent)', () => {
    // 0.01% of 1B = 100K
    expect(percentToTokens(totalSupply, 0.01)).toBe(100_000n)
  })

  test('2.5% works correctly', () => {
    // 2.5% of 1B = 25M
    expect(percentToTokens(totalSupply, 2.5)).toBe(25_000_000n)
  })

  test('33.33% approximation', () => {
    // 33.33% of 1B = 333,300,000 (due to floor in calculation)
    const result = percentToTokens(totalSupply, 33.33)
    expect(result).toBe(333_300_000n)
  })
})

describe('percentToTokens - Edge Cases', () => {
  test('zero total supply returns zero', () => {
    expect(percentToTokens(0n, 50)).toBe(0n)
  })

  test('very small total supply', () => {
    expect(percentToTokens(100n, 50)).toBe(50n)
    expect(percentToTokens(100n, 1)).toBe(1n)
  })

  test('large total supply (18 decimals)', () => {
    // 1 trillion tokens with 18 decimals
    const supply = 1_000_000_000_000n * 10n ** 18n
    const tenPercent = percentToTokens(supply, 10)
    expect(tenPercent).toBe(100_000_000_000n * 10n ** 18n)
  })

  test('handles maximum bigint ranges', () => {
    const largeSupply = 2n ** 100n
    const result = percentToTokens(largeSupply, 50)
    expect(result).toBe(largeSupply / 2n)
  })
})

describe('percentToTokens - Property-Based Testing (Fuzzing)', () => {
  // Generate random test cases
  const randomPercentages = Array.from(
    { length: 100 },
    () => Math.random() * 100,
  )
  const randomSupplies = Array.from({ length: 20 }, () =>
    BigInt(Math.floor(Math.random() * 1e15)),
  )

  test('result never exceeds total supply', () => {
    for (const supply of randomSupplies) {
      for (const percent of randomPercentages) {
        const result = percentToTokens(supply, percent)
        expect(result).toBeLessThanOrEqual(supply)
      }
    }
  })

  test('0% always returns 0', () => {
    for (const supply of randomSupplies) {
      expect(percentToTokens(supply, 0)).toBe(0n)
    }
  })

  test('100% always returns total supply', () => {
    for (const supply of randomSupplies) {
      expect(percentToTokens(supply, 100)).toBe(supply)
    }
  })

  test('result is monotonically increasing with percentage', () => {
    const supply = 1_000_000_000n
    let previous = 0n
    for (let percent = 0; percent <= 100; percent += 0.1) {
      const result = percentToTokens(supply, percent)
      expect(result).toBeGreaterThanOrEqual(previous)
      previous = result
    }
  })

  test('result scales linearly (within rounding tolerance)', () => {
    const supply = 1_000_000_000n
    const p1 = 10
    const p2 = 20
    const result1 = percentToTokens(supply, p1)
    const result2 = percentToTokens(supply, p2)
    // result2 should be approximately 2x result1 (within rounding error)
    expect(result2).toBe(result1 * 2n)
  })
})

// tokensToWei - DECIMAL CONVERSION

describe('tokensToWei - Standard Decimals', () => {
  test('1 token with 18 decimals', () => {
    expect(tokensToWei(1n, 18)).toBe(10n ** 18n)
  })

  test('100 tokens with 18 decimals', () => {
    expect(tokensToWei(100n, 18)).toBe(100n * 10n ** 18n)
  })

  test('1 million tokens with 18 decimals', () => {
    const expected = 1_000_000n * 10n ** 18n
    expect(tokensToWei(1_000_000n, 18)).toBe(expected)
  })

  test('default decimals is 18', () => {
    expect(tokensToWei(1n)).toBe(10n ** 18n)
  })
})

describe('tokensToWei - Various Decimals', () => {
  test('Solana tokens (9 decimals)', () => {
    expect(tokensToWei(1n, 9)).toBe(10n ** 9n)
    expect(tokensToWei(1n, 9)).toBe(1_000_000_000n)
  })

  test('USDC-like (6 decimals)', () => {
    expect(tokensToWei(1n, 6)).toBe(1_000_000n)
    expect(tokensToWei(100n, 6)).toBe(100_000_000n)
  })

  test('8 decimals (like BTC)', () => {
    expect(tokensToWei(1n, 8)).toBe(100_000_000n)
  })

  test('0 decimals (whole tokens)', () => {
    expect(tokensToWei(100n, 0)).toBe(100n)
  })
})

describe('tokensToWei - Edge Cases', () => {
  test('zero tokens returns zero', () => {
    expect(tokensToWei(0n, 18)).toBe(0n)
    expect(tokensToWei(0n, 6)).toBe(0n)
    expect(tokensToWei(0n, 0)).toBe(0n)
  })

  test('large token amounts', () => {
    const billion = 1_000_000_000n
    const result = tokensToWei(billion, 18)
    expect(result).toBe(billion * 10n ** 18n)
  })

  test('maximum practical decimals (18)', () => {
    const result = tokensToWei(1n, 18)
    expect(result.toString()).toBe('1000000000000000000')
  })
})

// weiToTokens - REVERSE CONVERSION

describe('weiToTokens - Standard Conversions', () => {
  test('1e18 wei equals 1 token', () => {
    expect(weiToTokens(10n ** 18n, 18)).toBe(1n)
  })

  test('1e18 wei with default decimals', () => {
    expect(weiToTokens(10n ** 18n)).toBe(1n)
  })

  test('100e18 wei equals 100 tokens', () => {
    expect(weiToTokens(100n * 10n ** 18n, 18)).toBe(100n)
  })
})

describe('weiToTokens - Various Decimals', () => {
  test('1e9 wei equals 1 token (Solana)', () => {
    expect(weiToTokens(10n ** 9n, 9)).toBe(1n)
  })

  test('1e6 wei equals 1 token (USDC)', () => {
    expect(weiToTokens(1_000_000n, 6)).toBe(1n)
  })

  test('0 decimals', () => {
    expect(weiToTokens(100n, 0)).toBe(100n)
  })
})

describe('weiToTokens - Truncation Behavior', () => {
  test('fractional tokens are truncated', () => {
    // 1.5 tokens in wei (1.5e18)
    const oneAndHalf = 15n * 10n ** 17n
    expect(weiToTokens(oneAndHalf, 18)).toBe(1n)
  })

  test('sub-token amounts return 0', () => {
    expect(weiToTokens(10n ** 17n, 18)).toBe(0n)
    expect(weiToTokens(1n, 18)).toBe(0n)
  })
})

describe('weiToTokens/tokensToWei - Round Trip', () => {
  test('round trip preserves whole tokens', () => {
    const tokens = 12345n
    const decimals = 18
    const wei = tokensToWei(tokens, decimals)
    const recovered = weiToTokens(wei, decimals)
    expect(recovered).toBe(tokens)
  })

  test('round trip for various decimals', () => {
    const testCases: [bigint, number][] = [
      [100n, 18],
      [1_000_000n, 18],
      [100n, 9],
      [100n, 6],
      [100n, 0],
    ]

    for (const [tokens, decimals] of testCases) {
      const wei = tokensToWei(tokens, decimals)
      const recovered = weiToTokens(wei, decimals)
      expect(recovered).toBe(tokens)
    }
  })

  test('property: tokensToWei then weiToTokens equals original', () => {
    const randomTokens = Array.from({ length: 50 }, () =>
      BigInt(Math.floor(Math.random() * 1e12)),
    )

    for (const tokens of randomTokens) {
      for (const decimals of [6, 8, 9, 18]) {
        const wei = tokensToWei(tokens, decimals)
        const recovered = weiToTokens(wei, decimals)
        expect(recovered).toBe(tokens)
      }
    }
  })
})

// formatTokens - DISPLAY FORMATTING

describe('formatTokens - Millions', () => {
  test('formats exactly 1 million', () => {
    expect(formatTokens(1_000_000n)).toBe('1.0M')
  })

  test('formats 10 million', () => {
    expect(formatTokens(10_000_000n)).toBe('10.0M')
  })

  test('formats 1.5 million', () => {
    expect(formatTokens(1_500_000n)).toBe('1.5M')
  })

  test('formats 100 million', () => {
    expect(formatTokens(100_000_000n)).toBe('100.0M')
  })

  test('formats 1 billion', () => {
    expect(formatTokens(1_000_000_000n)).toBe('1000.0M')
  })
})

describe('formatTokens - Thousands', () => {
  test('formats exactly 1 thousand', () => {
    expect(formatTokens(1_000n)).toBe('1.0K')
  })

  test('formats 10 thousand', () => {
    expect(formatTokens(10_000n)).toBe('10.0K')
  })

  test('formats 500 thousand', () => {
    expect(formatTokens(500_000n)).toBe('500.0K')
  })

  test('formats 999 thousand (just under 1M)', () => {
    expect(formatTokens(999_000n)).toBe('999.0K')
  })
})

describe('formatTokens - Small Numbers', () => {
  test('formats numbers under 1000 as-is', () => {
    expect(formatTokens(999n)).toBe('999')
    expect(formatTokens(100n)).toBe('100')
    expect(formatTokens(1n)).toBe('1')
    expect(formatTokens(0n)).toBe('0')
  })
})

describe('formatTokens - Edge Cases', () => {
  test('formats zero', () => {
    expect(formatTokens(0n)).toBe('0')
  })

  test('boundary at 1000', () => {
    expect(formatTokens(999n)).toBe('999')
    expect(formatTokens(1000n)).toBe('1.0K')
  })

  test('boundary at 1 million', () => {
    // 999,999 displays as 999.9K (exact bigint division, no rounding)
    expect(formatTokens(999_999n)).toBe('999.9K')
    expect(formatTokens(1_000_000n)).toBe('1.0M')
  })
})

// formatWei - WEI DISPLAY FORMATTING

describe('formatWei - Standard Formatting', () => {
  test('formats 1 ETH (1e18 wei)', () => {
    const result = formatWei(10n ** 18n, 18, 4)
    expect(result).toBe('1.0000')
  })

  test('formats 0.5 ETH', () => {
    const result = formatWei(5n * 10n ** 17n, 18, 4)
    expect(result).toBe('0.5000')
  })

  test('formats 100 ETH', () => {
    const result = formatWei(100n * 10n ** 18n, 18, 4)
    expect(result).toBe('100.0000')
  })
})

describe('formatWei - Precision Control', () => {
  test('2 decimal places', () => {
    const result = formatWei(10n ** 18n, 18, 2)
    expect(result).toBe('1.00')
  })

  test('0 decimal places', () => {
    const result = formatWei(10n ** 18n, 18, 0)
    expect(result).toBe('1')
  })

  test('8 decimal places', () => {
    const result = formatWei(10n ** 18n, 18, 8)
    expect(result).toBe('1.00000000')
  })

  test('default is 4 decimal places', () => {
    const result = formatWei(10n ** 18n)
    expect(result).toBe('1.0000')
  })
})

describe('formatWei - Various Token Decimals', () => {
  test('USDC format (6 decimals)', () => {
    const result = formatWei(1_000_000n, 6, 2)
    expect(result).toBe('1.00')
  })

  test('Solana format (9 decimals)', () => {
    const result = formatWei(10n ** 9n, 9, 4)
    expect(result).toBe('1.0000')
  })
})

// calculateVestingSchedule - COMPLEX FINANCIAL LOGIC

describe('calculateVestingSchedule - Basic Cases', () => {
  test('100% TGE unlock', () => {
    const schedule: VestingSchedule = {
      cliffDuration: 0,
      vestingDuration: 0,
      tgeUnlockPercent: 100,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 1_000_000n)

    expect(result.length).toBe(1)
    expect(result[0].month).toBe(0)
    expect(result[0].unlocked).toBe(1_000_000n)
    expect(result[0].cumulative).toBe(1_000_000n)
  })

  test('0% TGE, 12 month cliff, 12 month vesting', () => {
    const schedule: VestingSchedule = {
      cliffDuration: ONE_YEAR, // 12 months
      vestingDuration: ONE_YEAR, // 12 months
      tgeUnlockPercent: 0,
      vestingType: 'linear',
    }
    const totalAmount = 1_200_000n
    const result = calculateVestingSchedule(schedule, totalAmount)

    // 12 months cliff + 12 months vesting = 24 entries (no TGE entry since 0%)
    expect(result.length).toBe(24)

    // First 12 months (cliff): 0 unlocked
    for (let i = 0; i < 12; i++) {
      expect(result[i].month).toBe(i + 1)
      expect(result[i].unlocked).toBe(0n)
      expect(result[i].cumulative).toBe(0n)
    }

    // Months 13-24: 100K per month
    for (let i = 12; i < 24; i++) {
      expect(result[i].unlocked).toBe(100_000n)
    }

    // Final cumulative should equal total
    expect(result[23].cumulative).toBe(totalAmount)
  })

  test('10% TGE, 6 month cliff, 12 month vesting', () => {
    const schedule: VestingSchedule = {
      cliffDuration: 6 * ONE_MONTH,
      vestingDuration: 12 * ONE_MONTH,
      tgeUnlockPercent: 10,
      vestingType: 'linear',
    }
    const totalAmount = 1_000_000n
    const result = calculateVestingSchedule(schedule, totalAmount)

    // TGE: 10% = 100,000
    expect(result[0].month).toBe(0)
    expect(result[0].unlocked).toBe(100_000n)

    // Cliff months (1-6): no unlocks
    for (let i = 1; i <= 6; i++) {
      const entry = result.find((e) => e.month === i)
      expect(entry?.unlocked).toBe(0n)
    }

    // Vesting months (7-18): 900,000 / 12 = 75,000 per month
    for (let i = 7; i <= 18; i++) {
      const entry = result.find((e) => e.month === i)
      expect(entry?.unlocked).toBe(75_000n)
    }
  })
})

describe('calculateVestingSchedule - Edge Cases', () => {
  test('zero total amount', () => {
    const schedule: VestingSchedule = {
      cliffDuration: ONE_MONTH,
      vestingDuration: ONE_MONTH,
      tgeUnlockPercent: 10,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 0n)

    // TGE of 0 should not add an entry
    expect(result[0].unlocked ?? 0n).toBe(0n)
  })

  test('100% TGE with vesting period (all unlocked at TGE)', () => {
    const schedule: VestingSchedule = {
      cliffDuration: ONE_YEAR,
      vestingDuration: ONE_YEAR,
      tgeUnlockPercent: 100,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 1_000_000n)

    // TGE unlocks everything
    expect(result[0].unlocked).toBe(1_000_000n)

    // Vesting period has 0 to distribute
    const vestingEntries = result.filter((e) => e.month > 12)
    for (const entry of vestingEntries) {
      expect(entry.unlocked).toBe(0n)
    }
  })

  test('very long vesting (5 years)', () => {
    const schedule: VestingSchedule = {
      cliffDuration: ONE_YEAR,
      vestingDuration: 5 * ONE_YEAR,
      tgeUnlockPercent: 0,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 60_000_000n)

    // 12 cliff + 60 vesting = 72 months
    expect(result.length).toBe(72)

    // Monthly unlock = 60M / 60 = 1M per month
    const vestingEntries = result.filter((e) => e.month > 12)
    for (const entry of vestingEntries) {
      expect(entry.unlocked).toBe(1_000_000n)
    }
  })

  test('no cliff, immediate vesting', () => {
    const schedule: VestingSchedule = {
      cliffDuration: 0,
      vestingDuration: 12 * ONE_MONTH,
      tgeUnlockPercent: 0,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 1_200_000n)

    // No TGE entry (0%), 12 vesting months
    expect(result.length).toBe(12)
    expect(result[0].month).toBe(1)

    // Each month: 100K
    for (const entry of result) {
      expect(entry.unlocked).toBe(100_000n)
    }
  })
})

describe('calculateVestingSchedule - Mathematical Properties', () => {
  test('cumulative always increases or stays same', () => {
    const schedule: VestingSchedule = {
      cliffDuration: 3 * ONE_MONTH,
      vestingDuration: 12 * ONE_MONTH,
      tgeUnlockPercent: 5,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 1_000_000n)

    let prevCumulative = 0n
    for (const entry of result) {
      expect(entry.cumulative).toBeGreaterThanOrEqual(prevCumulative)
      prevCumulative = entry.cumulative
    }
  })

  test('final cumulative equals total amount', () => {
    const testCases: [VestingSchedule, bigint][] = [
      [
        {
          cliffDuration: 0,
          vestingDuration: ONE_YEAR,
          tgeUnlockPercent: 10,
          vestingType: 'linear' as const,
        },
        1_000_000n,
      ],
      [
        {
          cliffDuration: 6 * ONE_MONTH,
          vestingDuration: 2 * ONE_YEAR,
          tgeUnlockPercent: 0,
          vestingType: 'linear' as const,
        },
        2_400_000n,
      ],
      [
        {
          cliffDuration: ONE_YEAR,
          vestingDuration: ONE_YEAR,
          tgeUnlockPercent: 20,
          vestingType: 'linear' as const,
        },
        1_200_000n,
      ],
    ]

    for (const [schedule, total] of testCases) {
      const result = calculateVestingSchedule(schedule, total)
      const finalEntry = result[result.length - 1]
      // May have rounding differences due to integer division
      expect(finalEntry.cumulative).toBeLessThanOrEqual(total)
      // Should be within 1% of total due to rounding
      const diff = total - finalEntry.cumulative
      expect(Number(diff)).toBeLessThan(Number(total) * 0.01)
    }
  })

  test('unlocked amounts are non-negative', () => {
    const schedule: VestingSchedule = {
      cliffDuration: 6 * ONE_MONTH,
      vestingDuration: 24 * ONE_MONTH,
      tgeUnlockPercent: 15,
      vestingType: 'linear',
    }
    const result = calculateVestingSchedule(schedule, 10_000_000n)

    for (const entry of result) {
      expect(entry.unlocked).toBeGreaterThanOrEqual(0n)
    }
  })
})

// FEE DISTRIBUTION VALIDATION

describe('validateFeeDistribution - Valid Cases', () => {
  test('accepts default fee distribution', () => {
    expect(() =>
      validateFeeDistribution(DEFAULT_FEE_DISTRIBUTION),
    ).not.toThrow()
  })

  test('accepts distribution summing to 100', () => {
    const distribution: FeeDistribution = {
      holders: 50,
      creators: 20,
      treasury: 15,
      liquidityProviders: 10,
      burn: 5,
    }
    expect(() => validateFeeDistribution(distribution)).not.toThrow()
  })

  test('accepts all-burn distribution', () => {
    const distribution: FeeDistribution = {
      holders: 0,
      creators: 0,
      treasury: 0,
      liquidityProviders: 0,
      burn: 100,
    }
    expect(() => validateFeeDistribution(distribution)).not.toThrow()
  })

  test('accepts even split', () => {
    const distribution: FeeDistribution = {
      holders: 20,
      creators: 20,
      treasury: 20,
      liquidityProviders: 20,
      burn: 20,
    }
    expect(() => validateFeeDistribution(distribution)).not.toThrow()
  })
})

describe('validateFeeDistribution - Invalid Cases', () => {
  test('rejects distribution summing to less than 100', () => {
    const distribution: FeeDistribution = {
      holders: 40,
      creators: 20,
      treasury: 20,
      liquidityProviders: 10,
      burn: 5, // Sum = 95
    }
    expect(() => validateFeeDistribution(distribution)).toThrow(ValidationError)
  })

  test('rejects distribution summing to more than 100', () => {
    const distribution: FeeDistribution = {
      holders: 40,
      creators: 25,
      treasury: 20,
      liquidityProviders: 10,
      burn: 10, // Sum = 105
    }
    expect(() => validateFeeDistribution(distribution)).toThrow(ValidationError)
  })

  test('rejects negative values', () => {
    const distribution = {
      holders: -10,
      creators: 50,
      treasury: 30,
      liquidityProviders: 20,
      burn: 10,
    } as FeeDistribution
    expect(() => validateFeeDistribution(distribution)).toThrow(ValidationError)
  })

  test('rejects values over 100', () => {
    const distribution = {
      holders: 150,
      creators: -50,
      treasury: 0,
      liquidityProviders: 0,
      burn: 0,
    } as FeeDistribution
    expect(() => validateFeeDistribution(distribution)).toThrow(ValidationError)
  })
})

// TOKEN ALLOCATION VALIDATION

describe('validateAllocation - Valid Cases', () => {
  test('accepts valid allocation summing to 100', () => {
    const allocation: TokenAllocation = {
      publicSale: 30,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 25,
      liquidity: 10,
      stakingRewards: 5,
    }
    expect(() => validateAllocation(allocation)).not.toThrow()
  })

  test('accepts allocation with zeros', () => {
    const allocation: TokenAllocation = {
      publicSale: 100,
      presale: 0,
      team: 0,
      advisors: 0,
      ecosystem: 0,
      liquidity: 0,
      stakingRewards: 0,
    }
    expect(() => validateAllocation(allocation)).not.toThrow()
  })

  test('accepts fractional percentages that sum to 100', () => {
    const allocation: TokenAllocation = {
      publicSale: 33.33,
      presale: 16.67,
      team: 10,
      advisors: 5,
      ecosystem: 20,
      liquidity: 10,
      stakingRewards: 5,
    }
    expect(() => validateAllocation(allocation)).not.toThrow()
  })
})

describe('validateAllocation - Invalid Cases', () => {
  test('rejects allocation summing to less than 100', () => {
    const allocation: TokenAllocation = {
      publicSale: 25,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 20,
      liquidity: 10,
      stakingRewards: 5, // Sum = 90
    }
    expect(() => validateAllocation(allocation)).toThrow(ValidationError)
  })

  test('rejects allocation summing to more than 100', () => {
    const allocation: TokenAllocation = {
      publicSale: 35,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 25,
      liquidity: 10,
      stakingRewards: 5, // Sum = 105
    }
    expect(() => validateAllocation(allocation)).toThrow(ValidationError)
  })
})

// createTokenEconomics

describe('createTokenEconomics - Factory Function', () => {
  const validAllocation: TokenAllocation = {
    publicSale: 30,
    presale: 10,
    team: 15,
    advisors: 5,
    ecosystem: 25,
    liquidity: 10,
    stakingRewards: 5,
  }

  const validVesting: VestingConfig = {
    team: {
      cliffDuration: ONE_YEAR,
      vestingDuration: 3 * ONE_YEAR,
      tgeUnlockPercent: 0,
      vestingType: 'linear',
    },
    advisors: {
      cliffDuration: 6 * ONE_MONTH,
      vestingDuration: 2 * ONE_YEAR,
      tgeUnlockPercent: 0,
      vestingType: 'linear',
    },
    presale: {
      cliffDuration: 3 * ONE_MONTH,
      vestingDuration: ONE_YEAR,
      tgeUnlockPercent: 10,
      vestingType: 'linear',
    },
    ecosystem: {
      cliffDuration: 0,
      vestingDuration: 4 * ONE_YEAR,
      tgeUnlockPercent: 5,
      vestingType: 'linear',
    },
  }

  test('creates token economics with defaults', () => {
    const result = createTokenEconomics(
      'Test Token',
      'TEST',
      1_000_000_000n,
      validAllocation,
      validVesting,
    )

    expect(result.name).toBe('Test Token')
    expect(result.symbol).toBe('TEST')
    expect(result.totalSupply).toBe(1_000_000_000n)
    expect(result.decimals).toBe(18)
    expect(result.fees.transferFeeBps).toBe(0)
    expect(result.fees.swapFeeBps).toBe(30)
    expect(result.maxWalletPercent).toBe(0)
    expect(result.maxTxPercent).toBe(0)
  })

  test('creates token economics with custom options', () => {
    const result = createTokenEconomics(
      'Custom Token',
      'CUST',
      500_000_000n,
      validAllocation,
      validVesting,
      DEFAULT_FEE_DISTRIBUTION,
      {
        decimals: 9,
        transferFeeBps: 100,
        bridgeFeeBps: 50,
        swapFeeBps: 25,
        maxWalletPercent: 5,
        maxTxPercent: 1,
        feeExemptAddresses: [
          '0x1234567890123456789012345678901234567890' as Address,
        ],
      },
    )

    expect(result.decimals).toBe(9)
    expect(result.fees.transferFeeBps).toBe(100)
    expect(result.fees.bridgeFeeBps).toBe(50)
    expect(result.fees.swapFeeBps).toBe(25)
    expect(result.maxWalletPercent).toBe(5)
    expect(result.maxTxPercent).toBe(1)
    expect(result.fees.feeExemptAddresses.length).toBe(1)
  })

  test('uses default fee distribution when not specified', () => {
    const result = createTokenEconomics(
      'Test',
      'TST',
      1_000_000n,
      validAllocation,
      validVesting,
    )

    expect(result.fees.distribution).toEqual(DEFAULT_FEE_DISTRIBUTION)
  })
})

// validateTokenEconomicsConfig - FULL VALIDATION

describe('validateTokenEconomicsConfig', () => {
  const validConfig: TokenEconomics = {
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 18,
    totalSupply: 1_000_000_000n,
    allocation: {
      publicSale: 30,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 25,
      liquidity: 10,
      stakingRewards: 5,
    },
    vesting: {
      team: {
        cliffDuration: ONE_YEAR,
        vestingDuration: 3 * ONE_YEAR,
        tgeUnlockPercent: 0,
        vestingType: 'linear',
      },
      advisors: {
        cliffDuration: 6 * ONE_MONTH,
        vestingDuration: 2 * ONE_YEAR,
        tgeUnlockPercent: 0,
        vestingType: 'linear',
      },
      presale: {
        cliffDuration: 3 * ONE_MONTH,
        vestingDuration: ONE_YEAR,
        tgeUnlockPercent: 10,
        vestingType: 'linear',
      },
      ecosystem: {
        cliffDuration: 0,
        vestingDuration: 4 * ONE_YEAR,
        tgeUnlockPercent: 5,
        vestingType: 'linear',
      },
    },
    fees: {
      transferFeeBps: 0,
      bridgeFeeBps: 50,
      swapFeeBps: 30,
      distribution: DEFAULT_FEE_DISTRIBUTION,
      feeExemptAddresses: [],
    },
    maxWalletPercent: 0,
    maxTxPercent: 0,
  }

  test('accepts valid configuration', () => {
    expect(() => validateTokenEconomicsConfig(validConfig)).not.toThrow()
  })

  test('rejects empty name', () => {
    const invalid = { ...validConfig, name: '' }
    expect(() => validateTokenEconomicsConfig(invalid)).toThrow(ValidationError)
  })

  test('rejects symbol too long', () => {
    const invalid = { ...validConfig, symbol: 'THISSYMBOLISTOOLONG' }
    expect(() => validateTokenEconomicsConfig(invalid)).toThrow(ValidationError)
  })

  test('rejects invalid decimals', () => {
    const invalid = { ...validConfig, decimals: 20 }
    expect(() => validateTokenEconomicsConfig(invalid)).toThrow(ValidationError)
  })

  test('rejects zero total supply', () => {
    const invalid = { ...validConfig, totalSupply: 0n }
    expect(() => validateTokenEconomicsConfig(invalid)).toThrow(ValidationError)
  })

  test('rejects allocation not summing to 100', () => {
    const invalid = {
      ...validConfig,
      allocation: { ...validConfig.allocation, publicSale: 20 }, // Sum now 90
    }
    expect(() => validateTokenEconomicsConfig(invalid)).toThrow(ValidationError)
  })

  test('rejects fee distribution not summing to 100', () => {
    const invalid = {
      ...validConfig,
      fees: {
        ...validConfig.fees,
        distribution: { ...DEFAULT_FEE_DISTRIBUTION, burn: 5 }, // Sum now 95
      },
    }
    expect(() => validateTokenEconomicsConfig(invalid)).toThrow(ValidationError)
  })
})

// DEFAULT_FEE_DISTRIBUTION

describe('DEFAULT_FEE_DISTRIBUTION', () => {
  test('sums to 100%', () => {
    const total = Object.values(DEFAULT_FEE_DISTRIBUTION).reduce(
      (sum, val) => sum + val,
      0,
    )
    expect(total).toBe(100)
  })

  test('has expected categories', () => {
    expect(DEFAULT_FEE_DISTRIBUTION.holders).toBeDefined()
    expect(DEFAULT_FEE_DISTRIBUTION.creators).toBeDefined()
    expect(DEFAULT_FEE_DISTRIBUTION.treasury).toBeDefined()
    expect(DEFAULT_FEE_DISTRIBUTION.liquidityProviders).toBeDefined()
    expect(DEFAULT_FEE_DISTRIBUTION.burn).toBeDefined()
  })

  test('all values are non-negative', () => {
    for (const value of Object.values(DEFAULT_FEE_DISTRIBUTION)) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  test('passes validation', () => {
    expect(() =>
      validateFeeDistribution(DEFAULT_FEE_DISTRIBUTION),
    ).not.toThrow()
  })
})
