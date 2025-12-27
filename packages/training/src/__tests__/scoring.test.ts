/**
 * Training Scoring Tests
 *
 * Tests for trajectory scoring and evaluation.
 */

import { describe, expect, it } from 'bun:test'

// Score components
interface ScoreComponents {
  environmentReward: number
  socialReward?: number
  tradingReward?: number
  consistencyBonus?: number
  riskPenalty?: number
}

// Trajectory score
interface TrajectoryScore {
  trajectoryId: string
  totalScore: number
  components: ScoreComponents
  normalized: number
  percentile?: number
}

// Reward signal
interface RewardSignal {
  stepId: string
  reward: number
  source: 'environment' | 'judge' | 'rubric'
  timestamp: number
}

describe('ScoreComponents', () => {
  it('validates complete score components', () => {
    const components: ScoreComponents = {
      environmentReward: 0.75,
      socialReward: 0.2,
      tradingReward: 0.5,
      consistencyBonus: 0.1,
      riskPenalty: -0.05,
    }

    expect(components.environmentReward).toBe(0.75)
    expect(components.riskPenalty).toBeLessThan(0)
  })

  it('validates minimal components', () => {
    const components: ScoreComponents = {
      environmentReward: 0.5,
    }

    expect(components.environmentReward).toBe(0.5)
    expect(components.socialReward).toBeUndefined()
    expect(components.tradingReward).toBeUndefined()
  })

  it('validates reward ranges', () => {
    const validComponents: ScoreComponents = {
      environmentReward: 1.0,
      socialReward: 0.0,
      tradingReward: 0.5,
    }

    expect(validComponents.environmentReward).toBeGreaterThanOrEqual(0)
    expect(validComponents.environmentReward).toBeLessThanOrEqual(1)
  })
})

describe('TrajectoryScore', () => {
  it('validates complete trajectory score', () => {
    const score: TrajectoryScore = {
      trajectoryId: 'traj-123',
      totalScore: 0.85,
      components: {
        environmentReward: 0.7,
        tradingReward: 0.3,
      },
      normalized: 0.85,
      percentile: 92,
    }

    expect(score.trajectoryId).toBe('traj-123')
    expect(score.totalScore).toBeGreaterThan(0)
    expect(score.normalized).toBeLessThanOrEqual(1)
    expect(score.percentile).toBeLessThanOrEqual(100)
  })

  it('validates score without percentile', () => {
    const score: TrajectoryScore = {
      trajectoryId: 'traj-456',
      totalScore: 0.5,
      components: {
        environmentReward: 0.5,
      },
      normalized: 0.5,
    }

    expect(score.percentile).toBeUndefined()
  })

  it('calculates weighted total from components', () => {
    const weights = {
      environment: 0.4,
      social: 0.3,
      trading: 0.3,
    }

    const components = {
      environmentReward: 0.8,
      socialReward: 0.6,
      tradingReward: 0.9,
    }

    const total =
      components.environmentReward * weights.environment +
      components.socialReward * weights.social +
      components.tradingReward * weights.trading

    expect(total).toBeCloseTo(0.77, 2)
  })
})

describe('RewardSignal', () => {
  it('validates environment reward signal', () => {
    const signal: RewardSignal = {
      stepId: 'step-1',
      reward: 0.5,
      source: 'environment',
      timestamp: Date.now(),
    }

    expect(signal.source).toBe('environment')
    expect(signal.reward).toBeGreaterThanOrEqual(0)
  })

  it('validates judge reward signal', () => {
    const signal: RewardSignal = {
      stepId: 'step-2',
      reward: 0.8,
      source: 'judge',
      timestamp: Date.now(),
    }

    expect(signal.source).toBe('judge')
  })

  it('validates rubric reward signal', () => {
    const signal: RewardSignal = {
      stepId: 'step-3',
      reward: 0.3,
      source: 'rubric',
      timestamp: Date.now(),
    }

    expect(signal.source).toBe('rubric')
  })

  it('supports negative rewards (penalties)', () => {
    const signal: RewardSignal = {
      stepId: 'step-4',
      reward: -0.2,
      source: 'environment',
      timestamp: Date.now(),
    }

    expect(signal.reward).toBeLessThan(0)
  })
})

describe('Score aggregation', () => {
  it('calculates mean score across steps', () => {
    const stepRewards = [0.5, 0.6, 0.7, 0.8, 0.9]
    const mean = stepRewards.reduce((a, b) => a + b, 0) / stepRewards.length

    expect(mean).toBe(0.7)
  })

  it('calculates discounted cumulative reward', () => {
    const rewards = [1.0, 0.5, 0.25, 0.125]
    const gamma = 0.99 // Discount factor

    let discounted = 0
    for (let i = 0; i < rewards.length; i++) {
      const r = rewards[i]
      if (r !== undefined) discounted += r * gamma ** i
    }

    expect(discounted).toBeGreaterThan(1.8)
    expect(discounted).toBeLessThan(2.0)
  })

  it('calculates advantage estimate', () => {
    const reward = 0.8
    const valueEstimate = 0.7
    const nextValueEstimate = 0.6
    const gamma = 0.99

    // TD error / advantage
    const advantage = reward + gamma * nextValueEstimate - valueEstimate

    expect(advantage).toBeCloseTo(0.694, 2)
  })
})

describe('Normalization', () => {
  it('normalizes score to [0, 1] range', () => {
    const rawScore = 150
    const minScore = 0
    const maxScore = 200

    const normalized = (rawScore - minScore) / (maxScore - minScore)

    expect(normalized).toBe(0.75)
    expect(normalized).toBeGreaterThanOrEqual(0)
    expect(normalized).toBeLessThanOrEqual(1)
  })

  it('handles z-score normalization', () => {
    const scores = [60, 70, 80, 90, 100]
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const variance =
      scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length
    const std = Math.sqrt(variance)

    const zScores = scores.map((s) => (s - mean) / std)

    // Mean of z-scores should be ~0
    const zMean = zScores.reduce((a, b) => a + b, 0) / zScores.length
    expect(Math.abs(zMean)).toBeLessThan(0.001)
  })

  it('calculates percentile rank', () => {
    const scores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const targetScore = 75

    const belowCount = scores.filter((s) => s < targetScore).length
    const percentile = (belowCount / scores.length) * 100

    expect(percentile).toBe(70) // 70th percentile
  })
})

describe('Rubric evaluation', () => {
  it('evaluates binary rubric criteria', () => {
    const criteria = [
      { name: 'completed_task', met: true, weight: 1 },
      { name: 'within_budget', met: true, weight: 1 },
      { name: 'no_errors', met: false, weight: 1 },
    ]

    const score =
      criteria.filter((c) => c.met).reduce((acc, c) => acc + c.weight, 0) /
      criteria.reduce((acc, c) => acc + c.weight, 0)

    expect(score).toBeCloseTo(0.667, 2)
  })

  it('evaluates scaled rubric criteria', () => {
    const criteria = [
      { name: 'quality', score: 4, maxScore: 5 },
      { name: 'efficiency', score: 3, maxScore: 5 },
      { name: 'creativity', score: 5, maxScore: 5 },
    ]

    const totalScore = criteria.reduce((acc, c) => acc + c.score, 0)
    const maxTotal = criteria.reduce((acc, c) => acc + c.maxScore, 0)
    const normalized = totalScore / maxTotal

    expect(normalized).toBe(0.8)
  })
})
