/**
 * Autonomous Agent Types
 */

import type { AgentCharacter } from '../types'

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
  }
  /** System prompt override for autonomous decisions */
  systemPrompt?: string
  /** Goals for goal-oriented planning */
  goals?: AgentGoal[]
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
 * Available action from jeju plugin
 */
export interface AvailableAction {
  name: string
  description: string
  category:
    | 'compute'
    | 'storage'
    | 'defi'
    | 'governance'
    | 'a2a'
    | 'crosschain'
    | 'other'
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
 * Default configuration for autonomous agents
 */
export const DEFAULT_AUTONOMOUS_CONFIG: Omit<
  AutonomousAgentConfig,
  'agentId' | 'character'
> = {
  autonomousEnabled: true,
  tickIntervalMs: 60_000, // 1 minute
  maxActionsPerTick: 5,
  capabilities: {
    compute: true,
    storage: true,
    defi: false, // Off by default for safety
    governance: false,
    a2a: true,
    crossChain: false,
  },
}
