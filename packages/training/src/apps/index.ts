/**
 * App Training Adapters
 *
 * Interface for apps to integrate with Jeju's training infrastructure.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TrainingConfig, TrainingMetrics } from '../grpo/index.js'
import {
  getHuggingFaceToken,
  uploadDirectoryToHuggingFace,
} from '../huggingface/index.js'
import type { JudgeRubric } from '../rubrics/index.js'

export interface TrainingDataAdapter<
  TStep extends AppTrajectoryStep = AppTrajectoryStep,
  TContext extends AppTrajectoryContext = AppTrajectoryContext,
> {
  appName: string
  collectTrajectories(options: CollectOptions): Promise<Trajectory<TStep>[]>
  getTrajectory(trajectoryId: string): Promise<Trajectory<TStep> | null>
  getTrajectoryContext(trajectoryId: string): Promise<TContext>
  markProcessed(trajectoryId: string): Promise<void>
  storeTrainingResult(result: TrainingResult): Promise<void>
  getRubrics(): JudgeRubric[]
  /** Optional: Custom scoring logic */
  customScoring?(
    trajectory: Trajectory<TStep>,
    context: TContext,
  ): Promise<number>
}

export interface CollectOptions {
  agentId?: string
  archetype?: string
  minSteps?: number
  limit?: number
  unprocessedOnly?: boolean
  since?: Date
  until?: Date
}

export interface Trajectory<TStep extends AppTrajectoryStep = AppTrajectoryStep> {
  trajectoryId: string
  agentId: string
  archetype?: string
  steps: TStep[]
  metadata: TrajectoryMetadata
  createdAt: Date
  updatedAt?: Date
}

/**
 * Trajectory step for app adapters.
 *
 * Note: This is a simplified step type for app integrations.
 * For Zod-validated storage types, use TrajectoryStep from @jejunetwork/training schemas.
 */
export interface AppTrajectoryStep {
  stepId: string
  tick: number
  timestamp: number
  observation: string
  action: string
  reward?: number
  llmCall?: LLMCallRecord
}

export interface LLMCallRecord {
  model: string
  prompt: string
  completion: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
}

export interface TrajectoryMetadata {
  totalReward?: number
  stepCount: number
  status: TrajectoryStatus
  scores?: Record<string, number>
  appData?: Record<string, unknown>
}

export type TrajectoryStatus =
  | 'collecting'
  | 'collected'
  | 'scored'
  | 'training'
  | 'trained'
  | 'exported'

/**
 * Trajectory context for app adapters.
 *
 * Note: This is for app integrations. For LLM judging context,
 * use TrajectoryContext from @jejunetwork/training scoring module.
 */
export interface AppTrajectoryContext {
  agent: {
    id: string
    archetype?: string
    startBalance: bigint
    endBalance: bigint
  }
  initialState: Record<string, unknown>
  finalState: Record<string, unknown>
  appContext?: Record<string, unknown>
}

export interface TrainingResult {
  trajectoryId: string
  scores: Record<string, number>
  feedback?: string
  model?: string
  trainedAt: Date
}

export interface ScoringConfig {
  expectedEpisodeLength?: number
  llmEfficiencyMultiplier?: number
  noMetricsFallbackScore?: number
  priorityMetricWeight?: number
}

export interface TrainingLoopConfig {
  archetype: string
  trajectoryThreshold: number
  maxTrajectories?: number
  trainingConfig?: Partial<TrainingConfig>
  exportToHuggingFace?: boolean
  huggingfaceRepo?: string
  useTEE?: boolean
  teePlatform?: 'intel_sgx' | 'intel_tdx' | 'amd_sev'
  mpc?: { parties: number; threshold: number }
  scoring?: ScoringConfig
}

export interface TrainingLoopResult {
  success: boolean
  trajectoriesProcessed: number
  trainingMetrics?: TrainingMetrics
  exportCid?: string
  errors?: string[]
}

