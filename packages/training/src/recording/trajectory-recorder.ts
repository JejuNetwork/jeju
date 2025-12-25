/**
 * TrajectoryRecorder
 *
 * Records agent decisions with full context for GRPO training.
 * Captures environment state, LLM calls, actions, and rewards.
 *
 * This module provides an abstract storage interface, allowing different
 * backends (databases, files, etc.) to be used for persistence.
 *
 * @packageDocumentation
 */

import type { JsonValue } from '@jejunetwork/types'
import { generateSnowflakeId, logger } from '@jejunetwork/shared'
import type {
  Action,
  EnvironmentState,
  LLMCall,
  ProviderAccess,
  TrajectoryStep,
} from '../schemas'
import { getCurrentWindowId } from './window-utils'

export type {
  TrajectoryStep,
  EnvironmentState,
  ProviderAccess,
  LLMCall,
  Action,
}

/**
 * Active trajectory being recorded.
 */
export interface ActiveTrajectory {
  trajectoryId: string
  agentId: string
  archetype?: string
  scenarioId?: string
  startTime: number
  steps: TrajectoryStep[]
  currentStep?: Partial<TrajectoryStep>
}

/**
 * Options for starting a trajectory.
 */
export interface StartTrajectoryOptions {
  /** The agent's user ID */
  agentId: string
  /** The agent's behavioral archetype */
  archetype?: string
  /** Optional scenario identifier */
  scenarioId?: string
  /** Optional time window ID */
  windowId?: string
  /** Optional metadata */
  metadata?: Record<string, JsonValue>
}

/**
 * Options for ending a trajectory.
 */
export interface EndTrajectoryOptions {
  /** Final account balance */
  finalBalance?: number
  /** Final profit/loss */
  finalPnL?: number
  /** Time window ID */
  windowId?: string
  /** Ground truth market data */
  gameKnowledge?: {
    trueProbabilities?: Record<string, number>
    actualOutcomes?: Record<string, JsonValue>
    futureOutcomes?: Record<string, JsonValue>
  }
}

/**
 * Complete trajectory data for storage
 */
export interface TrajectoryRecord {
  id: string
  trajectoryId: string
  agentId: string
  archetype: string | null
  startTime: Date
  endTime: Date
  durationMs: number
  windowId: string
  windowHours: number
  scenarioId: string
  episodeId: string | null
  steps: TrajectoryStep[]
  rewardComponents: {
    environmentReward: number
  }
  metrics: {
    episodeLength: number
    finalStatus: string
    finalBalance?: number
    finalPnL?: number
    tradesExecuted: number
    postsCreated: number
    errorCount: number
  }
  metadata: {
    isTrainingData: boolean
    gameKnowledge: EndTrajectoryOptions['gameKnowledge']
  }
  totalReward: number
}

/**
 * LLM call log record for storage
 */
export interface LLMCallLogRecord {
  id: string
  trajectoryId: string
  stepId: string
  callId: string
  timestamp: Date
  latencyMs: number | null
  model: string
  purpose: string
  actionType: string | null
  systemPrompt: string
  userPrompt: string
  messages: Array<{ role: string; content: string }>
  response: string
  reasoning: string | null
  temperature: number
  maxTokens: number
  metadata: { modelVersion?: string }
}

/**
 * Abstract storage interface for trajectory persistence
 *
 * Implement this interface to use a custom storage backend
 * (database, file system, cloud storage, etc.)
 */
export interface TrajectoryStorage {
  /**
   * Save a completed trajectory
   */
  saveTrajectory(record: TrajectoryRecord): Promise<void>

  /**
   * Save LLM call logs
   */
  saveLLMCallLogs(logs: LLMCallLogRecord[]): Promise<void>

  /**
   * Generate a unique ID (optional, defaults to snowflake)
   */
  generateId?(): Promise<string>
}

/**
 * In-memory storage implementation (for testing/development)
 */
export class InMemoryTrajectoryStorage implements TrajectoryStorage {
  public trajectories: TrajectoryRecord[] = []
  public llmCallLogs: LLMCallLogRecord[] = []

  async saveTrajectory(record: TrajectoryRecord): Promise<void> {
    this.trajectories.push(record)
  }

  async saveLLMCallLogs(logs: LLMCallLogRecord[]): Promise<void> {
    this.llmCallLogs.push(...logs)
  }

  async generateId(): Promise<string> {
    return generateSnowflakeId()
  }

  /**
   * Clear all stored data (useful for tests)
   */
  clear(): void {
    this.trajectories = []
    this.llmCallLogs = []
  }
}

/**
 * Records agent trajectories for RL training.
 */
export class TrajectoryRecorder {
  private activeTrajectories: Map<string, ActiveTrajectory> = new Map()
  private storage: TrajectoryStorage

  constructor(storage?: TrajectoryStorage) {
    this.storage = storage ?? new InMemoryTrajectoryStorage()
  }

