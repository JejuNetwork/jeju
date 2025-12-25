/**
 * Moderation System Unit Tests
 *
 * Tests for visibility scoring, trust calculations, and auto-rejection logic
 */

import { describe, expect, test } from 'bun:test'

const FlagType = {
  DUPLICATE: 'DUPLICATE',
  SPAM: 'SPAM',
  HARMFUL: 'HARMFUL',
  INFEASIBLE: 'INFEASIBLE',
  MISALIGNED: 'MISALIGNED',
  LOW_QUALITY: 'LOW_QUALITY',
  NEEDS_WORK: 'NEEDS_WORK',
} as const
type FlagType = (typeof FlagType)[keyof typeof FlagType]

interface ProposalFlag {
  flagId: string
  proposalId: string
  flagger: string
  flagType: FlagType
  reason: string
  evidence?: string
  stake: number
  reputation: number
  upvotes: number
  downvotes: number
  createdAt: number
  resolved: boolean
  resolution?: 'UPHELD' | 'REJECTED'
}

interface ModeratorStats {
  address: string
  flagsRaised: number
  flagsUpheld: number
  flagsRejected: number
  accuracy: number
  reputation: number
  trustScore: number
}

interface ModerationScore {
  proposalId: string
  visibilityScore: number
  flags: ProposalFlag[]
  trustWeightedFlags: number
  recommendation: 'VISIBLE' | 'REVIEW' | 'HIDDEN'
}
const STAKE: Record<FlagType, number> = {
  DUPLICATE: 10,
  SPAM: 5,
  HARMFUL: 50,
  INFEASIBLE: 20,
  MISALIGNED: 30,
  LOW_QUALITY: 10,
  NEEDS_WORK: 5,
}

const WEIGHT: Record<FlagType, number> = {
  DUPLICATE: 30,
  SPAM: 50,
  HARMFUL: 100,
  INFEASIBLE: 25,
  MISALIGNED: 40,
  LOW_QUALITY: 15,
  NEEDS_WORK: 10,
}
function getDefaultModeratorStats(address: string): ModeratorStats {
  return {
    address,
    flagsRaised: 0,
    flagsUpheld: 0,
    flagsRejected: 0,
    accuracy: 50,
    reputation: 10,
    trustScore: 50,
  }
}

function calculateVisibilityScore(
  flags: ProposalFlag[],
  getStats: (address: string) => ModeratorStats,
): ModerationScore {
  const proposalId = flags[0]?.proposalId ?? 'unknown'
  const activeFlags = flags.filter((f) => !f.resolved)

  const weighted = activeFlags.reduce((sum, f) => {
    const stats = getStats(f.flagger)
    const tw = stats.accuracy / 100
    const vw = (f.upvotes - f.downvotes) / Math.max(1, f.upvotes + f.downvotes)
    return sum + WEIGHT[f.flagType] * tw * (1 + vw)
  }, 0)

  const vis = Math.max(0, 100 - weighted)
  const rec: ModerationScore['recommendation'] =
    vis < 30 ? 'HIDDEN' : vis < 70 ? 'REVIEW' : 'VISIBLE'

  return {
    proposalId,
    visibilityScore: vis,
    flags: activeFlags,
    trustWeightedFlags: weighted,
    recommendation: rec,
  }
}

function calculateTrustScore(
  address: string,
  trustRelations: Map<string, Map<string, number>>,
): number {
  let total = 0
  let count = 0
  for (const [, rels] of trustRelations) {
    const r = rels.get(address)
    if (r !== undefined) {
      total += r
      count++
    }
  }
  return count > 0 ? Math.round(50 + total / count / 2) : 50
}

function updateModeratorStatsOnResolution(
  stats: ModeratorStats,
  flagType: FlagType,
  upheld: boolean,
): ModeratorStats {
  const w = WEIGHT[flagType]
  const newStats = { ...stats }

  if (upheld) {
    newStats.flagsUpheld++
    newStats.reputation += w / 10
    newStats.trustScore = Math.min(100, newStats.trustScore + 5)
  } else {
    newStats.flagsRejected++
    newStats.reputation = Math.max(0, newStats.reputation - w / 20)
    newStats.trustScore = Math.max(0, newStats.trustScore - 3)
  }

  newStats.accuracy =
    (newStats.flagsUpheld /
      Math.max(1, newStats.flagsUpheld + newStats.flagsRejected)) *
    100

  return newStats
}

