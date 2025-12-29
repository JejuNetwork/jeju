import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { type DataSource, IsNull, Not } from 'typeorm'
import {
  ComputeProvider,
  RegisteredAgent,
  StorageProvider,
  TagIndex,
} from '../model'
import type { AgentSearchResult, ProviderResult, SearchResult } from './types'
import { type SearchParams, searchParamsSchema } from './validation'

export type { AgentSearchResult, ProviderResult, SearchResult }

/**
 * Escape special characters in SQL LIKE patterns to prevent injection
 * Escapes %, _, and \ which have special meaning in LIKE patterns
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, (char) => `\\${char}`)
}

const CACHE_TTL_SECONDS = 30

// Distributed cache for search results
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
  return {
    agentId: agent.agentId.toString(),
    name: agent.name ?? 'Unnamed Agent',
    description: agent.description ?? null,
    tags: agent.tags ?? [],
    serviceType: agent.serviceType ?? null,
    category: agent.category ?? null,
    endpoints: {
      a2a: agent.a2aEndpoint ?? null,
      mcp: agent.mcpEndpoint ?? null,
    },
    tools: {
      mcpTools: agent.mcpTools ?? [],
      a2aSkills: agent.a2aSkills ?? [],
    },
    stakeTier: agent.stakeTier,
    stakeAmount: agent.stakeAmount.toString(),
    x402Support: agent.x402Support,
    active: agent.active,
    isBanned: agent.isBanned,
    registeredAt: agent.registeredAt.toISOString(),
    score,
  }
}

export async function search(
  dataSource: DataSource,
  params: Partial<SearchParams> = {},
): Promise<SearchResult> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }

  const validated = searchParamsSchema.parse(params)
  const startTime = Date.now()
  const query = validated.query
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
    const data: SearchResult = JSON.parse(cached)
    return { ...data, took: Date.now() - startTime }
  }

  const agentRepo = dataSource.getRepository(RegisteredAgent)
  const computeRepo = dataSource.getRepository(ComputeProvider)
  const storageRepo = dataSource.getRepository(StorageProvider)
  const tagRepo = dataSource.getRepository(TagIndex)

  let agentQuery = agentRepo
    .createQueryBuilder('a')
    .leftJoinAndSelect('a.owner', 'owner')

  if (active !== undefined)
    agentQuery = agentQuery.andWhere('a.active = :active', { active })
  if (endpointType === 'a2a')
    agentQuery = agentQuery.andWhere('a.a2aEndpoint IS NOT NULL')
  else if (endpointType === 'mcp')
    agentQuery = agentQuery.andWhere('a.mcpEndpoint IS NOT NULL')
  else if (endpointType === 'rest')
    agentQuery = agentQuery.andWhere("a.serviceType = 'rest'")
  if (category && category !== 'all')
    agentQuery = agentQuery.andWhere('a.category = :category', { category })
  if (minStakeTier > 0)
    agentQuery = agentQuery.andWhere('a.stakeTier >= :minTier', {
      minTier: minStakeTier,
    })
  if (verified) agentQuery = agentQuery.andWhere('a.stakeAmount > 0')
  if (tags && tags.length > 0)
    agentQuery = agentQuery.andWhere('a.tags && :tags', { tags })

  let agents: RegisteredAgent[]
  const scores = new Map<string, number>()

  if (query?.trim()) {
    // Escape LIKE special chars to prevent SQL injection via pattern manipulation
    const escapedQuery = escapeLikePattern(query)
    const rawQuery = `
      SELECT a.*,
        ts_rank_cd(
          to_tsvector('english', COALESCE(a.name, '') || ' ' || COALESCE(a.description, '') || ' ' ||
            COALESCE(array_to_string(a.tags, ' '), '') || ' ' || COALESCE(array_to_string(a.mcp_tools, ' '), '') || ' ' ||
            COALESCE(array_to_string(a.a2a_skills, ' '), '')),
          plainto_tsquery('english', $1), 32
        ) * (1 + (a.stake_tier::float / 4)) as rank
      FROM registered_agent a
      WHERE a.active = $2 AND (
        to_tsvector('english', COALESCE(a.name, '') || ' ' || COALESCE(a.description, '') || ' ' ||
          COALESCE(array_to_string(a.tags, ' '), '')) @@ plainto_tsquery('english', $1)
        OR LOWER(a.name) LIKE LOWER($3) ESCAPE '\\' OR LOWER(a.description) LIKE LOWER($3) ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE LOWER(t) LIKE LOWER($3) ESCAPE '\\'))
      ORDER BY rank DESC, a.stake_tier DESC LIMIT $4 OFFSET $5`

    const results = (await dataSource.query(rawQuery, [
      query,
      active,
      `%${escapedQuery}%`,
      limit,
      offset,
    ])) as Array<RegisteredAgent & { rank: number }>
    agents = results.map((r) => {
      scores.set(r.id, r.rank)
      return r
    })
  } else {
    agents = await agentQuery
      .orderBy('a.stakeTier', 'DESC')
      .addOrderBy('a.registeredAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany()
    for (const a of agents) {
      scores.set(a.id, a.stakeTier / 4)
    }
  }

  const providers: ProviderResult[] = []

  if (endpointType === 'all' || endpointType === 'rest') {
    const providerLimit = Math.max(10, Math.floor(limit / 4))
    // Escape LIKE special chars for provider search
    const searchPattern = query ? `%${escapeLikePattern(query)}%` : null

    const buildQuery = (alias: string) => {
      const conditions = [`${alias}.isActive = :active`]
      const params: { active: boolean; q?: string } = { active }
      if (searchPattern) {
        conditions.push(
          `(LOWER(${alias}.name) LIKE LOWER(:q) ESCAPE '\\' OR LOWER(${alias}.endpoint) LIKE LOWER(:q) ESCAPE '\\')`,
        )
        params.q = searchPattern
      }
      return { where: conditions.join(' AND '), params }
    }

    const { where, params } = buildQuery('p')
    const [computeProviders, storageProviders] = await Promise.all([
      computeRepo
        .createQueryBuilder('p')
        .where(where, params)
        .take(providerLimit)
        .getMany(),
      storageRepo
        .createQueryBuilder('p')
        .where(where, params)
        .take(providerLimit)
        .getMany(),
    ])

    const mapProvider = (
      p: ComputeProvider | StorageProvider,
      type: 'compute' | 'storage',
    ): ProviderResult => ({
      providerId: `${type}:${p.address}`,
      type,
      name:
        p.name || `${type.charAt(0).toUpperCase() + type.slice(1)} Provider`,
      endpoint: p.endpoint,
      agentId: p.agentId || null,
      isActive: p.isActive,
      isVerified: (p.agentId ?? 0) > 0,
      score: p.agentId ? 0.8 : 0.5,
    })

    providers.push(
      ...computeProviders.map((p) => mapProvider(p, 'compute')),
      ...storageProviders.map((p) => mapProvider(p, 'storage')),
    )
  }

  const tagFacets = await tagRepo.find({
    order: { agentCount: 'DESC' },
    take: 20,
  })

  const serviceTypeCounts = (await agentRepo
    .createQueryBuilder('a')
    .select('a.serviceType', 'type')
    .addSelect('COUNT(*)', 'count')
    .where('a.active = true')
    .andWhere('a.serviceType IS NOT NULL')
    .groupBy('a.serviceType')
    .getRawMany()) as Array<{ type: string; count: string }>

  const [a2aCount, mcpCount, restCount] = await Promise.all([
    agentRepo.count({ where: { active: true, a2aEndpoint: Not(IsNull()) } }),
    agentRepo.count({ where: { active: true, mcpEndpoint: Not(IsNull()) } }),
    agentRepo.count({ where: { active: true, serviceType: 'rest' } }),
  ])

  const agentResults = agents
    .map((a) => mapAgentToResult(a, scores.get(a.id) ?? 0))
    .sort((a, b) => b.score - a.score)
  providers.sort((a, b) => b.score - a.score)

  const totalAgents = await agentRepo.count({ where: { active: true } })

  const result: SearchResult = {
    agents: agentResults,
    providers,
    total: totalAgents + providers.length,
    facets: {
      tags: tagFacets.map((t) => ({ tag: t.tag, count: t.agentCount })),
      serviceTypes: serviceTypeCounts.map((s) => ({
        type: s.type,
        count: parseInt(s.count, 10),
      })),
      endpointTypes: [
        { type: 'a2a', count: a2aCount },
        { type: 'mcp', count: mcpCount },
        { type: 'rest', count: restCount },
      ],
    },
    query: query ?? null,
    took: Date.now() - startTime,
  }

  // Store in distributed cache with TTL (no need for manual eviction - TTL handles it)
  await cache.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS)
  return result
}

export async function getAgentById(
  dataSource: DataSource,
  agentId: string,
): Promise<AgentSearchResult | null> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (!agentId) {
    throw new Error('agentId must be a non-empty string')
  }
  if (!/^\d+$/.test(agentId)) {
    throw new Error(
      `Invalid agentId format: ${agentId}. Must be a numeric string.`,
    )
  }

  const agentRepo = dataSource.getRepository(RegisteredAgent)
  const agent = await agentRepo.findOne({
    where: { agentId: BigInt(agentId) },
    relations: ['owner'],
  })

  return agent ? mapAgentToResult(agent, 1) : null
}

export async function getPopularTags(
  dataSource: DataSource,
  limit = 50,
): Promise<Array<{ tag: string; count: number }>> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof limit !== 'number' || limit <= 0 || limit > 1000) {
    throw new Error(`Invalid limit: ${limit}. Must be between 1 and 1000.`)
  }

  const tagRepo = dataSource.getRepository(TagIndex)
  const tags = await tagRepo.find({
    order: { agentCount: 'DESC' },
    take: limit,
  })

  return tags.map((t) => ({ tag: t.tag, count: t.agentCount }))
}

export async function invalidateSearchCache(): Promise<void> {
  const cache = getSearchCache()
  await cache.clear()
}
