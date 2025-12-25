/**
 * Agent Configuration Types
 *
 * Core type definitions for agent configuration and runtime state.
 */

import type { Character } from '@elizaos/core'
import type { JsonValue } from '@jejunetwork/types'

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string
  userId: string
  name: string
  description?: string
  profileImageUrl?: string

  /** Character configuration for ElizaOS */
  character: Character

  /** Model tier for inference */
  modelTier: 'lite' | 'standard' | 'pro'

  /** Whether autonomous behavior is enabled */
  autonomousEnabled: boolean

  /** Whether agent is active */
  isActive: boolean

  /** Points balance for operations */
  pointsBalance: number

  /** EVM wallet address */
  walletAddress?: string

  /** OAuth3 wallet ID for decentralized key management */
  oauth3WalletId?: string

  /** Lifetime P&L from trading */
  lifetimePnL: number

  /** Total trades executed */
  totalTrades: number

  /** Win rate (0-1) */
  winRate: number
}

/**
 * Agent message record
 */
export interface AgentMessage {
  id: string
  agentId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  modelUsed?: string
  pointsCost: number
  metadata?: Record<string, JsonValue>
  createdAt: Date
}

/**
 * Agent log entry
 */
export interface AgentLog {
  id: string
  agentId: string
  type:
    | 'chat'
    | 'tick'
    | 'trade'
    | 'error'
    | 'system'
    | 'post'
    | 'comment'
    | 'dm'
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  prompt?: string
  completion?: string
  thinking?: string
  metadata?: Record<string, JsonValue>
  createdAt: Date
}

/**
 * Agent points transaction
 */
export interface AgentPointsTransaction {
  id: string
  agentId: string
  userId: string
  type:
    | 'deposit'
    | 'withdraw'
    | 'spend_chat'
    | 'spend_tick'
    | 'spend_post'
    | 'earn_trade'
  amount: number
  balanceBefore: number
  balanceAfter: number
  description: string
  relatedId?: string
  createdAt: Date
}

/**
 * Agent trade record
 */
export interface AgentTrade {
  id: string
  agentId: string
  userId: string
  marketType: 'prediction' | 'perp' | 'spot'
  marketId?: string
  ticker?: string
  action: 'open' | 'close'
  side?: 'long' | 'short' | 'yes' | 'no'
  amount: number
  price: number
  pnl?: number
  reasoning?: string
  executedAt: Date
}

/**
 * Parameters for creating a new agent
 */
export interface CreateAgentParams {
  userId: string
  name: string
  description?: string
  profileImageUrl?: string
  coverImageUrl?: string
  system: string
  bio?: string[]
  personality?: string
  tradingStrategy?: string
  initialDeposit?: number
  modelTier?: 'lite' | 'standard' | 'pro'
}

/**
 * Chat request to agent
 */
export interface ChatRequest {
  agentId: string
  userId: string
  message: string
  usePro?: boolean
}

/**
 * Chat response from agent
 */
export interface ChatResponse {
  messageId: string
  response: string
  pointsCost: number
  modelUsed: string
  balanceAfter: number
}

/**
 * Agent performance metrics
 */
export interface AgentPerformance {
  lifetimePnL: number
  totalTrades: number
  profitableTrades: number
  winRate: number
  avgTradeSize: number
  sharpeRatio?: number
  maxDrawdown?: number
}
