/**
 * Search utilities for indexer
 * SQLit-based search implementation
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/cache'
import {
  type ComputeProvider,
  count,
  find,
  query,
  type RegisteredAgent,
  type StorageProvider,
} from '../db'
import type { AgentSearchResult, ProviderResult, SearchResult } from './types'
import { type SearchParams, searchParamsSchema } from './validation'

export type { AgentSearchResult, ProviderResult, SearchResult }

const CACHE_TTL_SECONDS = 30

let searchCache: CacheClient | null = null

function getSearchCache(): CacheClient {
  if (!searchCache) {
    searchCache = getCacheClient('indexer-search')
  }
  return searchCache
}

function hashParams(params: SearchParams): string {
  return `search:${JSON.stringify(params)}`
}

function mapAgentToResult(
  agent: RegisteredAgent,
  score: number,
): AgentSearchResult {
  // Parse JSON tags if stored as string
  let tags: string[] = []
  if (typeof agent.tags === 'string') {
    try {
      tags = JSON.parse(agent.tags)
    } catch {
      tags = []
    }
  } else if (Array.isArray(agent.tags)) {
    tags = agent.tags
  }

  // Parse JSON skills if stored as string
  let mcpTools: string[] = []
  let a2aSkills: string[] = []
  if (typeof agent.mcpTools === 'string') {
    try {
      mcpTools = JSON.parse(agent.mcpTools)
    } catch {
      mcpTools = []
    }
  } else if (Array.isArray(agent.mcpTools)) {
    mcpTools = agent.mcpTools
  }
  if (typeof agent.a2aSkills === 'string') {
    try {
      a2aSkills = JSON.parse(agent.a2aSkills)
    } catch {
      a2aSkills = []
    }
  } else if (Array.isArray(agent.a2aSkills)) {
    a2aSkills = agent.a2aSkills
  }

  return {
    agentId: agent.agentId.toString(),
    name: agent.name ?? 'Unnamed Agent',
    description: agent.description ?? null,
    tags,
    serviceType: agent.serviceType ?? null,
    category: agent.category ?? null,
    endpoints: {
      a2a: agent.a2aEndpoint ?? null,
      mcp: agent.mcpEndpoint ?? null,
    },
    tools: {
      mcpTools,
      a2aSkills,
    },
    stakeTier: agent.stakeTier,
    stakeAmount: agent.stakeAmount,
    x402Support: agent.x402Support,
    active: agent.active,
    isBanned: agent.isBanned,
    registeredAt: agent.registeredAt ?? new Date().toISOString(),
    score,
  }
}

/**
 * Search for agents and providers
 */
