/**
 * Agent Discovery - merges local registry with Agent0 network
 */

import { isAgent0Enabled } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { agentRegistry } from '../services/agent-registry.service'
import { type AgentRegistration, AgentStatus } from '../types/agent-registry'
import { getAgent0Client } from './client'
import { type ReputationData, reputationBridge } from './reputation'
import type { Agent0SearchOptions, Agent0SearchResult } from './types'

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

export interface DiscoveryResponse<T> {
  items: T[]
  nextCursor?: string
  meta?: { chains: number[]; totalResults: number }
}

const DEFAULT_CAPS = {
  strategies: [],
  markets: [],
  actions: [],
  version: '1.0.0',
  skills: [],
  domains: [],
}

export class AgentDiscoveryService {
  async discoverAgents(
    filter: DiscoveryFilter,
    options?: Agent0SearchOptions,
  ): Promise<DiscoveryResponse<DiscoveredAgent>> {
    logger.debug('Discovering agents', {
      strategies: !!filter.strategies?.length,
      skills: !!filter.skills?.length,
    })

    const results: DiscoveredAgent[] = []
    let nextCursor: string | undefined

    // Local agents
    const localAgents = await agentRegistry.discoverAgents(
      filter.active !== false ? { statuses: [AgentStatus.ACTIVE] } : {},
    )

    const filtered = localAgents.filter((a) => {
      if (
        filter.strategies?.length &&
        !filter.strategies.some((s) => a.capabilities?.strategies?.includes(s))
      )
        return false
      if (
        filter.skills?.length &&
        !filter.skills.some((s) => a.capabilities?.skills?.includes(s))
      )
        return false
      if (
        filter.minReputation !== undefined &&
        (a.onChainData?.reputationScore ?? a.trustLevel * 25) <
          filter.minReputation
      )
        return false
      if (
        filter.x402Support !== undefined &&
        (a.capabilities?.x402Support ?? false) !== filter.x402Support
      )
        return false
      return true
    })

    results.push(...(await Promise.all(filtered.map((a) => this.mapLocal(a)))))

    // External agents
    if (filter.includeExternal && isAgent0Enabled()) {
      const client = getAgent0Client()
      if (client.isAvailable()) {
        const search = await client.searchAgents(
          {
            skills: filter.skills,
            strategies: filter.strategies,
            markets: filter.markets,
            minReputation: filter.minReputation,
            active: filter.active,
            x402Support: filter.x402Support,
            chains: filter.chains,
            mcp: filter.mcp,
            a2a: filter.a2a,
          },
          options,
        )

        results.push(
          ...(await Promise.all(search.items.map((a) => this.mapAgent0(a)))),
        )
        nextCursor = search.nextCursor
      }
    }

    return { items: this.deduplicateAndSort(results), nextCursor }
  }

  async getAgent(agentId: string): Promise<DiscoveredAgent | null> {
    logger.debug('Getting agent', { agentId })

    if (agentId.startsWith('agent0-')) {
      const tokenId = Number.parseInt(agentId.replace('agent0-', ''), 10)
      if (!isAgent0Enabled()) return null

      const client = getAgent0Client()
      if (!client.isAvailable()) return null

      const profile = await client.loadAgent(client.formatAgentId(tokenId))
      if (!profile) return null

      const reputation = await reputationBridge.getAggregatedReputation(tokenId)
      const endpoint =
        profile.endpoints?.find((e) => e.type === 'A2A')?.value ??
        profile.endpoints?.find((e) => e.type === 'MCP')?.value ??
        ''

      return {
        agentId: `agent0-${profile.tokenId}`,
        tokenId: profile.tokenId,
        address: profile.walletAddress,
        name: profile.name,
        endpoint,
        capabilities: { ...DEFAULT_CAPS, ...profile.capabilities },
        reputation,
        isActive: profile.active ?? true,
        source: 'agent0',
      }
    }

    const local = (await agentRegistry.discoverAgents({})).find(
      (a) => a.agentId === agentId,
    )
    return local ? this.mapLocal(local) : null
  }

  private async mapLocal(agent: AgentRegistration): Promise<DiscoveredAgent> {
    const reputation = agent.onChainData?.tokenId
      ? await reputationBridge.getAggregatedReputation(
          agent.onChainData.tokenId,
        )
      : {
          totalBets: 0,
          winningBets: 0,
          accuracyScore: 0,
          trustScore: agent.onChainData?.reputationScore
            ? agent.onChainData.reputationScore / 100
            : agent.trustLevel * 0.25,
          totalVolume: '0',
          profitLoss: 0,
          isBanned: false,
        }

    return {
      agentId: agent.agentId,
      tokenId: agent.onChainData?.tokenId ?? 0,
      address: agent.onChainData?.serverWallet ?? '',
      name: agent.name,
      endpoint:
        agent.capabilities?.a2aEndpoint ??
        agent.discoveryMetadata?.endpoints?.a2a ??
        agent.discoveryMetadata?.endpoints?.mcp ??
        '',
      capabilities: { ...DEFAULT_CAPS, ...agent.capabilities },
      reputation,
      isActive: agent.status === 'ACTIVE',
      source: 'local',
    }
  }

  private async mapAgent0(
    result: Agent0SearchResult,
  ): Promise<DiscoveredAgent> {
    return {
      agentId: `agent0-${result.tokenId}`,
      tokenId: result.tokenId,
      address: result.walletAddress,
      name: result.name,
      endpoint: '', // Use loadAgent for full endpoint details
      capabilities: { ...DEFAULT_CAPS, ...result.capabilities },
      reputation: await reputationBridge.getAggregatedReputation(
        result.tokenId,
      ),
      isActive: result.active ?? true,
      source: 'agent0',
    }
  }

  private deduplicateAndSort(agents: DiscoveredAgent[]): DiscoveredAgent[] {
    const byAddress = new Map<string, DiscoveredAgent>()
    for (const agent of agents) {
      const key = agent.address.toLowerCase()
      if (!byAddress.has(key) || agent.source === 'local')
        byAddress.set(key, agent)
    }
    return [...byAddress.values()].sort(
      (a, b) => b.reputation.trustScore - a.reputation.trustScore,
    )
  }
}

export const agentDiscoveryService = new AgentDiscoveryService()
