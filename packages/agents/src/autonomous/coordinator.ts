/**
 * Autonomous Coordinator
 *
 * Central orchestrator for all autonomous agent behaviors.
 * Manages the tick loop and coordinates between different autonomous services.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import { autonomousCommentingService } from './commenting.service'
import { autonomousDMService } from './dm.service'
import { autonomousGroupChatService } from './group-chat.service'
import { autonomousPostingService } from './posting.service'
import { autonomousTradingService } from './trading.service'

/**
 * Coordinator configuration
 */
export interface CoordinatorConfig {
  /** Enable trading behavior */
  autonomousTrading?: boolean
  /** Enable posting behavior */
  autonomousPosting?: boolean
  /** Enable commenting behavior */
  autonomousCommenting?: boolean
  /** Enable DM responses */
  autonomousDMs?: boolean
  /** Enable group chat participation */
  autonomousGroupChats?: boolean
  /** Planning horizon: single action or multi-action */
  planningHorizon?: 'single' | 'multi'
  /** Max actions per tick */
  maxActionsPerTick?: number
  /** Enable trajectory recording */
  recordTrajectories?: boolean
}

/**
 * Result of an autonomous tick
 */
export interface TickResult {
  success: boolean
  actionsExecuted: {
    trades: number
    posts: number
    comments: number
    messages: number
    groupMessages: number
    engagements: number
  }
  method: 'a2a' | 'database' | 'planning_coordinator' | 'multi_step'
  duration: number
  trajectoryId?: string
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CoordinatorConfig = {
  autonomousTrading: true,
  autonomousPosting: true,
  autonomousCommenting: true,
  autonomousDMs: true,
  autonomousGroupChats: true,
  planningHorizon: 'single',
  maxActionsPerTick: 3,
  recordTrajectories: false,
}

/**
 * Autonomous Coordinator
 *
 * Orchestrates autonomous agent behaviors in a coordinated manner.
 */
export class AutonomousCoordinator {
  private config: CoordinatorConfig
  private running: boolean = false
  private currentAgent: { id: string; runtime?: IAgentRuntime } | null = null
  private tickInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: CoordinatorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start autonomous coordination for an agent
   */
  async start(agent: { id: string; runtime?: IAgentRuntime }): Promise<void> {
    if (this.running) {
      throw new Error(
        `Coordinator already running for agent ${this.currentAgent?.id}`,
      )
    }

    this.currentAgent = agent
    this.running = true

    logger.info(`Starting autonomous coordinator for agent ${agent.id}`)

    // Run initial tick
    await this.executeAutonomousTick(agent.id, agent.runtime)

    // Set up periodic ticks (every 60 seconds)
    this.tickInterval = setInterval(async () => {
      if (this.running && this.currentAgent) {
        await this.executeAutonomousTick(
          this.currentAgent.id,
          this.currentAgent.runtime,
        )
      }
    }, 60000)
  }

