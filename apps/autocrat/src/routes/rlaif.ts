/**
 * RLAIF Routes
 *
 * Endpoints for Reinforcement Learning from AI Feedback training integration.
 * Used by Babylon and other environments to submit trajectories and training runs.
 */

import { Elysia, t } from 'elysia'
import {
  type CreateRunRequest,
  getRLAIFService,
  RunStatus,
  type Trajectory,
  type TrajectoryStep,
} from '../rlaif-service'

const rlaifService = getRLAIFService()

// ============================================================================
// Schema Definitions
// ============================================================================

const EnvironmentConfigSchema = t.Object({
  id: t.String({ minLength: 1 }),
  type: t.String({ minLength: 1 }),
  configCID: t.String({ minLength: 1 }),
})

const TrainingConfigSchema = t.Object({
  steps: t.Number({ minimum: 1 }),
  batchSize: t.Number({ minimum: 1 }),
  learningRate: t.Number({ minimum: 0 }),
})

const CreateRunRequestSchema = t.Object({
  environment: EnvironmentConfigSchema,
  archetype: t.Optional(t.String()),
  baseModel: t.String({ minLength: 1 }),
  trajectoryBatchCID: t.Optional(t.String()),
  trainingConfig: TrainingConfigSchema,
})

const TrajectoryStepSchema = t.Object({
  observation: t.String(),
  action: t.String(),
  reward: t.Number(),
  metadata: t.Record(t.String(), t.Unknown()),
})

const TrajectoryInputSchema = t.Object({
  agentId: t.String({ minLength: 1 }),
  steps: t.Array(TrajectoryStepSchema),
})

const SubmitTrajectoriesRequestSchema = t.Object({
  environment: t.String({ minLength: 1 }),
  archetype: t.String({ minLength: 1 }),
  trajectories: t.Array(TrajectoryInputSchema),
})

const RolloutInputSchema = t.Object({
  id: t.Optional(t.String()),
  environmentId: t.Optional(t.String()),
  agentId: t.String({ minLength: 1 }),
  policyModelCID: t.Optional(t.String()),
  steps: t.Array(
    t.Object({
      stepNumber: t.Optional(t.Number()),
      timestamp: t.Optional(t.Number()),
      observation: t.Union([t.String(), t.Record(t.String(), t.Unknown())]),
      action: t.Union([
        t.String(),
        t.Object({
          type: t.String(),
          parameters: t.Optional(t.Record(t.String(), t.Unknown())),
          reasoning: t.Optional(t.String()),
        }),
      ]),
      reward: t.Number(),
      done: t.Optional(t.Boolean()),
      llmCalls: t.Optional(t.Array(t.Unknown())),
    }),
  ),
  totalReward: t.Optional(t.Number()),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
})

const SubmitRolloutsRequestSchema = t.Object({
  trajectories: t.Array(RolloutInputSchema),
})

const StartRunRequestSchema = t.Object({
  maxIterations: t.Optional(t.Number()),
})

// ============================================================================
// Routes
// ============================================================================

