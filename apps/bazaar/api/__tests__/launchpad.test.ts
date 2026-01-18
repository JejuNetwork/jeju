/**
 * Unit tests for launchpad business logic
 * Tests bonding curve calculations, ICO logic, and validation
 */

import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'
import {
  // Schemas
  BondingCurveConfigSchema,
  calculateBuyPriceImpact,
  calculateEthOut,
  calculateGraduationMarketCap,
  calculateGraduationProgress,
  calculateInitialMarketCap,
  // Bonding curve calculations
  calculateInitialPrice,
  calculateLPAllocation,
  calculatePresaleTokens,
  // ICO calculations
  calculateTokenAllocation,
  calculateTokensOut,
  canClaimRefund,
  canClaimTokens,
  // Presets
  DEFAULT_BONDING_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_ICO_CONFIG,
  formatBasisPoints,
  formatDuration,
  formatEthAmount,
  // Formatting
  formatPrice,
  ICOConfigSchema,
  type PresaleStatus,
  parseBondingCurveStats,
  parsePresaleStatus,
  parseUserContribution,
  type UserContribution,
  // Validation
  validateBondingCurveLaunch,
  validateICOLaunch,
} from '../../lib/launchpad'

// BONDING CURVE CALCULATION TESTS

describe('calculateInitialPrice', () => {
  test('calculates correct initial price', () => {
    const config = {
      virtualEthReserves: '30',
      graduationTarget: '10',
      tokenSupply: '1000000000',
    }

    const price = calculateInitialPrice(config)
    expect(price).toBe(30 / 1000000000)
    expect(price).toBe(3e-8)
  })

  test('handles small supply', () => {
    const config = {
      virtualEthReserves: '1',
      graduationTarget: '1',
      tokenSupply: '1000',
    }

    const price = calculateInitialPrice(config)
    expect(price).toBe(0.001)
  })

  test('handles large reserves', () => {
    const config = {
      virtualEthReserves: '100',
      graduationTarget: '50',
      tokenSupply: '1000000000',
    }

    const price = calculateInitialPrice(config)
    expect(price).toBe(100 / 1000000000)
  })
})

describe('calculateInitialMarketCap', () => {
  test('returns virtual eth reserves as market cap', () => {
    const config = {
      virtualEthReserves: '30',
      graduationTarget: '10',
      tokenSupply: '1000000000',
    }

    expect(calculateInitialMarketCap(config)).toBe(30)
  })

  test('handles decimal values', () => {
    const config = {
      virtualEthReserves: '15.5',
      graduationTarget: '10',
      tokenSupply: '1000000000',
    }

    expect(calculateInitialMarketCap(config)).toBe(15.5)
  })
})

describe('calculateGraduationMarketCap', () => {
  test('calculates graduation market cap correctly', () => {
    const config = {
      virtualEthReserves: '30',
      graduationTarget: '10',
      tokenSupply: '1000000000',
    }

    expect(calculateGraduationMarketCap(config)).toBe(40)
  })

  test('handles large targets', () => {
    const config = {
      virtualEthReserves: '50',
      graduationTarget: '100',
      tokenSupply: '1000000000',
    }

    expect(calculateGraduationMarketCap(config)).toBe(150)
  })
})

describe('calculateBuyPriceImpact', () => {
  test('calculates price impact for small buy', () => {
    const impact = calculateBuyPriceImpact(1, 30, 1000000000)

    // Small buy should have small impact
    expect(impact).toBeGreaterThan(0)
    expect(impact).toBeLessThan(10)
  })

  test('calculates price impact for large buy', () => {
    const smallBuy = calculateBuyPriceImpact(1, 30, 1000000000)
    const largeBuy = calculateBuyPriceImpact(10, 30, 1000000000)

    // Larger buy should have larger impact
    expect(largeBuy).toBeGreaterThan(smallBuy)
  })

  test('returns 0 for zero amount', () => {
    expect(calculateBuyPriceImpact(0, 30, 1000000000)).toBe(0)
  })

  test('returns 0 for invalid reserves', () => {
    expect(calculateBuyPriceImpact(1, 0, 1000000000)).toBe(0)
    expect(calculateBuyPriceImpact(1, 30, 0)).toBe(0)
    expect(calculateBuyPriceImpact(1, -1, 1000000000)).toBe(0)
  })
})

