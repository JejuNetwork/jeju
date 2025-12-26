/**
 * Agent0 SDK Type Definitions
 */

import type { AgentCapabilities } from '@jejunetwork/types'
import type { Address } from 'viem'

// Search & Pagination

export interface Agent0SearchFilters {
  name?: string
  description?: string
  skills?: string[]
  strategies?: string[]
  markets?: string[]
  minReputation?: number
  type?: string
  active?: boolean
  x402Support?: boolean
  hasX402?: boolean
  chains?: number[] | 'all'
  owners?: string[]
  operators?: string[]
  mcp?: boolean
  a2a?: boolean
  ens?: string
  did?: string
  walletAddress?: string
  supportedTrust?: string[]
  mcpTools?: string[]
  mcpPrompts?: string[]
  mcpResources?: string[]
  a2aSkills?: string[]
}

export interface Agent0SearchOptions {
  pageSize?: number
  cursor?: string
  sort?: string[]
}

export interface Agent0SearchResultMeta {
  chains: number[]
  successfulChains: number[]
  failedChains: number[]
  totalResults: number
  timing: { totalMs: number; averagePerChainMs?: number }
}

export interface Agent0SearchResponse<T> {
  items: T[]
  nextCursor?: string
  meta?: Agent0SearchResultMeta
}

// Agent Types

export interface Agent0RegistrationParams {
  name: string
  description: string
  imageUrl?: string | null
  walletAddress: string
  mcpEndpoint?: string
  a2aEndpoint?: string
  capabilities: AgentCapabilities
}

export interface Agent0RegistrationResult {
  tokenId: number
  txHash?: string // Only for on-chain registration
  metadataCID?: string
}

export interface Agent0SearchResult {
  tokenId: number
  name: string
  walletAddress: string
  metadataCID: string
  capabilities: AgentCapabilities
  reputation: { trustScore: number; accuracyScore: number }
  chainId?: number
  description?: string
  image?: string
  owners?: string[]
  operators?: string[]
  mcp?: boolean
  a2a?: boolean
  ens?: string
  did?: string
  supportedTrusts?: string[]
  a2aSkills?: string[]
  mcpTools?: string[]
  mcpPrompts?: string[]
  mcpResources?: string[]
  active?: boolean
  x402support?: boolean
}

export interface Agent0AgentProfile {
  tokenId: number
  name: string
  walletAddress: string
  metadataCID: string
  capabilities: AgentCapabilities
  reputation: { trustScore: number; accuracyScore: number }
  description?: string
  image?: string
  chainId?: number
  owners?: string[]
  operators?: string[]
  endpoints?: Agent0Endpoint[]
  trustModels?: string[]
  active?: boolean
  x402support?: boolean
  metadata?: Record<string, unknown>
  updatedAt?: number
}

export interface Agent0Endpoint {
  type: 'MCP' | 'A2A' | 'ENS' | 'DID' | 'wallet' | 'OASF'
  value: string
  meta?: Record<string, unknown>
}

export interface Agent0AgentUpdateParams {
  name?: string
  description?: string
  image?: string
  mcpEndpoint?: string
  a2aEndpoint?: string
  skills?: string[]
  domains?: string[]
  active?: boolean
  x402Support?: boolean
  walletAddress?: string
  walletChainId?: number
  trustModels?: {
    reputation?: boolean
    cryptoEconomic?: boolean
    teeAttestation?: boolean
  }
  metadata?: Record<string, unknown>
}

export interface Agent0TransferResult {
  txHash: string
  from: string
  to: string
  agentId: string
}

// Feedback & Reputation

export interface Agent0FeedbackParams {
  targetAgentId: number
  rating: number // -5 to +5
  comment: string
  transactionId?: string
  tags?: string[]
  capability?: string
  skill?: string
  task?: string
  context?: Record<string, unknown>
  proofOfPayment?: Record<string, unknown>
}

export interface Agent0Feedback {
  id: [string, string, number]
  agentId: string
  reviewer: string
  score?: number
  tags: string[]
  text?: string
  context?: Record<string, unknown>
  proofOfPayment?: Record<string, unknown>
  fileURI?: string
  createdAt: number
  answers: Array<Record<string, unknown>>
  isRevoked: boolean
  capability?: string
  name?: string
  skill?: string
  task?: string
}

export interface Agent0FeedbackSearchParams {
  agents?: string[]
  tags?: string[]
  reviewers?: string[]
  capabilities?: string[]
  skills?: string[]
  tasks?: string[]
  names?: string[]
  minScore?: number
  maxScore?: number
  includeRevoked?: boolean
}

export interface Agent0ReputationSummary {
  count: number
  averageScore: number
}

