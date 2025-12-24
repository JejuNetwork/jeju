/**
 * DWS Agent Types
 * First-class agent management in DWS
 */

import type { JsonRecord } from '@jejunetwork/sdk'
import type { Address } from 'viem'

// Character & Personality

export interface AgentCharacter {
  name: string
  system: string
  bio: string[]
  messageExamples?: Array<Array<{ name: string; content: { text: string } }>>
  topics?: string[]
  adjectives?: string[]
  style?: {
    all?: string[]
    chat?: string[]
    post?: string[]
  }
  knowledge?: string[]
  lore?: string[]
}

export interface AgentModelPreferences {
  small?: string
  large?: string
  embedding?: string
}

// Agent Configuration

export interface AgentSecrets {
  /** Platform tokens */
  DISCORD_TOKEN?: string
  TELEGRAM_TOKEN?: string
  TWITTER_API_KEY?: string
  TWITTER_API_SECRET?: string
  TWITTER_ACCESS_TOKEN?: string
  TWITTER_ACCESS_SECRET?: string
  FARCASTER_MNEMONIC?: string

  /** Wallet */
  WALLET_PRIVATE_KEY?: string

  /** Custom secrets */
  [key: string]: string | undefined
}

export interface AgentRuntimeConfig {
  /** Keep at least one instance warm */
  keepWarm: boolean

  /** Cron schedule for autonomous execution (e.g., "* /5 * * * *" without the space) */
  cronSchedule?: string

  /** Max memory in MB (default 256) */
  maxMemoryMb: number

  /** Execution timeout in ms (default 30000) */
  timeoutMs: number

  /** Plugins to load */
  plugins: string[]

  /** MCP servers to connect */
  mcpServers?: string[]

  /** A2A capabilities */
  a2aCapabilities?: string[]
}

export interface AgentConfig {
  id: string
  owner: Address

  /** Character definition */
  character: AgentCharacter

  /** Model preferences */
  models?: AgentModelPreferences

  /** Runtime configuration */
  runtime: AgentRuntimeConfig

  /** KMS vault key ID for secrets */
  secretsKeyId?: string

  /** CQL database ID for memories */
  memoriesDbId?: string

  /** Agent status */
  status: AgentStatus

  /** Creation timestamp */
  createdAt: number

  /** Last update timestamp */
  updatedAt: number

  /** Metadata */
  metadata?: Record<string, string>
}

export type AgentStatus =
  | 'pending' // Just registered, not deployed
  | 'deploying' // Worker being deployed
  | 'active' // Ready to receive messages
  | 'paused' // Temporarily disabled
  | 'error' // Deployment or runtime error
  | 'terminated' // Permanently stopped

// Agent Instance (Runtime State)

export interface AgentInstance {
  agentId: string
  instanceId: string
  workerId: string

  /** Instance status */
  status: 'starting' | 'ready' | 'busy' | 'draining' | 'stopped'

  /** Endpoint for invoking this instance */
  endpoint: string
  port: number

  /** Current connections/invocations */
  activeInvocations: number
  totalInvocations: number

  /** Timing */
  startedAt: number
  lastActivityAt: number

  /** Resource usage */
  memoryUsedMb: number

  /** Loaded plugins */
  loadedPlugins: string[]
}

// Agent Invocation

export interface AgentMessage {
  id: string
  userId: string
  roomId: string
  content: {
    text: string
    source?: string
    attachments?: Array<{ type: string; url: string }>
  }
  createdAt: number
}

export interface AgentResponse {
  id: string
  agentId: string
  text: string
  actions?: Array<{
    name: string
    params: Record<string, string>
  }>
  metadata?: {
    model?: string
    tokensUsed?: number
    latencyMs?: number
  }
}

export interface AgentInvocation {
  id: string
  agentId: string
  instanceId?: string

  message: AgentMessage
  response?: AgentResponse

  status: 'pending' | 'processing' | 'completed' | 'error' | 'timeout'
  error?: string

  startedAt: number
  completedAt?: number
  durationMs?: number
}

// Agent Memories (CQL Schema)

export interface AgentMemory {
  id: string
  agentId: string
  userId: string
  roomId: string

  /** Memory content */
  content: string

  /** Embedding vector (stored as JSON array) */
  embedding?: number[]

  /** Memory type */
  type: 'message' | 'fact' | 'goal' | 'reflection'

  /** Importance score (0-1) */
  importance: number

  /** Creation timestamp */
  createdAt: number

  /** Metadata */
  metadata?: Record<string, string>
}

// Agent Cron (Autonomous Execution)

export interface AgentCronTrigger {
  id: string
  agentId: string

  /** Cron expression */
  schedule: string

  /** Action to execute */
  action: 'think' | 'post' | 'check' | 'custom'

  /** Custom payload for the action */
  payload?: JsonRecord

  /** Is this trigger active? */
  enabled: boolean

  /** Last execution */
  lastRunAt?: number
  nextRunAt?: number

  /** Execution count */
  runCount: number
}

// Warm Pool Configuration

export interface WarmPoolConfig {
  /** Max instances to keep warm across all agents */
  maxWarmInstances: number

  /** Idle timeout before scaling to zero (ms) */
  idleTimeoutMs: number

  /** Cooldown after request before considering idle (ms) */
  cooldownMs: number

  /** Request threshold to trigger keep-warm */
  keepWarmRequestThreshold: number

  /** Time window for request threshold (ms) */
  keepWarmWindowMs: number
}

export const DEFAULT_WARM_POOL_CONFIG: WarmPoolConfig = {
  maxWarmInstances: 50,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  cooldownMs: 30 * 1000, // 30 seconds
  keepWarmRequestThreshold: 3,
  keepWarmWindowMs: 5 * 60 * 1000, // 5 minutes
}

// API Request/Response Types

export interface RegisterAgentRequest {
  character: AgentCharacter
  models?: AgentModelPreferences
  runtime?: Partial<AgentRuntimeConfig>
  secrets?: AgentSecrets
  metadata?: Record<string, string>
}

export interface UpdateAgentRequest {
  character?: Partial<AgentCharacter>
  models?: AgentModelPreferences
  runtime?: Partial<AgentRuntimeConfig>
  secrets?: AgentSecrets
  metadata?: Record<string, string>
}

export interface ChatRequest {
  text: string
  userId?: string
  roomId?: string
  source?: string
}

export interface AgentStats {
  agentId: string
  totalInvocations: number
  avgLatencyMs: number
  errorRate: number
  activeInstances: number
  memoriesCount: number
  lastActivityAt?: number
}

// Events

export type AgentEvent =
  | { type: 'agent:registered'; agentId: string; owner: Address }
  | { type: 'agent:deployed'; agentId: string }
  | { type: 'agent:invoked'; agentId: string; invocationId: string }
  | {
      type: 'agent:completed'
      agentId: string
      invocationId: string
      durationMs: number
    }
  | { type: 'agent:error'; agentId: string; error: string }
  | { type: 'agent:scaled'; agentId: string; from: number; to: number }
  | { type: 'agent:terminated'; agentId: string }

export type AgentEventHandler = (event: AgentEvent) => void