describe('calculateTokensOut', () => {
  test('calculates tokens for buy order', () => {
    const tokens = calculateTokensOut(1, 30, 1000000000)

    // Should get approximately 1/30 of the supply for 1 ETH
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(1000000000)
  })

  test('larger buy gets less tokens per ETH (slippage)', () => {
    const smallBuy = calculateTokensOut(1, 30, 1000000000)
    const largeBuy = calculateTokensOut(10, 30, 1000000000)

    // Tokens per ETH should decrease with larger buys
    expect(smallBuy).toBeGreaterThan(0)
    expect(largeBuy / 10).toBeLessThan(smallBuy)
  })

  test('returns 0 for invalid inputs', () => {
    expect(calculateTokensOut(0, 30, 1000000000)).toBe(0)
    expect(calculateTokensOut(-1, 30, 1000000000)).toBe(0)
    expect(calculateTokensOut(1, 0, 1000000000)).toBe(0)
  })
})

describe('calculateEthOut', () => {
  test('calculates ETH for sell order', () => {
    const eth = calculateEthOut(10000000, 30, 1000000000)

    expect(eth).toBeGreaterThan(0)
    expect(eth).toBeLessThan(30)
  })

  test('larger sell gets less ETH per token (slippage)', () => {
    const smallSell = calculateEthOut(1000000, 30, 1000000000)
    const largeSell = calculateEthOut(100000000, 30, 1000000000)

    // ETH per token should decrease with larger sells
    expect(smallSell).toBeGreaterThan(0)
    expect(largeSell / 100).toBeLessThan(smallSell)
  })

  test('returns 0 for invalid inputs', () => {
    expect(calculateEthOut(0, 30, 1000000000)).toBe(0)
    expect(calculateEthOut(-1, 30, 1000000000)).toBe(0)
  })
})

describe('calculateGraduationProgress', () => {
  test('calculates 0% for no ETH collected', () => {
    expect(calculateGraduationProgress(0, 10)).toBe(0)
  })

  test('calculates 50% at halfway', () => {
    expect(calculateGraduationProgress(5, 10)).toBe(50)
  })

  test('calculates 100% at target', () => {
    expect(calculateGraduationProgress(10, 10)).toBe(100)
  })

  test('caps at 100% for over target', () => {
    expect(calculateGraduationProgress(15, 10)).toBe(100)
  })

  test('returns 0 for zero target', () => {
    expect(calculateGraduationProgress(5, 0)).toBe(0)
  })
})

describe('parseBondingCurveStats', () => {
  test('parses contract response correctly', () => {
    const data: readonly [bigint, bigint, bigint, bigint, boolean] = [
      parseEther('0.0001'),
      5000n,
      parseEther('5'),
      parseEther('500000000'),
      false,
    ]

    const stats = parseBondingCurveStats(data)

    expect(stats.price).toBe(parseEther('0.0001'))
    expect(stats.progress).toBe(5000)
    expect(stats.ethCollected).toBe(parseEther('5'))
    expect(stats.tokensRemaining).toBe(parseEther('500000000'))
    expect(stats.graduated).toBe(false)
    expect(stats.marketCap).toBe(0n)
  })

  test('handles graduated curve', () => {
    const data: readonly [bigint, bigint, bigint, bigint, boolean] = [
      parseEther('0.001'),
      10000n,
      parseEther('10'),
      0n,
      true,
    ]

    const stats = parseBondingCurveStats(data)
    expect(stats.graduated).toBe(true)
    expect(stats.progress).toBe(10000)
  })
})

// ICO CALCULATION TESTS

