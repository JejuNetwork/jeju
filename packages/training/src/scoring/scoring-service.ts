/**
 * ArchetypeScoringService
 *
 * Scores trajectories using LLM-as-judge with archetype-specific rubrics.
 * Supports both single trajectory scoring and RULER-style relative comparison.
 *
 * This is a framework-agnostic implementation. Database and LLM caller
 * must be provided via dependency injection.
 *
 * @packageDocumentation
 */

import type { z } from 'zod'
import { TrajectoryMetricsExtractor } from '../metrics/extractor'
import { hasArchetypeRubric } from '../rubrics/archetypes'
import {
  parseTrajectorySteps,
  RulerScoreResponseSchema,
  TrajectoryScoreResponseSchema,
} from '../schemas'
import { judgePromptBuilder } from './judge-prompt-builder'
import type {
  ArchetypeScore,
  ILLMCallerForScoring,
  ScoringOptions,
  TrajectoryContext,
} from './types'

/**
 * Split array into batches
 */
function splitIntoBatches<T>(arr: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < arr.length; i += batchSize) {
    batches.push(arr.slice(i, i + batchSize))
  }
  return batches
}

/**
 * Trajectory data from database for scoring
 */
export interface ScoringTrajectoryRecord {
  trajectoryId: string
  agentId: string
  stepsJson: string
  archetype?: string
  scenarioId?: string
  finalPnL?: number
  episodeLength?: number
  totalReward?: number
}

const DEFAULT_OPTIONS: ScoringOptions = {
  includeActionDetails: false,
  saveToDatabase: true,
}

/**
 * Service for scoring trajectories with archetype-aware evaluation.
 * Requires LLM caller to be injected.
 */
export class ArchetypeScoringService {
  private readonly minGroupSize = 2
  private readonly maxGroupSize = 8
  private readonly metricsExtractor = new TrajectoryMetricsExtractor()

  constructor(private readonly llmCaller: ILLMCallerForScoring) {}

  /**
   * Score a single trajectory from raw data
   */
  async scoreTrajectoryFromRecord(
    record: ScoringTrajectoryRecord,
    options: ScoringOptions = {},
  ): Promise<ArchetypeScore> {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const archetype = record.archetype ?? opts.archetype ?? 'default'
    const steps = parseTrajectorySteps(record.stepsJson)

    const metrics = this.metricsExtractor.extractFromJson({
      trajectoryId: record.trajectoryId,
      agentId: record.agentId,
      stepsJson: record.stepsJson,
      scenarioId: record.scenarioId,
      finalPnL: record.finalPnL,
    })

    const context: TrajectoryContext = {
      trajectoryId: record.trajectoryId,
      agentId: record.agentId,
      archetype,
      steps: steps.map(
        (s: {
          stepNumber: number
          action?: {
            actionType: string
            parameters?: Record<string, unknown>
            reasoning?: string
            success: boolean
            result?: Record<string, unknown>
          } | null
        }) => ({
          stepNumber: s.stepNumber,
          action: s.action,
        }),
      ),
      metrics,
      finalPnL: record.finalPnL,
      episodeLength: record.episodeLength,
      totalReward: record.totalReward,
    }

    return this.scoreFromContext(context, opts)
  }

  /**
   * Score a trajectory from prepared context
   */
  async scoreFromContext(
    context: TrajectoryContext,
    options: ScoringOptions = {},
  ): Promise<ArchetypeScore> {
    const opts = { ...DEFAULT_OPTIONS, ...options }

    const { system, user } = judgePromptBuilder.buildSinglePrompt(context, {
      includeActionDetails: opts.includeActionDetails,
    })

    const response = await this.callSingleJudge(system, user)

    return {
      trajectoryId: context.trajectoryId,
      agentId: context.agentId,
      archetype: context.archetype ?? 'default',
      score: Math.max(0, Math.min(1, response.score)),
      reasoning: response.reasoning,
      strengths: response.strengths ?? [],
      weaknesses: response.weaknesses ?? [],
      metrics: context.metrics,
      scoredAt: new Date(),
    }
  }

  /**
   * Score multiple trajectories using RULER comparison.
   */
  async scoreTrajectoryGroup(
    records: ScoringTrajectoryRecord[],
    options: ScoringOptions = {},
  ): Promise<ArchetypeScore[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options }

    if (records.length < this.minGroupSize) {
      return []
    }

    const contexts: TrajectoryContext[] = []
    const fallbackArchetype = opts.archetype ?? 'default'