export interface AggregatedReputation {
  totalBets: number
  winningBets: number
  accuracyScore: number
  trustScore: number
  totalVolume: string
  profitLoss: number
  isBanned: boolean
  sources: { local: number; agent0: number }
}

// Client Interface

export interface IAgent0Client {
  registerAgent(
    params: Agent0RegistrationParams,
  ): Promise<Agent0RegistrationResult>
  searchAgents(
    filters: Agent0SearchFilters,
    options?: Agent0SearchOptions,
  ): Promise<Agent0SearchResponse<Agent0SearchResult>>
  searchAgentsByReputation(
    params: Agent0FeedbackSearchParams,
    options?: Agent0SearchOptions,
  ): Promise<Agent0SearchResponse<Agent0SearchResult>>
  getAgentProfile(tokenId: number): Promise<Agent0AgentProfile | null>
  loadAgent(agentId: string): Promise<Agent0AgentProfile | null>
  updateAgent(
    agentId: string,
    params: Agent0AgentUpdateParams,
  ): Promise<Agent0RegistrationResult>
  transferAgent(
    agentId: string,
    newOwner: string,
  ): Promise<Agent0TransferResult>
  isAgentOwner(agentId: string, address: string): Promise<boolean>
  getAgentOwner(agentId: string): Promise<string>
  submitFeedback(params: Agent0FeedbackParams): Promise<Agent0Feedback>
  getFeedback(
    agentId: string,
    clientAddress: string,
    feedbackIndex: number,
  ): Promise<Agent0Feedback>
  searchFeedback(
    agentId: string,
    params?: Partial<Agent0FeedbackSearchParams>,
  ): Promise<Agent0Feedback[]>
  revokeFeedback(agentId: string, feedbackIndex: number): Promise<string>
  appendFeedbackResponse(
    agentId: string,
    clientAddress: string,
    feedbackIndex: number,
    uri: string,
    hash: string,
  ): Promise<string>
  getReputationSummary(
    agentId: string,
    tag1?: string,
    tag2?: string,
  ): Promise<Agent0ReputationSummary>
  isAvailable(): boolean
  getChainId(): number
  formatAgentId(tokenId: number): string
}

// Service Interfaces

export interface IAgentDiscoveryService {
  discoverAgents(
    filters: DiscoveryFilters,
    options?: Agent0SearchOptions,
  ): Promise<Agent0SearchResponse<AgentProfile>>
  getAgent(agentId: string): Promise<AgentProfile | null>
}

export interface DiscoveryFilters {
  strategies?: string[]
  markets?: string[]
  minReputation?: number
  includeExternal?: boolean
  skills?: string[]
  active?: boolean
  x402Support?: boolean
  chains?: number[] | 'all'
  mcp?: boolean
  a2a?: boolean
}

export interface AgentProfile {
  agentId: string
  tokenId: number
  address: string
  name: string
  endpoint: string
  capabilities: AgentCapabilities
  reputation: AgentReputation
  isActive: boolean
}

export interface AgentReputation {
  totalBets: number
  winningBets: number
  accuracyScore: number
  trustScore: number
  totalVolume: string
  profitLoss: number
  isBanned: boolean
}

export interface IReputationBridge {
  getAggregatedReputation(tokenId: number): Promise<AggregatedReputation>
  getAgent0ReputationSummary(
    agentId: string,
    tag1?: string,
    tag2?: string,
  ): Promise<Agent0ReputationSummary>
}

export interface IAgent0FeedbackService {
  submitFeedback(params: Agent0FeedbackParams): Promise<Agent0Feedback>
  getFeedback(
    agentId: string,
    clientAddress: string,
    feedbackIndex: number,
  ): Promise<Agent0Feedback>
  searchFeedback(
    agentId: string,
    params?: Partial<Agent0FeedbackSearchParams>,
  ): Promise<Agent0Feedback[]>
  revokeFeedback(agentId: string, feedbackIndex: number): Promise<string>
  appendResponse(
    agentId: string,
    clientAddress: string,
    feedbackIndex: number,
    uri: string,
    hash: string,
  ): Promise<string>
  getReputationSummary(
    agentId: string,
    tag1?: string,
    tag2?: string,
  ): Promise<Agent0ReputationSummary>
}

// Configuration

export interface Agent0ContractAddresses {
  identityRegistry: Address
  reputationSystem: Address
  chainId: number
  network: string
}

export type Agent0Network = 'sepolia' | 'mainnet' | 'localnet'

export interface Agent0ClientConfig {
  network: Agent0Network
  rpcUrl: string
  privateKey?: string
  ipfsProvider?: 'node' | 'filecoinPin' | 'pinata'
  ipfsNodeUrl?: string
  pinataJwt?: string
  filecoinPrivateKey?: string
  subgraphUrl?: string
  registryOverrides?: Record<number, { REPUTATION: Address; IDENTITY: Address }>
}
