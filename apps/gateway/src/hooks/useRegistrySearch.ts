import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  searchRegistry, 
  getPopularTags, 
  SearchParams, 
  SearchResult, 
  AgentSearchResult 
} from '../services/indexer-search';
import { INDEXER_URL } from '../config';

export interface UseRegistrySearchOptions {
  initialParams?: SearchParams;
  debounceMs?: number;
  autoFetch?: boolean;
}

export interface UseRegistrySearchReturn {
  results: SearchResult | null;
  agents: AgentSearchResult[];
  isLoading: boolean;
  error: Error | null;
  search: (params: SearchParams) => Promise<void>;
  refetch: () => Promise<void>;
  setQuery: (query: string) => void;
  query: string;
  tags: Array<{ tag: string; count: number }>;
}

export function useRegistrySearch(options: UseRegistrySearchOptions = {}): UseRegistrySearchReturn {
  const { initialParams = {}, debounceMs = 300, autoFetch = true } = options;
  
  const [results, setResults] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQueryState] = useState(initialParams.query || '');
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [params, setParams] = useState<SearchParams>(initialParams);
  
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch popular tags on mount
  useEffect(() => {
    getPopularTags()
      .then(setTags)
      .catch(err => console.warn('Failed to fetch tags:', err));
  }, []);

  const performSearch = useCallback(async (searchParams: SearchParams) => {
    setIsLoading(true);
    setError(null);
    
    // Try REST API first, fallback to GraphQL
    const restSearch = async () => {
      const result = await searchRegistry(searchParams);
      setResults(result);
      return result;
    };

    const graphqlFallback = async () => {
      // GraphQL fallback for when REST API is not available
      const whereConditions: string[] = [];
      if (searchParams.query) whereConditions.push(`name_containsInsensitive: "${searchParams.query}"`);
      if (searchParams.tags?.length) whereConditions.push(`tags_containsAll: ${JSON.stringify(searchParams.tags)}`);
      if (searchParams.category && searchParams.category !== 'all') whereConditions.push(`category_eq: "${searchParams.category}"`);
      if (searchParams.active !== false) whereConditions.push(`active_eq: true, isBanned_eq: false`);
      
      const whereClause = whereConditions.length > 0 ? `where: { ${whereConditions.join(', ')} }` : '';
      
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
      `;

      const response = await fetch(INDEXER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gqlQuery }),
      });

      const result = await response.json();
      if (result.errors) throw new Error(result.errors[0].message);

      const agents: AgentSearchResult[] = (result.data?.registeredAgents || []).map((a: Record<string, unknown>) => ({
        agentId: String(a.agentId || a.id),
        name: (a.name as string) || `Agent #${a.id}`,
        description: a.description as string || null,
        tags: (a.tags as string[]) || [],
        serviceType: a.serviceType as string || null,
        category: a.category as string || null,
        endpoints: {
          a2a: a.a2aEndpoint as string || null,
          mcp: a.mcpEndpoint as string || null,
        },
        tools: {
          mcpTools: (a.mcpTools as string[]) || [],
          a2aSkills: (a.a2aSkills as string[]) || [],
        },
        stakeTier: (a.stakeTier as number) || 0,
        stakeAmount: String(a.stakeAmount || '0'),
        x402Support: a.x402Support as boolean || false,
        active: a.active !== false && !a.isBanned,
        isBanned: a.isBanned as boolean || false,
        registeredAt: a.registeredAt as string || new Date().toISOString(),
        score: (a.stakeTier as number) || 0,
      }));

      const fallbackResult: SearchResult = {
        agents,
        providers: [],
        total: agents.length,
        facets: {
          tags: [],
          serviceTypes: [],
          endpointTypes: [],
        },
        query: searchParams.query || null,
        took: 0,
      };
      
      setResults(fallbackResult);
      return fallbackResult;
    };

    try {
      await restSearch();
    } catch (restError) {
      console.warn('REST API failed, falling back to GraphQL:', restError);
      await graphqlFallback().catch(setError);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const search = useCallback(async (newParams: SearchParams) => {
    setParams(newParams);
    await performSearch(newParams);
  }, [performSearch]);

  const refetch = useCallback(async () => {
    await performSearch(params);
  }, [performSearch, params]);

  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);
    
    // Debounce the search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      setParams(prev => ({ ...prev, query: newQuery }));
      performSearch({ ...params, query: newQuery });
    }, debounceMs);
  }, [params, performSearch, debounceMs]);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      performSearch(initialParams);
    }
    
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    results,
    agents: results?.agents || [],
    isLoading,
    error,
    search,
    refetch,
    setQuery,
    query,
    tags,
  };
}

export default useRegistrySearch;
