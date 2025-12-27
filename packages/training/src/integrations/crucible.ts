/**
 * Crucible Training Integration
 *
 * Connects training infrastructure to Crucible's agent runtime.
 * Enables RLAIF (Reinforcement Learning from AI Feedback) for Eliza agents.
 */

import { expectValid } from '@jejunetwork/types'
import { JobsListResponseSchemaExternal } from '../schemas'

// Types

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

/** Metadata for agent trajectory */
export interface TrajectoryMetadata {
  /** Environment the trajectory was collected in */
  environment?: string
  /** Archetype/persona of the agent */
  archetype?: string
  /** Session ID for grouping trajectories */
  sessionId?: string
  /** Whether this trajectory was successful */
  success?: boolean
  /** Duration in milliseconds */
  durationMs?: number
  /** Start timestamp */
  startTimestamp?: number
  /** End timestamp */
  endTimestamp?: number
}

export interface AgentTrajectory {
  agentId: string
  episodeId: string
  steps: CrucibleTrajectoryStep[]
  totalReward: number
  metadata: TrajectoryMetadata
}

/** Simple trajectory step for Crucible integration */
export interface CrucibleTrajectoryStep {
  stepNumber: number
  observation: string
  action: string
  reward: number
  done: boolean
}

// Crucible Training Client

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
        const errorText = await response.text().catch(() => '')
        throw new Error(
          `Failed to register agent ${agent.agentId}: ${response.status} ${errorText}`,
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
    const runId = `run-${crypto.randomUUID()}`

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
      const errorText = await response.text().catch(() => '')
      throw new Error(
        `Failed to start training run: ${response.status} ${errorText}`,
      )
    }

    run.status = 'running'
    this.activeRuns.set(runId, run)
    return run
  }

  /**
   * Submit a trajectory for training.
   *
   * Note: Uses message-based submission rather than raw tokens.
   * The Atropos server handles tokenization using the configured tokenizer.
   */
  async submitTrajectory(trajectory: AgentTrajectory): Promise<void> {
    const prompt = trajectory.steps.map((s) => s.observation).join('\n')
    const response = trajectory.steps.map((s) => s.action).join('\n')

    // Submit as messages - let Atropos handle tokenization
    const emptyTokenArrays: number[][] = []
    const emptyMaskArrays: number[][] = []

    const scoredData = {
      messages: [
        [
          { role: 'user' as const, content: prompt },
          { role: 'assistant' as const, content: response },
        ],
      ],
      scores: [trajectory.totalReward],
      // Empty tokens/masks - server will tokenize from messages
      tokens: emptyTokenArrays,
      masks: emptyMaskArrays,
      metadata: {
        trajectoryId: trajectory.episodeId,
        agentId: trajectory.agentId,
        ...trajectory.metadata,
      },
    }

    const res = await fetch(`${this.dwsApiUrl}/training/atropos/scored_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoredData),
    })

    if (!res.ok) {
      throw new Error(`Failed to submit trajectory: ${res.status}`)
    }
  }

  async getRunStatus(runId: string): Promise<TrainingRun | null> {
    const run = this.activeRuns.get(runId)
    if (!run) return null

    const response = await fetch(`${this.dwsApiUrl}/training/jobs`)
    if (response.ok) {
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
    }

    return run
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId)
    if (!run) {
      throw new Error(`Run ${runId} not found`)
    }

    // Call DWS to stop the training job
    const response = await fetch(`${this.dwsApiUrl}/training/jobs/${runId}`, {
      method: 'DELETE',
    })

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text().catch(() => '')
      throw new Error(
        `Failed to stop run ${runId}: ${response.status} ${errorText}`,
      )
    }

    run.status = 'completed'
    run.completedAt = Date.now()
  }

  getActiveRuns(): TrainingRun[] {
    return Array.from(this.activeRuns.values()).filter(
      (r) => r.status === 'running',
    )
  }
}

// Factory

export function createCrucibleTrainingClient(config?: {
  dwsApiUrl?: string
  crucibleApiUrl?: string
}): CrucibleTrainingClient {
  return new CrucibleTrainingClient(config)
}
