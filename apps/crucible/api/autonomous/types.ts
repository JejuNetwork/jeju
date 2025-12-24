/**
 * Autonomous Agent Types
 * Configuration and types for autonomous agent execution
 */

import type { AgentCharacter } from '../../lib/types'

export interface AutonomousAgentConfig {
  agentId: string
  character: AgentCharacter
  tickIntervalMs: number
  capabilities: AutonomousCapabilities
  maxActionsPerTick: number
  enabled: boolean
}

export interface AutonomousCapabilities {
  canTrade: boolean
  canChat: boolean
  canPropose: boolean
  canVote: boolean
  canDelegate: boolean
  canStake: boolean
  canBridge: boolean
}

export const DEFAULT_AUTONOMOUS_CONFIG: Omit<AutonomousAgentConfig, 'agentId' | 'character'> = {
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
