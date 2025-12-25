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
  displayName: string
  systemPrompt?: string
  maxActionsPerTick: number
  riskTolerance: 'low' | 'medium' | 'high'
  autonomousTrading: boolean
  autonomousPosting: boolean
  autonomousCommenting: boolean
  autonomousDMs: boolean
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
      displayName: `Agent-${agentId.slice(0, 8)}`,
      systemPrompt: 'You are an AI agent on Jeju Network.',
      maxActionsPerTick: 3,
      riskTolerance: 'medium',
      autonomousTrading: true,
      autonomousPosting: true,
      autonomousCommenting: true,
      autonomousDMs: true,
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
    }
  }

  /**
<<<<<<< HEAD
=======
   * Build planning prompt
   */
  private buildPlanningPrompt(
    config: PlanningAgentConfig,
    context: PlanningContext,
  ): string {
    const goalsText =
      context.goals.active.length > 0
        ? context.goals.active
            .map((g, i) => {
              const targetInfo = g.target
                ? `Target: ${g.target.metric} = ${g.target.value}${g.target.unit ?? ''}`
                : ''
              return `${i + 1}. ${g.name} (Priority: ${g.priority}/10) - ${(g.progress * 100).toFixed(0)}% complete
   ${g.description}
   ${targetInfo}`
            })
            .join('\n\n')
        : 'No goals configured'

    const directivesText =
      [
        ...context.directives.always.map((d) => `✓ ALWAYS: ${d.rule}`),
        ...context.directives.never.map((d) => `✗ NEVER: ${d.rule}`),
        ...context.directives.prefer.map((d) => `+ PREFER: ${d.rule}`),
      ].join('\n') ?? 'No directives'

    const constraintsText = context.constraints
      ? `- Max actions this tick: ${context.constraints.general.maxActionsPerTick}
- Max position: $${context.constraints.trading.maxPositionSize}
- Max leverage: ${context.constraints.trading.maxLeverage}x
- Risk tolerance: ${context.constraints.general.riskTolerance}`
      : 'No specific constraints'

    const pendingText =
      context.pending.length > 0
        ? context.pending
            .slice(0, 5)
            .map(
              (p) =>
                `- ${p.type}: "${p.content.substring(0, 60)}..." by ${p.author}`,
            )
            .join('\n')
        : 'None'

    return `${config.systemPrompt}

You are ${config.displayName}, planning your actions for this autonomous tick.

=== YOUR GOALS (in priority order) ===
${goalsText}

=== YOUR DIRECTIVES (rules you must follow) ===
${directivesText}

=== YOUR CONSTRAINTS ===
${constraintsText}

=== CURRENT SITUATION ===
Portfolio:
- Balance: $${context.portfolio.balance.toFixed(2)}
- Lifetime P&L: ${context.portfolio.pnl >= 0 ? '+' : ''}$${context.portfolio.pnl.toFixed(2)}
- Open positions: ${context.portfolio.positions}

Capabilities enabled:
${config.autonomousTrading ? '✓ Trading' : '✗ Trading'}
${config.autonomousPosting ? '✓ Posting' : '✗ Posting'}
${config.autonomousCommenting ? '✓ Commenting' : '✗ Commenting'}
${config.autonomousDMs ? '✓ Direct messages' : '✗ Direct messages'}

Pending interactions (${context.pending.length}):
${pendingText}

Recent actions (last 10):
${
  context.recentActions
    .slice(0, 10)
    .map((a) => `- ${a.type}: ${a.success ? 'success' : 'failed'}`)
    .join('\n') ?? 'None'
}

=== YOUR TASK ===
Plan ${config.maxActionsPerTick} or fewer actions for this tick to make maximum progress toward your goals.

Respond in JSON format:
{
  "reasoning": "Overall strategy for this tick and how it serves your goals",
  "actions": [
    {
      "type": "trade" | "post" | "comment" | "respond",
      "priority": 1-10,
      "goalId": "goal_id or null if general",
      "reasoning": "How this advances your goals",
      "estimatedImpact": 0.0-1.0,
      "params": {}
    }
  ]
}

Your action plan (JSON only):`
  }

  /**
>>>>>>> 9ead75abad3a811d2d0d16aa55c89314f789455e
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

    // In a full implementation, this would call the LLM
    // For now, use simple planning
    logger.info('LLM planning not implemented, using simple planning')
    return this.generateSimplePlan(config, context)
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