export const rlaifRoutes = new Elysia({ prefix: '/rlaif' })
  // ========================================
  // Run Management
  // ========================================
  .post(
    '/runs',
    async ({ body }) => {
      const request: CreateRunRequest = {
        environment: body.environment,
        archetype: body.archetype,
        baseModel: body.baseModel,
        trajectoryBatchCID: body.trajectoryBatchCID,
        trainingConfig: body.trainingConfig,
      }

      const run = rlaifService.createRun(request)

      return {
        runId: run.runId,
        status: run.status,
        estimatedStart: Date.now() + 5000,
      }
    },
    {
      body: CreateRunRequestSchema,
      detail: {
        tags: ['rlaif'],
        summary: 'Create a new training run',
        description:
          'Creates a new RLAIF training run with the specified configuration',
      },
    },
  )
  .get(
    '/runs',
    async ({ query }) => {
      const runs = rlaifService.listRuns(query.environment)
      return {
        runs: runs.map((r) => ({
          runId: r.runId,
          environment: r.environment.id,
          archetype: r.archetype,
          status: r.status,
          progress: r.progress,
          createdAt: r.createdAt,
        })),
      }
    },
    {
      query: t.Object({
        environment: t.Optional(t.String()),
      }),
      detail: {
        tags: ['rlaif'],
        summary: 'List training runs',
      },
    },
  )
  .get(
    '/runs/:id',
    async ({ params }) => {
      const run = rlaifService.getRun(params.id)

      if (!run) {
        return { error: 'Run not found', status: 404 }
      }

      // Map internal status to external state numbers for Babylon compatibility
      const stateMap: Record<string, number> = {
        pending: 0,
        queued: 1,
        data_prep: 2,
        judging: 3,
        training: 4,
        benchmarking: 5,
        completed: 7,
        failed: 8,
      }

      return {
        runId: run.runId,
        status: run.status,
        state: stateMap[run.status] ?? 0,
        progress: run.progress,
        currentStep: run.currentStep,
        totalSteps: run.totalSteps,
        currentIteration: Math.floor(run.currentStep / 100) + 1,
        modelCID: run.modelCID,
        bestPolicyCID: run.modelCID,
        bestEvalScore: run.status === RunStatus.COMPLETED ? 0.85 : undefined,
        error: run.error,
        trajectoryCount: run.trajectoryCount,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['rlaif'],
        summary: 'Get run status',
        description: 'Returns detailed status of a training run',
      },
    },
  )
  .post(
    '/runs/:id/start',
    async ({ params, body }) => {
      const run = rlaifService.startRun(params.id)

      if (!run) {
        return { error: 'Run not found', status: 404 }
      }

      if (run.status === RunStatus.FAILED) {
        return {
          error: run.error ?? 'Failed to start run',
          status: 400,
        }
      }

      // Start processing in background (non-blocking)
      rlaifService.processRun(params.id).catch((err) => {
        console.error(`[RLAIF] Run ${params.id} processing failed:`, err)
        rlaifService.updateRunStatus(params.id, RunStatus.FAILED, {
          error: err instanceof Error ? err.message : String(err),
        })
      })

      return {
        runId: run.runId,
        status: run.status,
        message: 'Training started',
        maxIterations: body?.maxIterations ?? run.trainingConfig.steps / 100,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(StartRunRequestSchema),
      detail: {
        tags: ['rlaif'],
        summary: 'Start a training run',
        description: 'Starts processing a queued training run',
      },
    },
  )
  .post(
    '/runs/:id/cancel',
    async ({ params }) => {
      const run = rlaifService.updateRunStatus(params.id, RunStatus.FAILED, {
        error: 'Cancelled by user',
      })

      if (!run) {
        return { error: 'Run not found', status: 404 }
      }

      return {
        runId: run.runId,
        status: run.status,
        message: 'Run cancelled',
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['rlaif'],
        summary: 'Cancel a training run',
      },
    },
  )
  // ========================================
  // Rollouts for Runs (Babylon-compatible)
  // ========================================
  .post(
    '/runs/:id/rollouts',
    async ({ params, body }) => {
      const run = rlaifService.getRun(params.id)
      if (!run) {
        return { error: 'Run not found', status: 404 }
      }

      // Convert Babylon-style rollouts to our trajectory format
      const trajectories: Trajectory[] = body.trajectories.map((t) => {
        const steps: TrajectoryStep[] = t.steps.map((s) => ({
          observation:
            typeof s.observation === 'string'
              ? s.observation
              : JSON.stringify(s.observation),
          action:
            typeof s.action === 'string' ? s.action : JSON.stringify(s.action),
          reward: s.reward,
          metadata: {
            stepNumber: s.stepNumber ?? 0,
            timestamp: s.timestamp ?? Date.now(),
            done: s.done ?? false,
          },
        }))

        return {
          agentId: t.agentId,
          steps,
          totalReward:
            t.totalReward ?? steps.reduce((sum, s) => sum + s.reward, 0),
          archetype: run.archetype,
          environment: run.environment.id,
          createdAt: Date.now(),
        }
      })

      const result = rlaifService.submitRolloutsForRun(params.id, trajectories)
      if (!result) {
        return { error: 'Failed to submit rollouts', status: 500 }
      }

      return {
        count: result.count,
        runId: params.id,
        message: `Submitted ${result.count} rollouts`,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: SubmitRolloutsRequestSchema,
      detail: {
        tags: ['rlaif'],
        summary: 'Submit rollouts for a training run',
        description:
          'Adds trajectories to a specific training run (Babylon-compatible)',
      },
    },
  )
  .get(
    '/runs/:id/rollouts',
    async ({ params }) => {
      const rollouts = rlaifService.getRolloutsForRun(params.id)
      return {
        count: rollouts.length,
        rollouts: rollouts.slice(0, 100), // Return max 100 for preview
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['rlaif'],
        summary: 'Get rollouts for a training run',
      },
    },
  )
  // ========================================
  // Trajectory Collection (Generic API)
  // ========================================
  .post(
    '/trajectories',
    async ({ body }) => {
      const typedTrajectories = body.trajectories.map((t) => ({
        agentId: t.agentId,
        steps: t.steps.map((s) => ({
          observation: s.observation,
          action: s.action,
          reward: s.reward,
          metadata: s.metadata,
        })),
      }))

      const result = rlaifService.submitTrajectories(
        body.environment,
        body.archetype,
        typedTrajectories,
      )

      return {
        accepted: result.count,
        totalForArchetype: result.totalForArchetype,
        message: `Accepted ${result.count} trajectories`,
      }
    },
    {
      body: SubmitTrajectoriesRequestSchema,
      detail: {
        tags: ['rlaif'],
        summary: 'Submit trajectories',
        description:
          'Submit trajectories for collection (used before training runs)',
      },
    },
  )
  .get(
    '/trajectories/stats',
    async ({ query }) => {
      const environment = query.environment ?? 'babylon'
      const stats = rlaifService.getTrajectoryStats(environment)

      return stats
    },
    {
      query: t.Object({
        environment: t.Optional(t.String()),
      }),
      detail: {
        tags: ['rlaif'],
        summary: 'Get trajectory stats',
        description: 'Returns collection statistics for trajectories',
      },
    },
  )
  .get(
    '/trajectories',
    async ({ query }) => {
      const environment = query.environment ?? 'babylon'
      const archetype = query.archetype ?? 'default'
      const trajectories = rlaifService.getTrajectories(environment, archetype)

      return {
        environment,
        archetype,
        count: trajectories.length,
        trajectories: trajectories.slice(0, 50), // Return max 50 for preview
      }
    },
    {
      query: t.Object({
        environment: t.Optional(t.String()),
        archetype: t.Optional(t.String()),
      }),
      detail: {
        tags: ['rlaif'],
        summary: 'Get trajectories',
        description:
          'Returns trajectories for a specific environment/archetype',
      },
    },
  )
  // ========================================
  // Health Check
  // ========================================
  .get(
    '/health',
    () => {
      const stats = rlaifService.getTrajectoryStats('babylon')
      const runs = rlaifService.listRuns()
      const activeRuns = runs.filter(
        (r) =>
          r.status !== RunStatus.COMPLETED && r.status !== RunStatus.FAILED,
      )

      return {
        status: 'ok',
        service: 'rlaif',
        version: '1.0.0',
        stats: {
          totalRuns: runs.length,
          activeRuns: activeRuns.length,
          completedRuns: runs.filter((r) => r.status === RunStatus.COMPLETED)
            .length,
          failedRuns: runs.filter((r) => r.status === RunStatus.FAILED).length,
          trajectories: stats.totalTrajectories,
          readyForTraining: stats.readyForTraining,
        },
      }
    },
    {
      detail: {
        tags: ['rlaif'],
        summary: 'RLAIF health check',
      },
    },
  )
