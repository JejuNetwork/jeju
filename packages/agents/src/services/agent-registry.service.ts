/**
 * Agent Registry Service
 *
 * Manages agent registration, discovery, and lifecycle in the unified registry.
 * Supports both user-controlled agents and external agents (ElizaOS, MCP, Agent0).
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { AgentCapabilities } from '@jejunetwork/types'
import type {
  AgentDiscoveryFilter,
  AgentRegistration,
  ExternalAgentConnectionParams,
} from '../types'
import { AgentStatus, AgentType, TrustLevel } from '../types'

/**
 * Parameters for registering a user-controlled agent
 */
export interface UserAgentRegistrationParams {
  userId: string
  name: string
  systemPrompt: string
  capabilities: AgentCapabilities
}

/**
 * Agent Registry Service
 *
 * Unified registry for all agent types with discovery and lifecycle management.
 */
export class AgentRegistryService {
  private agents: Map<string, AgentRegistration> = new Map()

  /**
   * Register a user-controlled agent
   */
  async registerUserAgent(
    params: UserAgentRegistrationParams,
  ): Promise<AgentRegistration> {
    logger.info('Registering user agent', {
      userId: params.userId,
      name: params.name,
    })

    const registration: AgentRegistration = {
      agentId: params.userId,
      type: AgentType.USER_CONTROLLED,
      status: AgentStatus.REGISTERED,
      trustLevel: TrustLevel.BASIC,
      userId: params.userId,
      name: params.name,
      systemPrompt: params.systemPrompt,
      capabilities: params.capabilities,
      discoveryMetadata: null,
      onChainData: null,
      agent0Data: null,
      runtimeInstanceId: null,
      registeredAt: new Date(),
      lastActiveAt: null,
      terminatedAt: null,
    }

    this.agents.set(params.userId, registration)
    return registration
  }

  /**
   * Register an external agent (ElizaOS, MCP, Agent0, etc)
   */
  async registerExternalAgent(
    params: ExternalAgentConnectionParams,
  ): Promise<AgentRegistration> {
    logger.info('Registering external agent', {
      externalId: params.externalId,
      name: params.name,
      protocol: params.protocol,
    })

    const registration: AgentRegistration = {
      agentId: params.externalId,
      type: AgentType.EXTERNAL,
      status: AgentStatus.REGISTERED,
      trustLevel: TrustLevel.UNTRUSTED,
      userId: null,
      name: params.name,
      systemPrompt: params.description,
      capabilities: params.capabilities,
      discoveryMetadata: params.agentCard ?? null,
      onChainData: null,
      agent0Data: null,
      runtimeInstanceId: null,
      registeredAt: new Date(),
      lastActiveAt: null,
      terminatedAt: null,
    }

    this.agents.set(params.externalId, registration)
    return registration
  }

  /**
   * Get an agent registration by ID
   */
  async getAgent(agentId: string): Promise<AgentRegistration | null> {
    return this.agents.get(agentId) ?? null
  }

  /**
   * Update agent status
   */
  async updateStatus(
    agentId: string,
    status: AgentStatus,
  ): Promise<AgentRegistration | null> {
    const agent = this.agents.get(agentId)
    if (!agent) return null

    agent.status = status
    if (status === AgentStatus.ACTIVE) {
      agent.lastActiveAt = new Date()
    } else if (status === AgentStatus.TERMINATED) {
      agent.terminatedAt = new Date()
    }

    return agent
  }

  /**
   * Discover agents matching filter criteria
   */
  async discoverAgents(
    filter: AgentDiscoveryFilter,
  ): Promise<AgentRegistration[]> {
    let results = Array.from(this.agents.values())

    if (filter.types?.length) {
      results = results.filter((a) => filter.types?.includes(a.type))
    }

    if (filter.statuses?.length) {
      results = results.filter((a) => filter.statuses?.includes(a.status))
    }

    if (filter.minTrustLevel !== undefined) {
      const minTrust = filter.minTrustLevel
      results = results.filter((a) => a.trustLevel >= minTrust)
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      results = results.filter(
        (a) =>
          a.name.toLowerCase().includes(searchLower) ||
          a.systemPrompt.toLowerCase().includes(searchLower),
      )
    }

    if (filter.requiredCapabilities?.length) {
      results = results.filter((a) => {
        const allActions = a.capabilities.actions ?? []
        return filter.requiredCapabilities?.every((cap) =>
          allActions.includes(cap),
        )
      })
    }

    // Pagination
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 100
    return results.slice(offset, offset + limit)
  }

  /**
   * Unregister an agent
   */
  async unregisterAgent(agentId: string): Promise<boolean> {
    const deleted = this.agents.delete(agentId)
    if (deleted) {
      logger.info('Agent unregistered', { agentId })
    }
    return deleted
  }

  /**
   * Get all registered agents
   */
  async getAllAgents(): Promise<AgentRegistration[]> {
    return Array.from(this.agents.values())
  }

  /**
   * Get agent count by type
   */
  async getAgentCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const agent of this.agents.values()) {
      counts[agent.type] = (counts[agent.type] ?? 0) + 1
    }
    return counts
  }
}

/** Singleton instance */
export const agentRegistry = new AgentRegistryService()
