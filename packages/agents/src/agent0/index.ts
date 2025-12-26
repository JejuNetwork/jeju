/**
 * Agent0 SDK Integration
 *
 * Requirements:
 * - Subgraph URL (AGENT0_SUBGRAPH_URL) required for search operations
 * - Private key required for write operations (registration, feedback, transfer)
 * - IPFS provider config: 'node' (default), 'pinata' (requires JWT), 'filecoinPin' (requires key)
 */

export { Agent0Client, createAgent0Client, getAgent0Client, ratingToScore, resetAgent0Client, setContractAddressesProvider } from './client'
export { AgentDiscoveryService, agentDiscoveryService, type DiscoveredAgent, type DiscoveryFilter, type DiscoveryResponse } from './discovery'
export { type Agent0ReputationSummary, type LocalReputationProvider, ReputationBridge, type ReputationData, reputationBridge, safeBigInt, setLocalReputationProvider } from './reputation'

export type {
  Agent0AgentProfile, Agent0AgentUpdateParams, Agent0ClientConfig, Agent0ContractAddresses, Agent0Endpoint,
  Agent0Feedback, Agent0FeedbackParams, Agent0FeedbackSearchParams, Agent0Network, Agent0RegistrationParams,
  Agent0RegistrationResult, Agent0SearchFilters, Agent0SearchOptions, Agent0SearchResponse, Agent0SearchResult,
  Agent0SearchResultMeta, Agent0TransferResult, AggregatedReputation, AgentProfile, AgentReputation,
  DiscoveryFilters, IAgent0Client, IAgent0FeedbackService, IAgentDiscoveryService, IReputationBridge,
} from './types'
