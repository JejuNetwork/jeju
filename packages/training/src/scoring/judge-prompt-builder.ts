/**
 * JudgePromptBuilder
 *
 * Builds LLM judge prompts with trajectory metrics context and archetype-specific rubrics.
 * Metrics are included as CONTEXT for the judge, not weighted directly.
 *
 * @packageDocumentation
 */

import type { BehavioralMetrics } from '../metrics/types'
import { getMetricsSummary } from '../metrics/types'
import {
  getArchetypePriorityMetrics,
  getArchetypeRubric,
} from '../rubrics/archetypes'
import type {
  JudgePromptOptions,
  TrajectoryContext,
  TrajectoryStepForJudge,
} from './types'

const DEFAULT_OPTIONS: JudgePromptOptions = {
  includeActionDetails: false,
  maxActionsToShow: 20,
  includeKeyDecisions: true,
}

/**
 * Builds prompts for LLM-as-judge scoring.
 */
export class JudgePromptBuilder {
  /**
   * Build prompt for single trajectory scoring.
   */
  buildSinglePrompt(
    trajectory: TrajectoryContext,
    options: JudgePromptOptions = {},
  ): { system: string; user: string } {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const archetype = trajectory.archetype ?? 'default'
    const rubric = getArchetypeRubric(archetype)
    const priorityMetrics = getArchetypePriorityMetrics(archetype)

    const system = this.buildSystemPrompt(archetype, rubric)
    const user = this.buildUserPrompt(trajectory, priorityMetrics, opts)

    return { system, user }
  }

  /**
   * Build a judge prompt for comparing multiple trajectories (RULER style)
   */
  buildComparisonPrompt(
    trajectories: TrajectoryContext[],
    scenarioId: string,
    options: JudgePromptOptions = {},
  ): { system: string; user: string } {
    const opts = { ...DEFAULT_OPTIONS, ...options }

    if (trajectories.length === 0) {
      throw new Error('At least one trajectory is required')
    }
    const archetype = trajectories[0]?.archetype ?? 'default'
    const rubric = getArchetypeRubric(archetype)
    const priorityMetrics = getArchetypePriorityMetrics(archetype)

    const system = this.buildComparisonSystemPrompt(archetype, rubric)
    const user = this.buildComparisonUserPrompt(
      trajectories,
      scenarioId,
      priorityMetrics,
      opts,
    )

    return { system, user }
  }

  /**
   * Build system prompt for single trajectory evaluation
   */
  private buildSystemPrompt(archetype: string, rubric: string): string {
    return `You are an expert evaluator of AI agent performance in prediction market simulations.

You are evaluating an agent with the "${archetype}" archetype. This archetype has specific goals and behaviors that should be evaluated differently than a generic agent.

${rubric}

Your task is to score this trajectory on a scale of 0.0 to 1.0 based on how well the agent embodied the "${archetype}" archetype's values and achieved its goals.

IMPORTANT: The metrics provided are CONTEXT to inform your judgment. Use them to understand what happened, but make a holistic evaluation based on the rubric - don't just calculate a weighted average of metrics.`
  }

  /**
   * Build system prompt for RULER comparison
   */
  private buildComparisonSystemPrompt(
    archetype: string,
    rubric: string,
  ): string {
    return `You are an expert evaluator of AI agent performance. All trajectories below were given the same scenario and are from "${archetype}" archetype agents.

Your job is to compare them RELATIVE to each other and assign scores from 0 to 1 based on how well each trajectory achieved the archetype's goals.

${rubric}

IMPORTANT RULER PRINCIPLES:
- A trajectory that achieves its archetype's goals should score significantly higher than one that doesn't
- A trajectory that achieves goals more efficiently should score higher
- If one trajectory is only slightly better, score differences should be small
- If one is significantly better, score differences should be large
- You may give partial credit for progress towards goals

The metrics provided are CONTEXT to inform your judgment. Use them to understand what happened, then make holistic evaluations based on the archetype rubric.`
  }

