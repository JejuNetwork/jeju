/**
 * Agent Discovery Service
 *
 * Merges local agent registry with Agent0 network discovery
 * to provide comprehensive agent search with full filter and pagination support.
 *
 * @packageDocumentation
 */

import { isAgent0Enabled } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { agentRegistry } from '../services/agent-registry.service'
import { type AgentRegistration, AgentStatus } from '../types/agent-registry'
import {
  getAgent0Client,
  type SearchFilters,
  type SearchOptions,
  type SearchResult,
} from './client'
import { type ReputationData, reputationBridge } from './reputation'

/**
 * Discovery filter
 */
export interface DiscoveryFilter {
  skills?: string[]
  strategies?: string[]
  markets?: string[]
  minReputation?: number
  active?: boolean
  x402Support?: boolean
  chains?: number[]
  mcp?: boolean
  a2a?: boolean
  includeExternal?: boolean
}

/**
 * Discovered agent profile
 */
export interface DiscoveredAgent {
  agentId: string
  tokenId: number
  address: string
  name: string
  endpoint: string
  capabilities: {
    strategies: string[]
    markets: string[]
    actions: string[]
    version: string
    skills: string[]
    domains: string[]
  }
  reputation: ReputationData
  isActive: boolean
  source: 'local' | 'agent0'
}

/**
 * Discovery response
 */
export interface DiscoveryResponse<T> {
  items: T[]
  nextCursor?: string
  meta?: {
    chains: number[]
    totalResults: number
  }
}

/**
 * Agent Discovery Service
 *
 * Discovers agents from both local registry and Agent0 network.
 */
