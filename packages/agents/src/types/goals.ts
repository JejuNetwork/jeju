/**
 * Agent Goal Types
 *
 * Type definitions for agent goals, directives, and constraints.
 * Used by the AutonomousPlanningCoordinator for goal-based planning.
 */

/**
 * Target specification for a goal
 */
export interface GoalTarget {
  metric: string
  value: number
  unit?: string
}

/**
 * Agent goal for tracking objectives
 */
export interface AgentGoal {
  id: string
  agentUserId: string
  type: string
  name: string
  description: string
  target?: GoalTarget
  priority: number
  status: string
  progress: number
  createdAt: Date
  updatedAt: Date
  completedAt?: Date | null
}

/**
 * Agent directive types
 */
export type DirectiveType = 'always' | 'never' | 'prefer' | 'avoid'

/**
 * Agent directive - rules the agent must follow
 */
export interface AgentDirective {
  type: DirectiveType
  rule: string
  reason?: string
}

/**
 * Trading constraints for the agent
 */
export interface TradingConstraints {
  maxPositionSize: number
  maxLeverage: number
  minBalance?: number
  allowedMarkets?: string[]
  blockedMarkets?: string[]
}

/**
 * Social constraints for the agent
 */
export interface SocialConstraints {
  maxPostsPerHour?: number
  maxCommentsPerHour?: number
  maxDMsPerHour?: number
  allowedTopics?: string[]
  blockedTopics?: string[]
}

/**
 * General constraints for the agent
 */
export interface GeneralConstraints {
  maxActionsPerTick: number
  riskTolerance: 'low' | 'medium' | 'high'
  cooldownMinutes?: number
}

/**
 * Agent constraints - limitations on agent behavior
 */
export interface AgentConstraints {
  general: GeneralConstraints
  trading: TradingConstraints
  social?: SocialConstraints
}
