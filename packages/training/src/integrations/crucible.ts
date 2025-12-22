/**
 * Crucible Training Integration
 *
 * Connects training infrastructure to Crucible's agent runtime.
 * Enables RLAIF (Reinforcement Learning from AI Feedback) for Eliza agents.
 */

import { expectValid } from '@jejunetwork/types'
import { JobsListResponseSchemaExternal } from '../schemas'

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

  async registerTrainingAgents(agents: TrainingAgentConfig[]): Promise<void> {
    for (const agent of agents) {
      const response = await fetch(`${this.crucibleApiUrl}/api/v1/agents`, {
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

      if (!response.ok) {
        throw new Error(
          `Failed to register training agent ${agent.agentId}: ${response.statusText}`,
        )
      }
    }
  }

  async startTrainingRun(config: {
    environment: string
    agents: TrainingAgentConfig[]
    modelName: string
    trainingSteps: number
    batchSize: number
  }): Promise<TrainingRun> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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

    if (!response.ok) {
      throw new Error(`Failed to start training run: ${response.statusText}`)
    }

    const run: TrainingRun = {
      runId,
      environment: config.environment,
      agents: config.agents,
      status: 'running',
      startedAt: Date.now(),
      metrics: {
        totalEpisodes: 0,
        totalSteps: 0,
        averageReward: 0,
        bestReward: 0,
        lossHistory: [],
      },
    }

    this.activeRuns.set(runId, run)
    return run
  }

  async submitTrajectory(trajectory: AgentTrajectory): Promise<void> {
    const prompt = trajectory.steps.map((s) => s.observation).join('\n')
    const responseText = trajectory.steps.map((s) => s.action).join('\n')

    const tokens = prompt.split(' ').map((_, i) => i + 1)

    const response = await fetch(
      `${this.dwsApiUrl}/training/atropos/scored_data`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [tokens],
          masks: [tokens.map(() => 1)],
          scores: [trajectory.totalReward],
          messages: [
            [
              { role: 'user', content: prompt },
              { role: 'assistant', content: responseText },
            ],
          ],
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to submit trajectory: ${response.statusText}`)
    }
  }

  async getRunStatus(runId: string): Promise<TrainingRun | null> {
    const run = this.activeRuns.get(runId)
    if (!run) return null

    const response = await fetch(`${this.dwsApiUrl}/training/jobs`)
    if (!response.ok) {
      throw new Error(`Failed to get run status: ${response.statusText}`)
    }

    const data = expectValid(
      JobsListResponseSchemaExternal,
      await response.json(),
      'DWS jobs list response',
    )
    const job = data.jobs.find(
      (j) => j.status === 'running' || j.status === 'completed',
    )
    if (job) {
      run.status = job.status as TrainingRun['status']
      if (job.metrics) {
        run.metrics = job.metrics
      }
    }

    return run
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId)
    if (run) {
      run.status = 'completed'
      run.completedAt = Date.now()
    }
  }

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
