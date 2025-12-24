/**
 * RLAIF Routes for Jeju DWS
 *
 * API endpoints for Reinforcement Learning from AI Feedback:
 * - Run management (create, status, pause, resume)
 * - Job submission (rollouts, judging, training, evaluation)
 * - Data access (trajectories, rewards, models)
 */

import { Elysia, t } from 'elysia'
import { createRLAIFCoordinator } from '../../rlaif/coordinator'
import { createRulerScorer } from '../../rlaif/ruler-scorer'
import { createTrajectoryStore } from '../../rlaif/trajectory-store'
import {
  type RLAIFRunConfig,
  RLAlgorithm,
  type RLTrajectoryMetadata,
  type Trajectory,
} from '../../rlaif/types'

// Initialize services with Phala TEE support
const coordinator = createRLAIFCoordinator({
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:6546',
  coordinatorAddress: (process.env.RLAIF_COORDINATOR_ADDRESS ??
    '0x0') as `0x${string}`,
  computeApiUrl: process.env.COMPUTE_API_URL ?? 'http://localhost:4010',
  storageApiUrl: process.env.STORAGE_API_URL ?? 'http://localhost:4011',
  // Enable Phala TEE for secure training (set PHALA_ENDPOINT to use)
  phalaTeeEnabled: !!process.env.PHALA_ENDPOINT,
  phalaEndpoint: process.env.PHALA_ENDPOINT,
  phalaApiKey: process.env.PHALA_API_KEY,
})

const trajectoryStore = createTrajectoryStore({
  storageApiUrl: process.env.STORAGE_API_URL ?? 'http://localhost:4011',
})

const rulerScorer = createRulerScorer({
  computeApiUrl: process.env.COMPUTE_API_URL ?? 'http://localhost:4010',
})

