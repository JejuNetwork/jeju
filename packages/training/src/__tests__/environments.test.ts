/**
 * Training Environments Tests
 *
 * Tests for training environment definitions.
 */

import { describe, expect, it } from 'bun:test'

// Environment state
interface EnvironmentState {
  timestamp: number
  agentBalance: number
  agentPoints: number
  agentPnL: number
  openPositions: number
  custom?: Record<string, unknown>
}

// Action definition
interface Action {
  timestamp: number
  actionType: string
  parameters: Record<string, unknown>
  success: boolean
  error?: string
}

// Step in trajectory
interface Step {
  stepId: string
  stepNumber: number
  timestamp: number
  environmentState: EnvironmentState
  action: Action
  reward: number
}

// Environment config
interface EnvironmentConfig {
  name: string
  version: string
  maxSteps: number
  timeoutMs: number
  actionSpace: string[]
  rewardRange: [number, number]
}

describe('EnvironmentState', () => {
  it('validates complete state', () => {
    const state: EnvironmentState = {
      timestamp: Date.now(),
      agentBalance: 1000,
      agentPoints: 100,
      agentPnL: 50,
      openPositions: 2,
    }

    expect(state.timestamp).toBeGreaterThan(0)
    expect(state.agentBalance).toBeGreaterThanOrEqual(0)
    expect(state.openPositions).toBeGreaterThanOrEqual(0)
  })

  it('validates state with custom fields', () => {
    const state: EnvironmentState = {
      timestamp: Date.now(),
      agentBalance: 500,
      agentPoints: 50,
      agentPnL: -10,
      openPositions: 0,
      custom: {
        marketPhase: 'volatile',
        sentiment: 0.6,
        volume24h: 1000000,
      },
    }

    expect(state.custom).toBeDefined()
    expect(state.custom?.marketPhase).toBe('volatile')
  })

  it('handles negative PnL', () => {
    const state: EnvironmentState = {
      timestamp: Date.now(),
      agentBalance: 800,
      agentPoints: 50,
      agentPnL: -200,
      openPositions: 1,
    }

    expect(state.agentPnL).toBeLessThan(0)
  })
})

describe('Action', () => {
  it('validates successful action', () => {
    const action: Action = {
      timestamp: Date.now(),
      actionType: 'buy',
      parameters: { symbol: 'ETH', amount: 1 },
      success: true,
    }

    expect(action.success).toBe(true)
    expect(action.error).toBeUndefined()
  })

  it('validates failed action', () => {
    const action: Action = {
      timestamp: Date.now(),
      actionType: 'sell',
      parameters: { symbol: 'BTC', amount: 10 },
      success: false,
      error: 'Insufficient balance',
    }

    expect(action.success).toBe(false)
    expect(action.error).toBeDefined()
  })

  it('supports various action types', () => {
    const actionTypes = [
      'buy',
      'sell',
      'hold',
      'post',
      'comment',
      'like',
      'follow',
      'message',
    ]

    for (const actionType of actionTypes) {
      const action: Action = {
        timestamp: Date.now(),
        actionType,
        parameters: {},
        success: true,
      }
      expect(action.actionType).toBe(actionType)
    }
  })
})

describe('Step', () => {
  it('validates complete step', () => {
    const step: Step = {
      stepId: 'step-001',
      stepNumber: 0,
      timestamp: Date.now(),
      environmentState: {
        timestamp: Date.now(),
        agentBalance: 1000,
        agentPoints: 100,
        agentPnL: 0,
        openPositions: 0,
      },
      action: {
        timestamp: Date.now(),
        actionType: 'buy',
        parameters: { symbol: 'ETH', amount: 0.5 },
        success: true,
      },
      reward: 0.1,
    }

    expect(step.stepNumber).toBeGreaterThanOrEqual(0)
    expect(step.reward).toBeGreaterThanOrEqual(-1)
    expect(step.reward).toBeLessThanOrEqual(1)
  })

  it('validates step sequence', () => {
    const steps: Step[] = []
    const baseTime = Date.now()

    for (let i = 0; i < 5; i++) {
      steps.push({
        stepId: `step-${i}`,
        stepNumber: i,
        timestamp: baseTime + i * 1000,
        environmentState: {
          timestamp: baseTime + i * 1000,
          agentBalance: 1000 + i * 10,
          agentPoints: 100 + i * 5,
          agentPnL: i * 10,
          openPositions: i % 3,
        },
        action: {
          timestamp: baseTime + i * 1000,
          actionType: i % 2 === 0 ? 'buy' : 'sell',
          parameters: {},
          success: true,
        },
        reward: 0.1 + i * 0.02,
      })
    }

    // Verify sequential step numbers
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (!step) throw new Error(`Step ${i} is undefined`)
      expect(step.stepNumber).toBe(i)
    }

    // Verify increasing timestamps
    for (let i = 1; i < steps.length; i++) {
      const current = steps[i]
      const previous = steps[i - 1]
      if (!current || !previous)
        throw new Error(`Step at index ${i} is undefined`)
      expect(current.timestamp).toBeGreaterThan(previous.timestamp)
    }
  })
})