  /**
   * Set the storage backend
   */
  setStorage(storage: TrajectoryStorage): void {
    this.storage = storage
  }

  /**
   * Start recording a new trajectory.
   * @param options - Configuration for the trajectory
   * @returns The unique trajectory ID
   */
  async startTrajectory(options: StartTrajectoryOptions): Promise<string> {
    const trajectoryId = this.storage.generateId
      ? await this.storage.generateId()
      : await generateSnowflakeId()
    const windowId = options.windowId ?? getCurrentWindowId()

    this.activeTrajectories.set(trajectoryId, {
      trajectoryId,
      agentId: options.agentId,
      archetype: options.archetype,
      scenarioId: options.scenarioId ?? windowId,
      startTime: Date.now(),
      steps: [],
    })

    logger.info('Started trajectory recording', {
      trajectoryId,
      agentId: options.agentId,
      archetype: options.archetype ?? 'none',
      scenarioId: options.scenarioId ?? windowId,
      windowId,
    })

    return trajectoryId
  }

  /**
   * Start a new step in the trajectory.
   * @param trajectoryId - The trajectory ID
   * @param environmentState - Current environment state
   * @throws Error if trajectory not found
   */
  startStep(trajectoryId: string, environmentState: EnvironmentState): void {
    const traj = this.activeTrajectories.get(trajectoryId)
    if (!traj) {
      throw new Error(`Trajectory not found: ${trajectoryId}`)
    }

    traj.currentStep = {
      stepNumber: traj.steps.length,
      timestamp: Date.now(),
      environmentState,
      providerAccesses: [],
      llmCalls: [],
      reward: 0,
    }
  }

  /**
   * Log a provider access in the current step.
   * @param trajectoryId - The trajectory ID
   * @param access - Provider access details
   * @throws Error if no current step exists
   */
  logProviderAccess(
    trajectoryId: string,
    access: {
      providerName: string
      data: Record<string, JsonValue>
      purpose: string
    },
  ): void {
    const traj = this.activeTrajectories.get(trajectoryId)
    if (!traj?.currentStep) {
      throw new Error(`No current step for trajectory: ${trajectoryId}`)
    }

    traj.currentStep.providerAccesses = traj.currentStep.providerAccesses ?? []
    // Create full ProviderAccess with required fields
    traj.currentStep.providerAccesses.push({
      providerId: `${trajectoryId}-provider-${Date.now()}`,
      providerName: access.providerName,
      timestamp: Date.now(),
      query: access.data,
      data: access.data,
      purpose: access.purpose,
    })
  }

  /**
   * Log an LLM call in the current step.
   * @param trajectoryId - The trajectory ID
   * @param llmCall - LLM call details
   * @throws Error if no current step exists
   */
  logLLMCall(trajectoryId: string, llmCall: LLMCall): void {
    const traj = this.activeTrajectories.get(trajectoryId)
    if (!traj?.currentStep) {
      throw new Error(`No current step for trajectory: ${trajectoryId}`)
    }

    traj.currentStep.llmCalls = traj.currentStep.llmCalls ?? []
    traj.currentStep.llmCalls.push(llmCall)
  }

  /**
   * Complete the current step with an action.
   * @param trajectoryId - The trajectory ID
   * @param action - The action taken
   * @param reward - Immediate reward for the step
   * @throws Error if no current step exists
   */
  completeStep(trajectoryId: string, action: Action, reward = 0): void {
    const traj = this.activeTrajectories.get(trajectoryId)
    if (!traj?.currentStep) {
      throw new Error(`No current step for trajectory: ${trajectoryId}`)
    }

    const { stepNumber, timestamp, environmentState } = traj.currentStep
    if (stepNumber === undefined || timestamp === undefined) {
      throw new Error(`Incomplete step for trajectory: ${trajectoryId}`)
    }

    const completeStep: TrajectoryStep = {
      stepNumber,
      timestamp,
      environmentState,
      providerAccesses: traj.currentStep.providerAccesses ?? [],
      llmCalls: traj.currentStep.llmCalls ?? [],
      action,
      reward,
    }

    traj.steps.push(completeStep)
    traj.currentStep = undefined
  }