export interface HuggingFaceExportConfig {
  repo: string
  branch?: string
  createIfNotExists?: boolean
  format: 'parquet' | 'json' | 'arrow'
  compression?: 'gzip' | 'zstd' | 'none'
  includeModelCard?: boolean
  private?: boolean
}

const DEFAULT_SCORING: Required<ScoringConfig> = {
  expectedEpisodeLength: 100,
  llmEfficiencyMultiplier: 2,
  noMetricsFallbackScore: 0.5,
  priorityMetricWeight: 1.2,
}

export class AppTrainingRunner<
  TStep extends AppTrajectoryStep = AppTrajectoryStep,
  TContext extends AppTrajectoryContext = AppTrajectoryContext,
> {
  private adapter: TrainingDataAdapter<TStep, TContext>
  private scoringConfig: Required<ScoringConfig>

  constructor(
    adapter: TrainingDataAdapter<TStep, TContext>,
    scoringConfig?: ScoringConfig,
  ) {
    this.adapter = adapter
    this.scoringConfig = { ...DEFAULT_SCORING, ...scoringConfig }
  }

  /**
   * Run the training loop
   */
  async runTrainingLoop(
    config: TrainingLoopConfig,
  ): Promise<TrainingLoopResult> {
    const errors: string[] = []
    let trajectoriesProcessed = 0

    let trajectories: Trajectory<TStep>[]
    try {
      trajectories = await this.adapter.collectTrajectories({
        archetype: config.archetype,
        limit: config.maxTrajectories ?? config.trajectoryThreshold,
        unprocessedOnly: true,
      })
    } catch (e) {
      return {
        success: false,
        trajectoriesProcessed: 0,
        errors: [`collectTrajectories failed: ${e}`],
      }
    }

    if (trajectories.length < config.trajectoryThreshold) {
      return {
        success: false,
        trajectoriesProcessed: 0,
        errors: [
          `Not enough trajectories: ${trajectories.length} < ${config.trajectoryThreshold}`,
        ],
      }
    }

    const rubrics = this.adapter.getRubrics()
    for (const trajectory of trajectories) {
      try {
        const context = await this.adapter.getTrajectoryContext(
          trajectory.trajectoryId,
        )
        const scores: Record<string, number> = {}

        if (this.adapter.customScoring) {
          scores.custom = await this.adapter.customScoring(trajectory, context)
        }

        for (const rubric of rubrics) {
          scores[rubric.id] = await this.scoreTrajectory(
            trajectory,
            context,
            rubric,
          )
        }

        await this.adapter.storeTrainingResult({
          trajectoryId: trajectory.trajectoryId,
          scores,
          trainedAt: new Date(),
        })

        await this.adapter.markProcessed(trajectory.trajectoryId)
        trajectoriesProcessed++
      } catch (e) {
        errors.push(`Trajectory ${trajectory.trajectoryId}: ${e}`)
      }
    }

    let exportCid: string | undefined
    if (config.exportToHuggingFace && config.huggingfaceRepo) {
      try {
        exportCid = await this.exportToHuggingFace(trajectories, {
          repo: config.huggingfaceRepo,
          format: 'parquet',
          includeModelCard: true,
        })
      } catch (e) {
        errors.push(`HuggingFace export failed: ${e}`)
      }
    }

    return {
      success: errors.length === 0,
      trajectoriesProcessed,
      exportCid,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  private async scoreTrajectory(
    trajectory: Trajectory<TStep>,
    context: TContext,
    rubric: JudgeRubric,
  ): Promise<number> {
    const {
      expectedEpisodeLength,
      llmEfficiencyMultiplier,
      noMetricsFallbackScore,
      priorityMetricWeight,
    } = this.scoringConfig
    const scores: number[] = []
    const stepCount = trajectory.steps.length

    const rewards = trajectory.steps
      .map((s) => s.reward)
      .filter((r): r is number => r !== undefined)
    if (rewards.length > 0) {
      const avgReward = rewards.reduce((a, b) => a + b, 0) / rewards.length
      scores.push(Math.max(0, Math.min(1, (avgReward + 1) / 2)))
    }

    scores.push(Math.min(1, stepCount / expectedEpisodeLength))

    if (context.agent.startBalance > 0n) {
      const pnlRatio =
        Number(context.agent.endBalance - context.agent.startBalance) /
        Number(context.agent.startBalance)
      scores.push(Math.max(0, Math.min(1, (pnlRatio + 1) / 2)))
    }

    const llmCalls = trajectory.steps.filter((s) => s.llmCall).length
    if (llmCalls > 0) {
      scores.push(
        Math.max(0, 1 - llmCalls / (stepCount * llmEfficiencyMultiplier)),
      )
    }

    if (scores.length === 0) {
      console.warn(
        `[AppTrainingRunner] No metrics for trajectory ${trajectory.trajectoryId}`,
      )
      return noMetricsFallbackScore
    }

    const weight =
      rubric.priorityMetrics.length > 0 ? priorityMetricWeight : 1.0
    return Math.min(
      1,
      (scores.reduce((a, b) => a + b, 0) / scores.length) * weight,
    )
  }

  private async exportToHuggingFace(
    trajectories: Trajectory<TStep>[],
    config: HuggingFaceExportConfig,
  ): Promise<string> {
    const token = getHuggingFaceToken()
    if (!token) {
      throw new Error('HUGGINGFACE_TOKEN not set')
    }

    const exportDir = join(tmpdir(), `jeju-export-${Date.now()}`)
    mkdirSync(exportDir, { recursive: true })

    try {
      const exportData = trajectories.map((t) => ({
        trajectory_id: t.trajectoryId,
        agent_id: t.agentId,
        archetype: t.archetype,
        step_count: t.steps.length,
        total_reward: t.metadata.totalReward,
        status: t.metadata.status,
        created_at: t.createdAt.toISOString(),
        steps: t.steps.map((s) => ({
          step_id: s.stepId,
          tick: s.tick,
          timestamp: s.timestamp,
          observation: s.observation,
          action: s.action,
          reward: s.reward,
          llm_model: s.llmCall?.model,
          llm_prompt_tokens: s.llmCall?.promptTokens,
          llm_completion_tokens: s.llmCall?.completionTokens,
        })),
      }))

      const dataFile = join(
        exportDir,
        config.format === 'json' ? 'data.json' : 'data.jsonl',
      )
      const content =
        config.format === 'json'
          ? JSON.stringify(exportData, null, 2)
          : exportData.map((d) => JSON.stringify(d)).join('\n')
      writeFileSync(dataFile, content)

      if (config.includeModelCard) {
        writeFileSync(
          join(exportDir, 'README.md'),
          `---
license: apache-2.0
task_categories: [reinforcement-learning]
tags: [jeju, training-data]
---
# Training Data
- Trajectories: ${trajectories.length}
- App: ${this.adapter.appName}
- Format: ${config.format}
`,
        )
      }

      const uploadedFiles = await uploadDirectoryToHuggingFace(
        config.repo,
        'dataset',
        exportDir,
        token,
      )
      return `upload-${Date.now()}-${uploadedFiles}files`
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  }
}

export function createAppTrainingAdapter<
  TStep extends AppTrajectoryStep = AppTrajectoryStep,
  TContext extends AppTrajectoryContext = AppTrajectoryContext,
>(
  adapter: TrainingDataAdapter<TStep, TContext>,
  scoringConfig?: ScoringConfig,
): AppTrainingRunner<TStep, TContext> {
  return new AppTrainingRunner(adapter, scoringConfig)
}

export interface AppTrainingConfig {
  appName: string
  huggingfaceRepo?: string
  defaultArchetype?: string
  trajectoryThreshold?: number
  maxTrajectories?: number
  useTEE?: boolean
  mpc?: { parties: number; threshold: number }
}

/**
 * Get default app training configuration
 */
export function getDefaultAppTrainingConfig(
  appName: string,
): AppTrainingConfig {
  return {
    appName,
    trajectoryThreshold: 10000,
    maxTrajectories: 50000,
    useTEE: false,
  }
}