export class AgentDiscoveryService {
  /**
   * Discover agents matching filter
   */
  async discoverAgents(
    filter: DiscoveryFilter,
    options?: SearchOptions,
  ): Promise<DiscoveryResponse<DiscoveredAgent>> {
    logger.debug('Discovering agents', {
      hasStrategies: (filter.strategies?.length ?? 0) > 0,
      hasSkills: (filter.skills?.length ?? 0) > 0,
      minReputation: filter.minReputation ?? 0,
      pageSize: options?.pageSize ?? 10,
    })

    const results: DiscoveredAgent[] = []
    let nextCursor: string | undefined

    // Search local registry
    const localAgents = await agentRegistry.discoverAgents(
      filter.active !== false ? { statuses: [AgentStatus.ACTIVE] } : {},
    )

    // Filter and map local agents
    const filteredLocal = localAgents.filter((agent) => {
      // Apply strategy filter
      if (filter.strategies && filter.strategies.length > 0) {
        const agentStrategies = agent.capabilities?.strategies ?? []
        const hasMatchingStrategy = filter.strategies.some((s) =>
          agentStrategies.includes(s),
        )
        if (!hasMatchingStrategy) return false
      }

      // Apply skills filter
      if (filter.skills && filter.skills.length > 0) {
        const agentSkills = agent.capabilities?.skills ?? []
        const hasMatchingSkill = filter.skills.some((s) =>
          agentSkills.includes(s),
        )
        if (!hasMatchingSkill) return false
      }

      // Apply reputation filter
      if (filter.minReputation !== undefined) {
        const score =
          agent.onChainData?.reputationScore ?? agent.trustLevel * 25
        if (score < filter.minReputation) return false
      }

      // Apply x402Support filter
      if (filter.x402Support !== undefined) {
        const hasX402 = agent.capabilities?.x402Support ?? false
        if (filter.x402Support !== hasX402) return false
      }

      return true
    })

    results.push(...filteredLocal.map((r) => this.mapLocalToDiscovered(r)))

    // Search Agent0 network if enabled
    if (filter.includeExternal && isAgent0Enabled()) {
      const agent0Client = getAgent0Client()

      if (agent0Client.isAvailable()) {
        try {
          const searchFilters: SearchFilters = {
            skills: filter.skills,
            strategies: filter.strategies,
            markets: filter.markets,
            minReputation: filter.minReputation,
            active: filter.active,
            x402Support: filter.x402Support,
            chains: filter.chains,
            mcp: filter.mcp,
            a2a: filter.a2a,
          }

          const searchResponse = await agent0Client.searchAgents(
            searchFilters,
            options,
          )

          for (const agent0Data of searchResponse.items) {
            const profile = await this.mapAgent0ToDiscovered(agent0Data)
            results.push(profile)
          }

          nextCursor = searchResponse.nextCursor
        } catch (error) {
          logger.warn('Agent0 search failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // Deduplicate and sort
    const deduplicated = this.deduplicateAndSort(results)

    return {
      items: deduplicated,
      nextCursor,
    }
  }

  /**
   * Get agent by ID (searches both local and external)
   */
  async getAgent(agentId: string): Promise<DiscoveredAgent | null> {
    logger.debug(`Getting agent: ${agentId}`)

    // Try Agent0 network first for agent0- prefixed IDs
    if (agentId.startsWith('agent0-')) {
      const tokenId = Number.parseInt(agentId.replace('agent0-', ''), 10)

      if (isAgent0Enabled()) {
        const agent0Client = getAgent0Client()
        if (agent0Client.isAvailable()) {
          try {
            const profile = await agent0Client.getAgentProfile(tokenId)
            if (profile) {
              return {
                agentId: `agent0-${profile.tokenId}`,
                tokenId: profile.tokenId,
                address: profile.walletAddress,
                name: profile.name,
                endpoint: '',
                capabilities: {
                  strategies: profile.capabilities?.strategies ?? [],
                  markets: profile.capabilities?.markets ?? [],
                  actions: profile.capabilities?.actions ?? [],
                  version: profile.capabilities?.version ?? '1.0.0',
                  skills: profile.capabilities?.skills ?? [],
                  domains: profile.capabilities?.domains ?? [],
                },
                reputation: {
                  totalBets: 0,
                  winningBets: 0,
                  accuracyScore: profile.reputation.accuracyScore,
                  trustScore: profile.reputation.trustScore,
                  totalVolume: '0',
                  profitLoss: 0,
                  isBanned: false,
                },
                isActive: profile.active ?? true,
                source: 'agent0',
              }
            }
          } catch (error) {
            logger.warn('Agent0 profile lookup failed', {
              agentId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      return null
    }

    // Search local registry
    const localAgents = await agentRegistry.discoverAgents({})
    const localAgent = localAgents.find((a) => a.agentId === agentId)

    if (localAgent) {
      return this.mapLocalToDiscovered(localAgent)
    }

    return null
  }

  /**
   * Map local agent to discovered agent
   */
  private mapLocalToDiscovered(agent: AgentRegistration): DiscoveredAgent {
    return {
      agentId: agent.agentId,
      tokenId: agent.onChainData?.tokenId ?? 0,
      address: agent.onChainData?.serverWallet ?? '',
      name: agent.name,
      endpoint: agent.capabilities?.a2aEndpoint ?? '',
      capabilities: {
        strategies: agent.capabilities?.strategies ?? [],
        markets: agent.capabilities?.markets ?? [],
        actions: agent.capabilities?.actions ?? [],
        version: agent.capabilities?.version ?? '1.0.0',
        skills: agent.capabilities?.skills ?? [],
        domains: agent.capabilities?.domains ?? [],
      },
      reputation: {
        totalBets: 0,
        winningBets: 0,
        accuracyScore: 0,
        trustScore: agent.onChainData?.reputationScore ?? agent.trustLevel * 25,
        totalVolume: '0',
        profitLoss: 0,
        isBanned: false,
      },
      isActive: agent.status === 'ACTIVE',
      source: 'local',
    }
  }

  /**
   * Map Agent0 search result to discovered agent
   */
  private async mapAgent0ToDiscovered(
    result: SearchResult,
  ): Promise<DiscoveredAgent> {
    let reputation: ReputationData

    try {
      reputation = await reputationBridge.getAggregatedReputation(
        result.tokenId,
      )
    } catch {
      reputation = {
        totalBets: 0,
        winningBets: 0,
        accuracyScore: result.reputation.accuracyScore,
        trustScore: result.reputation.trustScore,
        totalVolume: '0',
        profitLoss: 0,
        isBanned: false,
      }
    }

    return {
      agentId: `agent0-${result.tokenId}`,
      tokenId: result.tokenId,
      address: result.walletAddress,
      name: result.name,
      endpoint: '',
      capabilities: {
        strategies: result.capabilities?.strategies ?? [],
        markets: result.capabilities?.markets ?? [],
        actions: result.capabilities?.actions ?? [],
        version: result.capabilities?.version ?? '1.0.0',
        skills: result.capabilities?.skills ?? [],
        domains: result.capabilities?.domains ?? [],
      },
      reputation,
      isActive: result.active ?? true,
      source: 'agent0',
    }
  }

  /**
   * Deduplicate agents by address and sort by reputation
   */
  private deduplicateAndSort(agents: DiscoveredAgent[]): DiscoveredAgent[] {
    const seen = new Map<string, DiscoveredAgent>()

    for (const agent of agents) {
      const address = agent.address.toLowerCase()
      const existing = seen.get(address)

      // Prefer local agents over Agent0 agents
      if (!existing || agent.source === 'local') {
        seen.set(address, agent)
      }
    }

    // Sort by trust score (descending)
    return Array.from(seen.values()).sort(
      (a, b) => b.reputation.trustScore - a.reputation.trustScore,
    )
  }
}

/** Singleton instance */
export const agentDiscoveryService = new AgentDiscoveryService()