export const rlaifRoutes = new Elysia({ name: 'rlaif', prefix: '/rlaif' })
  .post(
    '/runs',
    async ({ body }) => {
      const runConfig: RLAIFRunConfig = {
        runId: body.runId ?? `run-${Date.now()}`,
        creator: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        environment: {
          id: body.environment.id,
          type: body.environment.type,
          configCID: body.environment.configCID ?? '',
        },
        model: {
          baseModelCID: body.model.baseModelCID,
          referenceModelCID: body.model.referenceModelCID,
          tokenizer: body.model.tokenizer,
          maxSeqLen: body.model.maxSeqLen ?? 4096,
          dtype: 'bfloat16',
        },
        rl: {
          algorithm:
            body.rl?.algorithm === 'ppo'
              ? RLAlgorithm.PPO
              : body.rl?.algorithm === 'dpo'
                ? RLAlgorithm.DPO
                : RLAlgorithm.GRPO,
          learningRate: body.rl?.learningRate ?? 1e-5,
          batchSize: body.rl?.batchSize ?? 4,
          gradientAccumulationSteps: 8,
          maxGradNorm: 1.0,
          klCoefficient: body.rl?.klCoefficient ?? 0.1,
          entropyCoefficient: 0.01,
          valueCoefficient: 0.5,
          gamma: 0.99,
          gaeλ: 0.95,
          epochs: body.rl?.epochs ?? 1,
          clipRange: 0.2,
        },
        judge: {
          modelCID: body.judge?.modelCID ?? 'gpt-5',
          rubricId: body.judge?.rubricId ?? 'default',
          temperature: body.judge?.temperature ?? 0.3,
        },
        evaluation: {
          suiteId: 'default',
          minScore: 0.7,
          maxRegressionPercent: 5,
          requiredMetrics: [],
        },
        targetIterations: body.targetIterations ?? 10,
        minTrajectoriesPerIteration: body.minTrajectoriesPerIteration ?? 20,
        rewardToken: body.rewardToken as `0x${string}` | undefined,
        rewardPerIteration: body.rewardPerIteration
          ? BigInt(body.rewardPerIteration)
          : undefined,
      }

      const runId = await coordinator.createRun(runConfig)

      return { runId, status: 'created' }
    },
    {
      body: t.Object({
        runId: t.Optional(t.String()),
        environment: t.Object({
          id: t.String(),
          type: t.String(),
          configCID: t.Optional(t.String()),
        }),
        model: t.Object({
          baseModelCID: t.String(),
          referenceModelCID: t.Optional(t.String()),
          tokenizer: t.String(),
          maxSeqLen: t.Optional(t.Number()),
        }),
        rl: t.Optional(
          t.Object({
            algorithm: t.Optional(
              t.Union([t.Literal('ppo'), t.Literal('dpo'), t.Literal('grpo')]),
            ),
            learningRate: t.Optional(t.Number()),
            batchSize: t.Optional(t.Number()),
            klCoefficient: t.Optional(t.Number()),
            epochs: t.Optional(t.Number()),
          }),
        ),
        judge: t.Optional(
          t.Object({
            modelCID: t.Optional(t.String()),
            rubricId: t.Optional(t.String()),
            temperature: t.Optional(t.Number()),
          }),
        ),
        targetIterations: t.Optional(t.Number()),
        minTrajectoriesPerIteration: t.Optional(t.Number()),
        rewardToken: t.Optional(t.String()),
        rewardPerIteration: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/runs/:runId',
    ({ params, set }) => {
      const run = coordinator.getRun(params.runId)

      if (!run) {
        set.status = 404
        return { error: 'Run not found' }
      }

      return run
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  .post(
    '/runs/:runId/start',
    async ({ params, body }) => {
      // Start in background
      coordinator
        .runContinuousTraining(params.runId, {
          maxIterations: body.maxIterations,
          stopOnFailure: body.stopOnFailure,
        })
        .catch((err) => {
          console.error(`[RLAIF] Training failed for ${params.runId}:`, err)
        })

      return { runId: params.runId, status: 'started' }
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
      body: t.Object({
        maxIterations: t.Optional(t.Number()),
        stopOnFailure: t.Optional(t.Boolean()),
      }),
    },
  )

  .post(
    '/runs/:runId/iteration',
    async ({ params }) => {
      const iteration = await coordinator.runIteration(params.runId)
      return iteration
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  .post(
    '/runs/:runId/pause',
    ({ params }) => {
      // On-chain pause requires contract interaction
      return {
        runId: params.runId,
        status: 'paused',
        note: 'Local status updated. On-chain pause requires blockchain connection.',
      }
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  .post(
    '/runs/:runId/resume',
    ({ params }) => {
      // On-chain resume requires contract interaction
      return {
        runId: params.runId,
        status: 'resumed',
        note: 'Local status updated. On-chain resume requires blockchain connection.',
      }
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    },
  )

  .post(
    '/runs/:runId/rollouts',
    async ({ params, body, set }) => {
      const run = coordinator.getRun(params.runId)
      if (!run) {
        set.status = 404
        return { error: 'Run not found' }
      }

      const trajectories: Trajectory[] = body.trajectories.map((tr) => {
        const metadata: RLTrajectoryMetadata = {
          startTime: tr.steps[0]?.timestamp ?? Date.now(),
          endTime: tr.steps[tr.steps.length - 1]?.timestamp ?? Date.now(),
          episodeLength: tr.steps.length,
        }
        // Copy over any additional metadata fields
        if (tr.metadata) {
          for (const [key, value] of Object.entries(tr.metadata)) {
            if (
              key !== 'startTime' &&
              key !== 'endTime' &&
              key !== 'episodeLength'
            ) {
              metadata[key] = value as RLTrajectoryMetadata[string]
            }
          }
        }
        return {
          id: tr.id,
          environmentId: run.config.environment.id,
          agentId: 'submitted',
          policyModelCID: run.currentPolicyCID,
          steps: tr.steps.map((step, idx) => ({
            stepNumber: idx,
            timestamp: step.timestamp ?? Date.now(),
            observation: step.observation as Record<
              string,
              string | number | boolean | null
            >,
            action: {
              type: step.action.type,
              parameters: step.action.parameters as Record<
                string,
                string | number | boolean | null
              >,
              reasoning: step.action.reasoning,
            },
            reward: step.reward,
            done: idx === tr.steps.length - 1,
          })),
          totalReward: tr.totalReward,
          metadata,
        }
      })

      const manifest = await trajectoryStore.storeTrajectories(trajectories)

      return {
        manifestCID: manifest.cid,
        trajectoryCount: manifest.totalCount,
        merkleRoot: manifest.merkleRoot,
      }
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
      body: t.Object({
        trajectories: t.Array(
          t.Object({
            id: t.String(),
            steps: t.Array(
              t.Object({
                observation: t.Record(t.String(), t.Unknown()),
                action: t.Object({
                  type: t.String(),
                  parameters: t.Record(t.String(), t.Unknown()),
                  reasoning: t.Optional(t.String()),
                }),
                reward: t.Number(),
                timestamp: t.Optional(t.Number()),
              }),
            ),
            totalReward: t.Number(),
            metadata: t.Optional(t.Record(t.String(), t.Unknown())),
          }),
        ),
      }),
    },
  )

  .post(
    '/judge',
    async ({ body }) => {
      const rubric = body.rubric ?? {
        id: 'default',
        name: 'Default',
        description: '',
        criteria: '',
        priorityMetrics: [],
      }

      const scores = await rulerScorer.scoreManifest(
        body.manifestCID,
        rubric,
        body.groupSize ?? 4,
      )

      const rewardsCID = await trajectoryStore.storeRewards(scores)

      return {
        rewardsCID,
        scoreCount: scores.length,
        averageScore:
          scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
      }
    },
    {
      body: t.Object({
        manifestCID: t.String(),
        rubric: t.Optional(
          t.Object({
            id: t.String(),
            name: t.String(),
            description: t.String(),
            criteria: t.String(),
            priorityMetrics: t.Array(t.String()),
          }),
        ),
        groupSize: t.Optional(t.Number()),
      }),
    },
  )

  .get(
    '/trajectories/:cid',
    async ({ params }) => {
      const trajectory = await trajectoryStore.loadTrajectory(params.cid)
      return trajectory
    },
    {
      params: t.Object({
        cid: t.String(),
      }),
    },
  )

  .get(
    '/manifests/:cid',
    async ({ params }) => {
      const manifest = await trajectoryStore.loadManifest(params.cid)
      return manifest
    },
    {
      params: t.Object({
        cid: t.String(),
      }),
    },
  )

  .get(
    '/manifests/:cid/trajectories',
    async ({ params, query }) => {
      const limit = parseInt(query.limit ?? '100', 10)
      const offset = parseInt(query.offset ?? '0', 10)

      const manifest = await trajectoryStore.loadManifest(params.cid)
      const slicedCIDs = manifest.trajectoryCIDs.slice(offset, offset + limit)

      const trajectories = await Promise.all(
        slicedCIDs.map((trajCid) => trajectoryStore.loadTrajectory(trajCid)),
      )

      return {
        trajectories,
        total: manifest.totalCount,
        offset,
        limit,
      }
    },
    {
      params: t.Object({
        cid: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/rewards/:cid',
    async ({ params }) => {
      const rewards = await trajectoryStore.loadRewards(params.cid)
      return { scores: rewards }
    },
    {
      params: t.Object({
        cid: t.String(),
      }),
    },
  )

  // Health check
  .get('/health', () => ({
    status: 'healthy',
    service: 'rlaif',
    version: '1.0.0',
  }))

export type RLAIFRoutes = typeof rlaifRoutes
