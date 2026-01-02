/**
 * Autonomous Planning Coordinator
 *
 * Orchestrates multi-action planning and execution for autonomous agents.
 * Considers goals, constraints, and opportunities to generate comprehensive action plans.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import type { JsonValue } from '@jejunetwork/types'
import type {
  AgentConstraints,
  AgentDirective,
  AgentGoal,
} from '../types/goals'
import { autonomousCommentingService } from './commenting.service'
import { autonomousDMService } from './dm.service'
import { autonomousPostingService } from './posting.service'
import { autonomousTradingService } from './trading.service'

/**
 * Planned action definition
 */
export interface PlanStep {
  type: 'trade' | 'post' | 'comment' | 'message' | 'respond'
  priority: number
  reasoning: string
  goalId?: string
  estimatedImpact: number
  params: Record<string, JsonValue>
  constraints?: string[]
}

/**
 * Complete action plan
 */
export interface AgentPlan {
  actions: PlanStep[]
  totalActions: number
  reasoning: string
  goalsAddressed: string[]
  estimatedCost: number
}

/**
 * Planning context
 */
interface PlanningContext {
  goals: {
    active: AgentGoal[]
    completed: AgentGoal[]
  }
  directives: {
    always: AgentDirective[]
    never: AgentDirective[]
    prefer: AgentDirective[]
    avoid: AgentDirective[]
  }
  constraints: AgentConstraints | null
  portfolio: {
    balance: number
    pnl: number
    positions: number
  }
  pending: Array<{
    type: string
    content: string
    author: string
  }>
  recentActions: Array<{
    type: string
    timestamp: Date
    success: boolean
  }>
  lastActivity: number | null
}

/**
 * Execution result
 */
interface ExecutionResult {
  planned: number
  executed: number
  successful: number
  failed: number
  results: Array<{
    action: PlanStep
    success: boolean
    result?: JsonValue
    error?: string
  }>
  goalsUpdated: string[]
}

/**
 * Agent planning configuration
 */
interface PlanningAgentConfig {
  agentId: string
  displayName: string
  systemPrompt?: string
  maxActionsPerTick: number
  riskTolerance: 'low' | 'medium' | 'high'
  autonomousTrading: boolean
  autonomousPosting: boolean
  autonomousCommenting: boolean
  autonomousDMs: boolean
  schedule: {
    activePeriods: Array<{ start: string; end: string }>
    maxDailyActions: number
  }
}

/**
 * Autonomous Planning Coordinator
 */
export class AutonomousPlanningCoordinator {
  /**
   * Get agent configuration for planning
   */
  private async getAgentConfig(agentId: string): Promise<PlanningAgentConfig> {
    logger.debug(`Getting planning config for agent ${agentId}`)

    // In a full implementation, this would fetch from database
    return {
      agentId,
      displayName: `Agent-${agentId.slice(0, 8)}`,
      systemPrompt: 'You are an AI agent on Jeju Network.',
      maxActionsPerTick: 3,
      riskTolerance: 'medium',
      autonomousTrading: true,
      autonomousPosting: true,
      autonomousCommenting: true,
      autonomousDMs: true,
      schedule: {
        activePeriods: [{ start: '09:00', end: '17:00' }],
        maxDailyActions: 100,
      },
    }
  }

  /**
   * Get planning context for agent
   */
  private async getPlanningContext(agentId: string): Promise<PlanningContext> {
    logger.debug(`Getting planning context for agent ${agentId}`)

    // In a full implementation, this would:
    // 1. Fetch active goals from database
    // 2. Get agent directives and constraints
    // 3. Get portfolio information
    // 4. Get pending interactions
    // 5. Get recent action history

    return {
      goals: {
        active: [],
        completed: [],
      },
      directives: {
        always: [],
        never: [],
        prefer: [],
        avoid: [],
      },
      constraints: null,
      portfolio: {
        balance: 1000,
        pnl: 0,
        positions: 0,
      },
      pending: [],
      recentActions: [],
      lastActivity: null,
    }
  }

  /**
   * Generate simple plan for agents without goals
   */
  private generateSimplePlan(
    config: PlanningAgentConfig,
    context: PlanningContext,
  ): AgentPlan {
    const actions: PlanStep[] = []

    // Respond to pending interactions first
    if (context.pending.length > 0 && config.autonomousCommenting) {
      actions.push({
        type: 'respond',
        priority: 9,
        reasoning: 'Respond to pending interactions',
        estimatedImpact: 0.3,
        params: {},
      })
    }

    // Trading
    if (config.autonomousTrading) {
      actions.push({
        type: 'trade',
        priority: 7,
        reasoning: 'Evaluate trading opportunities',
        estimatedImpact: 0.5,
        params: {},
      })
    }

    // Posting
    if (config.autonomousPosting) {
      actions.push({
        type: 'post',
        priority: 5,
        reasoning: 'Create social content',
        estimatedImpact: 0.2,
        params: {},
      })
    }

    return {
      actions: actions.slice(0, config.maxActionsPerTick),
      totalActions: actions.length,
      reasoning: 'Simple mode: executing enabled capabilities',
      goalsAddressed: [],
      estimatedCost: actions.length,
    }
  }

