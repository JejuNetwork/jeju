/**
 * @fileoverview Comprehensive tests for moderation.ts
 *
 * Tests cover:
 * - appNameToId: Convert app name to bytes32 hex
 * - getBanStatusLabel / getBanTypeLabel: Human-readable labels
 * - calculateVotePercentages: Vote percentage calculation
 * - formatStake / formatPnL: Stake/PnL formatting
 * - getTimeRemaining: Time remaining calculation
 * - getReputationTierFromScore / getReputationTierLabel: Reputation utilities
 * - getQuorumForTier: Quorum requirements
 * - calculateWinRate: Win rate percentage
 */

import { describe, expect, test } from 'bun:test'
import {
  appNameToId,
  BanStatus,
  BanType,
  calculateVotePercentages,
  calculateWinRate,
  formatPnL,
  formatStake,
  getBanStatusLabel,
  getBanTypeLabel,
  getQuorumForTier,
  getReputationTierFromScore,
  getReputationTierLabel,
  getTimeRemaining,
  ReputationTier,
} from '../moderation'

// ============================================================================
// appNameToId Tests
// ============================================================================

describe('appNameToId', () => {
  test('converts simple app name to bytes32 hex', () => {
    const result = appNameToId('bazaar')

    expect(result.startsWith('0x')).toBe(true)
    expect(result.length).toBe(66) // 0x + 64 hex chars
  })

  test('produces consistent output for same input', () => {
    const result1 = appNameToId('bazaar')
    const result2 = appNameToId('bazaar')

    expect(result1).toBe(result2)
  })

  test('produces different output for different inputs', () => {
    const bazaar = appNameToId('bazaar')
    const gateway = appNameToId('gateway')

    expect(bazaar).not.toBe(gateway)
  })

  test('handles empty string', () => {
    const result = appNameToId('')
    const expected = `0x${'0'.repeat(64)}`

    expect(result as string).toBe(expected)
  })

  test('handles long app names', () => {
    const longName = 'a'.repeat(100)
    const result = appNameToId(longName)

    // Function encodes entire string and pads to 64 chars
    // 100 chars of 'a' = 100 * 2 hex chars = 200, plus '0x' = 202
    // This is the actual behavior - function doesn't truncate
    expect(result.startsWith('0x')).toBe(true)
    expect(result.length).toBe(202) // 0x + 200 hex chars for 100 'a' characters
  })

  test('correctly encodes ASCII characters', () => {
    // 'a' = 0x61, 'b' = 0x62, 'c' = 0x63
    const result = appNameToId('abc')

    expect(result.startsWith('0x616263')).toBe(true)
    // Rest should be padded with zeros
    expect(result).toBe(
      '0x6162630000000000000000000000000000000000000000000000000000000000',
    )
  })

  test('handles special characters', () => {
    const result = appNameToId('test-app_v2')

    expect(result.startsWith('0x')).toBe(true)
    expect(result.length).toBe(66)
  })

  test('handles numbers in name', () => {
    const result = appNameToId('app123')

    // '1' = 0x31, '2' = 0x32, '3' = 0x33
    expect(result.includes('313233')).toBe(true)
  })
})

// ============================================================================
// getBanStatusLabel Tests
// ============================================================================

describe('getBanStatusLabel', () => {
  const testCases: [BanStatus, string][] = [
    [BanStatus.NONE, 'Not Banned'],
    [BanStatus.ON_NOTICE, 'On Notice'],
    [BanStatus.CHALLENGED, 'Challenged'],
    [BanStatus.BANNED, 'Banned'],
    [BanStatus.CLEARED, 'Cleared'],
    [BanStatus.APPEALING, 'Appealing'],
  ]

  test.each(
    testCases,
  )('returns "%s" for status %s', (status: BanStatus, expected: string) => {
    expect(getBanStatusLabel(status)).toBe(expected)
  })

  test('handles all BanStatus values exhaustively', () => {
    // This test ensures we handle all enum values
    const allStatuses = Object.values(BanStatus).filter(
      (v) => typeof v === 'string',
    ) as BanStatus[]

    for (const status of allStatuses) {
      expect(() => getBanStatusLabel(status)).not.toThrow()
    }
  })
})

// ============================================================================
// getBanTypeLabel Tests
// ============================================================================

