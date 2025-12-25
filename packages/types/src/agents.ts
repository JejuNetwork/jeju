/**
 * Agent Types and Schemas
 *
 * Core type definitions for AI agents, capabilities, and networking.
 */

import { z } from 'zod'

/**
 * Game network information schema
 */
export const GameNetworkInfoSchema = z.object({
  chainId: z.number().int().positive(),
  registryAddress: z.string(),
  reputationAddress: z.string().optional().nullable(),
  marketAddress: z.string().optional().nullable(),
})
export type GameNetworkInfo = z.infer<typeof GameNetworkInfoSchema>

/**
 * Agent capabilities schema - defines what an agent can do
 */
export const AgentCapabilitiesSchema = z.object({
  strategies: z.array(z.string()).optional().default([]),
  markets: z.array(z.string()).optional().default([]),
  actions: z.array(z.string()).optional().default([]),
  version: z.string().optional().default('1.0.0'),
  x402Support: z.boolean().optional(),
  platform: z.string().optional().nullable(),
  userType: z.string().optional().nullable(),
  gameNetwork: GameNetworkInfoSchema.optional(),

  // OASF Taxonomy Support
  skills: z.array(z.string()).optional().default([]),
  domains: z.array(z.string()).optional().default([]),

  // A2A Communication Endpoints
  a2aEndpoint: z.string().optional().nullable(),
  mcpEndpoint: z.string().optional().nullable(),
})
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>

/**
 * Agent discovery profile for A2A communication
 */
export interface AgentDiscoveryProfile {
  agentId: string
  address: string
  capabilities: AgentCapabilities
  reputation?: number
}

/**
 * Agent authentication credentials
 */
export interface AgentAuth {
  agentId: string
  agentSecret: string
}

/**
 * Agent discovery query parameters
 */
export interface AgentDiscoveryQuery {
  strategies?: string
  markets?: string
  minReputation?: number
  external?: 'true' | 'false'
}
