/**
 * RLAIF Framework Tests
 *
 * End-to-end tests for the Reinforcement Learning from AI Feedback system.
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { RulerScorer } from '../api/rlaif/ruler-scorer'
import { TrajectoryStore } from '../api/rlaif/trajectory-store'
import type {
  JudgeRubric,
  JudgeScore,
  RLAIFRunConfig,
  RLAlgorithm,
  Trajectory,
} from '../api/rlaif/types'

// Mock fetch for storage tests
const mockStorageResponses = new Map<string, unknown>()
const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = mock(async (url: string, options?: RequestInit) => {
    const urlStr = url.toString()

    if (urlStr.includes('/upload')) {
      const body = options?.body
      const content = typeof body === 'string' ? body : ''
      const cid = `mock-cid-${Math.random().toString(36).slice(2, 10)}`
      mockStorageResponses.set(cid, JSON.parse(content))
      return new Response(JSON.stringify({ cid }), { status: 200 })
    }

    if (urlStr.includes('/get/')) {
      const cid = urlStr.split('/get/')[1]
      const data = mockStorageResponses.get(cid ?? '')
      if (data) {
        return new Response(JSON.stringify(data), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    }

    if (urlStr.includes('/judge')) {
      return new Response(
        JSON.stringify({
          content: JSON.stringify({
            scores: [
              {
                trajectory_id: 'trajectory-1',
                explanation: 'Good',
                score: 0.8,
              },
              {
                trajectory_id: 'trajectory-2',
                explanation: 'Average',
                score: 0.5,
              },
            ],
          }),
        }),
        { status: 200 },
      )
    }

    return originalFetch(url, options)
  })
})

describe('TrajectoryStore', () => {
  const store = new TrajectoryStore({
    storageApiUrl: 'http://localhost:4011',
  })

  test('should store and load trajectory', async () => {
    const trajectory: Trajectory = {
      id: 'test-traj-1',
      environmentId: 'test-env',
      agentId: 'test-agent',
      policyModelCID: 'model-cid',
      steps: [
        {
          stepNumber: 0,
          timestamp: Date.now(),
          observation: { state: 'initial' },
          action: { type: 'move', parameters: { direction: 'left' } },
          reward: 0.5,
          done: false,
        },
        {
          stepNumber: 1,
          timestamp: Date.now() + 1000,
          observation: { state: 'moved' },
          action: { type: 'collect', parameters: {} },
          reward: 1.0,
          done: true,
        },
      ],
      totalReward: 1.5,
      metadata: {
        startTime: Date.now(),
        endTime: Date.now() + 1000,
        episodeLength: 2,
      },
    }

    const cid = await store.storeTrajectory(trajectory)
    expect(cid).toMatch(/^mock-cid-/)

    const loaded = await store.loadTrajectory(cid)
    expect(loaded.id).toBe(trajectory.id)
    expect(loaded.totalReward).toBe(1.5)
    expect(loaded.steps.length).toBe(2)
  })

  test('should store multiple trajectories and create manifest', async () => {
    const trajectories: Trajectory[] = [
      {
        id: 'batch-traj-1',
        environmentId: 'test-env',
        agentId: 'agent-1',
        policyModelCID: 'model-cid',
        steps: [
          {
            stepNumber: 0,
            timestamp: Date.now(),
            observation: {},
            action: { type: 'a', parameters: {} },
            reward: 1,
            done: true,
          },
        ],
        totalReward: 1,
        metadata: { startTime: 0, endTime: 1, episodeLength: 1 },
      },
      {
        id: 'batch-traj-2',
        environmentId: 'test-env',
        agentId: 'agent-2',
        policyModelCID: 'model-cid',
        steps: [
          {
            stepNumber: 0,
            timestamp: Date.now(),
            observation: {},
            action: { type: 'b', parameters: {} },
            reward: 2,
            done: true,
          },
        ],
        totalReward: 2,
        metadata: { startTime: 0, endTime: 1, episodeLength: 1 },
      },
    ]

    const manifest = await store.storeTrajectories(trajectories)

    expect(manifest.cid).toMatch(/^mock-cid-/)
    expect(manifest.totalCount).toBe(2)
    expect(manifest.trajectoryCIDs.length).toBe(2)
    expect(manifest.merkleRoot).toMatch(/^0x/)
  })

  test('should store and load rewards', async () => {
    const scores: JudgeScore[] = [
      {
        trajectoryId: 't1',
        score: 0.8,
        reasoning: 'Good',
        rubricId: 'default',
        judgedAt: Date.now(),
      },
      {
        trajectoryId: 't2',
        score: 0.5,
        reasoning: 'Average',
        rubricId: 'default',
        judgedAt: Date.now(),
      },
    ]

    const cid = await store.storeRewards(scores)
    expect(cid).toMatch(/^mock-cid-/)

    const loaded = await store.loadRewards(cid)
    expect(loaded.length).toBe(2)
    expect(loaded[0].score).toBe(0.8)
  })
})

describe('RulerScorer', () => {
  const scorer = new RulerScorer({
    computeApiUrl: 'http://localhost:4010',
  })

  test('should score trajectories', async () => {
    const trajectories: Trajectory[] = [
      {
        id: 'ruler-traj-1',
        environmentId: 'test-env',
        agentId: 'agent-1',
        policyModelCID: 'model',
        steps: [
          {
            stepNumber: 0,
            timestamp: Date.now(),
            observation: {},
            action: { type: 'buy', parameters: {} },
            reward: 10,
            done: true,
          },
        ],
        totalReward: 10,
        metadata: { startTime: 0, endTime: 1, episodeLength: 1, finalPnL: 100 },
      },
      {
        id: 'ruler-traj-2',
        environmentId: 'test-env',
        agentId: 'agent-2',
        policyModelCID: 'model',
        steps: [
          {
            stepNumber: 0,
            timestamp: Date.now(),
            observation: {},
            action: { type: 'sell', parameters: {} },
            reward: 5,
            done: true,
          },
        ],
        totalReward: 5,
        metadata: { startTime: 0, endTime: 1, episodeLength: 1, finalPnL: 50 },
      },
    ]

    const rubric: JudgeRubric = {
      id: 'test-rubric',
      name: 'Test Rubric',
      description: 'Test evaluation',
      criteria: 'Higher reward is better',
      priorityMetrics: ['totalReward'],
    }

    const scores = await scorer.scoreTrajectories(trajectories, rubric)

    expect(scores.length).toBe(2)
    expect(scores[0].score).toBeGreaterThan(0)
    expect(scores[0].score).toBeLessThanOrEqual(1)
    expect(scores[0].rubricId).toBe('test-rubric')
  })

  test('should return empty for insufficient trajectories', async () => {
    const trajectories: Trajectory[] = [
      {
        id: 'single-traj',
        environmentId: 'test-env',
        agentId: 'agent-1',
        policyModelCID: 'model',
        steps: [],
        totalReward: 0,
        metadata: { startTime: 0, endTime: 0, episodeLength: 0 },
      },
    ]

    const rubric: JudgeRubric = {
      id: 'test',
      name: 'Test',
      description: '',
      criteria: '',
      priorityMetrics: [],
    }

    const scores = await scorer.scoreTrajectories(trajectories, rubric)
    expect(scores.length).toBe(0)
  })
})

describe('RLAIF Config', () => {
  test('should create valid run config', () => {
    const config: RLAIFRunConfig = {
      runId: 'test-run',
      creator: '0x0000000000000000000000000000000000000000',
      environment: {
        id: 'test-env',
        type: 'simulation',
        configCID: 'env-config-cid',
      },
      model: {
        baseModelCID: 'model-cid',
        tokenizer: 'Qwen/Qwen2.5-3B-Instruct',
        maxSeqLen: 4096,
        dtype: 'bfloat16',
      },
      rl: {
        algorithm: 'grpo' as RLAlgorithm,
        learningRate: 1e-5,
        batchSize: 4,
        gradientAccumulationSteps: 8,
        maxGradNorm: 1.0,
        klCoefficient: 0.1,
        entropyCoefficient: 0.01,
        valueCoefficient: 0.5,
        gamma: 0.99,
        gaeλ: 0.95,
        epochs: 1,
        clipRange: 0.2,
      },
      judge: {
        modelCID: 'gpt-5',
        rubricId: 'default',
        temperature: 0.3,
      },
      evaluation: {
        suiteId: 'default',
        minScore: 0.7,
        maxRegressionPercent: 5,
        requiredMetrics: [],
      },
      targetIterations: 10,
      minTrajectoriesPerIteration: 20,
    }

    expect(config.runId).toBe('test-run')
    expect(config.rl.algorithm).toBe('grpo')
    expect(config.targetIterations).toBe(10)
  })

  test('should support all RL algorithms', () => {
    const algorithms: RLAlgorithm[] = ['grpo', 'ppo', 'dpo', 'reinforce']

    for (const algo of algorithms) {
      const config: Partial<RLAIFRunConfig> = {
        rl: {
          algorithm: algo,
          learningRate: 1e-5,
          batchSize: 4,
          gradientAccumulationSteps: 8,
          maxGradNorm: 1.0,
          klCoefficient: 0.1,
          entropyCoefficient: 0.01,
          valueCoefficient: 0.5,
          gamma: 0.99,
          gaeλ: 0.95,
          epochs: 1,
          clipRange: 0.2,
        },
      }
      expect(config.rl?.algorithm).toBe(algo)
    }
  })
})

describe('Trajectory Format', () => {
  test('should support LLM calls in steps', () => {
    const trajectory: Trajectory = {
      id: 'llm-traj',
      environmentId: 'test',
      agentId: 'agent',
      policyModelCID: 'model',
      steps: [
        {
          stepNumber: 0,
          timestamp: Date.now(),
          observation: { market: 'BTC/USD', price: 50000 },
          action: {
            type: 'trade',
            parameters: { amount: 0.1, side: 'buy' },
            reasoning: 'Market looks bullish based on technical analysis',
          },
          reward: 0.5,
          done: false,
          llmCalls: [
            {
              model: 'gpt-4',
              systemPrompt: 'You are a trading agent',
              userPrompt: 'Analyze this market condition',
              response: 'I recommend buying based on...',
              reasoning: 'Technical indicators show...',
              temperature: 0.7,
              latencyMs: 500,
              purpose: 'reasoning',
            },
          ],
        },
      ],
      totalReward: 0.5,
      metadata: {
        startTime: Date.now(),
        endTime: Date.now() + 1000,
        episodeLength: 1,
        archetype: 'trader',
        finalPnL: 100,
      },
    }

    expect(trajectory.steps[0].llmCalls?.length).toBe(1)
    expect(trajectory.steps[0].llmCalls?.[0]?.purpose).toBe('reasoning')
    expect(trajectory.metadata.archetype).toBe('trader')
    expect(trajectory.metadata.finalPnL).toBe(100)
  })
})

describe('Integration', () => {
  test('should flow from trajectories to scores to training data', async () => {
    const store = new TrajectoryStore({
      storageApiUrl: 'http://localhost:4011',
    })
    const scorer = new RulerScorer({ computeApiUrl: 'http://localhost:4010' })

    // Create trajectories
    const trajectories: Trajectory[] = [
      {
        id: 'int-traj-1',
        environmentId: 'test',
        agentId: 'a1',
        policyModelCID: 'model',
        steps: [
          {
            stepNumber: 0,
            timestamp: Date.now(),
            observation: {},
            action: { type: 'a', parameters: {} },
            reward: 1,
            done: true,
          },
        ],
        totalReward: 1,
        metadata: { startTime: 0, endTime: 1, episodeLength: 1 },
      },
      {
        id: 'int-traj-2',
        environmentId: 'test',
        agentId: 'a2',
        policyModelCID: 'model',
        steps: [
          {
            stepNumber: 0,
            timestamp: Date.now(),
            observation: {},
            action: { type: 'b', parameters: {} },
            reward: 2,
            done: true,
          },
        ],
        totalReward: 2,
        metadata: { startTime: 0, endTime: 1, episodeLength: 1 },
      },
    ]

    // Store trajectories
    const manifest = await store.storeTrajectories(trajectories)
    expect(manifest.totalCount).toBe(2)

    // Score trajectories
    const scores = await scorer.scoreTrajectories(trajectories, {
      id: 'default',
      name: 'Default',
      description: '',
      criteria: '',
      priorityMetrics: [],
    })
    expect(scores.length).toBe(2)

    // Store rewards
    const rewardsCid = await store.storeRewards(scores)
    expect(rewardsCid).toMatch(/^mock-cid-/)

    // Load rewards
    const loadedScores = await store.loadRewards(rewardsCid)
    expect(loadedScores.length).toBe(2)
  })
})