  /**
   * Stop autonomous coordination
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return
    }

    logger.info(
      `Stopping autonomous coordinator for agent ${this.currentAgent?.id}`,
    )

    this.running = false

    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }

    this.currentAgent = null
  }

  /**
   * Check if coordinator is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Execute complete autonomous tick for an agent
   */
  async executeAutonomousTick(
    agentId: string,
    runtime?: IAgentRuntime,
    config?: CoordinatorConfig,
  ): Promise<TickResult> {
    const startTime = Date.now()
    const effectiveConfig = config ? { ...this.config, ...config } : this.config

    const result: TickResult = {
      success: false,
      actionsExecuted: {
        trades: 0,
        posts: 0,
        comments: 0,
        messages: 0,
        groupMessages: 0,
        engagements: 0,
      },
      method: 'database',
      duration: 0,
    }

    logger.info(`Starting autonomous tick for agent ${agentId}`, {
      autonomousTrading: effectiveConfig.autonomousTrading ?? false,
      autonomousPosting: effectiveConfig.autonomousPosting ?? false,
      autonomousCommenting: effectiveConfig.autonomousCommenting ?? false,
      planningHorizon: effectiveConfig.planningHorizon ?? 'single',
    })

    // Execute trading if enabled
    if (effectiveConfig.autonomousTrading) {
      const tradingResult = await autonomousTradingService.executeTrades(
        agentId,
        runtime,
      )
      result.actionsExecuted.trades = tradingResult.tradesExecuted

      if (tradingResult.tradesExecuted > 0) {
        logger.info(
          `Agent ${agentId} executed ${tradingResult.tradesExecuted} trade(s)`,
        )
      }
    }

    // Execute posting if enabled
    if (effectiveConfig.autonomousPosting) {
      const postId = await autonomousPostingService.createAgentPost(
        agentId,
        runtime,
      )
      if (postId) {
        result.actionsExecuted.posts = 1
        logger.info(`Agent ${agentId} created post ${postId}`)
      }
    }

    // Execute commenting if enabled
    if (effectiveConfig.autonomousCommenting) {
      const commentId = await autonomousCommentingService.createAgentComment(
        agentId,
        runtime,
      )
      if (commentId) {
        result.actionsExecuted.comments = 1
        logger.info(`Agent ${agentId} created comment ${commentId}`)
      }
    }

    // Execute DM responses if enabled
    if (effectiveConfig.autonomousDMs) {
      const dmResponses = await autonomousDMService.respondToDMs(
        agentId,
        runtime,
      )
      result.actionsExecuted.messages = dmResponses

      if (dmResponses > 0) {
        logger.info(`Agent ${agentId} sent ${dmResponses} DM response(s)`)
      }
    }

    // Execute group chat participation if enabled
    if (effectiveConfig.autonomousGroupChats) {
      const groupMessages =
        await autonomousGroupChatService.participateInGroupChats(
          agentId,
          runtime,
        )
      result.actionsExecuted.groupMessages = groupMessages

      if (groupMessages > 0) {
        logger.info(`Agent ${agentId} sent ${groupMessages} group message(s)`)
      }
    }

    result.duration = Date.now() - startTime
    result.success = Object.values(result.actionsExecuted).some(
      (count) => count > 0,
    )
    result.method =
      effectiveConfig.planningHorizon === 'multi'
        ? 'planning_coordinator'
        : 'database'

    logger.info(`Autonomous tick completed for agent ${agentId}`, {
      duration: result.duration,
      actions: result.actionsExecuted,
      method: result.method,
    })

    return result
  }

  /**
   * Execute autonomous tick for multiple agents
   */
  async executeTickForAllAgents(
    agentIds: string[],
    runtime?: IAgentRuntime,
    config?: CoordinatorConfig,
  ): Promise<{
    agentsProcessed: number
    totalActions: number
    errors: number
    results: Array<{ agentId: string; result: TickResult }>
  }> {
    logger.info(`Processing ${agentIds.length} agents`)

    const results: Array<{ agentId: string; result: TickResult }> = []
    let totalActions = 0
    let errors = 0

    for (const agentId of agentIds) {
      try {
        const tickResult = await this.executeAutonomousTick(
          agentId,
          runtime,
          config,
        )
        results.push({ agentId, result: tickResult })

        if (tickResult.success) {
          const actionCount = Object.values(tickResult.actionsExecuted).reduce(
            (sum, count) => sum + count,
            0,
          )
          totalActions += actionCount
        }

        // Small delay between agents to avoid overwhelming system
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (error) {
        errors++
        logger.error(`Error processing agent ${agentId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      agentsProcessed: agentIds.length,
      totalActions,
      errors,
      results,
    }
  }

  /**
   * Update coordinator configuration
   */
  setConfig(config: Partial<CoordinatorConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): CoordinatorConfig {
    return { ...this.config }
  }
}

/**
 * Create a new autonomous coordinator
 */
export function createAutonomousCoordinator(
  config?: CoordinatorConfig,
): AutonomousCoordinator {
  return new AutonomousCoordinator(config)
}

/** Default singleton instance */
const defaultCoordinator = new AutonomousCoordinator()

export { defaultCoordinator as autonomousCoordinator }