  /**
   * End trajectory and save to storage.
   * @param trajectoryId - The trajectory ID
   * @param options - End options including final metrics
   * @throws Error if trajectory not found
   */
  async endTrajectory(
    trajectoryId: string,
    options: EndTrajectoryOptions = {},
  ): Promise<void> {
    const traj = this.activeTrajectories.get(trajectoryId)
    if (!traj) {
      throw new Error(`Trajectory not found: ${trajectoryId}`)
    }

    const endTime = Date.now()
    const durationMs = endTime - traj.startTime
    const totalReward = traj.steps.reduce(
      (sum, step) => sum + (step.reward ?? 0),
      0,
    )
    const windowId = options.windowId ?? getCurrentWindowId()

    // Calculate metrics
    const tradesExecuted = traj.steps.filter(
      (s) =>
        s.action &&
        (s.action.actionType.includes('BUY') ||
          s.action.actionType.includes('SELL')),
    ).length

    const postsCreated = traj.steps.filter((s) =>
      s.action?.actionType.includes('POST'),
    ).length

    const errorCount = traj.steps.filter(
      (s) => s.action && !s.action.success,
    ).length
    const finalStatus = errorCount > 0 ? 'completed_with_errors' : 'completed'

    // Generate IDs
    const recordId = this.storage.generateId
      ? await this.storage.generateId()
      : await generateSnowflakeId()

    // Build trajectory record
    const trajectoryRecord: TrajectoryRecord = {
      id: recordId,
      trajectoryId,
      agentId: traj.agentId,
      archetype: traj.archetype ?? null,
      startTime: new Date(traj.startTime),
      endTime: new Date(endTime),
      durationMs,
      windowId,
      windowHours: 1,
      scenarioId: traj.scenarioId ?? windowId,
      episodeId: traj.scenarioId ? `${traj.scenarioId}-${Date.now()}` : null,
      steps: traj.steps,
      rewardComponents: {
        environmentReward: totalReward,
      },
      metrics: {
        episodeLength: traj.steps.length,
        finalStatus,
        finalBalance: options.finalBalance,
        finalPnL: options.finalPnL,
        tradesExecuted,
        postsCreated,
        errorCount,
      },
      metadata: {
        isTrainingData: true,
        gameKnowledge: options.gameKnowledge ?? {},
      },
      totalReward,
    }

    // Save trajectory
    await this.storage.saveTrajectory(trajectoryRecord)

    // Build and save LLM call logs
    const llmLogRecords: LLMCallLogRecord[] = []

    for (const step of traj.steps) {
      const llmCalls = step.llmCalls ?? []
      for (let i = 0; i < llmCalls.length; i++) {
        const llmCall = llmCalls[i]
        if (!llmCall) continue

        const logId = this.storage.generateId
          ? await this.storage.generateId()
          : await generateSnowflakeId()

        llmLogRecords.push({
          id: logId,
          trajectoryId,
          stepId: `${trajectoryId}-step-${step.stepNumber}`,
          callId: `${trajectoryId}-call-${step.stepNumber}-${i}`,
          timestamp: new Date(step.timestamp),
          latencyMs: llmCall.latencyMs ?? null,
          model: llmCall.model,
          purpose: llmCall.purpose,
          actionType: llmCall.actionType ?? null,
          systemPrompt: llmCall.systemPrompt,
          userPrompt: llmCall.userPrompt,
          messages: [
            { role: 'system', content: llmCall.systemPrompt },
            { role: 'user', content: llmCall.userPrompt },
          ],
          response: llmCall.response,
          reasoning: llmCall.reasoning ?? null,
          temperature: llmCall.temperature,
          maxTokens: llmCall.maxTokens,
          metadata: { modelVersion: llmCall.modelVersion },
        })
      }
    }

    if (llmLogRecords.length > 0) {
      await this.storage.saveLLMCallLogs(llmLogRecords)
    }

    this.activeTrajectories.delete(trajectoryId)

    logger.info('Trajectory saved to storage', {
      trajectoryId,
      archetype: traj.archetype ?? 'none',
      steps: traj.steps.length,
      reward: totalReward,
      duration: durationMs,
    })
  }

  /**
   * Get an active trajectory by ID.
   * @param trajectoryId - The trajectory ID
   * @returns The active trajectory or undefined
   */
  getActiveTrajectory(trajectoryId: string): ActiveTrajectory | undefined {
    return this.activeTrajectories.get(trajectoryId)
  }

  /**
   * Check if a trajectory is active.
   * @param trajectoryId - The trajectory ID
   * @returns True if trajectory is active
   */
  isActive(trajectoryId: string): boolean {
    return this.activeTrajectories.has(trajectoryId)
  }

  /**
   * Get count of active trajectories.
   * @returns Number of active trajectories
   */
  getActiveCount(): number {
    return this.activeTrajectories.size
  }

  /**
   * Cancel an active trajectory without saving
   * @param trajectoryId - The trajectory ID
   */
  cancelTrajectory(trajectoryId: string): void {
    this.activeTrajectories.delete(trajectoryId)
    logger.info('Trajectory cancelled', { trajectoryId })
  }

  /**
   * Get all active trajectory IDs
   */
  getActiveTrajectoryIds(): string[] {
    return Array.from(this.activeTrajectories.keys())
  }
}

/** Default in-memory storage instance */
export const defaultStorage = new InMemoryTrajectoryStorage()

/** Singleton instance with default in-memory storage */
export const trajectoryRecorder = new TrajectoryRecorder(defaultStorage)
