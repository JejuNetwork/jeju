/**
 * Indexer Types
 * Canonical types for indexer search functionality
 */

export type EndpointType = 'a2a' | 'mcp' | 'rest' | 'graphql' | 'all'

export type ServiceCategory =
  | 'agent'
  | 'workflow'
  | 'app'
  | 'game'
  | 'oracle'
  | 'marketplace'
  | 'compute'
  | 'storage'
  | 'all'

export interface SearchParams {
  query?: string
  endpointType?: EndpointType
  tags?: string[]
  category?: ServiceCategory
  minStakeTier?: number
  verified?: boolean
  active?: boolean
  limit?: number
  offset?: number
}

export interface AgentSearchResult {
  agentId: string
  name: string
  description: string | null
  tags: string[]
  serviceType: string | null
  category: string | null
  endpoints: {
    a2a: string | null
    mcp: string | null
  }
  tools: {
    mcpTools: string[]
    a2aSkills: string[]
  }
  stakeTier: number
  stakeAmount: string
  x402Support: boolean
  active: boolean
  isBanned: boolean
  registeredAt: string
  score: number
}

export interface ProviderResult {
  providerId: string
  type: 'compute' | 'storage'
  name: string
  endpoint: string
  agentId: number | null
  isActive: boolean
  isVerified: boolean
  score: number
}

export interface SearchResult {
  agents: AgentSearchResult[]
  providers: ProviderResult[]
  total: number
  facets: {
    tags: Array<{ tag: string; count: number }>
    serviceTypes: Array<{ type: string; count: number }>
    endpointTypes: Array<{ type: string; count: number }>
  }
  query: string | null
  took: number
}
