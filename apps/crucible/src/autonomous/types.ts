/**
 * Autonomous Agent Types
 */

import type { AgentCharacter } from '../types'

/**
 * Red Team Mode - enables adversarial testing agents
 */
export type RedTeamMode = 'off' | 'dev' | 'testnet'

/**
 * Configuration for an autonomous agent
 */
export interface AutonomousAgentConfig {
  /** Unique agent ID */
  agentId: string
  /** Agent character definition */
  character: AgentCharacter
  /** Whether autonomous mode is enabled */
  autonomousEnabled: boolean
  /** Tick interval in milliseconds (default: 60000 = 1 minute) */
  tickIntervalMs: number
  /** Maximum actions per tick (default: 5) */
  maxActionsPerTick: number
  /** Enabled autonomous capabilities */
  capabilities: {
    /** Can execute compute actions (inference, GPU rental) */
    compute: boolean
    /** Can execute storage actions (IPFS upload/download) */
    storage: boolean
    /** Can execute DeFi actions (swaps, liquidity) */
    defi: boolean
    /** Can execute governance actions (proposals, voting) */
    governance: boolean
    /** Can communicate with other agents (A2A) */
    a2a: boolean
    /** Can execute cross-chain actions */
    crossChain: boolean
    /** Can execute security testing actions (red team only) */
    security: boolean
    /** Can execute moderation actions (blue team only) */
    moderation: boolean
  }
  /** System prompt override for autonomous decisions */
  systemPrompt?: string
  /** Goals for goal-oriented planning */
  goals?: AgentGoal[]
  /** Red team mode - enables adversarial agents */
  redTeamMode?: RedTeamMode
}

/**
 * Agent goal for planning
 */
export interface AgentGoal {
  id: string
  description: string
  priority: 'high' | 'medium' | 'low'
  status: 'active' | 'completed' | 'paused'
  deadline?: Date
  metrics?: Record<string, number>
}

/**
 * Context provided to the agent during each tick
 */
export interface AgentTickContext {
  /** Agent's current balance (if applicable) */
  balance?: number
  /** Available jeju plugin actions */
  availableActions: AvailableAction[]
  /** Recent agent activity (for context) */
  recentActivity: ActivityLog[]
  /** Pending tasks/goals */
  pendingGoals: AgentGoal[]
  /** Messages waiting for response */
  pendingMessages: PendingMessage[]
  /** Current network state */
  networkState: NetworkState
}

/**
 * Available action from jeju plugin or custom handlers
 */
export interface AvailableAction {
  name: string
  description: string
  category: string
  parameters?: Record<
    string,
    { type: string; description?: string; required?: boolean }
  >
}

/**
 * Activity log entry
 */
export interface ActivityLog {
  timestamp: number
  action: string
  success: boolean
  summary: string
  details?: Record<string, unknown>
}

/**
 * Pending message requiring response
 */
export interface PendingMessage {
  id: string
  from: string
  roomId: string
  content: string
  receivedAt: number
}

/**
 * Current network state
 */
export interface NetworkState {
  network: 'localnet' | 'testnet' | 'mainnet'
  blockNumber?: number
  gasPrice?: string
  dwsAvailable: boolean
  inferenceNodes: number
}

/**
 * Default small model - Groq's Llama 3.1 8B Instant (fast & cheap)
 */
export const DEFAULT_SMALL_MODEL = 'llama-3.1-8b-instant'
export const DEFAULT_LARGE_MODEL = 'llama-3.3-70b-versatile'

/**
 * Default configuration for autonomous agents
 */
export const DEFAULT_AUTONOMOUS_CONFIG: Omit<
  AutonomousAgentConfig,
  'agentId' | 'character'
> = {
  autonomousEnabled: true,
  tickIntervalMs: 30_000, // 30 seconds - fast iteration
  maxActionsPerTick: 5,
  capabilities: {
    compute: true,
    storage: true,
    defi: false, // Off by default for safety
    governance: false,
    a2a: true,
    crossChain: false,
    security: false, // Red team only
    moderation: false, // Blue team only
  },
}

/**
 * Configuration for red team agents
 */
export const RED_TEAM_CONFIG: Omit<
  AutonomousAgentConfig,
  'agentId' | 'character'
> = {
  autonomousEnabled: true,
  tickIntervalMs: 20_000, // 20 seconds - aggressive testing
  maxActionsPerTick: 10,
  capabilities: {
    compute: true,
    storage: true,
    defi: true,
    governance: true,
    a2a: true,
    crossChain: true,
    security: true,
    moderation: false,
  },
  redTeamMode: 'dev',
}

/**
 * Configuration for blue team agents
 */
export const BLUE_TEAM_CONFIG: Omit<
  AutonomousAgentConfig,
  'agentId' | 'character'
> = {
  autonomousEnabled: true,
  tickIntervalMs: 15_000, // 15 seconds - fast response for moderation
  maxActionsPerTick: 20,
  capabilities: {
    compute: true,
    storage: true,
    defi: false, // No DeFi for moderators
    governance: false,
    a2a: true,
    crossChain: false,
    security: false, // Can't do red team actions
    moderation: true,
  },
}

/**
 * Get configuration for red team mode
 */
export function getRedTeamConfig(network: 'localnet' | 'testnet' | 'mainnet'): {
  enabled: boolean
  model: string
} {
  // Red team enabled on all networks except mainnet
  if (network === 'mainnet') {
    return { enabled: false, model: DEFAULT_LARGE_MODEL }
  }

  // Always use small cheap model for dev/testing - Groq llama-3.1-8b-instant
  return {
    enabled: true,
    model: DEFAULT_SMALL_MODEL,
  }
}
