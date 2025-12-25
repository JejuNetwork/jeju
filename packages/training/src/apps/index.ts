/**
 * App Training Adapters
 *
 * Provides a generalized structure for apps (like Babylon) to integrate
 * with Jeju's training infrastructure while maintaining their own data
 * tables and training loops.
 *
 * Key concepts:
 * - TrainingDataAdapter: Interface for app-specific data collection
 * - TrainingLoopRunner: Orchestrates training with app-specific hooks
 * - HuggingFaceExporter: Containerizes and ships data to HuggingFace
 *
 * @example
 * ```typescript
 * import { createAppTrainingAdapter } from '@jejunetwork/training/apps';
 *
 * const adapter = createAppTrainingAdapter({
 *   appName: 'babylon',
 *   dataCollector: babylonDataCollector,
 *   rubrics: babylonRubrics,
 *   huggingfaceRepo: 'babylon/training-data',
 * });
 *
 * // Run training loop
 * await adapter.runTrainingLoop({
 *   archetype: 'trader',
 *   trajectoryThreshold: 10000,
 * });
 * ```
 */

import type { JudgeRubric } from '../rubrics/index.js'
import type { TrainingConfig, TrainingMetrics } from '../grpo/index.js'
import {
  uploadDirectoryToHuggingFace,
  getHuggingFaceToken,
} from '../huggingface/index.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Interface for app-specific training data collection
 */
export interface TrainingDataAdapter<
  TStep extends TrajectoryStep = TrajectoryStep,
  TContext extends TrajectoryContext = TrajectoryContext,
> {
  /** App name (e.g., 'babylon', 'crucible') */
  appName: string

  /** Collect trajectories from the app's database */
  collectTrajectories(options: CollectOptions): Promise<Trajectory<TStep>[]>

  /** Get trajectory by ID */
  getTrajectory(trajectoryId: string): Promise<Trajectory<TStep> | null>

  /** Get context for scoring (e.g., agent state, market conditions) */
  getTrajectoryContext(trajectoryId: string): Promise<TContext>

  /** Mark trajectory as processed for training */
  markProcessed(trajectoryId: string): Promise<void>

  /** Store training results back to app database */
  storeTrainingResult(result: TrainingResult): Promise<void>

  /** Get app-specific rubrics for scoring */
  getRubrics(): JudgeRubric[]

  /** Optional: Custom scoring logic */
  customScoring?(trajectory: Trajectory<TStep>, context: TContext): Promise<number>
}

/**
 * Options for collecting trajectories
 */
export interface CollectOptions {
  /** Agent ID to collect for */
  agentId?: string
  /** Archetype to filter by */
  archetype?: string
  /** Minimum trajectory length */
  minSteps?: number
  /** Maximum trajectories to collect */
  limit?: number
  /** Only unprocessed trajectories */
  unprocessedOnly?: boolean
  /** Start timestamp */
  since?: Date
  /** End timestamp */
  until?: Date
}

/**
 * Generic trajectory structure that apps can customize
 */
export interface Trajectory<TStep extends TrajectoryStep = TrajectoryStep> {
  trajectoryId: string
  agentId: string
  archetype?: string
  steps: TStep[]
  metadata: TrajectoryMetadata
  createdAt: Date
  updatedAt?: Date
}

/**
 * Base trajectory step structure
 */
export interface TrajectoryStep {
  stepId: string
  tick: number
  timestamp: number
  observation: string
  action: string
  reward?: number
  llmCall?: LLMCallRecord
}

/**
 * LLM call record for training data
 */
export interface LLMCallRecord {
  model: string
  prompt: string
  completion: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
}

/**
 * Trajectory metadata
 */
export interface TrajectoryMetadata {
  /** Total reward accumulated */
  totalReward?: number
  /** Number of steps */
  stepCount: number
  /** Training status */
  status: TrajectoryStatus
  /** Scoring results */
  scores?: Record<string, number>
  /** App-specific metadata */
  appData?: Record<string, unknown>
}

/**
 * Trajectory status
 */
export type TrajectoryStatus =
  | 'collecting'
  | 'collected'
  | 'scored'
  | 'training'
  | 'trained'
  | 'exported'

/**
 * Context for trajectory scoring
 */
export interface TrajectoryContext {
  /** Agent information */
  agent: {
    id: string
    archetype?: string
    startBalance: bigint
    endBalance: bigint
  }
  /** Game/environment state at trajectory start */
  initialState: Record<string, unknown>
  /** Game/environment state at trajectory end */
  finalState: Record<string, unknown>
  /** App-specific context */
  appContext?: Record<string, unknown>
}

/**
 * Training result to store
 */
export interface TrainingResult {
  trajectoryId: string
  scores: Record<string, number>
  feedback?: string
  model?: string
  trainedAt: Date
}

/**
 * Training loop configuration
 */