describe('calculateTokenAllocation', () => {
  test('calculates correct token allocation', () => {
    const tokens = calculateTokenAllocation(1, 0.0001)
    expect(tokens).toBe(10000)
  })

  test('handles larger contributions', () => {
    const tokens = calculateTokenAllocation(10, 0.0001)
    expect(tokens).toBe(100000)
  })

  test('returns 0 for zero contribution', () => {
    expect(calculateTokenAllocation(0, 0.0001)).toBe(0)
  })

  test('returns 0 for zero price', () => {
    expect(calculateTokenAllocation(1, 0)).toBe(0)
  })
})

describe('calculatePresaleTokens', () => {
  test('calculates 30% allocation', () => {
    const tokens = calculatePresaleTokens(1000000000, 3000)
    expect(tokens).toBe(300000000)
  })

  test('calculates 15% allocation', () => {
    const tokens = calculatePresaleTokens(1000000000, 1500)
    expect(tokens).toBe(150000000)
  })

  test('handles 100% allocation', () => {
    const tokens = calculatePresaleTokens(1000000000, 10000)
    expect(tokens).toBe(1000000000)
  })
})

describe('calculateLPAllocation', () => {
  test('calculates 80% LP funding', () => {
    const lp = calculateLPAllocation(10, 8000)
    expect(lp).toBe(8)
  })

  test('calculates 90% LP funding', () => {
    const lp = calculateLPAllocation(10, 9000)
    expect(lp).toBe(9)
  })
})

describe('canClaimTokens', () => {
  const finalized: PresaleStatus = {
    raised: parseEther('10'),
    participants: 100n,
    progress: 10000,
    timeRemaining: 0n,
    isActive: false,
    isFinalized: true,
    isFailed: false,
  }

  const contribution: UserContribution = {
    ethAmount: parseEther('1'),
    tokenAllocation: parseEther('10000'),
    claimedTokens: 0n,
    claimable: parseEther('10000'),
    isRefunded: false,
  }

  test('returns true when all conditions met', () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const claimStart = now - 3600n

    expect(canClaimTokens(finalized, contribution, claimStart, now)).toBe(true)
  })

  test('returns false when not finalized', () => {
    const status = { ...finalized, isFinalized: false }
    const now = BigInt(Math.floor(Date.now() / 1000))

    expect(canClaimTokens(status, contribution, now - 3600n, now)).toBe(false)
  })

  test('returns false when presale failed', () => {
    const status = { ...finalized, isFailed: true }
    const now = BigInt(Math.floor(Date.now() / 1000))

    expect(canClaimTokens(status, contribution, now - 3600n, now)).toBe(false)
  })

  test('returns false when nothing claimable', () => {
    const contrib = { ...contribution, claimable: 0n }
    const now = BigInt(Math.floor(Date.now() / 1000))

    expect(canClaimTokens(finalized, contrib, now - 3600n, now)).toBe(false)
  })

  test('returns false before claim start', () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const claimStart = now + 3600n // Future

    expect(canClaimTokens(finalized, contribution, claimStart, now)).toBe(false)
  })
})

describe('canClaimRefund', () => {
  const failed: PresaleStatus = {
    raised: parseEther('2'),
    participants: 50n,
    progress: 4000,
    timeRemaining: 0n,
    isActive: false,
    isFinalized: true,
    isFailed: true,
  }

  const contribution: UserContribution = {
    ethAmount: parseEther('1'),
    tokenAllocation: parseEther('10000'),
    claimedTokens: 0n,
    claimable: 0n,
    isRefunded: false,
  }

  test('returns true when presale failed and not refunded', () => {
    expect(canClaimRefund(failed, contribution)).toBe(true)
  })

  test('returns false when not failed', () => {
    const status = { ...failed, isFailed: false }
    expect(canClaimRefund(status, contribution)).toBe(false)
  })

  test('returns false when already refunded', () => {
    const contrib = { ...contribution, isRefunded: true }
    expect(canClaimRefund(failed, contrib)).toBe(false)
  })

  test('returns false when no contribution', () => {
    const contrib = { ...contribution, ethAmount: 0n }
    expect(canClaimRefund(failed, contrib)).toBe(false)
  })
})

