/**
 * Smart Contract Type Definitions
 *
 * TypeScript interfaces for blockchain contract interactions
 */

/**
 * Contract method interfaces for Identity Registry
 */
export interface IdentityRegistryContract {
  getTokenId(address: string): Promise<bigint>
  ownerOf(tokenId: number): Promise<string>
  getAgentProfile(tokenId: number): Promise<AgentProfileResult>
  isRegistered(address: string): Promise<boolean>
  getAllActiveAgents(): Promise<bigint[]>
  isEndpointActive(endpoint: string): Promise<boolean>
  getAgentsByCapability(capabilityHash: string): Promise<bigint[]>
}

/**
 * Contract method interfaces for Reputation System
 */
export interface ReputationSystemContract {
  getReputation(tokenId: number): Promise<ReputationResult>
  getFeedbackCount(tokenId: number): Promise<bigint>
  getFeedback(tokenId: number, index: number): Promise<FeedbackResult>
  getAgentsByMinScore(minScore: number): Promise<bigint[]>
}

/**
 * Agent profile result from contract call
 */
export interface AgentProfileResult {
  name: string
  endpoint: string
  capabilitiesHash: string
  registeredAt: bigint
  isActive: boolean
  metadata: string
}

/**
 * Reputation result tuple from contract call
 */
export type ReputationResult = [
  bigint, // totalBets
  bigint, // winningBets
  bigint, // totalVolume
  bigint, // profitLoss
  bigint, // accuracyScore
  bigint, // trustScore
  boolean, // isBanned
]

/**
 * Feedback result from contract call
 */
export interface FeedbackResult {
  from: string
  rating: number // int8 mapped to number
  comment: string
  timestamp: bigint
}
