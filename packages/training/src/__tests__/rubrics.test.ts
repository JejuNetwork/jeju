/**
 * Training Rubrics Tests
 *
 * Tests for rubric definitions and evaluation.
 */

import { describe, expect, it } from 'bun:test'

// Rubric criterion
interface RubricCriterion {
  name: string
  description: string
  weight: number
  levels: {
    score: number
    description: string
  }[]
}

// Rubric definition
interface Rubric {
  id: string
  name: string
  archetype: string
  version: string
  criteria: RubricCriterion[]
}

// Evaluation result
interface EvaluationResult {
  rubricId: string
  trajectoryId: string
  scores: {
    criterion: string
    score: number
    level: number
    feedback: string
  }[]
  totalScore: number
  normalizedScore: number
  timestamp: number
}

describe('RubricCriterion', () => {
  it('validates trading criterion', () => {
    const criterion: RubricCriterion = {
      name: 'profitability',
      description: 'Measures trading profitability over time',
      weight: 0.4,
      levels: [
        { score: 0, description: 'Significant losses (>10%)' },
        { score: 1, description: 'Minor losses (0-10%)' },
        { score: 2, description: 'Break even' },
        { score: 3, description: 'Minor gains (0-10%)' },
        { score: 4, description: 'Significant gains (>10%)' },
      ],
    }

    expect(criterion.levels).toHaveLength(5)
    expect(criterion.weight).toBeLessThanOrEqual(1)
    expect(criterion.levels[0].score).toBeLessThan(criterion.levels[4].score)
  })

  it('validates social engagement criterion', () => {
    const criterion: RubricCriterion = {
      name: 'engagement_quality',
      description: 'Quality of social interactions',
      weight: 0.3,
      levels: [
        { score: 0, description: 'Spam or low-quality content' },
        { score: 1, description: 'Generic responses' },
        { score: 2, description: 'Relevant but not insightful' },
        { score: 3, description: 'Helpful and informative' },
        { score: 4, description: 'Exceptional value added' },
      ],
    }

    expect(criterion.name).toBe('engagement_quality')
    expect(criterion.levels.every((l) => l.score >= 0)).toBe(true)
  })

  it('validates risk management criterion', () => {
    const criterion: RubricCriterion = {
      name: 'risk_management',
      description: 'Adherence to risk management principles',
      weight: 0.3,
      levels: [
        { score: 0, description: 'Reckless risk-taking' },
        { score: 1, description: 'Inconsistent risk management' },
        { score: 2, description: 'Basic risk awareness' },
        { score: 3, description: 'Good risk-reward balance' },
        { score: 4, description: 'Excellent risk management' },
      ],
    }

    expect(criterion.weight).toBe(0.3)
  })
})

describe('Rubric', () => {
  it('validates trader rubric', () => {
    const rubric: Rubric = {
      id: 'trader-v1',
      name: 'Trading Agent Rubric',
      archetype: 'trader',
      version: '1.0.0',
      criteria: [
        {
          name: 'profitability',
          description: 'Trading PnL',
          weight: 0.4,
          levels: [
            { score: 0, description: 'Loss' },
            { score: 1, description: 'Break even' },
            { score: 2, description: 'Profit' },
          ],
        },
        {
          name: 'risk_management',
          description: 'Risk control',
          weight: 0.3,
          levels: [
            { score: 0, description: 'Poor' },
            { score: 1, description: 'Moderate' },
            { score: 2, description: 'Excellent' },
          ],
        },
        {
          name: 'timing',
          description: 'Entry/exit timing',
          weight: 0.3,
          levels: [
            { score: 0, description: 'Bad timing' },
            { score: 1, description: 'Neutral' },
            { score: 2, description: 'Good timing' },
          ],
        },
      ],
    }

    expect(rubric.archetype).toBe('trader')
    expect(rubric.criteria).toHaveLength(3)

    const totalWeight = rubric.criteria.reduce((sum, c) => sum + c.weight, 0)
    expect(totalWeight).toBeCloseTo(1.0, 2)
  })

  it('validates researcher rubric', () => {
    const rubric: Rubric = {
      id: 'researcher-v1',
      name: 'Researcher Agent Rubric',
      archetype: 'researcher',
      version: '1.0.0',
      criteria: [
        {
          name: 'accuracy',
          description: 'Information accuracy',
          weight: 0.4,
          levels: [
            { score: 0, description: 'Inaccurate' },
            { score: 1, description: 'Partially accurate' },
            { score: 2, description: 'Accurate' },
          ],
        },
        {
          name: 'depth',
          description: 'Analysis depth',
          weight: 0.3,
          levels: [
            { score: 0, description: 'Shallow' },
            { score: 1, description: 'Moderate' },
            { score: 2, description: 'Deep' },
          ],
        },
        {
          name: 'citation',
          description: 'Source citation',
          weight: 0.3,
          levels: [
            { score: 0, description: 'No sources' },
            { score: 1, description: 'Some sources' },
            { score: 2, description: 'Well sourced' },
          ],
        },
      ],
    }

    expect(rubric.archetype).toBe('researcher')
  })
})