    for (const record of records) {
      const steps = parseTrajectorySteps(record.stepsJson)
      const archetype = record.archetype ?? fallbackArchetype

      const metrics = this.metricsExtractor.extractFromJson({
        trajectoryId: record.trajectoryId,
        agentId: record.agentId,
        stepsJson: record.stepsJson,
        scenarioId: record.scenarioId,
        finalPnL: record.finalPnL,
      })

      contexts.push({
        trajectoryId: record.trajectoryId,
        agentId: record.agentId,
        archetype,
        steps: steps.map(
          (s: {
            stepNumber: number
            action?: {
              actionType: string
              parameters?: Record<string, unknown>
              reasoning?: string
              success: boolean
              result?: Record<string, unknown>
            } | null
          }) => ({
            stepNumber: s.stepNumber,
            action: s.action,
          }),
        ),
        metrics,
        finalPnL: record.finalPnL,
        episodeLength: record.episodeLength,
        totalReward: record.totalReward,
      })
    }

    const batches = splitIntoBatches(contexts, this.maxGroupSize)
    const scores: ArchetypeScore[] = []

    for (const batch of batches) {
      const scenarioId = batch[0]?.archetype ?? 'unknown'
      const { system, user } = judgePromptBuilder.buildComparisonPrompt(
        batch,
        scenarioId,
      )
      const response = await this.callComparisonJudge(system, user)

      for (let i = 0; i < batch.length; i++) {
        const ctx = batch[i]
        if (!ctx) continue

        const expectedId = `trajectory-${i + 1}`
        const scoreData = response.scores.find(
          (s: { trajectory_id: string; explanation: string; score: number }) =>
            s.trajectory_id === expectedId,
        )

        if (!scoreData) {
          throw new Error(`Missing score for ${expectedId}`)
        }

        scores.push({
          trajectoryId: ctx.trajectoryId,
          agentId: ctx.agentId,
          archetype: ctx.archetype ?? 'default',
          score: Math.max(0, Math.min(1, scoreData.score)),
          reasoning: scoreData.explanation,
          strengths: [],
          weaknesses: [],
          metrics: ctx.metrics,
          scoredAt: new Date(),
        })
      }
    }

    return scores
  }

  /**
   * Score trajectories by archetype.
   */
  async scoreByArchetype(
    archetype: string,
    records: ScoringTrajectoryRecord[],
  ): Promise<{ scored: number; errors: number }> {
    if (!hasArchetypeRubric(archetype)) {
      // Using default rubric
    }

    if (records.length === 0) {
      return { scored: 0, errors: 0 }
    }

    const scores = await this.scoreTrajectoryGroup(records, {
      archetype,
      saveToDatabase: true,
    })

    return {
      scored: scores.length,
      errors: records.length - scores.length,
    }
  }

  /**
   * Score trajectories in parallel with rate limiting.
   */
  async scoreTrajectoriesParallel(
    records: ScoringTrajectoryRecord[],
    options: ScoringOptions = {},
    concurrency: number = 5,
  ): Promise<ArchetypeScore[]> {
    const results: ArchetypeScore[] = []
    const batches = splitIntoBatches(records, concurrency)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i] ?? []
      const batchPromises = batch.map((record) =>
        this.scoreTrajectoryFromRecord(record, options),
      )
      const batchResults = await Promise.all(batchPromises)

      for (const result of batchResults) {
        results.push(result)
      }

      if (i < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    return results
  }

  /**
   * Call LLM judge for single trajectory.
   */
  private async callSingleJudge(
    system: string,
    user: string,
  ): Promise<z.infer<typeof TrajectoryScoreResponseSchema>> {
    const prompt = `${user}\n\nReturn ONLY valid JSON, no other text.`

    const response = await this.llmCaller.callLLM({
      prompt,
      system,
      temperature: 0.3,
      maxTokens: 1000,
    })

    const parsed = this.parseJudgeResponse(
      response,
      TrajectoryScoreResponseSchema,
    )
    if (!parsed) {
      throw new Error('Failed to parse judge response')
    }
    return parsed
  }

  /**
   * Call LLM judge for trajectory comparison.
   */
  private async callComparisonJudge(
    system: string,
    user: string,
  ): Promise<z.infer<typeof RulerScoreResponseSchema>> {
    const prompt = `${user}\n\nReturn ONLY valid JSON, no other text.`

    const response = await this.llmCaller.callLLM({
      prompt,
      system,
      temperature: 0.3,
      maxTokens: 2000,
    })

    const parsed = this.parseJudgeResponse(response, RulerScoreResponseSchema)
    if (!parsed) {
      throw new Error('Failed to parse comparison judge response')
    }
    return parsed
  }

  /**
   * Parse JSON response from judge with Zod validation.
   */
  private parseJudgeResponse<T>(
    response: string,
    schema: z.ZodType<T>,
  ): T | null {
    const jsonText = response
      .trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return null
    }

    const parsed: unknown = JSON.parse(jsonMatch[0])
    const result = schema.safeParse(parsed)

    if (!result.success) {
      return null
    }

    return result.data
  }
}

/**
 * Create a scoring service with the provided LLM caller
 */
export function createScoringService(
  llmCaller: ILLMCallerForScoring,
): ArchetypeScoringService {
  return new ArchetypeScoringService(llmCaller)
}