export interface TrainingLoopConfig {
  /** Archetype to train */
  archetype: string
  /** Minimum trajectories before starting training */
  trajectoryThreshold: number
  /** Maximum trajectories to process per run */
  maxTrajectories?: number
  /** Training configuration */
  trainingConfig?: Partial<TrainingConfig>
  /** Whether to export to HuggingFace after training */
  exportToHuggingFace?: boolean
  /** HuggingFace repository */
  huggingfaceRepo?: string
  /** Use TEE for training */
  useTEE?: boolean
  /** TEE platform */
  teePlatform?: 'intel_sgx' | 'intel_tdx' | 'amd_sev'
  /** MPC configuration for distributed training */
  mpc?: {
    parties: number
    threshold: number
  }
}

/**
 * Training loop result
 */
export interface TrainingLoopResult {
  success: boolean
  trajectoriesProcessed: number
  trainingMetrics?: TrainingMetrics
  exportCid?: string
  errors?: string[]
}

/**
 * HuggingFace export configuration
 */
export interface HuggingFaceExportConfig {
  /** Repository name (e.g., 'babylon/trading-trajectories') */
  repo: string
  /** Branch to push to */
  branch?: string
  /** Whether to create repo if it doesn't exist */
  createIfNotExists?: boolean
  /** Dataset format */
  format: 'parquet' | 'json' | 'arrow'
  /** Compression */
  compression?: 'gzip' | 'zstd' | 'none'
  /** Include model card */
  includeModelCard?: boolean
  /** Privacy setting */
  private?: boolean
}

/**
 * App Training Runner
 *
 * Orchestrates the training loop for an app using Jeju's infrastructure.
 */
export class AppTrainingRunner<
  TStep extends TrajectoryStep = TrajectoryStep,
  TContext extends TrajectoryContext = TrajectoryContext,