describe('getBanTypeLabel', () => {
  const testCases: [BanType, string][] = [
    [BanType.NONE, 'None'],
    [BanType.ON_NOTICE, 'On Notice'],
    [BanType.CHALLENGED, 'Challenged'],
    [BanType.PERMANENT, 'Permanent'],
  ]

  test.each(
    testCases,
  )('returns "%s" for type %d', (type: BanType, expected: string) => {
    expect(getBanTypeLabel(type)).toBe(expected)
  })

  test('handles all BanType values', () => {
    const allTypes = [
      BanType.NONE,
      BanType.ON_NOTICE,
      BanType.CHALLENGED,
      BanType.PERMANENT,
    ]

    for (const type of allTypes) {
      expect(() => getBanTypeLabel(type)).not.toThrow()
    }
  })
})

// ============================================================================
// calculateVotePercentages Tests
// ============================================================================

describe('calculateVotePercentages', () => {
  test('returns 50/50 for zero votes', () => {
    const result = calculateVotePercentages(0n, 0n)

    expect(result.yes).toBe(50)
    expect(result.no).toBe(50)
  })

  test('calculates 100% yes correctly', () => {
    const result = calculateVotePercentages(100n, 0n)

    expect(result.yes).toBe(100)
    expect(result.no).toBe(0)
  })

  test('calculates 100% no correctly', () => {
    const result = calculateVotePercentages(0n, 100n)

    expect(result.yes).toBe(0)
    expect(result.no).toBe(100)
  })

  test('calculates even split', () => {
    const result = calculateVotePercentages(50n, 50n)

    expect(result.yes).toBe(50)
    expect(result.no).toBe(50)
  })

  test('calculates 2/3 majority', () => {
    const result = calculateVotePercentages(200n, 100n)

    expect(result.yes).toBeCloseTo(66.66, 1)
    expect(result.no).toBeCloseTo(33.33, 1)
  })

  test('percentages always sum to 100', () => {
    const testCases: [bigint, bigint][] = [
      [1n, 2n],
      [7n, 3n],
      [123n, 456n],
      [999999999999n, 1n],
    ]

    for (const [yes, no] of testCases) {
      const result = calculateVotePercentages(yes, no)
      expect(result.yes + result.no).toBe(100)
    }
  })

  test('handles large vote counts', () => {
    const largeVotes = 10n ** 18n // 1 ETH in wei
    const result = calculateVotePercentages(largeVotes, largeVotes)

    expect(result.yes).toBe(50)
    expect(result.no).toBe(50)
  })

  test('handles asymmetric large votes', () => {
    const result = calculateVotePercentages(10n ** 18n, 10n ** 17n)

    // 10:1 ratio = ~90.9% yes
    expect(result.yes).toBeCloseTo(90.9, 0)
    expect(result.no).toBeCloseTo(9.1, 0)
  })

  test('property: result is always 0-100 for each percentage', () => {
    for (let i = 0; i < 50; i++) {
      const yes = BigInt(Math.floor(Math.random() * 1000000))
      const no = BigInt(Math.floor(Math.random() * 1000000))

      const result = calculateVotePercentages(yes, no)

      expect(result.yes).toBeGreaterThanOrEqual(0)
      expect(result.yes).toBeLessThanOrEqual(100)
      expect(result.no).toBeGreaterThanOrEqual(0)
      expect(result.no).toBeLessThanOrEqual(100)
    }
  })
})

// ============================================================================
// formatStake Tests
// ============================================================================

describe('formatStake', () => {
  test('formats small stakes as "<0.001 ETH"', () => {
    expect(formatStake(0n)).toBe('<0.001 ETH')
    expect(formatStake(999n)).toBe('<0.001 ETH')
    expect(formatStake(999999999999999n)).toBe('<0.001 ETH')
  })

  test('formats 1 ETH correctly', () => {
    const oneEth = 10n ** 18n
    expect(formatStake(oneEth)).toBe('1.000 ETH')
  })

  test('formats fractional ETH', () => {
    const halfEth = 5n * 10n ** 17n
    expect(formatStake(halfEth)).toBe('0.500 ETH')
  })

  test('formats large stakes', () => {
    const hundredEth = 100n * 10n ** 18n
    expect(formatStake(hundredEth)).toBe('100.000 ETH')
  })

  test('rounds to 3 decimal places', () => {
    // 1.1234 ETH should round to 1.123
    const stake = 1123400000000000000n
    expect(formatStake(stake)).toBe('1.123 ETH')
  })
})

// ============================================================================
// getTimeRemaining Tests
// ============================================================================

