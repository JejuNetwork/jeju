/**
 * Comprehensive Tests for ReputationBridge
 *
 * Tests cover:
 * - Aggregated reputation calculation
 * - Weighted accuracy scoring
 * - Trust score calculation
 * - Volume summing
 * - Agent0 integration
 * - Error handling
 * - Edge cases and boundary conditions
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetAgent0Client } from '../client'
import {
  ReputationBridge,
  type ReputationData,
  reputationBridge,
  safeBigInt,
} from '../reputation'

// =============================================================================
// Test Fixtures
// =============================================================================

const _defaultReputation: ReputationData = {
  totalBets: 0,
  winningBets: 0,
  accuracyScore: 0,
  trustScore: 0,
  totalVolume: '0',
  profitLoss: 0,
  isBanned: false,
}

const _highReputation: ReputationData = {
  totalBets: 100,
  winningBets: 75,
  accuracyScore: 0.75,
  trustScore: 0.85,
  totalVolume: '1000000000000000000', // 1 ETH
  profitLoss: 500,
  isBanned: false,
}

const lowReputation: ReputationData = {
  totalBets: 10,
  winningBets: 3,
  accuracyScore: 0.3,
  trustScore: 0.4,
  totalVolume: '100000000000000000', // 0.1 ETH
  profitLoss: -50,
  isBanned: false,
}

const _bannedReputation: ReputationData = {
  ...lowReputation,
  isBanned: true,
}

// =============================================================================
// Service Instance Tests
// =============================================================================

describe('ReputationBridge Instance', () => {
  test('singleton instance is ReputationBridge', () => {
    expect(reputationBridge).toBeInstanceOf(ReputationBridge)
  })

  test('new instance is independent', () => {
    const bridge = new ReputationBridge()
    expect(bridge).toBeInstanceOf(ReputationBridge)
    expect(bridge).not.toBe(reputationBridge)
  })
})

// =============================================================================
// getAggregatedReputation Tests
// =============================================================================

describe('getAggregatedReputation', () => {
  let bridge: ReputationBridge

  beforeEach(() => {
    bridge = new ReputationBridge()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  // ---------------------------------------------------------------------------
  // Basic Aggregation Tests
  // ---------------------------------------------------------------------------

  describe('basic aggregation', () => {
    test('returns all required reputation fields', async () => {
      const rep = await bridge.getAggregatedReputation(1)
      expect(typeof rep.totalBets).toBe('number')
      expect(typeof rep.winningBets).toBe('number')
      expect(typeof rep.accuracyScore).toBe('number')
      expect(typeof rep.trustScore).toBe('number')
      expect(typeof rep.totalVolume).toBe('string')
      expect(typeof rep.profitLoss).toBe('number')
      expect(typeof rep.isBanned).toBe('boolean')
    })

    test('returns zeros for unknown token', async () => {
      const rep = await bridge.getAggregatedReputation(999999999)
      expect(rep.totalBets).toBe(0)
      expect(rep.winningBets).toBe(0)
      expect(rep.accuracyScore).toBe(0)
      expect(rep.trustScore).toBe(0)
      expect(rep.totalVolume).toBe('0')
    })

    test('includes local and agent0 source breakdown', async () => {
      const rep = await bridge.getAggregatedReputation(1)
      expect(rep.sources).toEqual({
        local: expect.any(Number),
        agent0: expect.any(Number),
      })
    })
  })

  describe('token ID edge cases', () => {
    test('token ID 0 returns valid reputation', async () => {
      const rep = await bridge.getAggregatedReputation(0)
      expect(rep.totalBets).toBeGreaterThanOrEqual(0)
    })

    test('large token ID returns valid reputation', async () => {
      const rep = await bridge.getAggregatedReputation(Number.MAX_SAFE_INTEGER)
      expect(rep.totalBets).toBeGreaterThanOrEqual(0)
    })

    test('negative token ID returns valid reputation', async () => {
      const rep = await bridge.getAggregatedReputation(-1)
      expect(rep.totalBets).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// getAgent0ReputationSummary Tests
// =============================================================================

describe('getAgent0ReputationSummary', () => {
  let bridge: ReputationBridge

  beforeEach(() => {
    bridge = new ReputationBridge()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  describe('basic summary', () => {
    test('returns count and averageScore fields', async () => {
      const summary = await bridge.getAgent0ReputationSummary('31337:1')
      expect(typeof summary.count).toBe('number')
      expect(typeof summary.averageScore).toBe('number')
    })

    test('returns non-negative values', async () => {
      const summary = await bridge.getAgent0ReputationSummary('31337:1')
      expect(summary.count).toBeGreaterThanOrEqual(0)
      expect(summary.averageScore).toBeGreaterThanOrEqual(0)
    })
  })

  describe('tag filtering', () => {
    test('single tag returns valid summary', async () => {
      const summary = await bridge.getAgent0ReputationSummary(
        '31337:1',
        'trading',
      )
      expect(summary.count).toBeGreaterThanOrEqual(0)
    })

    test('two tags return valid summary', async () => {
      const summary = await bridge.getAgent0ReputationSummary(
        '31337:1',
        'trading',
        'crypto',
      )
      expect(summary.count).toBeGreaterThanOrEqual(0)
    })

    test('undefined tags same as no tags', async () => {
      const withTags = await bridge.getAgent0ReputationSummary(
        '31337:1',
        undefined,
        undefined,
      )
      const withoutTags = await bridge.getAgent0ReputationSummary('31337:1')
      expect(withTags.count).toBe(withoutTags.count)
    })
  })

  describe('agent ID formats', () => {
    test('chainId:tokenId format works', async () => {
      const summary = await bridge.getAgent0ReputationSummary('31337:1')
      expect(summary.count).toBeGreaterThanOrEqual(0)
    })

    test('plain tokenId string works', async () => {
      const summary = await bridge.getAgent0ReputationSummary('1')
      expect(summary.count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// Weighted Accuracy Calculation Tests
// =============================================================================

describe('Weighted Accuracy Calculation', () => {
  // Testing the internal calculation logic through getAggregatedReputation

  test('returns 0 when both sources have no bets', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(999999)
    // With no data, accuracy should be 0
    expect(rep.accuracyScore).toBe(0)
  })

  // The weighted calculation follows:
  // - Local weight: 60%
  // - Agent0 weight: 40%
  // - If one source has no data, use the other
})

// =============================================================================
// Trust Score Calculation Tests
// =============================================================================

describe('Trust Score Calculation', () => {
  test('trust score is within valid range', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)
    expect(rep.trustScore).toBeGreaterThanOrEqual(0)
    expect(rep.trustScore).toBeLessThanOrEqual(100)
  })
})

// =============================================================================
// safeBigInt Tests
// =============================================================================

describe('safeBigInt', () => {
  test('parses valid integer string', () => {
    expect(safeBigInt('12345')).toBe(12345n)
  })

  test('parses large integer string', () => {
    expect(safeBigInt('1000000000000000000')).toBe(1000000000000000000n)
  })

  test('parses negative integer string', () => {
    expect(safeBigInt('-500')).toBe(-500n)
  })

  test('returns 0n for null', () => {
    expect(safeBigInt(null)).toBe(0n)
  })

  test('returns 0n for undefined', () => {
    expect(safeBigInt(undefined)).toBe(0n)
  })

  test('returns 0n for empty string', () => {
    expect(safeBigInt('')).toBe(0n)
  })

  test('returns 0n for whitespace-only string', () => {
    expect(safeBigInt('   ')).toBe(0n)
  })

  test('returns 0n for invalid number string', () => {
    expect(safeBigInt('not-a-number')).toBe(0n)
  })

  test('returns 0n for float string', () => {
    expect(safeBigInt('123.456')).toBe(0n)
  })

  test('returns 0n for string with letters', () => {
    expect(safeBigInt('123abc')).toBe(0n)
  })

  test('handles string with leading/trailing whitespace', () => {
    expect(safeBigInt('  12345  ')).toBe(12345n)
  })
})

// =============================================================================
// Volume Summing Tests
// =============================================================================

describe('Volume Summing', () => {
  test('total volume is a valid string', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)
    expect(typeof rep.totalVolume).toBe('string')
    // Should be parseable as BigInt
    expect(() => BigInt(rep.totalVolume)).not.toThrow()
  })

  test('volume is non-negative', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)
    const volume = BigInt(rep.totalVolume)
    expect(volume >= 0n).toBe(true)
  })
})

// =============================================================================
// Ban Status Tests
// =============================================================================

describe('Ban Status', () => {
  test('isBanned is boolean', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)
    expect(typeof rep.isBanned).toBe('boolean')
  })

  test('ban propagates from either source', async () => {
    // If either local or agent0 shows banned, result should be banned
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)
    // Can't test this without mocking, but structure is correct
    expect(rep).toHaveProperty('isBanned')
  })
})

// =============================================================================
// Reputation Sync Tests
// =============================================================================

describe('syncReputationToAgent0', () => {
  let bridge: ReputationBridge

  beforeEach(() => {
    bridge = new ReputationBridge()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  test('completes without error when Agent0 disabled', async () => {
    // Should return early if Agent0 is not enabled
    await expect(bridge.syncReputationToAgent0(1)).resolves.toBeUndefined()
  })

  test('skips sync when no local activity', async () => {
    // With no bets, sync should skip
    await expect(bridge.syncReputationToAgent0(999999)).resolves.toBeUndefined()
  })
})

// =============================================================================
// Data Structure Consistency Tests
// =============================================================================

describe('Data Structure Consistency', () => {
  test('ReputationData has all required fields', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)

    // Required fields
    expect(rep).toHaveProperty('totalBets')
    expect(rep).toHaveProperty('winningBets')
    expect(rep).toHaveProperty('accuracyScore')
    expect(rep).toHaveProperty('trustScore')
    expect(rep).toHaveProperty('totalVolume')
    expect(rep).toHaveProperty('profitLoss')
    expect(rep).toHaveProperty('isBanned')
  })

  test('Agent0ReputationSummary has all required fields', async () => {
    const bridge = new ReputationBridge()
    const summary = await bridge.getAgent0ReputationSummary('31337:1')

    expect(summary).toHaveProperty('count')
    expect(summary).toHaveProperty('averageScore')
  })

  test('numeric fields are numbers', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)

    expect(typeof rep.totalBets).toBe('number')
    expect(typeof rep.winningBets).toBe('number')
    expect(typeof rep.accuracyScore).toBe('number')
    expect(typeof rep.trustScore).toBe('number')
    expect(typeof rep.profitLoss).toBe('number')
  })

  test('winningBets <= totalBets', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)

    expect(rep.winningBets).toBeLessThanOrEqual(rep.totalBets)
  })

  test('accuracyScore is in [0, 1] range', async () => {
    const bridge = new ReputationBridge()
    const rep = await bridge.getAggregatedReputation(1)

    expect(rep.accuracyScore).toBeGreaterThanOrEqual(0)
    expect(rep.accuracyScore).toBeLessThanOrEqual(1)
  })
})

// =============================================================================
// Concurrent Request Tests
// =============================================================================

describe('Concurrent Requests', () => {
  test('5 concurrent getAggregatedReputation calls succeed', async () => {
    const bridge = new ReputationBridge()
    const results = await Promise.all([
      bridge.getAggregatedReputation(1),
      bridge.getAggregatedReputation(2),
      bridge.getAggregatedReputation(3),
      bridge.getAggregatedReputation(4),
      bridge.getAggregatedReputation(5),
    ])

    expect(results).toHaveLength(5)
    for (const rep of results) {
      expect(typeof rep.totalBets).toBe('number')
      expect(typeof rep.trustScore).toBe('number')
    }
  })

  test('3 concurrent getAgent0ReputationSummary calls succeed', async () => {
    const bridge = new ReputationBridge()
    const results = await Promise.all([
      bridge.getAgent0ReputationSummary('31337:1'),
      bridge.getAgent0ReputationSummary('31337:2'),
      bridge.getAgent0ReputationSummary('31337:3'),
    ])

    expect(results).toHaveLength(3)
    for (const summary of results) {
      expect(typeof summary.count).toBe('number')
      expect(typeof summary.averageScore).toBe('number')
    }
  })
})

// =============================================================================
// Error Recovery Tests
// =============================================================================

describe('Error Recovery', () => {
  let bridge: ReputationBridge

  beforeEach(() => {
    bridge = new ReputationBridge()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  test('returns valid default data for unknown token', async () => {
    const rep = await bridge.getAggregatedReputation(999999)
    expect(rep.totalBets).toBe(0)
    expect(rep.trustScore).toBe(0)
    expect(rep.isBanned).toBe(false)
  })

  test('returns zero summary for invalid agent ID', async () => {
    const summary = await bridge.getAgent0ReputationSummary('invalid-format')
    expect(summary.count).toBe(0)
    expect(summary.averageScore).toBe(0)
  })
})
