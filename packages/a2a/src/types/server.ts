/**
 * A2A Server Type Definitions
 *
 * Types for A2A server configuration and dependencies.
 * Includes local definitions of @a2a-js/sdk types for use when the
 * optional peer dependency is not installed.
 */

import type { JsonValue } from '@jejunetwork/types'
import type { AgentCapabilities, AgentProfile } from './a2a'
import type {
  PaymentMetadata,
  PaymentRequest,
  PaymentVerificationParams,
  PaymentVerificationResult,
} from './common'

// ============================================================================
// A2A SDK Types (local definitions for when @a2a-js/sdk is not installed)
// These mirror the types from @a2a-js/sdk for local use
// ============================================================================

/**
 * Message part in an A2A message
 */
export interface MessagePart {
  kind: 'text' | 'data' | 'file'
  text?: string
  data?: Record<string, JsonValue>
  file?: {
    name: string
    mimeType: string
    bytes: string
  }
}

/**
 * A2A Protocol Message
 */
export interface Message {
  role: 'user' | 'agent'
  messageId: string
  parts: MessagePart[]
  kind: 'message'
}

/**
 * Task status state
 */
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'

/**
 * Task status
 */
export interface TaskStatus {
  state: TaskState
  timestamp?: string
  message?: string
}

/**
 * Task artifact part
 */
export interface ArtifactPart {
  kind: 'text' | 'data' | 'file'
  text?: string
  data?: Record<string, JsonValue>
  file?: {
    name: string
    mimeType: string
    bytes: string
  }
}

/**
 * Task artifact
 */
export interface TaskArtifact {
  artifactId: string
  name: string
  parts: ArtifactPart[]
}

/**
 * A2A Protocol Task
 */
export interface Task {
  kind: 'task'
  id: string
  contextId: string
  status: TaskStatus
  history?: Message[]
  artifacts?: TaskArtifact[]
}

/**
 * Task status update event
 */
export interface TaskStatusUpdateEvent {
  kind: 'status-update'
  taskId: string
  contextId: string
  status: TaskStatus
  final: boolean
}

/**
 * Task artifact update event
 */
export interface TaskArtifactUpdateEvent {
  kind: 'artifact-update'
  taskId: string
  contextId: string
  artifact: TaskArtifact
}

/**
 * Request context for executor
 */
export interface RequestContext {
  taskId: string
  contextId?: string
  task?: Task
  userMessage: Message
}

/**
 * Execution event bus for publishing task updates
 */
export interface ExecutionEventBus {
  publish(event: Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent): void
  finished(): void
}

/**
 * Agent executor interface
 */
export interface AgentExecutor {
  execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void>
  cancelTask?(taskId: string, eventBus: ExecutionEventBus): Promise<void>
}

/**
 * Task store interface for storing and retrieving tasks
 */
export interface TaskStore {
  save(task: Task): Promise<void>
  load(taskId: string): Promise<Task | undefined>
}

/**
 * Agent card skill definition
 */
export interface AgentCardSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}

/**
 * A2A Agent Card
 */
export interface AgentCard {
  protocolVersion: string
  name: string
  description: string
  url: string
  preferredTransport: 'JSONRPC' | 'http'
  additionalInterfaces?: Array<{
    url: string
    transport: 'JSONRPC' | 'http'
  }>
  provider: {
    organization: string
    url: string
  }
  iconUrl?: string
  version: string
  documentationUrl?: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  securitySchemes?: Record<
    string,
    {
      type: string
      in?: string
      name?: string
      description?: string
    }
  >
  security?: Array<Record<string, string[]>>
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: AgentCardSkill[]
  supportsAuthenticatedExtendedCard?: boolean
}

/**
 * Agent registry entry
 */
export interface AgentRegistryEntry {
  agentId: string
  [key: string]: JsonValue
}

/**
 * Registry client interface
 * Supports both simple registry operations and blockchain-based registry
 * Named IRegistryClient to distinguish from the RegistryClient class
 */
export interface IRegistryClient {
  // Simple registry operations
  register(agentId: string, data: Record<string, JsonValue>): Promise<void>
  unregister(agentId: string): Promise<void>
  getAgents(): Promise<AgentRegistryEntry[]>
  getAgent(agentId: string): Promise<AgentRegistryEntry | null>

  // Blockchain-based registry operations (optional)
  discoverAgents?(filters?: {
    strategies?: string[]
    minReputation?: number
    markets?: string[]
  }): Promise<AgentProfile[]>
  getAgentProfile?(tokenId: number): Promise<AgentProfile | null>
  verifyAgent?(address: string, tokenId: number): Promise<boolean>
}

/**
 * Payment request result - re-exported from common for interface use
 */
export type PaymentRequestResult = PaymentRequest

/**
 * X402 payment manager interface
 * Named IX402Manager to distinguish from the X402Manager class
 */
export interface IX402Manager {
  createPaymentRequest(
    from: string,
    to: string,
    amount: string,
    service: string,
    metadata?: PaymentMetadata,
  ): Promise<PaymentRequestResult>
  verifyPayment(
    verificationData: PaymentVerificationParams,
  ): Promise<PaymentVerificationResult>
  getPaymentRequest(requestId: string): Promise<PaymentRequestResult | null>
  isPaymentVerified(requestId: string): Promise<boolean>
  cancelPaymentRequest(requestId: string): Promise<boolean>
  getPendingPayments(): Promise<PaymentRequestResult[]>
  getStatistics(): Promise<{
    pending: number
    verified: number
    expired: number
  }>
}

/**
 * Agent0 client interface
 */
export interface IAgent0Client {
  discoverAgents(filters?: {
    strategies?: string[]
    minReputation?: number
    markets?: string[]
  }): Promise<AgentProfile[]>
  getAgentProfile(tokenId: number): Promise<AgentProfile | null>
  verifyAgent(address: string, tokenId: number): Promise<boolean>
}

/**
 * Agent discovery service interface
 */
export interface IAgentDiscoveryService {
  discoverAgents(filters?: {
    strategies?: string[]
    minReputation?: number
    markets?: string[]
    skills?: string[]
    domains?: string[]
  }): Promise<AgentProfile[]>
  getAgentByAddress(address: string): Promise<AgentProfile | null>
  getAgentByTokenId(tokenId: number): Promise<AgentProfile | null>
}

/**
 * Server Configuration
 */
export interface A2AServerConfig {
  port: number
  host?: string
  maxConnections?: number
  messageRateLimit?: number
  authTimeout?: number
  enableX402?: boolean
  enableCoalitions?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  registryClient?: IRegistryClient
  agent0Client?: IAgent0Client
  agentDiscovery?: IAgentDiscoveryService
}

/**
 * Server Options (used internally by websocket-server)
 */
export interface A2AServerOptions
  extends Omit<
    A2AServerConfig,
    'registryClient' | 'agent0Client' | 'agentDiscovery'
  > {
  registryClient?: IRegistryClient
  x402Manager?: IX402Manager
  agent0Client?: IAgent0Client
  agentDiscovery?: IAgentDiscoveryService
}

/**
 * Client Configuration
 */
export interface A2AClientConfig {
  endpoint: string
  credentials: {
    address: string
    privateKey: string
    tokenId?: number
  }
  capabilities: AgentCapabilities
  autoReconnect?: boolean
  reconnectInterval?: number
  heartbeatInterval?: number
}
