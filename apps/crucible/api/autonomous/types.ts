/**
 * Autonomous Agent Types
 * Configuration and types for autonomous agent execution
 */

import type { JsonValue } from '@jejunetwork/types'
import type { AgentCharacter } from '../../lib/types'

export interface AutonomousAgentConfig {
  agentId: string
  character: AgentCharacter
  tickIntervalMs: number
  capabilities: AutonomousCapabilities
  maxActionsPerTick: number
  enabled: boolean
  goals?: AgentGoal[]
}

export interface AutonomousCapabilities {
  canTrade: boolean
  canChat: boolean
  canPropose: boolean
  canVote: boolean
  canDelegate: boolean
  canStake: boolean
  canBridge: boolean
  a2a?: boolean
  compute?: boolean
}

export interface AgentGoal {
  id: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'active' | 'completed' | 'paused' | 'failed'
  deadline?: number
  progress?: number
  metadata?: Record<string, JsonValue>
}

export interface AvailableAction {
  name: string
  description: string
  category: string
  parameters?: ActionParameter[]
  examples?: string[]
  requiresApproval?: boolean
}

export interface ActionParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'address' | 'bigint' | 'object'
  description: string
  required: boolean
  default?: JsonValue
}

export interface PendingMessage {
  id: string
  from: string
  content: string
  timestamp: number
  roomId?: string
  requiresResponse: boolean
}

export interface AgentTickContext {
  availableActions: AvailableAction[]
  recentActivity: ActivityEntry[]
  pendingGoals: AgentGoal[]
  pendingMessages: PendingMessage[]
  networkState: NetworkState
}

export interface ActivityEntry {
  action: string
  timestamp: number
  success: boolean
  result?: JsonValue
}

export interface NetworkState {
  network: string
  dwsAvailable: boolean
  inferenceAvailable?: boolean
  inferenceNodes?: number
  gasPrice?: bigint
  blockNumber?: bigint
}

export const DEFAULT_AUTONOMOUS_CONFIG: Omit<
  AutonomousAgentConfig,
  'agentId' | 'character'
> = {
  tickIntervalMs: 60_000, // 1 minute default
  capabilities: {
    canTrade: true,
    canChat: true,
    canPropose: false, // Require explicit opt-in
    canVote: true,
    canDelegate: true,
    canStake: true,
    canBridge: false, // Require explicit opt-in
  },
  maxActionsPerTick: 3,
  enabled: true,
}

export interface AutonomousRunnerConfig {
  enableBuiltinCharacters?: boolean
  defaultTickIntervalMs?: number
  maxConcurrentAgents?: number
}

export interface AutonomousRunnerStatus {
  running: boolean
  agentCount: number
  agents: Array<{
    id: string
    character: string
    lastTick: number
    tickCount: number
  }>
}
