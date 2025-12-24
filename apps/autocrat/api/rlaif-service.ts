/**
 * RLAIF (Reinforcement Learning from AI Feedback) Service
 *
 * Manages training runs, trajectories, and job coordination for DWS integration.
 * Stores data locally and queues jobs for distributed training.
 */

// Types

export const RunStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  DATA_PREP: 'data_prep',
  JUDGING: 'judging',
  TRAINING: 'training',
  BENCHMARKING: 'benchmarking',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus]

export interface EnvironmentConfig {
  id: string
  type: string
  configCID: string
}

export interface TrainingConfig {
  steps: number
  batchSize: number
  learningRate: number
}

export interface CreateRunRequest {
  environment: EnvironmentConfig
  archetype?: string
  baseModel: string
  trajectoryBatchCID?: string
  trainingConfig: TrainingConfig
}

export interface RLAIFRun {
  runId: string
  environment: EnvironmentConfig
  archetype: string
  baseModel: string
  trajectoryBatchCID: string | null
  trainingConfig: TrainingConfig
  status: RunStatus
  progress: number
  currentStep: number
  totalSteps: number
  modelCID: string | null
  error: string | null
  trajectoryCount: number
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
}

export interface TrajectoryStep {
  observation: string
  action: string
  reward: number
  metadata: Record<string, unknown>
}

export interface Trajectory {
  agentId: string
  steps: TrajectoryStep[]
  totalReward: number
  archetype: string
  environment: string
  createdAt: number
}

export interface TrajectoryStats {
  environment: string
  totalTrajectories: number
  byArchetype: Record<string, number>
  readyForTraining: boolean
  thresholdNeeded: number
}

// RLAIF Service

const TRAINING_THRESHOLD = 20 // Minimum trajectories needed per archetype

class RLAIFService {
  private runs: Map<string, RLAIFRun> = new Map()
  private trajectories: Map<string, Trajectory[]> = new Map() // Key: environment:archetype
  private runCounter = 0

  generateRunId(): string {
    this.runCounter++
    return `rlaif-${Date.now()}-${this.runCounter}`
  }

  // Run Management

  createRun(request: CreateRunRequest): RLAIFRun {
    const runId = this.generateRunId()
    const now = Date.now()

    const run: RLAIFRun = {
      runId,
      environment: request.environment,
      archetype: request.archetype ?? 'default',
      baseModel: request.baseModel,
      trajectoryBatchCID: request.trajectoryBatchCID ?? null,
      trainingConfig: request.trainingConfig,
      status: RunStatus.PENDING,
      progress: 0,
      currentStep: 0,
      totalSteps: request.trainingConfig.steps,
      modelCID: null,
      error: null,
      trajectoryCount: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    }

    this.runs.set(runId, run)

    return run
  }

  getRun(runId: string): RLAIFRun | null {
    return this.runs.get(runId) ?? null
  }

  listRuns(environment?: string): RLAIFRun[] {
    const allRuns = Array.from(this.runs.values())
    if (environment) {
      return allRuns.filter((r) => r.environment.id === environment)
    }
    return allRuns.sort((a, b) => b.createdAt - a.createdAt)
  }

  updateRunStatus(
    runId: string,
    status: RunStatus,
    updates?: Partial<RLAIFRun>,
  ): RLAIFRun | null {
    const run = this.runs.get(runId)
    if (!run) return null

    run.status = status
    run.updatedAt = Date.now()

    if (updates) {
      Object.assign(run, updates)
    }

    if (status === RunStatus.TRAINING && !run.startedAt) {
      run.startedAt = Date.now()
    }

    if (status === RunStatus.COMPLETED || status === RunStatus.FAILED) {
      run.completedAt = Date.now()
    }

    this.runs.set(runId, run)
    return run
  }

  startRun(runId: string): RLAIFRun | null {
    const run = this.runs.get(runId)
    if (!run) return null

    if (run.status !== RunStatus.PENDING && run.status !== RunStatus.QUEUED) {
      return run
    }

    // Check if we have enough trajectories
    const key = `${run.environment.id}:${run.archetype}`
    const trajectories = this.trajectories.get(key) ?? []

    if (trajectories.length < TRAINING_THRESHOLD && !run.trajectoryBatchCID) {
      return this.updateRunStatus(runId, RunStatus.FAILED, {
        error: `Not enough trajectories: ${trajectories.length}/${TRAINING_THRESHOLD}`,
      })
    }

    run.trajectoryCount = trajectories.length
    return this.updateRunStatus(runId, RunStatus.QUEUED)
  }

