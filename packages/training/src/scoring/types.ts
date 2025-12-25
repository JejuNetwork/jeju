/**
 * Scoring Module Types
 *
 * Types for LLM-as-judge scoring with archetype-specific rubrics.
 *
 * @packageDocumentation
 */

import type { BehavioralMetrics } from '../metrics/types'

/**
 * Score result for a single trajectory.
 */
export interface ArchetypeScore {
  trajectoryId: string
  agentId: string
  archetype: string
  score: number
  reasoning: string
  strengths: string[]
  weaknesses: string[]
  metrics: BehavioralMetrics
  scoredAt: Date
}

/**
 * Options for scoring operations.
 */
export interface ScoringOptions {
  /** Override archetype for scoring */
  archetype?: string
  /** Include detailed action context in prompts */
  includeActionDetails?: boolean
  /** Save scores to database */
  saveToDatabase?: boolean
}

/**
 * Cached score entry
 */
export interface CachedScore {
  cacheKey: string
  trajectoryId: string
  archetype: string
  score: number
  reasoning: string
  strengths: string[]
  weaknesses: string[]
  rubricVersion: string
  rubricHash: string
  scoredAt: Date
  expiresAt: Date
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number
  misses: number
  invalidations: number
  hitRate: number
}

/**
 * Cache configuration
 */
export interface JudgeCacheConfig {
  /** Time-to-live in hours (default: 168 = 1 week) */
  ttlHours: number
  /** Maximum cache entries (default: 10000) */
  maxEntries: number
  /** Whether to validate rubric version on cache hit */
  validateRubricVersion: boolean
}

/**
 * Context for trajectory evaluation.
 */
export interface TrajectoryContext {
  trajectoryId: string
  agentId: string
  archetype?: string
  steps: TrajectoryStepForJudge[]
  metrics: BehavioralMetrics
  /** Final profit/loss */
  finalPnL?: number
  /** Episode length in steps */
  episodeLength?: number
  /** Total accumulated reward */
  totalReward?: number
}

/**
 * Trajectory step for judge evaluation
 */
export interface TrajectoryStepForJudge {
  stepNumber: number
  action?: {
    actionType: string
    parameters?: Record<string, unknown>
    reasoning?: string
    success: boolean
    result?: Record<string, unknown>
  } | null
}

/**
 * Options for building judge prompts.
 */
export interface JudgePromptOptions {
  /** Include full action details */
  includeActionDetails?: boolean
  /** Maximum recent actions to show */
  maxActionsToShow?: number
  /** Include key decisions (trades, posts) */
  includeKeyDecisions?: boolean
}

/**
 * LLM caller interface for scoring
 */
export interface ILLMCallerForScoring {
  callLLM(params: {
    prompt: string
    system: string
    temperature?: number
    maxTokens?: number
  }): Promise<string>
}
