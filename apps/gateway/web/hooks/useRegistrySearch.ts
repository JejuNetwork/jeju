import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AgentSearchResult,
  getPopularTags,
  type SearchParams,
  type SearchResult,
  searchRegistry,
} from '../../api/services/indexer-search'
import { INDEXER_URL } from '../../lib/config'

/** Raw GraphQL response for registered agent */
interface GraphQLAgent {
  id?: string
  agentId?: string
  owner?: { address?: string }
  name?: string
  description?: string
  tags?: string[]
  tokenURI?: string
  stakeToken?: string
  stakeAmount?: string
  stakeTier?: number
  registeredAt?: string
  active?: boolean
  isBanned?: boolean
  a2aEndpoint?: string
  mcpEndpoint?: string
  serviceType?: string
  category?: string
  x402Support?: boolean
  mcpTools?: string[]
  a2aSkills?: string[]
  image?: string
}

export interface UseRegistrySearchOptions {
  initialParams?: SearchParams
  debounceMs?: number
  autoFetch?: boolean
}

export interface UseRegistrySearchReturn {
  results: SearchResult | null
  agents: AgentSearchResult[]
  isLoading: boolean
  error: Error | null
  search: (params: SearchParams) => Promise<void>
  refetch: () => Promise<void>
  setQuery: (query: string) => void
  query: string
  tags: Array<{ tag: string; count: number }>
}

async function performSearch(
  searchParams: SearchParams,
): Promise<SearchResult> {
  // Try REST API first
  const restResult = await searchRegistry(searchParams)
  if (restResult) return restResult

  // GraphQL fallback
  const whereConditions: string[] = []
  if (searchParams.query)
    whereConditions.push(`name_containsInsensitive: "${searchParams.query}"`)
  if (searchParams.tags?.length)
    whereConditions.push(
      `tags_containsAll: ${JSON.stringify(searchParams.tags)}`,
    )
  if (searchParams.category && searchParams.category !== 'all')
    whereConditions.push(`category_eq: "${searchParams.category}"`)
  if (searchParams.active !== false)
    whereConditions.push(`active_eq: true, isBanned_eq: false`)

  const whereClause =
    whereConditions.length > 0 ? `where: { ${whereConditions.join(', ')} }` : ''

  const gqlQuery = `
    query SearchAgents {
      registeredAgents(
        limit: ${searchParams.limit || 50}
        offset: ${searchParams.offset || 0}
        orderBy: stakeTier_DESC
        ${whereClause}
      ) {
        id agentId owner { address } name description tags tokenURI stakeToken stakeAmount stakeTier registeredAt active isBanned a2aEndpoint mcpEndpoint serviceType category x402Support mcpTools a2aSkills image
      }
    }
  `

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gqlQuery }),
  })

  const result = await response.json()
  if (result.errors) throw new Error(result.errors[0].message)

  const rawAgents = (result.data?.registeredAgents || []) as GraphQLAgent[]
  const agents: AgentSearchResult[] = rawAgents.map((a) => ({
    agentId: String(a.agentId || a.id),
    name: a.name || `Agent #${a.id}`,
    description: a.description || null,
    tags: a.tags || [],
    serviceType: a.serviceType || null,
    category: a.category || null,
    endpoints: {
      a2a: a.a2aEndpoint || null,
      mcp: a.mcpEndpoint || null,
    },
    tools: {
      mcpTools: a.mcpTools || [],
      a2aSkills: a.a2aSkills || [],
    },
    stakeTier: a.stakeTier || 0,
    stakeAmount: String(a.stakeAmount || '0'),
    x402Support: a.x402Support || false,
    active: a.active !== false && !a.isBanned,
    isBanned: a.isBanned || false,
    registeredAt: a.registeredAt || new Date().toISOString(),
    score: a.stakeTier || 0,
  }))

  return {
    agents,
    providers: [],
    total: agents.length,
    facets: { tags: [], serviceTypes: [], endpointTypes: [] },
    query: searchParams.query || null,
    took: 0,
  }
}

export function useRegistrySearch(
  options: UseRegistrySearchOptions = {},
): UseRegistrySearchReturn {
  const { initialParams = {}, debounceMs = 300, autoFetch = true } = options

  const [query, setQueryState] = useState(initialParams.query || '')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const [params, setParams] = useState<SearchParams>(initialParams)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce query updates
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), debounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, debounceMs])

  // React Query for popular tags
  const { data: tags = [] } = useQuery({
    queryKey: ['registry-tags'],
    queryFn: getPopularTags,
    staleTime: 60000,
  })

  // React Query for search results
  const searchParams = { ...params, query: debouncedQuery }
  const {
    data: results = null,
    isLoading,
    error,
    refetch: refetchQuery,
  } = useQuery({
    queryKey: ['registry-search', searchParams],
    queryFn: () => performSearch(searchParams),
    enabled: autoFetch,
  })

  const search = useCallback(async (newParams: SearchParams) => {
    setParams(newParams)
    if (newParams.query !== undefined) {
      setQueryState(newParams.query)
      setDebouncedQuery(newParams.query)
    }
  }, [])

  const refetch = useCallback(async () => {
    await refetchQuery()
  }, [refetchQuery])

  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery)
  }, [])

  return {
    results,
    agents: results?.agents || [],
    isLoading,
    error: error as Error | null,
    search,
    refetch,
    setQuery,
    query,
    tags,
  }
}

export default useRegistrySearch