describe('EnvironmentConfig', () => {
  it('validates trading environment config', () => {
    const config: EnvironmentConfig = {
      name: 'trading-v1',
      version: '1.0.0',
      maxSteps: 1000,
      timeoutMs: 60000,
      actionSpace: ['buy', 'sell', 'hold'],
      rewardRange: [-1, 1],
    }

    expect(config.name).toBe('trading-v1')
    expect(config.maxSteps).toBeGreaterThan(0)
    expect(config.actionSpace).toContain('buy')
    expect(config.rewardRange[0]).toBeLessThan(config.rewardRange[1])
  })

  it('validates social environment config', () => {
    const config: EnvironmentConfig = {
      name: 'social-v1',
      version: '1.0.0',
      maxSteps: 500,
      timeoutMs: 30000,
      actionSpace: ['post', 'comment', 'like', 'follow', 'message', 'noop'],
      rewardRange: [0, 1],
    }

    expect(config.actionSpace).toHaveLength(6)
    expect(config.rewardRange[0]).toBe(0)
  })

  it('validates game environment config', () => {
    const config: EnvironmentConfig = {
      name: 'tic-tac-toe',
      version: '1.0.0',
      maxSteps: 9,
      timeoutMs: 5000,
      actionSpace: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
      rewardRange: [-1, 1],
    }

    expect(config.maxSteps).toBe(9)
    expect(config.actionSpace).toHaveLength(9)
  })
})

describe('Reward calculation', () => {
  it('calculates trading reward', () => {
    const startBalance = 1000
    const endBalance = 1050
    const pnlPercent = ((endBalance - startBalance) / startBalance) * 100

    expect(pnlPercent).toBe(5) // 5% gain
  })

  it('calculates social engagement reward', () => {
    const metrics = {
      likes: 10,
      comments: 5,
      shares: 2,
    }
    const weights = { likes: 1, comments: 3, shares: 5 }

    const engagementScore =
      metrics.likes * weights.likes +
      metrics.comments * weights.comments +
      metrics.shares * weights.shares

    expect(engagementScore).toBe(35) // 10 + 15 + 10
  })

  it('applies time decay to reward', () => {
    const baseReward = 1.0
    const decayRate = 0.1
    const stepsElapsed = 5

    const decayedReward = baseReward * Math.exp(-decayRate * stepsElapsed)

    expect(decayedReward).toBeLessThan(baseReward)
    expect(decayedReward).toBeGreaterThan(0)
  })
})

describe('Episode termination', () => {
  it('terminates on max steps', () => {
    const maxSteps = 100
    const currentStep = 100

    const shouldTerminate = currentStep >= maxSteps
    expect(shouldTerminate).toBe(true)
  })

  it('terminates on win condition', () => {
    const winCondition = { threshold: 1000, metric: 'points' }
    const agentPoints = 1050

    const hasWon = agentPoints >= winCondition.threshold
    expect(hasWon).toBe(true)
  })

  it('terminates on loss condition', () => {
    const lossCondition = { minBalance: 100 }
    const agentBalance = 50

    const hasLost = agentBalance < lossCondition.minBalance
    expect(hasLost).toBe(true)
  })

  it('terminates on timeout', () => {
    const startTime = Date.now() - 70000 // 70 seconds ago
    const timeoutMs = 60000

    const hasTimedOut = Date.now() - startTime > timeoutMs
    expect(hasTimedOut).toBe(true)
  })
})