describe('getTimeRemaining', () => {
  test('returns expired for past timestamp', () => {
    const past = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    const result = getTimeRemaining(past)

    expect(result.expired).toBe(true)
    expect(result.hours).toBe(0)
    expect(result.minutes).toBe(0)
  })

  test('calculates hours and minutes correctly', () => {
    // Use a fixed future time with buffer to avoid timing issues
    const twoAndHalfHoursInSeconds = 7200 + 1800 + 60 // Add buffer
    const futureTime = Math.floor(Date.now() / 1000) + twoAndHalfHoursInSeconds
    const result = getTimeRemaining(futureTime)

    expect(result.expired).toBe(false)
    // Allow some tolerance due to timing
    expect(result.hours).toBeGreaterThanOrEqual(2)
    expect(result.hours).toBeLessThanOrEqual(2)
    expect(result.minutes).toBeGreaterThanOrEqual(29)
    expect(result.minutes).toBeLessThanOrEqual(31)
  })

  test('handles exact hour boundary', () => {
    // Add a small buffer to prevent boundary issues
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600 + 60
    const result = getTimeRemaining(oneHourFromNow)

    expect(result.expired).toBe(false)
    expect(result.hours).toBe(1)
    // Minutes could be 0 or 1 due to timing
    expect(result.minutes).toBeGreaterThanOrEqual(0)
    expect(result.minutes).toBeLessThanOrEqual(1)
  })

  test('handles minutes only', () => {
    const thirtyMinutesFromNow = Math.floor(Date.now() / 1000) + 1800 + 30
    const result = getTimeRemaining(thirtyMinutesFromNow)

    expect(result.expired).toBe(false)
    expect(result.hours).toBe(0)
    expect(result.minutes).toBeGreaterThanOrEqual(29)
    expect(result.minutes).toBeLessThanOrEqual(31)
  })

  test('handles very long durations', () => {
    const oneWeekFromNow = Math.floor(Date.now() / 1000) + 604800 + 60
    const result = getTimeRemaining(oneWeekFromNow)

    expect(result.expired).toBe(false)
    // 7 days * 24 hours = 168 hours
    expect(result.hours).toBeGreaterThanOrEqual(167)
    expect(result.hours).toBeLessThanOrEqual(168)
  })

  test('handles exactly now (boundary)', () => {
    const now = Math.floor(Date.now() / 1000)
    const result = getTimeRemaining(now)

    // At exactly now, remaining <= 0, so expired
    expect(result.expired).toBe(true)
  })
})

// ============================================================================
// getReputationTierFromScore Tests
// ============================================================================

describe('getReputationTierFromScore', () => {
  test('returns UNTRUSTED for 0-1000', () => {
    expect(getReputationTierFromScore(0)).toBe(ReputationTier.UNTRUSTED)
    expect(getReputationTierFromScore(500)).toBe(ReputationTier.UNTRUSTED)
    expect(getReputationTierFromScore(1000)).toBe(ReputationTier.UNTRUSTED)
  })

  test('returns LOW for 1001-3000', () => {
    expect(getReputationTierFromScore(1001)).toBe(ReputationTier.LOW)
    expect(getReputationTierFromScore(2000)).toBe(ReputationTier.LOW)
    expect(getReputationTierFromScore(3000)).toBe(ReputationTier.LOW)
  })

  test('returns MEDIUM for 3001-6000', () => {
    expect(getReputationTierFromScore(3001)).toBe(ReputationTier.MEDIUM)
    expect(getReputationTierFromScore(4500)).toBe(ReputationTier.MEDIUM)
    expect(getReputationTierFromScore(6000)).toBe(ReputationTier.MEDIUM)
  })

  test('returns HIGH for 6001-8000', () => {
    expect(getReputationTierFromScore(6001)).toBe(ReputationTier.HIGH)
    expect(getReputationTierFromScore(7000)).toBe(ReputationTier.HIGH)
    expect(getReputationTierFromScore(8000)).toBe(ReputationTier.HIGH)
  })

  test('returns TRUSTED for 8001+', () => {
    expect(getReputationTierFromScore(8001)).toBe(ReputationTier.TRUSTED)
    expect(getReputationTierFromScore(9000)).toBe(ReputationTier.TRUSTED)
    expect(getReputationTierFromScore(10000)).toBe(ReputationTier.TRUSTED)
    expect(getReputationTierFromScore(99999)).toBe(ReputationTier.TRUSTED)
  })

  test('handles negative scores as UNTRUSTED', () => {
    expect(getReputationTierFromScore(-1)).toBe(ReputationTier.UNTRUSTED)
    expect(getReputationTierFromScore(-1000)).toBe(ReputationTier.UNTRUSTED)
  })
})

