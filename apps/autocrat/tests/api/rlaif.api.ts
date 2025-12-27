/**
 * RLAIF Tests - Training run and trajectory management
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`

test.describe('RLAIF Endpoints', () => {
  test.describe('Health', () => {
    test('rlaif health endpoint returns ok', async ({ request }) => {
      const response = await request.get(`${AUTOCRAT_URL}/rlaif/health`)
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.status).toBe('ok')
      expect(data.service).toBe('rlaif')
      expect(data.version).toBe('1.0.0')
      expect(data.stats).toBeDefined()
      expect(typeof data.stats.totalRuns).toBe('number')
      expect(typeof data.stats.trajectories).toBe('number')
    })
  })

  test.describe('Training Runs', () => {
    test('can create a training run', async ({ request }) => {
      const response = await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: {
            id: 'test-env',
            type: 'game',
            configCID: 'QmTestConfig',
          },
          archetype: 'trader',
          baseModel: 'Qwen/Qwen2.5-3B-Instruct',
          trainingConfig: {
            steps: 100,
            batchSize: 8,
            learningRate: 0.0001,
          },
        },
      })
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.runId).toBeDefined()
      expect(data.runId).toMatch(/^rlaif-/)
      expect(data.status).toBe('pending')
      expect(data.estimatedStart).toBeGreaterThan(Date.now() - 10000)
    })

    test('can get run status', async ({ request }) => {
      // First create a run
      const createResponse = await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: { id: 'test-env', type: 'game', configCID: 'QmConfig' },
          archetype: 'degen',
          baseModel: 'test-model',
          trainingConfig: { steps: 50, batchSize: 4, learningRate: 0.001 },
        },
      })
      const { runId } = await createResponse.json()

      // Then get its status
      const response = await request.get(`${AUTOCRAT_URL}/rlaif/runs/${runId}`)
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.runId).toBe(runId)
      expect(data.status).toBe('pending')
      expect(data.progress).toBe(0)
      expect(data.totalSteps).toBe(50)
      expect(data.state).toBe(0) // pending = 0
    })

    test('can list runs', async ({ request }) => {
      const response = await request.get(`${AUTOCRAT_URL}/rlaif/runs`)
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.runs).toBeDefined()
      expect(Array.isArray(data.runs)).toBeTruthy()
    })

    test('can filter runs by environment', async ({ request }) => {
      // Create a run with specific environment
      await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: { id: 'filter-test', type: 'game', configCID: 'Qm123' },
          baseModel: 'test',
          trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
        },
      })

      const response = await request.get(
        `${AUTOCRAT_URL}/rlaif/runs?environment=filter-test`,
      )
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.runs).toBeDefined()
      for (const run of data.runs) {
        expect(run.environment).toBe('filter-test')
      }
    })

    test('returns 404 for non-existent run', async ({ request }) => {
      const response = await request.get(
        `${AUTOCRAT_URL}/rlaif/runs/non-existent`,
      )
      const data = await response.json()
      expect(data.error).toBe('Run not found')
    })

    test('can cancel a run', async ({ request }) => {
      // Create a run
      const createResponse = await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: { id: 'cancel-test', type: 'game', configCID: 'Qm' },
          baseModel: 'test',
          trainingConfig: { steps: 100, batchSize: 1, learningRate: 0.01 },
        },
      })
      const { runId } = await createResponse.json()

      // Cancel it
      const cancelResponse = await request.post(
        `${AUTOCRAT_URL}/rlaif/runs/${runId}/cancel`,
      )
      expect(cancelResponse.ok()).toBeTruthy()

      const data = await cancelResponse.json()
      expect(data.runId).toBe(runId)
      expect(data.status).toBe('failed')
      expect(data.message).toBe('Run cancelled')
    })
  })

  test.describe('Trajectories', () => {
    test('can submit trajectories', async ({ request }) => {
      const response = await request.post(
        `${AUTOCRAT_URL}/rlaif/trajectories`,
        {
          data: {
            environment: 'test-env',
            archetype: 'trader',
            trajectories: [
              {
                agentId: 'agent-001',
                steps: [
                  {
                    observation: 'market open',
                    action: 'buy',
                    reward: 0.5,
                    metadata: { timestamp: Date.now() },
                  },
                  {
                    observation: 'price up',
                    action: 'hold',
                    reward: 0.2,
                    metadata: { timestamp: Date.now() },
                  },
                ],
              },
            ],
          },
        },
      )
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.accepted).toBe(1)
      expect(data.totalForArchetype).toBeGreaterThanOrEqual(1)
    })

    test('can get trajectory stats', async ({ request }) => {
      const response = await request.get(
        `${AUTOCRAT_URL}/rlaif/trajectories/stats?environment=test-env`,
      )
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.environment).toBe('test-env')
      expect(typeof data.totalTrajectories).toBe('number')
      expect(data.byArchetype).toBeDefined()
      expect(typeof data.readyForTraining).toBe('boolean')
      expect(data.thresholdNeeded).toBe(20)
    })

    test('can get trajectories', async ({ request }) => {
      const response = await request.get(
        `${AUTOCRAT_URL}/rlaif/trajectories?environment=test-env&archetype=trader`,
      )
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.environment).toBe('test-env')
      expect(data.archetype).toBe('trader')
      expect(typeof data.count).toBe('number')
      expect(Array.isArray(data.trajectories)).toBeTruthy()
    })
  })

  test.describe('Run Rollouts', () => {
    test('can submit rollouts to a run', async ({ request }) => {
      // Create a run first
      const createResponse = await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: { id: 'rollout-test', type: 'game', configCID: 'Qm' },
          archetype: 'default',
          baseModel: 'test-model',
          trainingConfig: { steps: 100, batchSize: 8, learningRate: 0.0001 },
        },
      })
      const { runId } = await createResponse.json()

      // Submit rollouts
      const rolloutsResponse = await request.post(
        `${AUTOCRAT_URL}/rlaif/runs/${runId}/rollouts`,
        {
          data: {
            trajectories: [
              {
                agentId: 'agent-123',
                steps: [
                  {
                    observation: { balance: 1000, pnl: 0 },
                    action: { type: 'buy', parameters: { amount: 100 } },
                    reward: 0.1,
                    done: false,
                  },
                  {
                    observation: { balance: 900, pnl: 50 },
                    action: { type: 'sell', parameters: { amount: 50 } },
                    reward: 0.5,
                    done: true,
                  },
                ],
                totalReward: 0.6,
              },
            ],
          },
        },
      )
      expect(rolloutsResponse.ok()).toBeTruthy()

      const data = await rolloutsResponse.json()
      expect(data.count).toBe(1)
      expect(data.runId).toBe(runId)
    })

    test('can get rollouts for a run', async ({ request }) => {
      // Create a run and submit rollouts
      const createResponse = await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: { id: 'get-rollouts', type: 'game', configCID: 'Qm' },
          archetype: 'test-arch',
          baseModel: 'test',
          trainingConfig: { steps: 10, batchSize: 1, learningRate: 0.01 },
        },
      })
      const { runId } = await createResponse.json()

      await request.post(`${AUTOCRAT_URL}/rlaif/runs/${runId}/rollouts`, {
        data: {
          trajectories: [
            {
              agentId: 'test-agent',
              steps: [
                { observation: 'state', action: 'act', reward: 1, done: true },
              ],
            },
          ],
        },
      })

      // Get rollouts
      const response = await request.get(
        `${AUTOCRAT_URL}/rlaif/runs/${runId}/rollouts`,
      )
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.count).toBeGreaterThan(0)
      expect(Array.isArray(data.rollouts)).toBeTruthy()
    })
  })

  test.describe('Full Training Flow', () => {
    test('can execute complete training workflow', async ({ request }) => {
      // 1. Submit enough trajectories first
      const trajectories = Array.from({ length: 25 }, (_, i) => ({
        agentId: `agent-${i}`,
        steps: [
          {
            observation: `obs-${i}`,
            action: `act-${i}`,
            reward: Math.random(),
            metadata: { index: i },
          },
        ],
      }))

      await request.post(`${AUTOCRAT_URL}/rlaif/trajectories`, {
        data: {
          environment: 'full-flow-test',
          archetype: 'full-flow-arch',
          trajectories,
        },
      })

      // 2. Check stats show ready for training
      const statsResponse = await request.get(
        `${AUTOCRAT_URL}/rlaif/trajectories/stats?environment=full-flow-test`,
      )
      const stats = await statsResponse.json()
      expect(stats.byArchetype['full-flow-arch']).toBe(25)
      expect(stats.readyForTraining).toBe(true)

      // 3. Create training run
      const createResponse = await request.post(`${AUTOCRAT_URL}/rlaif/runs`, {
        data: {
          environment: {
            id: 'full-flow-test',
            type: 'game',
            configCID: 'QmFullFlow',
          },
          archetype: 'full-flow-arch',
          baseModel: 'test-model-cid',
          trainingConfig: { steps: 10, batchSize: 4, learningRate: 0.001 },
        },
      })
      const { runId } = await createResponse.json()

      // 4. Start the run
      const startResponse = await request.post(
        `${AUTOCRAT_URL}/rlaif/runs/${runId}/start`,
      )
      expect(startResponse.ok()).toBeTruthy()

      const startData = await startResponse.json()
      expect(startData.status).toBe('queued')
      expect(startData.message).toBe('Training started')

      // 5. Poll for completion (with timeout)
      let completed = false
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100))
        const statusResponse = await request.get(
          `${AUTOCRAT_URL}/rlaif/runs/${runId}`,
        )
        const status = await statusResponse.json()

        if (status.status === 'completed') {
          expect(status.progress).toBe(100)
          expect(status.modelCID).toBeDefined()
          expect(status.bestPolicyCID).toBeDefined()
          expect(status.state).toBe(7) // completed state
          completed = true
          break
        }

        if (status.status === 'failed') {
          throw new Error(`Training failed: ${status.error}`)
        }
      }

      expect(completed).toBe(true)
    })
  })
})