describe('EvaluationResult', () => {
  it('validates complete evaluation', () => {
    const result: EvaluationResult = {
      rubricId: 'trader-v1',
      trajectoryId: 'traj-123',
      scores: [
        {
          criterion: 'profitability',
          score: 3,
          level: 3,
          feedback: 'Consistent profits with good ROI',
        },
        {
          criterion: 'risk_management',
          score: 2,
          level: 2,
          feedback: 'Adequate position sizing',
        },
        {
          criterion: 'timing',
          score: 1,
          level: 1,
          feedback: 'Neutral market timing',
        },
      ],
      totalScore: 6,
      normalizedScore: 0.75,
      timestamp: Date.now(),
    }

    expect(result.scores).toHaveLength(3)
    expect(result.normalizedScore).toBeLessThanOrEqual(1)
    expect(result.normalizedScore).toBeGreaterThanOrEqual(0)
  })

  it('calculates weighted total score', () => {
    const scores = [
      { score: 4, weight: 0.4 }, // profitability
      { score: 3, weight: 0.3 }, // risk
      { score: 2, weight: 0.3 }, // timing
    ]

    const weightedTotal = scores.reduce(
      (sum, s) => sum + s.score * s.weight,
      0,
    )

    expect(weightedTotal).toBeCloseTo(3.1, 1) // 1.6 + 0.9 + 0.6
  })

  it('normalizes score to 0-1 range', () => {
    const rawScore = 6
    const maxPossible = 8 // 4 + 2 + 2 based on level maxes

    const normalized = rawScore / maxPossible

    expect(normalized).toBe(0.75)
  })
})

describe('Archetype-specific rubrics', () => {
  it('validates all archetypes', () => {
    const archetypes = [
      'trader',
      'researcher',
      'social-butterfly',
      'degen',
      'super-predictor',
      'information-trader',
      'goody-twoshoes',
      'red-team',
      'blue-team',
      'liar',
      'scammer',
    ]

    expect(archetypes).toContain('trader')
    expect(archetypes).toContain('researcher')
    expect(archetypes).toContain('degen')
    expect(archetypes.length).toBeGreaterThan(5)
  })

  it('validates archetype-criterion mapping', () => {
    const archetypeCriteria: Record<string, string[]> = {
      trader: ['profitability', 'risk_management', 'timing'],
      researcher: ['accuracy', 'depth', 'citation'],
      'social-butterfly': ['engagement', 'network_growth', 'content_quality'],
      degen: ['risk_tolerance', 'meme_awareness', 'speed'],
    }

    expect(archetypeCriteria.trader).toContain('profitability')
    expect(archetypeCriteria.researcher).toContain('accuracy')
  })
})

describe('Rubric versioning', () => {
  it('validates semver format', () => {
    const versions = ['1.0.0', '1.1.0', '2.0.0', '1.0.1']

    for (const version of versions) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('compares rubric versions', () => {
    const parseVersion = (v: string) => v.split('.').map(Number)

    const v1 = parseVersion('1.0.0')
    const v2 = parseVersion('1.1.0')

    // Compare major.minor
    const isNewer =
      v2[0] > v1[0] || (v2[0] === v1[0] && v2[1] > v1[1])

    expect(isNewer).toBe(true)
  })
})