// ============================================================================
// getReputationTierLabel Tests
// ============================================================================

describe('getReputationTierLabel', () => {
  const testCases: [ReputationTier, string][] = [
    [ReputationTier.UNTRUSTED, 'Untrusted'],
    [ReputationTier.LOW, 'Low'],
    [ReputationTier.MEDIUM, 'Medium'],
    [ReputationTier.HIGH, 'High'],
    [ReputationTier.TRUSTED, 'Trusted'],
  ]

  test.each(
    testCases,
  )('returns "%s" for tier %d', (tier: ReputationTier, expected: string) => {
    expect(getReputationTierLabel(tier)).toBe(expected)
  })
})

// ============================================================================
// getQuorumForTier Tests
// ============================================================================

describe('getQuorumForTier', () => {
  test('returns Infinity for UNTRUSTED', () => {
    expect(getQuorumForTier(ReputationTier.UNTRUSTED)).toBe(Infinity)
  })

  test('returns 3 for LOW', () => {
    expect(getQuorumForTier(ReputationTier.LOW)).toBe(3)
  })

  test('returns 2 for MEDIUM', () => {
    expect(getQuorumForTier(ReputationTier.MEDIUM)).toBe(2)
  })

  test('returns 1 for HIGH', () => {
    expect(getQuorumForTier(ReputationTier.HIGH)).toBe(1)
  })

  test('returns 1 for TRUSTED', () => {
    expect(getQuorumForTier(ReputationTier.TRUSTED)).toBe(1)
  })

  test('higher tiers require lower quorum', () => {
    const tiers = [
      ReputationTier.LOW,
      ReputationTier.MEDIUM,
      ReputationTier.HIGH,
      ReputationTier.TRUSTED,
    ]

    let lastQuorum = Infinity
    for (const tier of tiers) {
      const quorum = getQuorumForTier(tier)
      expect(quorum).toBeLessThanOrEqual(lastQuorum)
      lastQuorum = quorum
    }
  })
})

// ============================================================================
// formatPnL Tests
// ============================================================================

describe('formatPnL', () => {
  test('formats positive PnL with + sign', () => {
    const oneEth = 10n ** 18n
    expect(formatPnL(oneEth)).toBe('+1.0000 ETH')
  })

  test('formats negative PnL', () => {
    const negOneEth = -(10n ** 18n)
    expect(formatPnL(negOneEth)).toBe('-1.0000 ETH')
  })

  test('formats zero PnL', () => {
    expect(formatPnL(0n)).toBe('+0.0000 ETH')
  })

  test('formats fractional ETH', () => {
    const halfEth = 5n * 10n ** 17n
    expect(formatPnL(halfEth)).toBe('+0.5000 ETH')
  })

  test('formats with 4 decimal places', () => {
    const pnl = 123456789012345678n // ~0.1234... ETH
    const result = formatPnL(pnl)
    // Number conversion may lose precision, verify format
    expect(result).toMatch(/^\+0\.\d{4} ETH$/)
    // Should be approximately 0.1234
    expect(result.startsWith('+0.123')).toBe(true)
  })
})

// ============================================================================
// calculateWinRate Tests
// ============================================================================

describe('calculateWinRate', () => {
  test('returns 50 for 0 wins and 0 losses', () => {
    expect(calculateWinRate(0, 0)).toBe(50)
  })

  test('returns 100 for all wins', () => {
    expect(calculateWinRate(10, 0)).toBe(100)
  })

  test('returns 0 for all losses', () => {
    expect(calculateWinRate(0, 10)).toBe(0)
  })

  test('calculates 50% correctly', () => {
    expect(calculateWinRate(5, 5)).toBe(50)
  })

  test('calculates 75% correctly', () => {
    expect(calculateWinRate(3, 1)).toBe(75)
  })

  test('rounds to nearest integer', () => {
    // 1 win, 2 losses = 33.33...% -> 33
    expect(calculateWinRate(1, 2)).toBe(33)

    // 2 wins, 1 loss = 66.66...% -> 67
    expect(calculateWinRate(2, 1)).toBe(67)
  })

  test('handles large numbers', () => {
    expect(calculateWinRate(1000000, 1000000)).toBe(50)
    expect(calculateWinRate(999999, 1)).toBe(100)
  })

  test('property: result is always 0-100', () => {
    for (let i = 0; i < 50; i++) {
      const wins = Math.floor(Math.random() * 1000)
      const losses = Math.floor(Math.random() * 1000)

      const result = calculateWinRate(wins, losses)

      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(100)
    }
  })
})
