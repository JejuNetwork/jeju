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

/**
 * Interface for app-specific training data collection
 */
export interface TrainingDataAdapter<TStep = TrajectoryStep, TContext = TrajectoryContext> {
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
export interface Trajectory<TStep = TrajectoryStep> {
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
export class AppTrainingRunner<TStep = TrajectoryStep, TContext = TrajectoryContext> {
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
   * Score a trajectory against a rubric
   */
  private async scoreTrajectory(
    _trajectory: Trajectory<TStep>,
    _context: TContext,
    rubric: JudgeRubric,
  ): Promise<number> {
    // Use rubric criteria to score
    // This is a simplified implementation - real scoring would use LLM judge
    let totalScore = 0
    let totalWeight = 0

    // Use priorityMetrics from the rubric for weighting
    for (const _metricName of rubric.priorityMetrics) {
      // Each metric contributes to the score based on equal weight
      const weight = 1
      // Calculate metric score based on trajectory data
      // This would be more sophisticated in practice
      const metricScore = 0.5 // Placeholder
      totalScore += metricScore * weight
      totalWeight += weight
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0
  }

  /**
   * Export trajectories to HuggingFace
   */
  private async exportToHuggingFace(
    _trajectories: Trajectory<TStep>[],
    _config: HuggingFaceExportConfig,
  ): Promise<string> {
    // Implementation would use the HuggingFace upload utilities
    // Return CID of exported data
    return 'exported-cid'
  }
}

/**
 * Create an app training adapter
 */
export function createAppTrainingAdapter<TStep = TrajectoryStep, TContext = TrajectoryContext>(
  adapter: TrainingDataAdapter<TStep, TContext>,
): AppTrainingRunner<TStep, TContext> {
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
