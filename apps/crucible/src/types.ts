/**
 * Crucible Types
 * 
 * Core type definitions for the decentralized agent orchestration platform.
 */

import type { Address } from 'viem';

// =============================================================================
// Agent Types
// =============================================================================

export interface AgentDefinition {
  agentId: bigint;
  owner: Address;
  name: string;
  characterCid: string;
  stateCid: string;
  vaultAddress: Address;
  active: boolean;
  registeredAt: number;
  lastExecutedAt: number;
  executionCount: number;
}

export interface AgentCharacter {
  id: string;
  name: string;
  description: string;
  system: string;
  bio: string[];
  messageExamples: MessageExample[][];
  topics: string[];
  adjectives: string[];
  style: {
    all: string[];
    chat: string[];
    post: string[];
  };
  modelPreferences?: {
    small: string;
    large: string;
    embedding?: string;
  };
  mcpServers?: string[];
  a2aCapabilities?: string[];
}

export interface MessageExample {
  name: string;
  content: { text: string };
}

export interface AgentState {
  /** Agent ID */
  agentId: string;
  /** State version (incremented on each update) */
  version: number;
  /** Memory entries */
  memories: MemoryEntry[];
  /** Active room memberships */
  rooms: string[];
  /** Current context */
  context: Record<string, unknown>;
  /** Last updated timestamp */
  updatedAt: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  importance: number;
  createdAt: number;
  roomId?: string;
  userId?: string;
}

// =============================================================================
// Room Types (Multi-Agent Coordination)
// =============================================================================

export interface Room {
  roomId: bigint;
  name: string;
  description: string;
  owner: Address;
  stateCid: string;
  members: RoomMember[];
  roomType: RoomType;
  config: RoomConfig;
  active: boolean;
  createdAt: number;
}

export interface RoomMember {
  agentId: bigint;
  role: AgentRole;
  joinedAt: number;
  lastActiveAt: number;
  score?: number;
}

export type RoomType = 'collaboration' | 'adversarial' | 'debate' | 'council';

export type AgentRole = 'participant' | 'moderator' | 'red_team' | 'blue_team' | 'observer';

export interface RoomConfig {
  maxMembers: number;
  turnBased: boolean;
  turnTimeout?: number;
  scoringRules?: ScoringRules;
  visibility: 'public' | 'private' | 'members_only';
}

export interface ScoringRules {
  /** Points per successful action */
  actionPoints: number;
  /** Points for winning */
  winBonus: number;
  /** Points deducted for violations */
  violationPenalty: number;
  /** Custom rules */
  custom?: Record<string, number>;
}

export interface RoomState {
  roomId: string;
  version: number;
  messages: RoomMessage[];
  scores: Record<string, number>;
  currentTurn?: string;
  phase: RoomPhase;
  metadata: Record<string, unknown>;
  updatedAt: number;
}

export interface RoomMessage {
  id: string;
  agentId: string;
  content: string;
  timestamp: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

export type RoomPhase = 'setup' | 'active' | 'paused' | 'completed' | 'archived';

// =============================================================================
// Team Types
// =============================================================================

export interface Team {
  teamId: bigint;
  name: string;
  objective: string;
  members: bigint[];
  vaultAddress: Address;
  teamType: TeamType;
  leaderId?: bigint;
  active: boolean;
}

export type TeamType = 'red' | 'blue' | 'neutral' | 'mixed';

// =============================================================================
// Execution Types
// =============================================================================

export interface ExecutionRequest {
  agentId: bigint;
  triggerId?: string;
  input: ExecutionInput;
  options?: ExecutionOptions;
}

export interface ExecutionInput {
  message?: string;
  roomId?: string;
  userId?: string;
  context?: Record<string, unknown>;
}

export interface ExecutionOptions {
  maxTokens?: number;
  temperature?: number;
  requireTee?: boolean;
  maxCost?: bigint;
  timeout?: number;
}

export interface ExecutionResult {
  executionId: string;
  agentId: bigint;
  status: ExecutionStatus;
  output?: ExecutionOutput;
  newStateCid?: string;
  cost: ExecutionCost;
  metadata: ExecutionMetadata;
}

export interface ExecutionOutput {
  response?: string;
  actions?: AgentAction[];
  stateUpdates?: Record<string, unknown>;
  roomMessages?: RoomMessage[];
}

export interface AgentAction {
  type: string;
  target?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  success: boolean;
}

export interface ExecutionCost {
  total: bigint;
  inference: bigint;
  storage: bigint;
  executionFee: bigint;
  currency: string;
  txHash?: string;
}

export interface ExecutionMetadata {
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  model?: string;
  tokensUsed?: { input: number; output: number };
  executor: Address;
  attestationHash?: string;
}

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

// =============================================================================
// Trigger Types
// =============================================================================

export interface AgentTrigger {
  triggerId: string;
  agentId: bigint;
  type: TriggerType;
  config: TriggerConfig;
  active: boolean;
  lastFiredAt?: number;
  fireCount: number;
}

export type TriggerType = 'cron' | 'webhook' | 'event' | 'room_message';

export interface TriggerConfig {
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  roomId?: string;
  endpoint?: string;
  paymentMode: 'x402' | 'prepaid' | 'vault';
  pricePerExecution?: bigint;
}

// =============================================================================
// Vault Types
// =============================================================================

export interface AgentVault {
  address: Address;
  agentId: bigint;
  balance: bigint;
  spendLimit: bigint;
  approvedSpenders: Address[];
  totalSpent: bigint;
  lastFundedAt: number;
}

export interface VaultTransaction {
  txHash: string;
  type: 'deposit' | 'withdrawal' | 'spend';
  amount: bigint;
  spender?: Address;
  description?: string;
  timestamp: number;
}

// =============================================================================
// Search/Discovery Types
// =============================================================================

export interface AgentSearchFilter {
  /** Search by name */
  name?: string;
  /** Search by owner */
  owner?: Address;
  /** Filter by active status */
  active?: boolean;
  /** Filter by capabilities */
  capabilities?: string[];
  /** Filter by room membership */
  roomId?: bigint;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface ServiceSearchFilter {
  type?: 'mcp' | 'a2a' | 'rest';
  category?: string;
  query?: string;
  verifiedOnly?: boolean;
  limit?: number;
}

export interface SearchResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface CrucibleConfig {
  rpcUrl: string;
  privateKey?: string;
  contracts: {
    agentVault: Address;
    roomRegistry: Address;
    triggerRegistry: Address;
    identityRegistry: Address;
    serviceRegistry: Address;
  };
  services: {
    computeMarketplace: string;
    storageApi: string;
    ipfsGateway: string;
    indexerGraphql: string;
  };
  network: 'localnet' | 'testnet' | 'mainnet';
}