function shouldAutoReject(score: ModerationScore): {
  reject: boolean
  reason?: string
} {
  if (score.visibilityScore < 10) {
    const top = score.flags.sort(
      (a, b) => WEIGHT[b.flagType] - WEIGHT[a.flagType],
    )[0]
    return { reject: true, reason: top?.reason ?? 'Too many flags' }
  }

  if (
    score.flags.filter(
      (f) => f.flagType === FlagType.SPAM && f.upvotes > f.downvotes * 2,
    ).length >= 3
  ) {
    return { reject: true, reason: 'Multiple spam flags' }
  }

  if (
    score.flags.some((f) => f.flagType === FlagType.HARMFUL && f.upvotes > 10)
  ) {
    return { reject: true, reason: 'Flagged harmful' }
  }

  return { reject: false }
}

function calculateVoteWeight(reputation: number): number {
  return Math.max(1, Math.floor(reputation / 10))
}
function createFlag(
  proposalId: string,
  flagger: string,
  flagType: FlagType,
  overrides: Partial<ProposalFlag> = {},
): ProposalFlag {
  return {
    flagId: `flag-${Math.random().toString(36).slice(2)}`,
    proposalId,
    flagger,
    flagType,
    reason: `${flagType} flag reason`,
    stake: STAKE[flagType],
    reputation: 10,
    upvotes: 0,
    downvotes: 0,
    createdAt: Date.now(),
    resolved: false,
    ...overrides,
  }
}
describe('Moderation System', () => {
  describe('Visibility Score Calculation', () => {
    test('no flags = 100% visibility', () => {
      const score = calculateVisibilityScore([], getDefaultModeratorStats)
      expect(score.visibilityScore).toBe(100)
      expect(score.recommendation).toBe('VISIBLE')
    })

    test('single SPAM flag reduces visibility', () => {
      const flags = [createFlag('prop-1', 'mod-1', FlagType.SPAM)]
      const score = calculateVisibilityScore(flags, getDefaultModeratorStats)

      // SPAM weight = 50, default accuracy = 50%, upvotes = downvotes = 0
      // weighted = 50 * 0.5 * 1 = 25
      // visibility = 100 - 25 = 75
      expect(score.visibilityScore).toBe(75)
      expect(score.recommendation).toBe('VISIBLE')
    })

    test('HARMFUL flag has highest weight', () => {
      const spamFlags = [createFlag('prop-1', 'mod-1', FlagType.SPAM)]
      const harmfulFlags = [createFlag('prop-1', 'mod-1', FlagType.HARMFUL)]

      const spamScore = calculateVisibilityScore(
        spamFlags,
        getDefaultModeratorStats,
      )
      const harmfulScore = calculateVisibilityScore(
        harmfulFlags,
        getDefaultModeratorStats,
      )

      expect(harmfulScore.visibilityScore).toBeLessThan(
        spamScore.visibilityScore,
      )
    })

    test('multiple flags stack', () => {
      const flags = [
        createFlag('prop-1', 'mod-1', FlagType.SPAM),
        createFlag('prop-1', 'mod-2', FlagType.LOW_QUALITY),
        createFlag('prop-1', 'mod-3', FlagType.NEEDS_WORK),
      ]

      const score = calculateVisibilityScore(flags, getDefaultModeratorStats)
      expect(score.visibilityScore).toBeLessThan(100)
      expect(score.flags).toHaveLength(3)
    })

    test('resolved flags do not count', () => {
      const flags = [
        createFlag('prop-1', 'mod-1', FlagType.HARMFUL, { resolved: true }),
        createFlag('prop-1', 'mod-2', FlagType.SPAM, { resolved: false }),
      ]

      const score = calculateVisibilityScore(flags, getDefaultModeratorStats)
      // Only SPAM flag counts
      expect(score.flags).toHaveLength(1)
      expect(score.visibilityScore).toBe(75) // 100 - 25 (SPAM weight * 0.5)
    })

    test('upvotes increase flag weight', () => {
      const noVotes = [createFlag('prop-1', 'mod-1', FlagType.SPAM)]
      const withUpvotes = [
        createFlag('prop-1', 'mod-1', FlagType.SPAM, {
          upvotes: 10,
          downvotes: 0,
        }),
      ]

      const noVotesScore = calculateVisibilityScore(
        noVotes,
        getDefaultModeratorStats,
      )
      const upvotesScore = calculateVisibilityScore(
        withUpvotes,
        getDefaultModeratorStats,
      )

      expect(upvotesScore.visibilityScore).toBeLessThan(
        noVotesScore.visibilityScore,
      )
    })

    test('downvotes decrease flag weight', () => {
      const noVotes = [createFlag('prop-1', 'mod-1', FlagType.SPAM)]
      const withDownvotes = [
        createFlag('prop-1', 'mod-1', FlagType.SPAM, {
          upvotes: 0,
          downvotes: 10,
        }),
      ]

      const noVotesScore = calculateVisibilityScore(
        noVotes,
        getDefaultModeratorStats,
      )
      const downvotesScore = calculateVisibilityScore(
        withDownvotes,
        getDefaultModeratorStats,
      )

      expect(downvotesScore.visibilityScore).toBeGreaterThan(
        noVotesScore.visibilityScore,
      )
    })

    test('higher accuracy moderator has more weight', () => {
      const flags = [createFlag('prop-1', 'high-accuracy-mod', FlagType.SPAM)]

      const lowAccuracyStats = (addr: string): ModeratorStats => ({
        ...getDefaultModeratorStats(addr),
        accuracy: 20,
      })

      const highAccuracyStats = (addr: string): ModeratorStats => ({
        ...getDefaultModeratorStats(addr),
        accuracy: 90,
      })

      const lowScore = calculateVisibilityScore(flags, lowAccuracyStats)
      const highScore = calculateVisibilityScore(flags, highAccuracyStats)

      expect(highScore.visibilityScore).toBeLessThan(lowScore.visibilityScore)
    })

    test('visibility below 30 = HIDDEN', () => {
      const flags = [
        createFlag('prop-1', 'mod-1', FlagType.HARMFUL),
        createFlag('prop-1', 'mod-2', FlagType.HARMFUL),
      ]

      const highAccuracyStats = (addr: string): ModeratorStats => ({
        ...getDefaultModeratorStats(addr),
        accuracy: 80,
      })

      const score = calculateVisibilityScore(flags, highAccuracyStats)
      expect(score.visibilityScore).toBeLessThan(30)
      expect(score.recommendation).toBe('HIDDEN')
    })

    test('visibility 30-70 = REVIEW', () => {
      const flags = [createFlag('prop-1', 'mod-1', FlagType.HARMFUL)]

      const mediumAccuracyStats = (addr: string): ModeratorStats => ({
        ...getDefaultModeratorStats(addr),
        accuracy: 60,
      })

      const score = calculateVisibilityScore(flags, mediumAccuracyStats)
      // HARMFUL = 100, 60% accuracy, no votes = 100 * 0.6 * 1 = 60
      // visibility = 100 - 60 = 40
      expect(score.visibilityScore).toBe(40)
      expect(score.recommendation).toBe('REVIEW')
    })
  })

  describe('Trust Score Calculation', () => {
    test('no trust relations = default 50', () => {
      const trustRelations = new Map<string, Map<string, number>>()
      expect(calculateTrustScore('user-1', trustRelations)).toBe(50)
    })

    test('positive trust increases score', () => {
      const trustRelations = new Map<string, Map<string, number>>()
      trustRelations.set('user-2', new Map([['user-1', 50]]))

      // 50 + (50 / 1 / 2) = 50 + 25 = 75
      expect(calculateTrustScore('user-1', trustRelations)).toBe(75)
    })

    test('negative trust decreases score', () => {
      const trustRelations = new Map<string, Map<string, number>>()
      trustRelations.set('user-2', new Map([['user-1', -50]]))

      // 50 + (-50 / 1 / 2) = 50 - 25 = 25
      expect(calculateTrustScore('user-1', trustRelations)).toBe(25)
    })

    test('multiple trust relations are averaged', () => {
      const trustRelations = new Map<string, Map<string, number>>()
      trustRelations.set('user-2', new Map([['user-1', 100]]))
      trustRelations.set('user-3', new Map([['user-1', 0]]))

      // 50 + ((100 + 0) / 2 / 2) = 50 + 25 = 75
      expect(calculateTrustScore('user-1', trustRelations)).toBe(75)
    })

    test('trust score is capped at reasonable bounds', () => {
      const highTrust = new Map<string, Map<string, number>>()
      highTrust.set('user-2', new Map([['user-1', 100]]))
      highTrust.set('user-3', new Map([['user-1', 100]]))
      highTrust.set('user-4', new Map([['user-1', 100]]))

      // 50 + (300 / 3 / 2) = 50 + 50 = 100
      expect(calculateTrustScore('user-1', highTrust)).toBe(100)
    })
  })

  describe('Moderator Stats Update on Resolution', () => {
    test('upheld flag increases reputation', () => {
      const initial = getDefaultModeratorStats('mod-1')
      const updated = updateModeratorStatsOnResolution(
        initial,
        FlagType.SPAM,
        true,
      )

      expect(updated.flagsUpheld).toBe(1)
      expect(updated.reputation).toBeGreaterThan(initial.reputation)
      expect(updated.trustScore).toBeGreaterThan(initial.trustScore)
    })

    test('rejected flag decreases reputation', () => {
      const initial = getDefaultModeratorStats('mod-1')
      const updated = updateModeratorStatsOnResolution(
        initial,
        FlagType.SPAM,
        false,
      )

      expect(updated.flagsRejected).toBe(1)
      expect(updated.reputation).toBeLessThan(initial.reputation)
      expect(updated.trustScore).toBeLessThan(initial.trustScore)
    })

    test('accuracy reflects upheld ratio', () => {
      let stats = getDefaultModeratorStats('mod-1')

      // 3 upheld, 1 rejected
      stats = updateModeratorStatsOnResolution(stats, FlagType.SPAM, true)
      stats = updateModeratorStatsOnResolution(stats, FlagType.SPAM, true)
      stats = updateModeratorStatsOnResolution(stats, FlagType.SPAM, true)
      stats = updateModeratorStatsOnResolution(stats, FlagType.SPAM, false)

      // 3 / 4 = 75%
      expect(stats.accuracy).toBe(75)
    })

    test('higher weight flags have more reputation impact', () => {
      const lowWeight = updateModeratorStatsOnResolution(
        getDefaultModeratorStats('mod-1'),
        FlagType.NEEDS_WORK,
        true,
      )
      const highWeight = updateModeratorStatsOnResolution(
        getDefaultModeratorStats('mod-2'),
        FlagType.HARMFUL,
        true,
      )

      expect(highWeight.reputation).toBeGreaterThan(lowWeight.reputation)
    })

    test('reputation cannot go below 0', () => {
      let stats = { ...getDefaultModeratorStats('mod-1'), reputation: 0 }
      stats = updateModeratorStatsOnResolution(stats, FlagType.HARMFUL, false)

      expect(stats.reputation).toBe(0)
    })

    test('trust score cannot exceed 100', () => {
      let stats = { ...getDefaultModeratorStats('mod-1'), trustScore: 98 }
      stats = updateModeratorStatsOnResolution(stats, FlagType.HARMFUL, true)

      expect(stats.trustScore).toBe(100)
    })
  })

  describe('Auto-Rejection Logic', () => {
    test('visibility below 10 triggers auto-reject', () => {
      const score: ModerationScore = {
        proposalId: 'prop-1',
        visibilityScore: 5,
        flags: [
          createFlag('prop-1', 'mod-1', FlagType.HARMFUL, {
            reason: 'Very harmful',
          }),
        ],
        trustWeightedFlags: 95,
        recommendation: 'HIDDEN',
      }

      const result = shouldAutoReject(score)
      expect(result.reject).toBe(true)
      expect(result.reason).toBe('Very harmful')
    })

    test('visibility at 10 does not trigger auto-reject', () => {
      const score: ModerationScore = {
        proposalId: 'prop-1',
        visibilityScore: 10,
        flags: [],
        trustWeightedFlags: 90,
        recommendation: 'HIDDEN',
      }

      const result = shouldAutoReject(score)
      expect(result.reject).toBe(false)
    })

    test('3+ upvoted spam flags trigger auto-reject', () => {
      const score: ModerationScore = {
        proposalId: 'prop-1',
        visibilityScore: 50,
        flags: [
          createFlag('prop-1', 'mod-1', FlagType.SPAM, {
            upvotes: 5,
            downvotes: 1,
          }),
          createFlag('prop-1', 'mod-2', FlagType.SPAM, {
            upvotes: 5,
            downvotes: 1,
          }),
          createFlag('prop-1', 'mod-3', FlagType.SPAM, {
            upvotes: 5,
            downvotes: 1,
          }),
        ],
        trustWeightedFlags: 50,
        recommendation: 'REVIEW',
      }

      const result = shouldAutoReject(score)
      expect(result.reject).toBe(true)
      expect(result.reason).toBe('Multiple spam flags')
    })

    test('2 spam flags do not trigger auto-reject', () => {
      const score: ModerationScore = {
        proposalId: 'prop-1',
        visibilityScore: 50,
        flags: [
          createFlag('prop-1', 'mod-1', FlagType.SPAM, {
            upvotes: 5,
            downvotes: 1,
          }),
          createFlag('prop-1', 'mod-2', FlagType.SPAM, {
            upvotes: 5,
            downvotes: 1,
          }),
        ],
        trustWeightedFlags: 50,
        recommendation: 'REVIEW',
      }

      const result = shouldAutoReject(score)
      expect(result.reject).toBe(false)
    })

    test('harmful flag with >10 upvotes triggers auto-reject', () => {
      const score: ModerationScore = {
        proposalId: 'prop-1',
        visibilityScore: 50,
        flags: [
          createFlag('prop-1', 'mod-1', FlagType.HARMFUL, {
            upvotes: 15,
            downvotes: 0,
          }),
        ],
        trustWeightedFlags: 50,
        recommendation: 'REVIEW',
      }

      const result = shouldAutoReject(score)
      expect(result.reject).toBe(true)
      expect(result.reason).toBe('Flagged harmful')
    })

    test('harmful flag with exactly 10 upvotes does not trigger', () => {
      const score: ModerationScore = {
        proposalId: 'prop-1',
        visibilityScore: 50,
        flags: [
          createFlag('prop-1', 'mod-1', FlagType.HARMFUL, {
            upvotes: 10,
            downvotes: 0,
          }),
        ],
        trustWeightedFlags: 50,
        recommendation: 'REVIEW',
      }

      const result = shouldAutoReject(score)
      expect(result.reject).toBe(false)
    })
  })

  describe('Vote Weight Calculation', () => {
    test('minimum reputation gives weight 1', () => {
      expect(calculateVoteWeight(1)).toBe(1)
      expect(calculateVoteWeight(9)).toBe(1)
    })

    test('reputation 10 gives weight 1', () => {
      expect(calculateVoteWeight(10)).toBe(1)
    })

    test('higher reputation increases weight', () => {
      expect(calculateVoteWeight(50)).toBe(5)
      expect(calculateVoteWeight(100)).toBe(10)
      expect(calculateVoteWeight(150)).toBe(15)
    })

    test('zero reputation still gives weight 1', () => {
      expect(calculateVoteWeight(0)).toBe(1)
    })
  })

  describe('Stake Requirements', () => {
    test('HARMFUL requires highest stake', () => {
      expect(STAKE.HARMFUL).toBeGreaterThan(STAKE.SPAM)
      expect(STAKE.HARMFUL).toBeGreaterThan(STAKE.DUPLICATE)
      expect(STAKE.HARMFUL).toBeGreaterThan(STAKE.MISALIGNED)
    })

    test('NEEDS_WORK requires lowest stake', () => {
      expect(STAKE.NEEDS_WORK).toBeLessThanOrEqual(STAKE.SPAM)
      expect(STAKE.NEEDS_WORK).toBeLessThanOrEqual(STAKE.LOW_QUALITY)
    })

    test('all flag types have non-zero stake', () => {
      for (const flagType of Object.values(FlagType)) {
        expect(STAKE[flagType]).toBeGreaterThan(0)
      }
    })
  })
})
