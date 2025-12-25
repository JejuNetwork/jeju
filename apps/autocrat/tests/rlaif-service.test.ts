/**
 * RLAIF Service Unit Tests
 *
 * Tests the RLAIF service directly without starting the full server.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  type CreateRunRequest,
  createRLAIFService,
  RunStatus,
  type Trajectory,
} from '../api/rlaif-service'

describe('RLAIF Service', () => {
  let service: ReturnType<typeof createRLAIFService>

  beforeEach(() => {
    service = createRLAIFService()
  })

  describe('Run Management', () => {
    it('should create a run with correct initial state', () => {
      const request: CreateRunRequest = {
        environment: { id: 'test-env', type: 'game', configCID: 'QmTest' },
        archetype: 'trader',
        baseModel: 'test-model',
        trainingConfig: { steps: 100, batchSize: 8, learningRate: 0.0001 },
      }

      const run = service.createRun(request)

      expect(run.runId).toMatch(/^rlaif-/)
      expect(run.status).toBe(RunStatus.PENDING)
      expect(run.environment.id).toBe('test-env')
      expect(run.archetype).toBe('trader')
      expect(run.baseModel).toBe('test-model')
      expect(run.progress).toBe(0)
      expect(run.currentStep).toBe(0)
      expect(run.totalSteps).toBe(100)
      expect(run.modelCID).toBeNull()
      expect(run.error).toBeNull()
    })

    it('should generate unique run IDs', () => {
      const request: CreateRunRequest = {
        environment: { id: 'test', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      }

      const run1 = service.createRun(request)
      const run2 = service.createRun(request)

      expect(run1.runId).not.toBe(run2.runId)
    })

    it('should get run by ID', () => {
      const request: CreateRunRequest = {
        environment: { id: 'test', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      }

      const created = service.createRun(request)
      const retrieved = service.getRun(created.runId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.runId).toBe(created.runId)
    })

    it('should return null for non-existent run', () => {
      const run = service.getRun('non-existent-id')
      expect(run).toBeNull()
    })

    it('should list all runs', () => {
      const request: CreateRunRequest = {
        environment: { id: 'test', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      }

      service.createRun(request)
      service.createRun(request)
      service.createRun(request)

      const runs = service.listRuns()
      expect(runs.length).toBe(3)
    })

    it('should filter runs by environment', () => {
      service.createRun({
        environment: { id: 'env1', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })
      service.createRun({
        environment: { id: 'env2', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })
      service.createRun({
        environment: { id: 'env1', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const env1Runs = service.listRuns('env1')
      expect(env1Runs.length).toBe(2)
      for (const r of env1Runs) {
        expect(r.environment.id).toBe('env1')
      }
    })

    it('should update run status', () => {
      const run = service.createRun({
        environment: { id: 'test', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const updated = service.updateRunStatus(run.runId, RunStatus.QUEUED)

      expect(updated).not.toBeNull()
      expect(updated?.status).toBe(RunStatus.QUEUED)
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(run.createdAt)
    })

    it('should set startedAt when training starts', () => {
      const run = service.createRun({
        environment: { id: 'test', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      expect(run.startedAt).toBeNull()

      const updated = service.updateRunStatus(run.runId, RunStatus.TRAINING)

      expect(updated?.startedAt).not.toBeNull()
    })

    it('should set completedAt when run completes', () => {
      const run = service.createRun({
        environment: { id: 'test', type: 'game', configCID: 'Qm' },
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const updated = service.updateRunStatus(run.runId, RunStatus.COMPLETED)

      expect(updated?.completedAt).not.toBeNull()
    })
  })

  describe('Trajectory Management', () => {
    it('should submit trajectories', () => {
      const result = service.submitTrajectories('test-env', 'trader', [
        {
          agentId: 'agent-001',
          steps: [
            {
              observation: 'state1',
              action: 'act1',
              reward: 0.5,
              metadata: {},
            },
            {
              observation: 'state2',
              action: 'act2',
              reward: 0.3,
              metadata: {},
            },
          ],
        },
      ])

      expect(result.count).toBe(1)
      expect(result.totalForArchetype).toBe(1)
    })

    it('should accumulate trajectories', () => {
      service.submitTrajectories('test-env', 'trader', [
        {
          agentId: 'agent-001',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
        },
      ])

      const result = service.submitTrajectories('test-env', 'trader', [
        {
          agentId: 'agent-002',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
        },
        {
          agentId: 'agent-003',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
        },
      ])

      expect(result.count).toBe(2)
      expect(result.totalForArchetype).toBe(3)
    })

    it('should get trajectory stats', () => {
      service.submitTrajectories('test-env', 'trader', [
        {
          agentId: 'agent-001',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
        },
      ])
      service.submitTrajectories('test-env', 'degen', [
        {
          agentId: 'agent-002',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
        },
        {
          agentId: 'agent-003',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
        },
      ])

      const stats = service.getTrajectoryStats('test-env')

      expect(stats.environment).toBe('test-env')
      expect(stats.totalTrajectories).toBe(3)
      expect(stats.byArchetype.trader).toBe(1)
      expect(stats.byArchetype.degen).toBe(2)
      expect(stats.thresholdNeeded).toBe(20)
      expect(stats.readyForTraining).toBe(false)
    })

    it('should indicate ready for training when threshold met', () => {
      const trajectories = Array.from({ length: 25 }, (_, i) => ({
        agentId: `agent-${i}`,
        steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
      }))

      service.submitTrajectories('test-env', 'trader', trajectories)

      const stats = service.getTrajectoryStats('test-env')

      expect(stats.readyForTraining).toBe(true)
    })

    it('should get trajectories by environment and archetype', () => {
      service.submitTrajectories('test-env', 'trader', [
        {
          agentId: 'agent-001',
          steps: [{ observation: 's1', action: 'a1', reward: 1, metadata: {} }],
        },
      ])
      service.submitTrajectories('test-env', 'degen', [
        {
          agentId: 'agent-002',
          steps: [{ observation: 's2', action: 'a2', reward: 2, metadata: {} }],
        },
      ])

      const traderTrajectories = service.getTrajectories('test-env', 'trader')
      const degenTrajectories = service.getTrajectories('test-env', 'degen')

      expect(traderTrajectories.length).toBe(1)
      expect(traderTrajectories[0]?.agentId).toBe('agent-001')
      expect(degenTrajectories.length).toBe(1)
      expect(degenTrajectories[0]?.agentId).toBe('agent-002')
    })
  })

  describe('Run with Rollouts', () => {
    it('should submit rollouts to a run', () => {
      const run = service.createRun({
        environment: { id: 'test-env', type: 'game', configCID: 'Qm' },
        archetype: 'trader',
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const trajectories: Trajectory[] = [
        {
          agentId: 'agent-001',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
          totalReward: 1,
          archetype: 'trader',
          environment: 'test-env',
          createdAt: Date.now(),
        },
      ]

      const result = service.submitRolloutsForRun(run.runId, trajectories)

      expect(result).not.toBeNull()
      expect(result?.count).toBe(1)

      const updated = service.getRun(run.runId)
      expect(updated?.trajectoryCount).toBe(1)
    })

    it('should get rollouts for a run', () => {
      const run = service.createRun({
        environment: { id: 'test-env', type: 'game', configCID: 'Qm' },
        archetype: 'test-arch',
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const trajectories: Trajectory[] = [
        {
          agentId: 'agent-001',
          steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
          totalReward: 1,
          archetype: 'test-arch',
          environment: 'test-env',
          createdAt: Date.now(),
        },
      ]

      service.submitRolloutsForRun(run.runId, trajectories)

      const rollouts = service.getRolloutsForRun(run.runId)
      expect(rollouts.length).toBe(1)
    })
  })

  describe('Starting Runs', () => {
    it('should fail to start without enough trajectories', () => {
      const run = service.createRun({
        environment: { id: 'empty-env', type: 'game', configCID: 'Qm' },
        archetype: 'test-arch',
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const result = service.startRun(run.runId)

      expect(result?.status).toBe(RunStatus.FAILED)
      expect(result?.error).toContain('Not enough trajectories')
    })

    it('should start run with enough trajectories', () => {
      const run = service.createRun({
        environment: { id: 'full-env', type: 'game', configCID: 'Qm' },
        archetype: 'full-arch',
        baseModel: 'model',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      // Submit enough trajectories
      const trajectories = Array.from({ length: 25 }, (_, i) => ({
        agentId: `agent-${i}`,
        steps: [{ observation: 's', action: 'a', reward: 1, metadata: {} }],
      }))
      service.submitTrajectories('full-env', 'full-arch', trajectories)

      const result = service.startRun(run.runId)

      expect(result?.status).toBe(RunStatus.QUEUED)
      expect(result?.trajectoryCount).toBe(25)
    })

    it('should allow start with trajectoryBatchCID even without local trajectories', () => {
      const run = service.createRun({
        environment: { id: 'cid-env', type: 'game', configCID: 'Qm' },
        archetype: 'cid-arch',
        baseModel: 'model',
        trajectoryBatchCID: 'QmExistingBatch',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      const result = service.startRun(run.runId)

      expect(result?.status).toBe(RunStatus.QUEUED)
    })
  })

  describe('Processing Runs', () => {
    it('should process a run through all stages', async () => {
      const run = service.createRun({
        environment: { id: 'process-env', type: 'game', configCID: 'Qm' },
        archetype: 'process-arch',
        baseModel: 'model',
        trajectoryBatchCID: 'QmBatch',
        trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
      })

      service.startRun(run.runId)
      const result = await service.processRun(run.runId)

      expect(result).not.toBeNull()
      expect(result?.status).toBe(RunStatus.COMPLETED)
      expect(result?.progress).toBe(100)
      expect(result?.modelCID).toBeDefined()
      expect(result?.modelCID).toMatch(/^Qm/)
    })
  })
})
