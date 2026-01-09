import type { ExecutionStatus, JsonObject, JsonValue } from '@jejunetwork/types'
import type { Address } from 'viem'

export interface LastExecutionInfo {
  executionId: string
  timestamp: number
  triggerId?: string | null
}

export interface AgentContext {
  lastExecution?: LastExecutionInfo | null
  [key: string]: JsonValue | LastExecutionInfo | null | undefined
}

export interface ActionParams {
  content?: string
  target?: string
  amount?: string
  [key: string]: JsonValue | undefined
}

export type ActionResult =
  | string
  | { txHash: string; success?: boolean }
  | { success: boolean; error?: string }
  | JsonObject

export interface StateUpdates {
  lastResponse?: string
  lastActions?: AgentAction[]
  actionSuccessRate?: number
}

export interface RoomStateMetadata {
  topic?: string | null
  rules?: string[] | null
  [key: string]: JsonValue | null | undefined
}

export interface MessageMetadata {
  source?: string | null
  replyTo?: string | null
  attachments?: string[] | null
  [key: string]: JsonValue | null | undefined
}

export type BotType = 'ai_agent' | 'trading_bot' | 'org_tool'

export interface AgentCapabilities {
  canTrade?: boolean
  canChat?: boolean
  canPropose?: boolean
  canVote?: boolean
  canStake?: boolean
  a2a?: boolean
  compute?: boolean
}

export interface AgentDefinition {
  agentId: bigint
  owner: Address
  name: string
  botType: BotType
  characterCid?: string
  stateCid: string
  vaultAddress: Address
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
  strategies?: TradingBotStrategy[]
  chains?: TradingBotChain[]
  treasuryAddress?: Address
  orgId?: string
  capabilities?: AgentCapabilities
}

export interface AgentCharacter {
  id: string
  name: string
  description: string
  system: string
  bio: string[]
  messageExamples: MessageExample[][]
  topics: string[]
  adjectives: string[]
  style: {
    all: string[]
    chat: string[]
    post: string[]
  }
  modelPreferences?: {
    small: string
    large: string
    analysis?: string | null
    embedding?: string | null
  } | null
  mcpServers?: string[] | null
  a2aCapabilities?: string[] | null
  capabilities?: AgentCapabilities | null
}

export interface MessageExample {
  name: string
  content: { text: string }
}

export interface AgentState {
  /** Agent ID */
  agentId: string
  /** State version (incremented on each update) */
  version: number
  /** Memory entries */
  memories: MemoryEntry[]
  /** Active room memberships */
  rooms: string[]
  /** Current context */
  context: AgentContext
  /** Last updated timestamp */
  updatedAt: number
}

export interface MemoryEntry {
  id: string
  content: string
  embedding?: number[] | null
  importance: number
  createdAt: number
  roomId?: string | null
  userId?: string | null
}

export interface Room {
  roomId: bigint
  name: string
  description: string
  owner: Address
  stateCid: string
  members: RoomMember[]
  roomType: RoomType
  config: RoomConfig
  active: boolean
  createdAt: number
}

export interface RoomMember {
  agentId: bigint
  role: AgentRole
  joinedAt: number
  lastActiveAt: number
  score?: number
}

export type RoomType = 'collaboration' | 'adversarial' | 'debate' | 'board'

export type AgentRole =
  | 'participant'
  | 'moderator'
  | 'red_team'
  | 'blue_team'
  | 'observer'

export interface RoomConfig {
  maxMembers: number
  turnBased: boolean
  turnTimeout?: number
  scoringRules?: ScoringRules
  visibility: 'public' | 'private' | 'members_only'
}

export interface ScoringRules {
  /** Points per successful action */
  actionPoints: number
  /** Points for winning */
  winBonus: number
  /** Points deducted for violations */
  violationPenalty: number
  /** Custom rules */
  custom?: Record<string, number>
}

export interface RoomState {
  roomId: string
  version: number
  messages: RoomMessage[]
  scores: Record<string, number>
  currentTurn?: string | null
  phase: RoomPhase
  metadata: RoomStateMetadata
  updatedAt: number
}

export interface RoomMessage {
  id: string
  agentId: string
  content: string
  timestamp: number
  action?: string | null
  metadata?: MessageMetadata | null
}

export type RoomPhase = 'setup' | 'active' | 'paused' | 'completed' | 'archived'

// Team Types

export interface Team {
  teamId: bigint
  name: string
  objective: string
  members: bigint[]
  vaultAddress: Address
  teamType: TeamType
  leaderId?: bigint
  active: boolean
}

export type TeamType = 'red' | 'blue' | 'neutral' | 'mixed'

export interface ExecutionRequest {
  agentId: bigint
  triggerId?: string
  input: ExecutionInput
  options?: ExecutionOptions
}

export interface ExecutionInput {
  message?: string | null
  roomId?: string | null
  userId?: string | null
  context?: JsonObject | null
}

export interface ExecutionOptions {
  maxTokens?: number | null
  temperature?: number | null
  requireTee?: boolean | null
  maxCost?: bigint | null
  timeout?: number | null
}

export interface ExecutionResult {
  executionId: string
  agentId: bigint
  status: ExecutionStatus
  output?: ExecutionOutput
  newStateCid?: string
  cost: ExecutionCost
  metadata: ExecutionMetadata
}

export interface ExecutionOutput {
  response?: string
  actions?: AgentAction[]
  stateUpdates?: StateUpdates
  roomMessages?: RoomMessage[]
}

export interface AgentAction {
  type: string
  target?: string
  params?: ActionParams
  result?: ActionResult
  success: boolean
}