  /**
   * Build user prompt with trajectory context and metrics
   */
  private buildUserPrompt(
    trajectory: TrajectoryContext,
    _priorityMetrics: string[],
    options: JudgePromptOptions,
  ): string {
    const parts: string[] = []

    // Agent info
    parts.push(`## Agent Information`)
    parts.push(`- Agent ID: ${trajectory.agentId}`)
    parts.push(`- Archetype: ${trajectory.archetype ?? 'unknown'}`)
    parts.push(
      `- Episode Length: ${trajectory.episodeLength ?? trajectory.steps.length} ticks`,
    )
    parts.push('')

    // Metrics section
    parts.push(`## Behavioral Metrics`)
    parts.push(this.formatMetrics(trajectory.metrics))
    parts.push('')

    // Action summary
    parts.push(`## Action Summary`)
    parts.push(this.summarizeActions(trajectory.steps))
    parts.push('')

    // Key decisions (if requested)
    if (options.includeKeyDecisions) {
      const keyDecisions = this.extractKeyDecisions(trajectory.steps)
      if (keyDecisions) {
        parts.push(`## Key Decisions`)
        parts.push(keyDecisions)
        parts.push('')
      }
    }

    // Recent actions (if requested)
    if (options.includeActionDetails) {
      parts.push(`## Recent Actions (last ${options.maxActionsToShow})`)
      parts.push(
        this.formatRecentActions(
          trajectory.steps,
          options.maxActionsToShow ?? 20,
        ),
      )
      parts.push('')
    }

    // Instructions
    parts.push(`## Instructions`)
    parts.push(
      `Score this trajectory on a scale of 0.0 to 1.0 based on how well it embodies the ${trajectory.archetype ?? 'agent'} archetype's values.`,
    )
    parts.push('')
    parts.push(`Respond with JSON:`)
    parts.push(`{
  "score": <float 0-1>,
  "reasoning": "<2-3 sentence explanation>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"]
}`)

    return parts.join('\n')
  }

  /**
   * Build user prompt for RULER comparison
   */
  private buildComparisonUserPrompt(
    trajectories: TrajectoryContext[],
    scenarioId: string,
    _priorityMetrics: string[],
    _options: JudgePromptOptions,
  ): string {
    const parts: string[] = []

    parts.push(`## Scenario: ${scenarioId}`)
    parts.push(`## Number of Trajectories: ${trajectories.length}`)
    parts.push('')

    parts.push(`## Trajectory Performance Context`)
    parts.push(`(Use this to inform your scoring)`)
    parts.push('')

    for (let i = 0; i < trajectories.length; i++) {
      const traj = trajectories[i]
      if (!traj) continue

      const trajId = `trajectory-${i + 1}`
      parts.push(`### ${trajId}`)
      parts.push(`- Archetype: ${traj.archetype ?? 'unknown'}`)
      parts.push(
        `- Episode Length: ${traj.episodeLength ?? traj.steps.length} steps`,
      )
      parts.push(`- Total Reward: ${traj.totalReward?.toFixed(2) ?? '0.00'}`)
      parts.push('')

      parts.push(`**Key Metrics:**`)
      parts.push(this.formatMetrics(traj.metrics))
      parts.push('')

      parts.push(`**Actions:**`)
      parts.push(this.summarizeActions(traj.steps))
      parts.push('')
    }

    parts.push(`## Instructions`)
    parts.push(
      `Score each trajectory from 0.0 to 1.0 RELATIVE to each other based on the archetype rubric.`,
    )
    parts.push('')
    parts.push(`Respond with ONLY valid JSON:`)
    parts.push(`{
  "scores": [
    {
      "trajectory_id": "trajectory-1",
      "explanation": "Brief explanation",
      "score": 0.85
    },
    {
      "trajectory_id": "trajectory-2",
      "explanation": "Brief explanation",
      "score": 0.65
    }
  ]
}`)

    return parts.join('\n')
  }