export async function search(
  params: Partial<SearchParams> = {},
): Promise<SearchResult> {
  const validated = searchParamsSchema.parse(params)
  const startTime = Date.now()
  const searchQuery = validated.query
  const endpointType = validated.endpointType ?? 'all'
  const tags = validated.tags
  const category = validated.category
  const minStakeTier = validated.minStakeTier ?? 0
  const verified = validated.verified
  const active = validated.active ?? true
  const limit = validated.limit ?? 50
  const offset = validated.offset ?? 0

  const cacheKey = hashParams(validated)
  const cache = getSearchCache()
  const cached = await cache.get(cacheKey)
  if (cached) {
    try {
      const data = JSON.parse(cached) as SearchResult
      return { ...data, took: Date.now() - startTime }
    } catch {
      // Cache corrupted - refresh from DB
    }
  }

  // Build where clause for agents
  const where: Record<string, string | number | boolean | null> = {}
  if (active !== undefined) where.active = active
  if (category && category !== 'all') where.category = category

  let agents: RegisteredAgent[]
  const scores = new Map<string, number>()

  if (searchQuery?.trim()) {
    // Sanitize search query - escape SQL LIKE special characters to prevent injection
    const sanitizedQuery = searchQuery
      .replace(/[%_\\]/g, (char) => `\\${char}`) // Escape LIKE wildcards
      .slice(0, 100) // Limit length to prevent DoS
    const searchPattern = `%${sanitizedQuery}%`
    const result = await query<RegisteredAgent>(
      `SELECT * FROM registered_agent 
       WHERE active = ? AND (
         name LIKE ? ESCAPE '\\' OR 
         description LIKE ? ESCAPE '\\' OR 
         tags LIKE ? ESCAPE '\\'
       )
       ORDER BY stake_amount DESC
       LIMIT ? OFFSET ?`,
      [
        active ? 1 : 0,
        searchPattern,
        searchPattern,
        searchPattern,
        limit,
        offset,
      ],
    )
    agents = result.rows
    for (const a of agents) {
      scores.set(a.id, a.stakeTier / 4)
    }
  } else {
    agents = await find<RegisteredAgent>('RegisteredAgent', {
      where,
      order: { stakeAmount: 'DESC' },
      take: limit,
      skip: offset,
    })
    for (const a of agents) {
      scores.set(a.id, a.stakeTier / 4)
    }
  }

  // Filter by endpoint type
  if (endpointType === 'a2a') {
    agents = agents.filter((a) => a.a2aEndpoint)
  } else if (endpointType === 'mcp') {
    agents = agents.filter((a) => a.mcpEndpoint)
  } else if (endpointType === 'rest') {
    agents = agents.filter((a) => a.serviceType === 'rest')
  }

  // Filter by min stake tier
  if (minStakeTier > 0) {
    agents = agents.filter((a) => a.stakeTier >= minStakeTier)
  }

  // Filter by verified (has stake)
  if (verified) {
    agents = agents.filter((a) => BigInt(a.stakeAmount) > 0n)
  }

  // Filter by tags
  if (tags && tags.length > 0) {
    agents = agents.filter((a) => {
      let agentTags: string[] = []
      if (typeof a.tags === 'string') {
        try {
          agentTags = JSON.parse(a.tags)
        } catch {
          agentTags = []
        }
      } else if (Array.isArray(a.tags)) {
        agentTags = a.tags
      }
      return tags.some((t) => agentTags.includes(t))
    })
  }

  const providers: ProviderResult[] = []

  if (endpointType === 'all' || endpointType === 'rest') {
    const providerLimit = Math.max(10, Math.floor(limit / 4))

    const [computeProviders, storageProviders] = await Promise.all([
      find<ComputeProvider>('ComputeProvider', {
        where: { isActive: true },
        take: providerLimit,
      }),
      find<StorageProvider>('StorageProvider', {
        where: { isActive: true },
        take: providerLimit,
      }),
    ])

    const mapProvider = (
      p: ComputeProvider | StorageProvider,
      type: 'compute' | 'storage',
    ): ProviderResult => ({
      providerId: `${type}:${p.providerAddress}`,
      type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} Provider`,
      endpoint: '',
      agentId: p.agentId ?? null,
      isActive: p.isActive,
      isVerified: (p.agentId ?? 0) > 0,
      score: p.agentId ? 0.8 : 0.5,
    })

    providers.push(
      ...computeProviders.map((p) => mapProvider(p, 'compute')),
      ...storageProviders.map((p) => mapProvider(p, 'storage')),
    )
  }

  // Get service type counts
  const totalAgents = await count('RegisteredAgent', { active: true })
  const a2aCount =
    (
      await query<{ count: number }>(
        'SELECT COUNT(*) as count FROM registered_agent WHERE active = 1 AND a2a_endpoint IS NOT NULL',
        [],
      )
    ).rows[0]?.count ?? 0
  const mcpCount =
    (
      await query<{ count: number }>(
        'SELECT COUNT(*) as count FROM registered_agent WHERE active = 1 AND mcp_endpoint IS NOT NULL',
        [],
      )
    ).rows[0]?.count ?? 0
  const restCount =
    (
      await query<{ count: number }>(
        "SELECT COUNT(*) as count FROM registered_agent WHERE active = 1 AND service_type = 'rest'",
        [],
      )
    ).rows[0]?.count ?? 0

  const agentResults = agents
    .map((a) => mapAgentToResult(a, scores.get(a.id) ?? 0))
    .sort((a, b) => b.score - a.score)
  providers.sort((a, b) => b.score - a.score)

  const result: SearchResult = {
    agents: agentResults,
    providers,
    total: totalAgents + providers.length,
    facets: {
      tags: [], // Would need separate tag index table for this
      serviceTypes: [],
      endpointTypes: [
        { type: 'a2a', count: a2aCount },
        { type: 'mcp', count: mcpCount },
        { type: 'rest', count: restCount },
      ],
    },
    query: searchQuery ?? null,
    took: Date.now() - startTime,
  }

  await cache.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS)
  return result
}

/**
 * Get agent by ID
 */
export async function getAgentById(
  agentId: string,
): Promise<AgentSearchResult | null> {
  if (!agentId) {
    throw new Error('agentId must be a non-empty string')
  }
  if (!/^\d+$/.test(agentId)) {
    throw new Error(
      `Invalid agentId format: ${agentId}. Must be a numeric string.`,
    )
  }

  const agents = await find<RegisteredAgent>('RegisteredAgent', {
    where: { agentId: parseInt(agentId, 10) },
    take: 1,
  })

  const agent = agents[0]
  return agent ? mapAgentToResult(agent, 1) : null
}

/**
 * Get popular tags
 */
export async function getPopularTags(
  limit = 50,
): Promise<Array<{ tag: string; count: number }>> {
  if (typeof limit !== 'number' || limit <= 0 || limit > 1000) {
    throw new Error(`Invalid limit: ${limit}. Must be between 1 and 1000.`)
  }

  // Query all agents and aggregate tags
  const agents = await find<RegisteredAgent>('RegisteredAgent', {
    where: { active: true },
  })

  const tagCounts = new Map<string, number>()
  for (const agent of agents) {
    let tags: string[] = []
    if (typeof agent.tags === 'string') {
      try {
        tags = JSON.parse(agent.tags)
      } catch {
        tags = []
      }
    } else if (Array.isArray(agent.tags)) {
      tags = agent.tags
    }
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }))

  return sortedTags
}

/**
 * Invalidate search cache
 */
export async function invalidateSearchCache(): Promise<void> {
  const cache = getSearchCache()
  await cache.clear()
}