export interface ExecutionCost {
  total: bigint
  inference: bigint
  storage: bigint
  executionFee: bigint
  currency: string
  txHash?: string
}

export interface ExecutionMetadata {
  startedAt: number
  completedAt: number
  latencyMs: number
  model?: string
  tokensUsed?: { input: number; output: number }
  executor: Address
  attestationHash?: string
}

// Trigger Types

export interface AgentTrigger {
  triggerId: string
  agentId: bigint
  type: TriggerType
  config: TriggerConfig
  active: boolean
  lastFiredAt?: number
  fireCount: number
}

export type TriggerType = 'cron' | 'webhook' | 'event' | 'room_message'

export interface TriggerConfig {
  cronExpression?: string
  webhookPath?: string
  eventTypes?: string[]
  roomId?: string
  endpoint?: string
  paymentMode: 'x402' | 'prepaid' | 'vault'
  pricePerExecution?: bigint
}

export interface AgentVault {
  address: Address
  agentId: bigint
  balance: bigint
  spendLimit: bigint
  approvedSpenders: Address[]
  totalSpent: bigint
  lastFundedAt: number
}

export interface VaultTransaction {
  txHash: string
  type: 'deposit' | 'withdrawal' | 'spend'
  amount: bigint
  spender?: Address
  description?: string
  timestamp: number
}

// Search/Discovery Types

export interface AgentSearchFilter {
  /** Search by name */
  name?: string
  /** Search by owner */
  owner?: Address
  /** Filter by active status */
  active?: boolean
  /** Filter by capabilities */
  capabilities?: string[]
  /** Filter by room membership */
  roomId?: bigint
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

export interface ServiceSearchFilter {
  type?: 'mcp' | 'a2a' | 'rest'
  category?: string
  query?: string
  verifiedOnly?: boolean
  limit?: number
}

export interface SearchResult<T> {
  items: T[]
  total: number
  hasMore: boolean
}

export interface CrucibleConfig {
  rpcUrl: string
  privateKey?: `0x${string}`
  kmsKeyId?: string
  contracts: {
    agentVault: Address
    roomRegistry: Address
    triggerRegistry: Address
    identityRegistry: Address
    serviceRegistry: Address
    autocratTreasury?: Address
  }
  services: {
    computeMarketplace: string
    storageApi: string
    ipfsGateway: string
    indexerGraphql: string
    sqlitEndpoint?: string
    dexCacheUrl?: string
  }
  network: 'localnet' | 'testnet' | 'mainnet'
}

// Trading Bot Types

export type TradingBotStrategyType =
  | 'DEX_ARBITRAGE'
  | 'CROSS_CHAIN_ARBITRAGE'
  | 'SANDWICH'
  | 'LIQUIDATION'
  | 'SOLVER'
  | 'ORACLE_KEEPER'

export interface TradingBotStrategy {
  type: TradingBotStrategyType
  enabled: boolean
  minProfitBps: number
  maxGasGwei: number
  maxSlippageBps: number
  cooldownMs?: number | null
}

export interface TradingBotChain {
  chainId: number
  name: string
  rpcUrl: string
  wsUrl?: string | null
  blockTime: number
  isL2: boolean
  nativeSymbol: string
  explorerUrl?: string | null
}

export interface TradingBotState {
  botId: string
  botType: 'trading_bot'
  lastExecution: number
  metrics: TradingBotMetrics
  opportunities: TradingBotOpportunity[]
  config: TradingBotConfig
  version: number
}

export interface TradingBotMetrics {
  opportunitiesDetected: number
  opportunitiesExecuted: number
  opportunitiesFailed: number
  totalProfitWei: string
  totalProfitUsd: string
  totalGasSpent: string
  avgExecutionTimeMs: number
  uptime: number
  lastUpdate: number
  byStrategy: Record<
    string,
    {
      detected: number
      executed: number
      failed: number
      profitWei: string
    }
  >
}

export interface TradingBotOpportunity {
  id: string
  type: TradingBotStrategyType
  chainId: number
  expectedProfit: string
  detectedAt: number
  status: 'DETECTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED'
}

export interface TradingBotConfig {
  strategies: TradingBotStrategy[]
  chains: TradingBotChain[]
  treasuryAddress?: Address
  maxConcurrentExecutions: number
  useFlashbots: boolean
}

export interface OrgToolState {
  orgId: string
  botId: string
  botType: 'org_tool'
  todos: OrgTodo[]
  checkinSchedules: OrgCheckinSchedule[]
  checkinResponses: OrgCheckinResponse[]
  teamMembers: OrgTeamMember[]
  version: number
  updatedAt: number
}

export interface OrgTodo {
  id: string
  orgId: string
  title: string
  description?: string
  priority: 'low' | 'medium' | 'high'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  assigneeAgentId?: string
  createdBy: string
  dueDate?: number
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface OrgCheckinSchedule {
  id: string
  orgId: string
  roomId?: string
  name: string
  checkinType: 'standup' | 'retrospective' | 'checkin'
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly'
  timeUtc: string
  questions: string[]
  active: boolean
  createdAt: number
}

export interface OrgCheckinResponse {
  id: string
  scheduleId: string
  responderAgentId: string
  answers: Record<string, string>
  submittedAt: number
}

export interface OrgTeamMember {
  agentId: string
  orgId: string
  role: string
  joinedAt: number
  lastActiveAt: number
  stats: {
    todosCompleted: number
    checkinsCompleted: number
    contributions: number
  }
}
