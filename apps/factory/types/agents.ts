/**
 * Agent Types
 */

import type { Address } from 'viem'

export type AgentType = 'ai_agent' | 'trading_bot' | 'org_tool'

export type AgentStatus = 'active' | 'inactive' | 'banned'

export interface Agent {
  agentId: bigint
  owner: Address
  name: string
  botType: AgentType
  characterCid: string | null
  stateCid: string
  vaultAddress: Address
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
  capabilities: string[]
  specializations: string[]
  reputation: number
}
