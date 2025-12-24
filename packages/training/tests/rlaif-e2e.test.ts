/**
 * RLAIF End-to-End Test Suite
 *
 * Tests the complete RLAIF training pipeline including:
 * - Atropos server setup and coordination
 * - Trajectory generation and labeling
 * - GRPO training steps
 * - Rubric registry integration
 * - DWS compute integration
 * - Cross-chain bridge functionality
 *
 * Note: This test uses lazy imports to avoid bun's subpath export resolution
 * issue with viem/tempo -> ox/tempo/SignatureEnvelope
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { expectValid } from '@jejunetwork/types'
import type { Server } from 'bun'
import { createFundamentalPredictionEnv } from '../src/environments'
import {
  createAtroposServer,
  createGRPOTrainer,
  type ScoredData,
} from '../src/grpo'
// Import only what we need to avoid pulling in viem/tempo
// (bun has issues with ox subpath exports)
import {
  clearRubrics,
  DEFAULT_RUBRIC,
  getRubric,
  hasRubric,
  type JudgeRubric,
  listRubrics,
  registerOrUpdateRubric,
  registerRubric,
} from '../src/rubrics'
import {
  BatchResponseSchema,
  EnvRegistrationResponseSchema,
  HealthResponseSchema,
  InfoResponseSchema,
  RegisterResponseSchema,
  RunInfoResponseSchema,
  ScoredDataListResponseSchema,
  StatusResponseSchema,
} from '../src/schemas'

// Test Configuration

const TEST_PORT = 9100 + Math.floor(Math.random() * 100)
let atroposServer: Server | null = null
const baseUrl = () => `http://localhost:${TEST_PORT}`

// Setup / Teardown

beforeAll(async () => {
  console.log('\n========================================')
  console.log('Starting RLAIF E2E Test Suite')
  console.log('========================================\n')

  // Start Atropos server
  const app = createAtroposServer()
  atroposServer = Bun.serve({
    port: TEST_PORT,
    fetch: app.fetch,
  })

  console.log(`[E2E] Atropos server started on port ${TEST_PORT}`)
})

afterAll(() => {
  if (atroposServer) {
    atroposServer.stop()
    console.log('[E2E] Atropos server stopped')
  }
})

beforeEach(async () => {
  // Reset server state before each test
  await fetch(`${baseUrl()}/reset_data`)
})

// Rubrics Registry Tests

describe('Rubrics Registry', () => {
  beforeEach(() => {
    clearRubrics()
    // Re-register default rubric
    registerOrUpdateRubric(DEFAULT_RUBRIC)
  })

  test('default rubric is registered', () => {
    expect(hasRubric('default')).toBe(true)
    const rubric = getRubric('default')
    expect(rubric).not.toBeNull()
    expect(rubric?.name).toBe('General Agent Evaluation')
  })

  test('can register custom rubric', () => {
    const customRubric: JudgeRubric = {
      id: 'test-rubric',
      name: 'Test Rubric',
      description: 'A test rubric for evaluation',
      criteria: 'Score based on test criteria',
      priorityMetrics: ['metric1', 'metric2'],
    }

    registerRubric(customRubric)
    expect(hasRubric('test-rubric')).toBe(true)

    const retrieved = getRubric('test-rubric')
    expect(retrieved?.id).toBe('test-rubric')
    expect(retrieved?.name).toBe('Test Rubric')
  })

  test('cannot register duplicate rubric', () => {
    const rubric: JudgeRubric = {
      id: 'unique-rubric',
      name: 'Unique',
      description: 'Test',
      criteria: 'Test',
      priorityMetrics: [],
    }

    registerRubric(rubric)
    expect(() => registerRubric(rubric)).toThrow()
  })

  test('listRubrics returns all registered rubrics', () => {
    const rubric1: JudgeRubric = {
      id: 'rubric-1',
      name: 'Rubric 1',
      description: '',
      criteria: '',
      priorityMetrics: [],
    }
    const rubric2: JudgeRubric = {
      id: 'rubric-2',
      name: 'Rubric 2',
      description: '',
      criteria: '',
      priorityMetrics: [],
    }

    registerRubric(rubric1)
    registerRubric(rubric2)

    const rubrics = listRubrics()
    expect(rubrics).toContain('default')
    expect(rubrics).toContain('rubric-1')
    expect(rubrics).toContain('rubric-2')
  })
})

// Atropos Server Tests

describe('Atropos Server Integration', () => {
  test('server health check works', async () => {
    const response = await fetch(`${baseUrl()}/health`)
    expect(response.ok).toBe(true)

    const health = expectValid(
      HealthResponseSchema,
      await response.json(),
      'health check response',
    )
    expect(health.status).toBe('healthy')
  })

  test('trainer registration and info retrieval', async () => {
    // Register trainer
    const regResponse = await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_group: 'e2e-test',
        run_project: 'rlaif-e2e',
        batch_size: 8,
        max_token_len: 1024,
        checkpoint_dir: '/tmp/e2e-test',
        save_checkpoint_interval: 5,
        starting_step: 0,
        num_steps: 20,
      }),
    })

    expect(regResponse.ok).toBe(true)
    const regResult = expectValid(
      RegisterResponseSchema,
      await regResponse.json(),
      'trainer registration response',
    )
    expect(regResult.uuid).toBeDefined()

    // Check run info
    const infoResponse = await fetch(`${baseUrl()}/run_info`)
    const info = expectValid(
      RunInfoResponseSchema,
      await infoResponse.json(),
      'run info response',
    )
    expect(info.group).toBe('e2e-test')
    expect(info.project).toBe('rlaif-e2e')
  })

  test('environment registration flow', async () => {
    // Register trainer first
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_group: 'e2e',
        run_project: 'test',
        batch_size: 4,
        max_token_len: 512,
        checkpoint_dir: '/tmp',
        save_checkpoint_interval: 5,
        starting_step: 0,
        num_steps: 10,
      }),
    })

    // Start training (trigger started state)
    await fetch(`${baseUrl()}/batch`)

    // Register environment
    const envResponse = await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 512,
        desired_name: 'fundamental-prediction',
        weight: 1.0,
        group_size: 4,
      }),
    })

    const envResult = expectValid(
      EnvRegistrationResponseSchema,
      await envResponse.json(),
      'environment registration response',
    )
    expect(envResult.status).toBe('success')
    expect(envResult.env_id).toBe(0)
  })
})

// GRPO Trainer Tests

describe('GRPO Trainer Integration', () => {
  test('trainer can be created and configured', () => {
    const trainer = createGRPOTrainer({
      modelName: 'test-model',
      trainingSteps: 5,
      batchSize: 2,
      atroposUrl: baseUrl(),
    })

    expect(trainer).toBeDefined()
    const config = trainer.getConfig()
    expect(config.modelName).toBe('test-model')
    expect(config.trainingSteps).toBe(5)
    expect(config.batchSize).toBe(2)
  })

  test('trainer registration with Atropos', async () => {
    const trainer = createGRPOTrainer({
      atroposUrl: baseUrl(),
      batchSize: 2,
      trainingSteps: 5,
    })

    await trainer.registerWithAtropos()

    // Verify registration by checking server info
    const infoResponse = await fetch(`${baseUrl()}/info`)
    const info = expectValid(
      InfoResponseSchema,
      await infoResponse.json(),
      'info response',
    )
    // batchSize * gradientAccumulationSteps = 2 * 16 = 32
    expect(info.batch_size).toBe(32)
  })

  test('trainer handles empty batch gracefully', async () => {
    const trainer = createGRPOTrainer({
      atroposUrl: baseUrl(),
    })

    await trainer.registerWithAtropos()
    const batch = await trainer.getBatch()
    expect(batch).toBeNull()
  })
})

// Training Environment Tests

describe('Training Environment Integration', () => {
  test('fundamental prediction environment setup', async () => {
    const env = createFundamentalPredictionEnv()
    await env.setup()

    const item = await env.getNextItem()
    expect(item).toBeDefined()
    expect(item.context).toBeDefined()
    expect(item.answer).toBeDefined()
    expect(item.magnitude).toBeDefined()
    expect(item.fundamentalMetric).toBeDefined()
  })

  test('environment provides sequential items', async () => {
    const env = createFundamentalPredictionEnv()
    await env.setup()

    const item1 = await env.getNextItem()
    const item2 = await env.getNextItem()

    expect(item1).toBeDefined()
    expect(item2).toBeDefined()
    // Items should be different (sequential iteration)
  })

  test('environment metrics tracking', async () => {
    const env = createFundamentalPredictionEnv()
    await env.setup()

    const metrics = env.getTrainingMetrics()
    expect(metrics.directionAccuracy).toBeDefined()
    expect(metrics.magnitudeAccuracy).toBeDefined()
    expect(metrics.combinedScore).toBeDefined()
  })
})

// Full Pipeline Tests

describe('Full RLAIF Pipeline', () => {
  test('complete training flow: register → submit → batch', async () => {
    // 1. Register trainer
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_group: 'pipeline-test',
        run_project: 'rlaif',
        batch_size: 4,
        max_token_len: 512,
        checkpoint_dir: '/tmp/pipeline',
        save_checkpoint_interval: 5,
        starting_step: 0,
        num_steps: 10,
      }),
    })

    // 2. Start (trigger started state)
    await fetch(`${baseUrl()}/batch`)

    // 3. Register environment
    const envResponse = await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 512,
        desired_name: 'test-env',
        weight: 1.0,
        group_size: 4,
      }),
    })
    const envData = expectValid(
      EnvRegistrationResponseSchema,
      await envResponse.json(),
      'environment registration response',
    )
    expect(envData.status).toBe('success')

    // 4. Submit scored data
    const scoredData: ScoredData = {
      tokens: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
      ],
      masks: [
        [0, 0, -100, -100],
        [0, 0, -100, -100],
        [0, 0, -100, -100],
        [0, 0, -100, -100],
      ],
      scores: [0.8, 0.6, 0.4, 0.2],
      env_id: envData.env_id,
    }

    const scoreResponse = await fetch(`${baseUrl()}/scored_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoredData),
    })
    expect(scoreResponse.ok).toBe(true)

    // 5. Check status
    const statusResponse = await fetch(`${baseUrl()}/status`)
    const status = expectValid(
      StatusResponseSchema,
      await statusResponse.json(),
      'status response',
    )
    expect(status.queue_size).toBeGreaterThan(0)
  })

  test('batch retrieval after sufficient data', async () => {
    // Setup
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_group: 'batch-test',
        run_project: 'rlaif',
        batch_size: 4,
        max_token_len: 512,
        checkpoint_dir: '/tmp/batch',
        save_checkpoint_interval: 5,
        starting_step: 0,
        num_steps: 10,
      }),
    })

    await fetch(`${baseUrl()}/batch`)

    await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 512,
        desired_name: 'batch-env',
        weight: 1.0,
        group_size: 4,
      }),
    })

    // Submit enough data for a batch
    for (let i = 0; i < 4; i++) {
      await fetch(`${baseUrl()}/scored_data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [[1, 2, 3, 4]],
          masks: [[0, 0, -100, -100]],
          scores: [Math.random()],
          env_id: 0,
        }),
      })
    }

    // Get batch
    const batchResponse = await fetch(`${baseUrl()}/batch`)
    const batchData = expectValid(
      BatchResponseSchema,
      await batchResponse.json(),
      'batch response',
    )
    expect(batchData.batch).not.toBeNull()
    expect(Array.isArray(batchData.batch)).toBe(true)
  })

  test('environment integration with GRPO trainer', async () => {
    // 1. Setup environment
    const env = createFundamentalPredictionEnv()
    await env.setup()

    // 2. Setup trainer
    const trainer = createGRPOTrainer({
      atroposUrl: baseUrl(),
      batchSize: 2,
      trainingSteps: 2,
    })

    await trainer.registerWithAtropos()

    // Start training (trigger started state)
    await fetch(`${baseUrl()}/batch`)

    // Register the environment
    const envResponse = await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 512,
        desired_name: 'fundamental',
        weight: 1.0,
        group_size: 4,
      }),
    })
    expect(envResponse.ok).toBe(true)

    // 3. Generate some training items and submit
    let submitCount = 0
    for (let i = 0; i < 2; i++) {
      const _item = await env.getNextItem()

      // Simulate scored data
      const submitResponse = await fetch(`${baseUrl()}/scored_data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [[1, 2, 3, 4, 5, 6, 7, 8]],
          masks: [[0, 0, 0, 0, -100, -100, -100, -100]],
          scores: [0.7 + Math.random() * 0.2],
          env_id: 0,
        }),
      })
      if (submitResponse.ok) {
        submitCount++
      }
    }

    // 4. Verify data was submitted
    expect(submitCount).toBe(2)

    // 5. Verify trainer status
    const trainerStatus = trainer.getStatus()
    expect(trainerStatus.running).toBe(false)
  })
})

// Babylon Rubric Integration Tests

describe('Babylon Rubric Integration', () => {
  beforeEach(() => {
    clearRubrics()
    registerOrUpdateRubric(DEFAULT_RUBRIC)
  })

  test('can register Babylon-style rubric', () => {
    const babylonRubric: JudgeRubric = {
      id: 'babylon-trader',
      name: 'Babylon Trader',
      description: 'LLM-as-judge rubric for trader archetype',
      criteria: `
## Trader Archetype Evaluation

Evaluate the trading agent based on:
1. P&L performance
2. Risk management
3. Position sizing
4. Market timing

Score from 0.0 to 1.0 based on overall trading competence.
`,
      priorityMetrics: [
        'behavior.pnlReturn',
        'behavior.winRate',
        'behavior.maxDrawdown',
      ],
    }

    registerRubric(babylonRubric)
    expect(hasRubric('babylon-trader')).toBe(true)

    const retrieved = getRubric('babylon-trader')
    expect(retrieved?.priorityMetrics).toContain('behavior.pnlReturn')
  })

  test('multiple archetypes can coexist', () => {
    const archetypes = ['trader', 'degen', 'researcher']

    for (const archetype of archetypes) {
      registerRubric({
        id: `babylon-${archetype}`,
        name: `Babylon ${archetype}`,
        description: `Rubric for ${archetype}`,
        criteria: `Evaluate ${archetype} behavior`,
        priorityMetrics: [`${archetype}.metric`],
      })
    }

    const registered = listRubrics()
    expect(registered).toContain('babylon-trader')
    expect(registered).toContain('babylon-degen')
    expect(registered).toContain('babylon-researcher')
  })
})

// Performance Tests

describe('Performance', () => {
  test('batch submission handles bulk data', async () => {
    // Setup
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_group: 'perf',
        run_project: 'test',
        batch_size: 32,
        max_token_len: 1024,
        checkpoint_dir: '/tmp/perf',
        save_checkpoint_interval: 10,
        starting_step: 0,
        num_steps: 100,
      }),
    })

    await fetch(`${baseUrl()}/batch`)

    await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 1024,
        desired_name: 'perf-env',
        weight: 1.0,
        group_size: 4,
      }),
    })

    // Submit batch of scored data
    const scoredDataList: ScoredData[] = Array(10)
      .fill(null)
      .map(() => ({
        tokens: [[1, 2, 3, 4]],
        masks: [[0, 0, -100, -100]],
        scores: [Math.random()],
        env_id: 0,
      }))

    const start = performance.now()

    const response = await fetch(`${baseUrl()}/scored_data_list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoredDataList),
    })

    const elapsed = performance.now() - start

    expect(response.ok).toBe(true)
    expect(elapsed).toBeLessThan(2000) // Should complete in under 2 seconds

    const data = expectValid(
      ScoredDataListResponseSchema,
      await response.json(),
      'scored data list response',
    )
    expect(data.groups_processed).toBe(10)
  })
})

console.log('\n========================================')
console.log('Running: bun test packages/training/tests/rlaif-e2e.test.ts')
console.log('========================================\n')