  // Simulate training progress (in production this would be callbacks from DWS)
  async processRun(runId: string): Promise<RLAIFRun | null> {
    const run = this.runs.get(runId)
    if (!run || run.status !== RunStatus.QUEUED) return null

    // Data preparation phase
    this.updateRunStatus(runId, RunStatus.DATA_PREP, { progress: 10 })
    await this.delay(100)

    // Judging phase
    this.updateRunStatus(runId, RunStatus.JUDGING, { progress: 30 })
    await this.delay(100)

    // Training phase
    this.updateRunStatus(runId, RunStatus.TRAINING, { progress: 50 })

    // Simulate training steps
    const stepIncrement = 50 / run.totalSteps
    for (let step = 1; step <= run.totalSteps; step++) {
      this.updateRunStatus(runId, RunStatus.TRAINING, {
        currentStep: step,
        progress: 50 + Math.floor(step * stepIncrement),
      })
      await this.delay(10)
    }

    // Benchmarking phase
    this.updateRunStatus(runId, RunStatus.BENCHMARKING, { progress: 95 })
    await this.delay(100)

    // Complete
    const modelCID = `Qm${Buffer.from(runId).toString('hex').slice(0, 44)}`
    return this.updateRunStatus(runId, RunStatus.COMPLETED, {
      progress: 100,
      modelCID,
    })
  }

  // Trajectory Management

  submitTrajectories(
    environment: string,
    archetype: string,
    trajectories: Array<{
      agentId: string
      steps: TrajectoryStep[]
    }>,
  ): { count: number; totalForArchetype: number } {
    const key = `${environment}:${archetype}`
    const existing = this.trajectories.get(key) ?? []
    const now = Date.now()

    const newTrajectories: Trajectory[] = trajectories.map((t) => ({
      agentId: t.agentId,
      steps: t.steps,
      totalReward: t.steps.reduce((sum, s) => sum + s.reward, 0),
      archetype,
      environment,
      createdAt: now,
    }))

    const combined = [...existing, ...newTrajectories]
    this.trajectories.set(key, combined)

    return {
      count: trajectories.length,
      totalForArchetype: combined.length,
    }
  }

  submitRolloutsForRun(
    runId: string,
    trajectories: Trajectory[],
  ): { count: number } | null {
    const run = this.runs.get(runId)
    if (!run) return null

    const key = `${run.environment.id}:${run.archetype}`
    const existing = this.trajectories.get(key) ?? []
    const combined = [...existing, ...trajectories]
    this.trajectories.set(key, combined)

    run.trajectoryCount = combined.length
    run.updatedAt = Date.now()
    this.runs.set(runId, run)

    return { count: trajectories.length }
  }

  getTrajectoryStats(environment: string): TrajectoryStats {
    const byArchetype: Record<string, number> = {}
    let totalTrajectories = 0

    for (const [key, trajectories] of this.trajectories) {
      if (key.startsWith(`${environment}:`)) {
        const archetype = key.split(':')[1] ?? 'default'
        byArchetype[archetype] = trajectories.length
        totalTrajectories += trajectories.length
      }
    }

    const maxArchetypeCount = Math.max(0, ...Object.values(byArchetype))
    const readyForTraining = maxArchetypeCount >= TRAINING_THRESHOLD

    return {
      environment,
      totalTrajectories,
      byArchetype,
      readyForTraining,
      thresholdNeeded: TRAINING_THRESHOLD,
    }
  }

  getTrajectories(environment: string, archetype: string): Trajectory[] {
    const key = `${environment}:${archetype}`
    return this.trajectories.get(key) ?? []
  }

  // Run-specific Rollouts API

  getRolloutsForRun(runId: string): Trajectory[] {
    const run = this.runs.get(runId)
    if (!run) return []
    return this.getTrajectories(run.environment.id, run.archetype)
  }

  // Cleanup

  clearOldRuns(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs
    let removed = 0

    for (const [runId, run] of this.runs) {
      if (
        run.completedAt &&
        run.completedAt < cutoff &&
        (run.status === RunStatus.COMPLETED || run.status === RunStatus.FAILED)
      ) {
        this.runs.delete(runId)
        removed++
      }
    }

    return removed
  }

  // Private Helpers

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Singleton instance
let rlaifService: RLAIFService | null = null

export function getRLAIFService(): RLAIFService {
  if (!rlaifService) {
    rlaifService = new RLAIFService()
  }
  return rlaifService
}

export function createRLAIFService(): RLAIFService {
  return new RLAIFService()
}