  /**
   * Generate a comprehensive action plan
   */
  async generateActionPlan(
    agentId: string,
    runtime?: IAgentRuntime,
  ): Promise<AgentPlan> {
    logger.info(`Generating action plan for agent ${agentId}`)

    const config = await this.getAgentConfig(agentId)
    const context = await this.getPlanningContext(agentId)

    // If no goals configured, use simple planning
    if (context.goals.active.length === 0) {
      logger.info('No goals configured, using simple planning')
      return this.generateSimplePlan(config, context)
    }

    // If no runtime, fall back to simple planning
    if (!runtime) {
      logger.warn('No runtime provided, using simple planning')
      return this.generateSimplePlan(config, context)
    }

    // Use LLM to generate intelligent plan
    try {
      const prompt = this.buildPlanningPrompt(config, context)

      const result = await runtime.generateText(prompt, {
        modelType: 'TEXT_SMALL',
      })

      // Parse LLM response into plan
      const plan = this.parseLLMPlan(result.text, config, context)
      if (plan) {
        logger.info(`LLM generated plan with ${plan.totalActions} actions`)
        return plan
      }

      // Fall back to simple planning if parse fails
      logger.warn('Failed to parse LLM plan, using simple planning')
      return this.generateSimplePlan(config, context)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`LLM planning failed: ${errorMsg}, using simple planning`)
      return this.generateSimplePlan(config, context)
    }
  }

  /**
   * Build prompt for LLM planning
   */
  private buildPlanningPrompt(
    config: PlanningAgentConfig,
    context: PlanningContext,
  ): string {
    const goalsText = context.goals.active
      .map((g) => `- ${g.description} (priority: ${g.priority})`)
      .join('\n')

    const recentActivityText =
      context.recentActions.length > 0
        ? context.recentActions
            .slice(0, 5)
            .map(
              (a) =>
                `${a.type} at ${a.timestamp.toISOString()} (${a.success ? 'success' : 'failed'})`,
            )
            .join('\n')
        : 'none'

    return `You are an AI agent planning your next actions.

Goals:
${goalsText}

Current state:
- Max actions per tick: ${config.maxActionsPerTick}
- Risk tolerance: ${config.riskTolerance}
- Recent activity:
${recentActivityText}

Generate a plan with 1-${config.maxActionsPerTick} actions. Each action should have:
- type: 'trade' | 'post' | 'comment' | 'respond' | 'message'
- priority: 1-10 (10 = highest)
- description: what the action does
- estimatedDuration: minutes

Respond with JSON: { "actions": [...] }`
  }

  /**
   * Parse LLM response into AgentPlan
   */
  private parseLLMPlan(
    llmResponse: string,
    _config: PlanningAgentConfig,
    context: PlanningContext,
  ): AgentPlan | null {
    try {
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0]) as {
        actions?: Array<{
          type: string
          priority?: number
          description?: string
          estimatedDuration?: number
        }>
      }

      if (!parsed.actions || !Array.isArray(parsed.actions)) return null

      const validTypes = ['trade', 'post', 'comment', 'respond', 'message']
      const actions: PlanStep[] = parsed.actions
        .filter((a) => validTypes.includes(a.type))
        .map((a) => ({
          type: a.type as PlanStep['type'],
          priority: Math.min(10, Math.max(1, a.priority ?? 5)),
          reasoning: a.description ?? `Execute ${a.type} action`,
          estimatedImpact: (a.estimatedDuration ?? 5) / 60,
          params: {},
          goalId: context.goals.active[0]?.id,
        }))

      if (actions.length === 0) return null

      return {
        actions,
        totalActions: actions.length,
        reasoning: 'LLM-generated plan based on active goals',
        goalsAddressed: context.goals.active.map((g) => g.id),
        estimatedCost: actions.length,
      }
    } catch {
      return null
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    agentId: string,
    action: PlanStep,
    runtime?: IAgentRuntime,
  ): Promise<{ success: boolean; data?: JsonValue; error?: string }> {
    logger.info(`Executing ${action.type} action`, {
      agentId,
      priority: action.priority,
    })

    switch (action.type) {
      case 'trade': {
        const tradeResult = await autonomousTradingService.executeTrades(
          agentId,
          runtime,
        )
        return {
          success: tradeResult.tradesExecuted > 0,
          data: { trades: tradeResult.tradesExecuted },
        }
      }

      case 'post': {
        const postId = await autonomousPostingService.createAgentPost(
          agentId,
          runtime,
        )
        return { success: !!postId, data: { postId } }
      }

      case 'comment':
      case 'respond': {
        const commentId = await autonomousCommentingService.createAgentComment(
          agentId,
          runtime,
        )
        return { success: !!commentId, data: { commentId } }
      }

      case 'message': {
        const dmResponses = await autonomousDMService.respondToDMs(
          agentId,
          runtime,
        )
        return { success: dmResponses > 0, data: { responses: dmResponses } }
      }

      default:
        return { success: false, error: `Unknown action type: ${action.type}` }
    }
  }

  /**
   * Execute an action plan
   */
  async executePlan(
    agentId: string,
    plan: AgentPlan,
    runtime?: IAgentRuntime,
  ): Promise<ExecutionResult> {
    const results: ExecutionResult['results'] = []
    const goalsUpdated: Set<string> = new Set()

    logger.info(`Executing plan with ${plan.totalActions} actions`, { agentId })

    // Sort by priority
    const sortedActions = [...plan.actions].sort(
      (a, b) => b.priority - a.priority,
    )

    for (const action of sortedActions) {
      const result = await this.executeAction(agentId, action, runtime)
      results.push({
        action,
        success: result.success,
        result: result.data,
        error: result.error,
      })

      // Track goal progress
      if (action.goalId && result.success) {
        goalsUpdated.add(action.goalId)
      }

      // Small delay between actions
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    logger.info('Plan execution complete', {
      agentId,
      planned: plan.totalActions,
      executed: results.length,
      successful,
      failed,
    })

    return {
      planned: plan.totalActions,
      executed: results.length,
      successful,
      failed,
      results,
      goalsUpdated: Array.from(goalsUpdated),
    }
  }
}

/** Singleton instance */
export const autonomousPlanningCoordinator = new AutonomousPlanningCoordinator()
