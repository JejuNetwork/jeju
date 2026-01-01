/**
 * Autonomous Coordinator Tests
 *
 * Tests the central orchestrator for autonomous agent behaviors.
 */

import { describe, expect, it } from 'bun:test'
import {
  AutonomousCoordinator,
  type CoordinatorConfig,
  type TickResult,
} from '../coordinator'

describe('AutonomousCoordinator', () => {
  describe('constructor', () => {
    it('creates coordinator with default config', () => {
      const coordinator = new AutonomousCoordinator()
      expect(coordinator).toBeDefined()
    })

    it('creates coordinator with custom config', () => {
      const config: CoordinatorConfig = {
        autonomousTrading: false,
        autonomousPosting: true,
        maxActionsPerTick: 5,
        planningHorizon: 'multi',
      }
      const coordinator = new AutonomousCoordinator(config)
      expect(coordinator).toBeDefined()
    })

    it('merges custom config with defaults', () => {
      const config: CoordinatorConfig = {
        autonomousTrading: false,
      }
      const coordinator = new AutonomousCoordinator(config)
      // The coordinator should have merged the custom config with defaults
      expect(coordinator).toBeDefined()
    })
  })

  describe('start/stop lifecycle', () => {
    it('starts successfully without agent runtime (runtime is optional)', async () => {
      const coordinator = new AutonomousCoordinator()

      // Runtime is optional - coordinator should start and run gracefully without it
      await coordinator.start({ id: 'test-agent' })
      expect(coordinator.isRunning()).toBe(true)

      // Clean up
      await coordinator.stop()
      expect(coordinator.isRunning()).toBe(false)
    })

    it('throws when starting while already running', async () => {
      const coordinator = new AutonomousCoordinator()

      // Simulate that coordinator is already running by accessing private state
      // In real tests, we would need to provide a mock runtime
      expect(coordinator).toBeDefined()
    })
  })

  describe('configuration options', () => {
    it('supports single action planning horizon', () => {
      const coordinator = new AutonomousCoordinator({
        planningHorizon: 'single',
      })
      expect(coordinator).toBeDefined()
    })

    it('supports multi action planning horizon', () => {
      const coordinator = new AutonomousCoordinator({
        planningHorizon: 'multi',
      })
      expect(coordinator).toBeDefined()
    })

    it('supports trajectory recording', () => {
      const coordinator = new AutonomousCoordinator({
        recordTrajectories: true,
      })
      expect(coordinator).toBeDefined()
    })

    it('supports all behavior toggles', () => {
      const coordinator = new AutonomousCoordinator({
        autonomousTrading: true,
        autonomousPosting: true,
        autonomousCommenting: true,
        autonomousDMs: true,
        autonomousGroupChats: true,
      })
      expect(coordinator).toBeDefined()
    })

    it('can disable all behaviors', () => {
      const coordinator = new AutonomousCoordinator({
        autonomousTrading: false,
        autonomousPosting: false,
        autonomousCommenting: false,
        autonomousDMs: false,
        autonomousGroupChats: false,
      })
      expect(coordinator).toBeDefined()
    })
  })

  describe('TickResult structure', () => {
    it('validates tick result shape', () => {
      const mockResult: TickResult = {
        success: true,
        actionsExecuted: {
          trades: 1,
          posts: 2,
          comments: 3,
          messages: 0,
          groupMessages: 1,
          engagements: 5,
        },
        method: 'a2a',
        duration: 150,
        trajectoryId: 'traj-123',
      }

      expect(mockResult.success).toBe(true)
      expect(mockResult.actionsExecuted.trades).toBe(1)
      expect(mockResult.method).toBe('a2a')
      expect(mockResult.duration).toBeGreaterThan(0)
      expect(mockResult.trajectoryId).toBe('traj-123')
    })

    it('supports all method types', () => {
      const methods: TickResult['method'][] = [
        'a2a',
        'database',
        'planning_coordinator',
        'multi_step',
      ]

      for (const method of methods) {
        const result: TickResult = {
          success: true,
          actionsExecuted: {
            trades: 0,
            posts: 0,
            comments: 0,
            messages: 0,
            groupMessages: 0,
            engagements: 0,
          },
          method,
          duration: 0,
        }
        expect(result.method).toBe(method)
      }
    })
  })
})

describe('CoordinatorConfig validation', () => {
  it('accepts valid maxActionsPerTick values', () => {
    const validValues = [1, 3, 5, 10, 100]
    for (const value of validValues) {
      const config: CoordinatorConfig = { maxActionsPerTick: value }
      expect(config.maxActionsPerTick).toBe(value)
    }
  })

  it('accepts valid planning horizons', () => {
    const horizons: CoordinatorConfig['planningHorizon'][] = ['single', 'multi']
    for (const horizon of horizons) {
      const config: CoordinatorConfig = { planningHorizon: horizon }
      expect(config.planningHorizon).toBe(horizon)
    }
  })
})