describe('parsePresaleStatus', () => {
  test('parses contract response correctly', () => {
    const data: readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
      boolean,
      boolean,
    ] = [parseEther('10'), 100n, 5000n, 86400n, true, false, false]

    const status = parsePresaleStatus(data)

    expect(status.raised).toBe(parseEther('10'))
    expect(status.participants).toBe(100n)
    expect(status.progress).toBe(5000)
    expect(status.timeRemaining).toBe(86400n)
    expect(status.isActive).toBe(true)
    expect(status.isFinalized).toBe(false)
    expect(status.isFailed).toBe(false)
  })
})

describe('parseUserContribution', () => {
  test('parses contract response correctly', () => {
    const data: readonly [bigint, bigint, bigint, bigint, boolean] = [
      parseEther('1'),
      parseEther('10000'),
      0n,
      parseEther('10000'),
      false,
    ]

    const contrib = parseUserContribution(data)

    expect(contrib.ethAmount).toBe(parseEther('1'))
    expect(contrib.tokenAllocation).toBe(parseEther('10000'))
    expect(contrib.claimedTokens).toBe(0n)
    expect(contrib.claimable).toBe(parseEther('10000'))
    expect(contrib.isRefunded).toBe(false)
  })
})

// FORMATTING TESTS

describe('formatPrice', () => {
  test('formats normal prices', () => {
    const price = parseEther('0.0001')
    expect(formatPrice(price)).toBe('0.00010000')
  })

  test('formats very small prices in exponential', () => {
    const price = 100000000000n // 0.0000001 ETH
    const result = formatPrice(price)
    expect(result).toMatch(/e/)
  })

  test('formats 1 ETH', () => {
    const price = parseEther('1')
    expect(formatPrice(price)).toBe('1.00000000')
  })
})

describe('formatBasisPoints', () => {
  test('formats 0 bps', () => {
    expect(formatBasisPoints(0)).toBe('0.00%')
  })

  test('formats 100%', () => {
    expect(formatBasisPoints(10000)).toBe('100.00%')
  })

  test('formats 50%', () => {
    expect(formatBasisPoints(5000)).toBe('50.00%')
  })

  test('formats fractional percentages', () => {
    expect(formatBasisPoints(1234)).toBe('12.34%')
  })
})

describe('formatDuration', () => {
  test('formats ended', () => {
    expect(formatDuration(0n)).toBe('Ended')
    expect(formatDuration(-100n)).toBe('Ended')
  })

  test('formats minutes', () => {
    expect(formatDuration(1800n)).toBe('30m')
  })

  test('formats hours and minutes', () => {
    expect(formatDuration(9000n)).toBe('2h 30m')
  })

  test('formats days and hours', () => {
    expect(formatDuration(90000n)).toBe('1d 1h')
  })
})

describe('formatEthAmount', () => {
  test('formats small amounts', () => {
    expect(formatEthAmount(parseEther('0.5'))).toBe('0.5000')
  })

  test('formats large amounts with K suffix', () => {
    expect(formatEthAmount(parseEther('1500'))).toBe('1.5K')
  })
})

// VALIDATION TESTS

describe('validateBondingCurveLaunch', () => {
  const validConfig = DEFAULT_BONDING_CONFIG

  test('validates correct params', () => {
    const result = validateBondingCurveLaunch(
      'Test Token',
      'TEST',
      8000,
      validConfig,
    )
    expect(result.valid).toBe(true)
  })

  test('rejects empty name', () => {
    const result = validateBondingCurveLaunch('', 'TEST', 8000, validConfig)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('name')
    }
  })

  test('rejects empty symbol', () => {
    const result = validateBondingCurveLaunch(
      'Test Token',
      '',
      8000,
      validConfig,
    )
    expect(result.valid).toBe(false)
  })

  test('rejects long symbol', () => {
    const result = validateBondingCurveLaunch(
      'Test Token',
      'VERYLONGSYMBOL',
      8000,
      validConfig,
    )
    expect(result.valid).toBe(false)
  })

  test('rejects invalid fee', () => {
    const result = validateBondingCurveLaunch(
      'Test Token',
      'TEST',
      15000,
      validConfig,
    )
    expect(result.valid).toBe(false)
  })

  test('rejects invalid config', () => {
    const badConfig = { ...validConfig, virtualEthReserves: '0' }
    const result = validateBondingCurveLaunch(
      'Test Token',
      'TEST',
      8000,
      badConfig,
    )
    expect(result.valid).toBe(false)
  })
})