  /**
   * Format metrics for prompt
   */
  private formatMetrics(metrics: BehavioralMetrics): string {
    const lines: string[] = []
    const summary = getMetricsSummary(metrics)

    lines.push('### Key Performance')
    lines.push(`- Total P&L: $${summary.totalPnL.toFixed(2)}`)
    lines.push(`- Win Rate: ${(summary.winRate * 100).toFixed(1)}%`)
    lines.push(`- Trades Executed: ${summary.tradesExecuted}`)
    lines.push(
      `- Action Success Rate: ${(summary.actionSuccessRate * 100).toFixed(1)}%`,
    )
    lines.push('')

    lines.push('### Social Activity')
    lines.push(
      `- Unique Users Interacted: ${metrics.social.uniqueUsersInteracted}`,
    )
    lines.push(`- Group Chats Joined: ${metrics.social.groupChatsJoined}`)
    lines.push(`- DMs Initiated: ${metrics.social.dmsInitiated}`)
    lines.push(`- Posts Created: ${metrics.social.postsCreated}`)
    lines.push(`- Comments Made: ${metrics.social.commentsMade}`)
    lines.push(
      `- Social to Trade Ratio: ${metrics.behavior.socialToTradeRatio.toFixed(2)}`,
    )
    lines.push('')

    lines.push('### Trading Performance')
    lines.push(`- Total P&L: $${metrics.trading.totalPnL.toFixed(2)}`)
    lines.push(`- Win Rate: ${(metrics.trading.winRate * 100).toFixed(1)}%`)
    lines.push(`- Sharpe Ratio: ${metrics.trading.sharpeRatio.toFixed(2)}`)
    lines.push(`- Max Drawdown: $${metrics.trading.maxDrawdown.toFixed(2)}`)
    lines.push(`- Markets Traded: ${metrics.trading.marketsTraded}`)
    lines.push(`- Largest Win: $${metrics.trading.largestWin.toFixed(2)}`)
    lines.push(`- Largest Loss: $${metrics.trading.largestLoss.toFixed(2)}`)
    lines.push('')

    lines.push('### Influence')
    lines.push(`- Followers Gained: ${metrics.influence.followersGained}`)
    lines.push(
      `- Reputation Delta: ${metrics.influence.reputationDelta > 0 ? '+' : ''}${metrics.influence.reputationDelta}`,
    )
    lines.push(`- Positive Reactions: ${metrics.influence.positiveReactions}`)
    lines.push(`- Information Spread: ${metrics.influence.informationSpread}`)
    lines.push('')

    lines.push('### Behavior Patterns')
    lines.push(
      `- Actions Per Tick: ${metrics.behavior.actionsPerTick.toFixed(2)}`,
    )
    lines.push(
      `- Consistency Score: ${(metrics.behavior.consistencyScore * 100).toFixed(1)}%`,
    )
    lines.push(
      `- Dominant Action: ${metrics.behavior.dominantActionType ?? 'none'}`,
    )
    lines.push('')

    lines.push('### Information Activity')
    lines.push(`- Research Actions: ${metrics.information.researchActions}`)
    lines.push(`- Predictions Made: ${metrics.information.predictionsMade}`)
    lines.push(
      `- Prediction Accuracy: ${(metrics.information.predictionAccuracy * 100).toFixed(1)}%`,
    )

    return lines.join('\n')
  }

  /**
   * Summarize actions in trajectory
   */
  private summarizeActions(steps: TrajectoryStepForJudge[]): string {
    const actionCounts = new Map<string, number>()
    let successCount = 0
    let errorCount = 0

    for (const step of steps) {
      const action = step.action
      if (!action) continue

      const actionType = action.actionType
      actionCounts.set(actionType, (actionCounts.get(actionType) ?? 0) + 1)

      if (action.success) {
        successCount++
      } else {
        errorCount++
      }
    }

    const sortedActions = Array.from(actionCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    )

    const lines: string[] = []
    lines.push(
      `- Total Actions: ${steps.length} (${successCount} successful, ${errorCount} failed)`,
    )
    lines.push(
      `- Action Types: ${sortedActions.map(([type, count]) => `${type}(${count})`).join(', ')}`,
    )

    return lines.join('\n')
  }

  /**
   * Extract key decisions (trades, significant social actions)
   */
  private extractKeyDecisions(steps: TrajectoryStepForJudge[]): string | null {
    const keyActions: string[] = []
    const keyActionTypes = new Set([
      'trade',
      'buy',
      'sell',
      'predict',
      'create_group_chat',
      'post',
    ])

    for (const step of steps) {
      const action = step.action
      if (!action) continue

      if (keyActionTypes.has(action.actionType.toLowerCase())) {
        const params = action.parameters ?? {}
        const result = action.result ?? {}

        let description = `${action.actionType}`

        if (params.amount || params.size) {
          description += ` (size: ${params.amount ?? params.size})`
        }
        if (params.marketId || params.market) {
          description += ` on ${params.marketId ?? params.market}`
        }
        if (result.pnl !== undefined) {
          const pnl = Number(result.pnl)
          description += ` → P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
        }

        keyActions.push(`- ${description} ${action.success ? '✓' : '✗'}`)
      }
    }

    if (keyActions.length === 0) {
      return null
    }

    return keyActions.slice(-10).join('\n')
  }

  /**
   * Format recent actions for detailed view
   */
  private formatRecentActions(
    steps: TrajectoryStepForJudge[],
    maxActions: number,
  ): string {
    const recentSteps = steps.slice(-maxActions)
    const lines: string[] = []

    for (const step of recentSteps) {
      const action = step.action
      if (!action) continue

      const success = action.success ? '✓' : '✗'
      const reasoning = action.reasoning
        ? ` | Reason: ${action.reasoning.substring(0, 50)}...`
        : ''
      lines.push(
        `- [${step.stepNumber}] ${action.actionType} ${success}${reasoning}`,
      )
    }

    return lines.join('\n') ?? 'No actions recorded'
  }
}

/**
 * Singleton instance
 */
export const judgePromptBuilder = new JudgePromptBuilder()
