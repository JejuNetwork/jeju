import { INDEXER_REST_URL } from '../config';

export type EndpointType = 'a2a' | 'mcp' | 'rest' | 'graphql' | 'all';
export type ServiceCategory = 'agent' | 'workflow' | 'app' | 'game' | 'oracle' | 'marketplace' | 'compute' | 'storage' | 'all';

export interface SearchParams {
  query?: string;
  endpointType?: EndpointType;
  tags?: string[];
  category?: ServiceCategory;
  minStakeTier?: number;
  verified?: boolean;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export interface AgentSearchResult {
  agentId: string;
  name: string;
  description: string | null;
  tags: string[];
  serviceType: string | null;
  category: string | null;
  endpoints: {
    a2a: string | null;
    mcp: string | null;
  };
  tools: {
    mcpTools: string[];
    a2aSkills: string[];
  };
  stakeTier: number;
  stakeAmount: string;
  x402Support: boolean;
  active: boolean;
  isBanned: boolean;
  registeredAt: string;
  score: number;
}

export interface ProviderResult {
  providerId: string;
  type: 'compute' | 'storage';
  name: string;
  endpoint: string;
  agentId: number | null;
  isActive: boolean;
  isVerified: boolean;
  score: number;
}

export interface SearchResult {
  agents: AgentSearchResult[];
  providers: ProviderResult[];
  total: number;
  facets: {
    tags: Array<{ tag: string; count: number }>;
    serviceTypes: Array<{ type: string; count: number }>;
    endpointTypes: Array<{ type: string; count: number }>;
  };
  query: string | null;
  took: number;
}

export interface IndexerStats {
  blocks: number;
  transactions: number;
  accounts: number;
  contracts: number;
  agents: number;
  nodes: number;
  latestBlock: number;
}

/**
 * Search agents and providers via REST API
 */
export async function searchRegistry(params: SearchParams = {}): Promise<SearchResult> {
  const searchParams = new URLSearchParams();
  
  if (params.query) searchParams.set('q', params.query);
  if (params.endpointType && params.endpointType !== 'all') searchParams.set('type', params.endpointType);
  if (params.tags?.length) searchParams.set('tags', params.tags.join(','));
  if (params.category && params.category !== 'all') searchParams.set('category', params.category);
  if (params.minStakeTier) searchParams.set('minTier', String(params.minStakeTier));
  if (params.verified) searchParams.set('verified', 'true');
  if (params.active !== undefined) searchParams.set('active', String(params.active));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));

  const response = await fetch(`${INDEXER_REST_URL}/search?${searchParams.toString()}`);
  
  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get agent by ID
 */
export async function getAgentById(agentId: string): Promise<AgentSearchResult | null> {
  const response = await fetch(`${INDEXER_REST_URL}/agents/${agentId}`);
  
  if (response.status === 404) {
    return null;
  }
  
  if (!response.ok) {
    throw new Error(`Failed to fetch agent: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get popular tags
 */
export async function getPopularTags(): Promise<Array<{ tag: string; count: number }>> {
  const response = await fetch(`${INDEXER_REST_URL}/tags`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch tags: ${response.statusText}`);
  }

  const data = await response.json();
  return data.tags;
}

/**
 * Get agents by tag
 */
export async function getAgentsByTag(tag: string, limit = 50): Promise<AgentSearchResult[]> {
  const response = await fetch(`${INDEXER_REST_URL}/agents/tag/${encodeURIComponent(tag)}?limit=${limit}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch agents by tag: ${response.statusText}`);
  }

  const data = await response.json();
  return data.agents;
}

/**
 * Get indexer stats
 */
export async function getIndexerStats(): Promise<IndexerStats> {
  const response = await fetch(`${INDEXER_REST_URL}/stats`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get rate limit info
 */
export async function getRateLimitInfo(): Promise<{
  tiers: Record<string, number>;
  thresholds: Record<string, { minUsd: number; limit: number | string }>;
}> {
  const response = await fetch(`${INDEXER_REST_URL}/rate-limits`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch rate limits: ${response.statusText}`);
  }

  return response.json();
}