describe('validateICOLaunch', () => {
  const validConfig = DEFAULT_ICO_CONFIG

  test('validates correct params', () => {
    const result = validateICOLaunch(
      'Test Token',
      'TEST',
      '1000000000',
      5000,
      validConfig,
    )
    expect(result.valid).toBe(true)
  })

  test('rejects zero supply', () => {
    const result = validateICOLaunch(
      'Test Token',
      'TEST',
      '0',
      5000,
      validConfig,
    )
    expect(result.valid).toBe(false)
  })

  test('rejects hard cap < soft cap', () => {
    const badConfig = { ...validConfig, softCap: '100', hardCap: '50' }
    const result = validateICOLaunch(
      'Test Token',
      'TEST',
      '1000000000',
      5000,
      badConfig,
    )
    expect(result.valid).toBe(false)
  })
})

// SCHEMA TESTS

describe('BondingCurveConfigSchema', () => {
  test('accepts valid config', () => {
    const result = BondingCurveConfigSchema.safeParse(DEFAULT_BONDING_CONFIG)
    expect(result.success).toBe(true)
  })

  test('rejects zero reserves', () => {
    const result = BondingCurveConfigSchema.safeParse({
      virtualEthReserves: '0',
      graduationTarget: '10',
      tokenSupply: '1000000000',
    })
    expect(result.success).toBe(false)
  })

  test('rejects negative values', () => {
    const result = BondingCurveConfigSchema.safeParse({
      virtualEthReserves: '-1',
      graduationTarget: '10',
      tokenSupply: '1000000000',
    })
    expect(result.success).toBe(false)
  })
})

describe('ICOConfigSchema', () => {
  test('accepts valid config', () => {
    const result = ICOConfigSchema.safeParse(DEFAULT_ICO_CONFIG)
    expect(result.success).toBe(true)
  })

  test('accepts degen config', () => {
    const result = ICOConfigSchema.safeParse(DEGEN_ICO_CONFIG)
    expect(result.success).toBe(true)
  })

  test('rejects invalid bps', () => {
    const result = ICOConfigSchema.safeParse({
      ...DEFAULT_ICO_CONFIG,
      presaleAllocationBps: 15000, // > 10000
    })
    expect(result.success).toBe(false)
  })

  test('rejects hard cap < soft cap', () => {
    const result = ICOConfigSchema.safeParse({
      ...DEFAULT_ICO_CONFIG,
      softCap: '100',
      hardCap: '50',
    })
    expect(result.success).toBe(false)
  })
})

// PRESET TESTS

describe('Preset configurations', () => {
  test('DEFAULT_BONDING_CONFIG is valid', () => {
    const result = BondingCurveConfigSchema.safeParse(DEFAULT_BONDING_CONFIG)
    expect(result.success).toBe(true)
  })

  test('DEFAULT_ICO_CONFIG is valid', () => {
    const result = ICOConfigSchema.safeParse(DEFAULT_ICO_CONFIG)
    expect(result.success).toBe(true)
  })

  test('DEGEN_ICO_CONFIG is valid', () => {
    const result = ICOConfigSchema.safeParse(DEGEN_ICO_CONFIG)
    expect(result.success).toBe(true)
  })

  test('DEGEN has shorter presale than DEFAULT', () => {
    expect(DEGEN_ICO_CONFIG.presaleDuration).toBeLessThan(
      DEFAULT_ICO_CONFIG.presaleDuration,
    )
  })

  test('DEGEN has smaller allocation than DEFAULT', () => {
    expect(DEGEN_ICO_CONFIG.presaleAllocationBps).toBeLessThan(
      DEFAULT_ICO_CONFIG.presaleAllocationBps,
    )
  })
})
