/**
 * Crucible Training Integration
 *
 * Connects DWS training infrastructure to Crucible's agent runtime.
 * Enables RLAIF (Reinforcement Learning from AI Feedback) for Eliza agents.
 */

import { JobsListResponseSchema } from '../shared/schemas/training'
import { expectValid } from '../shared/validation'

// ============================================================================
// Types
// ============================================================================

export interface TrainingAgentConfig {
  agentId: string
  name: string
  role: 'player' | 'evaluator' | 'trainer'
  modelEndpoint?: string
}

export interface TrainingEnvironment {
  envId: string
  name: string
  description: string
  agentCount: number
}

export interface TrainingRun {
  runId: string
  environment: string
  agents: TrainingAgentConfig[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  metrics: TrainingMetrics
}

export interface TrainingMetrics {
  totalEpisodes: number
  totalSteps: number
  averageReward: number
  bestReward: number
  lossHistory: number[]
}

export interface AgentTrajectory {
  agentId: string
  episodeId: string
  steps: TrajectoryStep[]
  totalReward: number
  metadata: Record<string, string | number | boolean>
}

export interface TrajectoryStep {
  stepNumber: number
  observation: string
  action: string
  reward: number
  done: boolean
}

// ============================================================================
// Crucible Training Client
// ============================================================================

export class CrucibleTrainingClient {
  private dwsApiUrl: string
  private crucibleApiUrl: string
  private activeRuns: Map<string, TrainingRun> = new Map()

  constructor(
    config: {
      dwsApiUrl?: string
      crucibleApiUrl?: string
    } = {},
  ) {
    this.dwsApiUrl = config.dwsApiUrl ?? 'http://localhost:4030'
    this.crucibleApiUrl = config.crucibleApiUrl ?? 'http://localhost:8080'
  }

  /**
   * Register agents for training
   */
  async registerTrainingAgents(agents: TrainingAgentConfig[]): Promise<void> {
    for (const agent of agents) {
      await fetch(`${this.crucibleApiUrl}/api/v1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: {
            id: agent.agentId,
            name: agent.name,
            description: `Training agent: ${agent.role}`,
            personality: 'Analytical and strategic',
          },
        }),
      })
    }
  }

  /**
   * Start a training run
   */
  async startTrainingRun(config: {
    environment: string
    agents: TrainingAgentConfig[]
    modelName: string
    trainingSteps: number
    batchSize: number
  }): Promise<TrainingRun> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const run: TrainingRun = {
      runId,
      environment: config.environment,
      agents: config.agents,
      status: 'pending',
      startedAt: Date.now(),
      metrics: {
        totalEpisodes: 0,
        totalSteps: 0,
        averageReward: 0,
        bestReward: 0,
        lossHistory: [],
      },
    }

    // Submit job to DWS
    const response = await fetch(`${this.dwsApiUrl}/training/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: config.modelName,
        batchSize: config.batchSize,
        trainingSteps: config.trainingSteps,
        environment: config.environment,
        agents: config.agents.map((a) => a.agentId),
      }),
    })

    if (response.ok) {
      run.status = 'running'
    }

    this.activeRuns.set(runId, run)
    return run
  }

  /**
   * Submit agent trajectory for training
   */
  async submitTrajectory(trajectory: AgentTrajectory): Promise<void> {
    // Convert to Atropos format
    const prompt = trajectory.steps.map((s) => s.observation).join('\n')
    const response = trajectory.steps.map((s) => s.action).join('\n')

    // Simulate tokenization
    const tokens = prompt.split(' ').map((_, i) => i + 1)

    await fetch(`${this.dwsApiUrl}/training/atropos/scored_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens: [tokens],
        masks: [tokens.map(() => 1)],
        scores: [trajectory.totalReward],
        messages: [
          [
            { role: 'user', content: prompt },
            { role: 'assistant', content: response },
          ],
        ],
      }),
    })
  }

  /**
   * Get training run status
   */
  async getRunStatus(runId: string): Promise<TrainingRun | null> {
    const run = this.activeRuns.get(runId)
    if (!run) return null

    // Check DWS for latest status
    const response = await fetch(`${this.dwsApiUrl}/training/jobs`)
    if (response.ok) {
      const data = expectValid(
        JobsListResponseSchema,
        await response.json(),
        'DWS jobs list response',
      )
      const job = data.jobs.find(
        (j) => j.status === 'running' || j.status === 'completed',
      )
      if (job) {
        run.status = job.status as TrainingRun['status']
        if (job.metrics) {
          run.metrics = {
            totalEpisodes:
              job.metrics.totalEpisodes ?? job.metrics.total_episodes ?? 0,
            totalSteps: job.metrics.totalSteps ?? job.metrics.total_steps ?? 0,
            averageReward:
              job.metrics.averageReward ?? job.metrics.average_reward ?? 0,
            bestReward: job.metrics.bestReward ?? job.metrics.best_reward ?? 0,
            lossHistory:
              job.metrics.lossHistory ?? job.metrics.loss_history ?? [],
          }
        }
      }
    }

    return run
  }

  /**
   * Stop a training run
   */
  async stopRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId)
    if (run) {
      run.status = 'completed'
      run.completedAt = Date.now()
    }
  }

  /**
   * Get all active runs
   */
  getActiveRuns(): TrainingRun[] {
    return Array.from(this.activeRuns.values()).filter(
      (r) => r.status === 'running',
    )
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCrucibleTrainingClient(config?: {
  dwsApiUrl?: string
  crucibleApiUrl?: string
}): CrucibleTrainingClient {
  return new CrucibleTrainingClient(config)
}