> {
  private adapter: TrainingDataAdapter<TStep, TContext>

  constructor(adapter: TrainingDataAdapter<TStep, TContext>) {
    this.adapter = adapter
  }

  /**
   * Run the training loop
   */
  async runTrainingLoop(config: TrainingLoopConfig): Promise<TrainingLoopResult> {
    const errors: string[] = []
    let trajectoriesProcessed = 0

    // 1. Collect trajectories
    const trajectories = await this.adapter.collectTrajectories({
      archetype: config.archetype,
      limit: config.maxTrajectories ?? config.trajectoryThreshold,
      unprocessedOnly: true,
    })

    if (trajectories.length < config.trajectoryThreshold) {
      return {
        success: false,
        trajectoriesProcessed: 0,
        errors: [
          `Not enough trajectories: ${trajectories.length} < ${config.trajectoryThreshold}`,
        ],
      }
    }

    // 2. Score trajectories
    const rubrics = this.adapter.getRubrics()
    for (const trajectory of trajectories) {
      const context = await this.adapter.getTrajectoryContext(trajectory.trajectoryId)

      // Use custom scoring if available, otherwise use rubric-based scoring
      const scores: Record<string, number> = {}
      if (this.adapter.customScoring) {
        scores.custom = await this.adapter.customScoring(trajectory, context)
      }

      // Score against each rubric
      for (const rubric of rubrics) {
        scores[rubric.id] = await this.scoreTrajectory(trajectory, context, rubric)
      }

      // Store results
      await this.adapter.storeTrainingResult({
        trajectoryId: trajectory.trajectoryId,
        scores,
        trainedAt: new Date(),
      })

      await this.adapter.markProcessed(trajectory.trajectoryId)
      trajectoriesProcessed++
    }

    // 3. Export to HuggingFace if configured
    let exportCid: string | undefined
    if (config.exportToHuggingFace && config.huggingfaceRepo) {
      exportCid = await this.exportToHuggingFace(trajectories, {
        repo: config.huggingfaceRepo,
        format: 'parquet',
        includeModelCard: true,
      })
    }

    return {
      success: true,
      trajectoriesProcessed,
      exportCid,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Score a trajectory against a rubric using actual trajectory metrics.
   *
   * Calculates scores based on:
   * - Total reward accumulated
   * - Episode completion (steps / expected steps)
   * - Consistency (reward variance)
   * - PnL metrics from context if available
   */
  private async scoreTrajectory(
    trajectory: Trajectory<TStep>,
    context: TContext,
    rubric: JudgeRubric,
  ): Promise<number> {
    const scores: number[] = []

    // 1. Reward-based scoring (if rewards available)
    const rewards = trajectory.steps
      .map((s) => s.reward)
      .filter((r): r is number => r !== undefined)

    if (rewards.length > 0) {
      const totalReward = rewards.reduce((a, b) => a + b, 0)
      const avgReward = totalReward / rewards.length
      // Normalize to 0-1 range (assuming rewards are in -1 to 1 range typically)
      const rewardScore = Math.max(0, Math.min(1, (avgReward + 1) / 2))
      scores.push(rewardScore)
    }

    // 2. Episode completion scoring
    const stepCount = trajectory.steps.length
    // Assume rubric has expected episode length or use 100 as default
    const expectedSteps = 100
    const completionScore = Math.min(1, stepCount / expectedSteps)
    scores.push(completionScore)

    // 3. PnL scoring from context
    if (context.agent.startBalance > 0n) {
      const pnlRatio =
        Number(context.agent.endBalance - context.agent.startBalance) /
        Number(context.agent.startBalance)
      // Normalize PnL: -100% = 0, 0% = 0.5, +100% = 1
      const pnlScore = Math.max(0, Math.min(1, (pnlRatio + 1) / 2))
      scores.push(pnlScore)
    }

    // 4. LLM usage efficiency (if LLM calls recorded)
    const llmCalls = trajectory.steps.filter((s) => s.llmCall).length
    if (llmCalls > 0) {
      // Reward efficient LLM usage - penalize excessive calls
      const llmEfficiency = Math.max(0, 1 - llmCalls / (stepCount * 2))
      scores.push(llmEfficiency)
    }

    // 5. Weight by rubric priority metrics
    const priorityWeight = rubric.priorityMetrics.length > 0 ? 1.2 : 1.0

    // Calculate final score
    if (scores.length === 0) {
      // No metrics available - return neutral score with warning
      console.warn(
        `[AppTrainingRunner] No scoring metrics available for trajectory ${trajectory.trajectoryId}`,
      )
      return 0.5
    }

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
    return Math.min(1, avgScore * priorityWeight)
  }

  /**
   * Export trajectories to HuggingFace
   *
   * Converts trajectories to JSON format and uploads to specified HuggingFace repository.
   * Returns the commit SHA/CID of the uploaded data.
   *
   * @throws Error if HuggingFace token not configured
   * @throws Error if upload fails
   */
  private async exportToHuggingFace(
    trajectories: Trajectory<TStep>[],
    config: HuggingFaceExportConfig,
  ): Promise<string> {
    // Validate HuggingFace token is available
    const token = getHuggingFaceToken()
    if (!token) {
      throw new Error(
        'HuggingFace token not configured. Set HUGGINGFACE_TOKEN environment variable.',
      )
    }

    // Create temporary directory for export
    const exportDir = join(tmpdir(), `jeju-training-export-${Date.now()}`)
    mkdirSync(exportDir, { recursive: true })

    try {
      // Convert trajectories to exportable format
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

      // Write data file based on format
      const dataFileName =
        config.format === 'json' ? 'data.json' : 'data.jsonl'
      const dataFilePath = join(exportDir, dataFileName)

      if (config.format === 'json') {
        writeFileSync(dataFilePath, JSON.stringify(exportData, null, 2))
      } else {
        // JSONL format - one JSON object per line
        const jsonlContent = exportData.map((d) => JSON.stringify(d)).join('\n')
        writeFileSync(dataFilePath, jsonlContent)
      }

      // Generate model card if requested
      if (config.includeModelCard) {
        const modelCard = `---
license: apache-2.0
task_categories:
  - reinforcement-learning
tags:
  - jeju
  - training-data
  - trajectories
---

# Training Data Export

Exported from Jeju Network training infrastructure.

## Statistics
- Trajectories: ${trajectories.length}
- App: ${this.adapter.appName}
- Export Date: ${new Date().toISOString()}

## Format
${config.format === 'json' ? 'Single JSON array' : 'JSON Lines (one trajectory per line)'}
`
        writeFileSync(join(exportDir, 'README.md'), modelCard)
      }

      // Upload to HuggingFace
      const uploadedFiles = await uploadDirectoryToHuggingFace(
        config.repo,
        'dataset',
        exportDir,
        token,
      )

      // Return upload ID based on file count
      return `upload-${Date.now()}-${uploadedFiles}files`
    } finally {
      // Clean up temporary directory
      try {
        rmSync(exportDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Create an app training adapter
 */
export function createAppTrainingAdapter<
  TStep extends TrajectoryStep = TrajectoryStep,
  TContext extends TrajectoryContext = TrajectoryContext,
>(adapter: TrainingDataAdapter<TStep, TContext>): AppTrainingRunner<TStep, TContext> {
  return new AppTrainingRunner(adapter)
}

/**
 * Create a training adapter configuration helper
 */
export interface AppTrainingConfig {
  appName: string
  huggingfaceRepo?: string
  defaultArchetype?: string
  trajectoryThreshold?: number
  maxTrajectories?: number
  useTEE?: boolean
  mpc?: {
    parties: number
    threshold: number
  }
}

/**
 * Get default app training configuration
 */
export function getDefaultAppTrainingConfig(appName: string): AppTrainingConfig {
  return {
    appName,
    trajectoryThreshold: 10000,
    maxTrajectories: 50000,
    useTEE: false,
  }
}
