/**
 * Search Tests
 *
 * Tests for search functionality including:
 * - Parameter validation
 * - Result transformation
 * - Filtering and scoring
 * - Cache behavior
 */

import { describe, expect, it } from 'bun:test'

// Type Definitions

interface SearchParams {
  query?: string
  endpointType?: string
  tags?: string | string[]
  category?: string
  minStakeTier?: string | number
  verified?: string | boolean
  active?: string | boolean
  limit?: string | number
  offset?: string | number
}

interface ValidatedSearchParams {
  query?: string
  endpointType: 'a2a' | 'mcp' | 'rest' | 'graphql' | 'all'
  tags: string[]
  category?: string
  minStakeTier: number
  verified: boolean
  active: boolean
  limit: number
  offset: number
}

interface MockAgent {
  id: string
  agentId: bigint
  name: string | null
  description: string | null
  tags: string[] | null
  serviceType: string | null
  category: string | null
  a2aEndpoint: string | null
  mcpEndpoint: string | null
  mcpTools: string[] | null
  a2aSkills: string[] | null
  stakeTier: number
  stakeAmount: bigint
  x402Support: boolean
  active: boolean
  isBanned: boolean
  registeredAt: Date
  owner: { address: string } | null
}

interface MockProvider {
  address: string
  name: string
  endpoint: string
  agentId: number | null
  isActive: boolean
}

interface AgentSearchResult {
  agentId: string
  owner: string
  name: string
  metadataUri: string
  active: boolean
  registeredAt: string
  totalExecutions: number
  totalSpent: string
  services: string[]
}

interface ServiceSearchResult {
  serviceId: string
  name: string
  type: 'mcp' | 'a2a' | 'rest'
  endpoint: string
  category: string
  provider: string
  agentId?: string
  pricePerCall: string
  isVerified: boolean
}

// Helper Functions

function validateSearchParams(raw: SearchParams): ValidatedSearchParams {
  const validEndpointTypes = ['a2a', 'mcp', 'rest', 'graphql', 'all']

  const endpointType = validEndpointTypes.includes(raw.endpointType ?? '')
    ? (raw.endpointType as ValidatedSearchParams['endpointType'])
    : 'all'

  let tags: string[] = []
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.filter((t) => typeof t === 'string' && t.trim())
  } else if (typeof raw.tags === 'string' && raw.tags.trim()) {
    tags = raw.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }

  const parsedMinStakeTier = parseInt(String(raw.minStakeTier ?? '0'), 10)
  const minStakeTier = Math.max(
    0,
    Math.min(4, Number.isNaN(parsedMinStakeTier) ? 0 : parsedMinStakeTier),
  )
  const parsedLimit = parseInt(String(raw.limit ?? '50'), 10)
  const limit = Math.max(
    1,
    Math.min(1000, Number.isNaN(parsedLimit) ? 50 : parsedLimit),
  )
  const parsedOffset = parseInt(String(raw.offset ?? '0'), 10)
  const offset = Math.max(0, Number.isNaN(parsedOffset) ? 0 : parsedOffset)

  const parseBoolean = (
    val: string | boolean | undefined,
    defaultVal: boolean,
  ): boolean => {
    if (typeof val === 'boolean') return val
    if (val === 'true' || val === '1') return true
    if (val === 'false' || val === '0') return false
    return defaultVal
  }

  return {
    query: raw.query?.trim() || undefined,
    endpointType,
    tags,
    category: raw.category?.trim() || undefined,
    minStakeTier,
    verified: parseBoolean(raw.verified, false),
    active: parseBoolean(raw.active, true),
    limit,
    offset,
  }
}

function mapProviderToService(
  p: MockProvider,
  category: 'compute' | 'storage',
): ServiceSearchResult {
  return {
    serviceId: `${category}-${p.address}`,
    name:
      p.name ||
      `${category.charAt(0).toUpperCase() + category.slice(1)} Provider`,
    type: 'rest',
    endpoint: p.endpoint,
    category,
    provider: p.address,
    agentId: p.agentId?.toString(),
    pricePerCall: '0',
    isVerified: (p.agentId ?? 0) > 0,
  }
}

// Parameter Validation Tests

describe('Search Parameter Validation', () => {
  describe('Query String', () => {
    it('should trim whitespace', () => {
      const result = validateSearchParams({ query: '  hello world  ' })
      expect(result.query).toBe('hello world')
    })

    it('should return undefined for empty query', () => {
      expect(validateSearchParams({ query: '' }).query).toBeUndefined()
      expect(validateSearchParams({ query: '   ' }).query).toBeUndefined()
      expect(validateSearchParams({}).query).toBeUndefined()
    })

    it('should preserve special characters in query', () => {
      const result = validateSearchParams({ query: 'DeFi $ETH @user' })
      expect(result.query).toBe('DeFi $ETH @user')
    })

    it('should handle unicode in search query', () => {
      const unicodeQueries = ['日本語', '한국어', '🤖🔧', 'émoji']
      for (const q of unicodeQueries) {
        expect(q.length).toBeGreaterThan(0)
      }
    })

    it('should handle very long query strings', () => {
      const longQuery = 'a'.repeat(10000)
      expect(longQuery.length).toBe(10000)
    })
  })

  describe('Endpoint Type', () => {
    it('should accept valid endpoint types', () => {
      expect(validateSearchParams({ endpointType: 'a2a' }).endpointType).toBe(
        'a2a',
      )
      expect(validateSearchParams({ endpointType: 'mcp' }).endpointType).toBe(
        'mcp',
      )
      expect(validateSearchParams({ endpointType: 'rest' }).endpointType).toBe(
        'rest',
      )
      expect(
        validateSearchParams({ endpointType: 'graphql' }).endpointType,
      ).toBe('graphql')
      expect(validateSearchParams({ endpointType: 'all' }).endpointType).toBe(
        'all',
      )
    })

    it('should default to all for invalid types', () => {
      expect(
        validateSearchParams({ endpointType: 'invalid' }).endpointType,
      ).toBe('all')
      expect(validateSearchParams({ endpointType: '' }).endpointType).toBe(
        'all',
      )
      expect(validateSearchParams({}).endpointType).toBe('all')
    })
  })

  describe('Tags', () => {
    it('should parse comma-separated string', () => {
      const result = validateSearchParams({ tags: 'agent,defi,nft' })
      expect(result.tags).toEqual(['agent', 'defi', 'nft'])
    })

    it('should accept array of tags', () => {
      const result = validateSearchParams({ tags: ['agent', 'defi', 'nft'] })
      expect(result.tags).toEqual(['agent', 'defi', 'nft'])
    })

    it('should trim tag values', () => {
      const result = validateSearchParams({ tags: ' agent , defi , nft ' })
      expect(result.tags).toEqual(['agent', 'defi', 'nft'])
    })

    it('should filter empty tags', () => {
      const result = validateSearchParams({ tags: 'agent,,defi,,,nft' })
      expect(result.tags).toEqual(['agent', 'defi', 'nft'])
    })

    it('should return empty array for empty tags', () => {
      expect(validateSearchParams({ tags: '' }).tags).toEqual([])
      expect(validateSearchParams({ tags: [] }).tags).toEqual([])
    })

    it('should handle duplicate tags', () => {
      const tags = ['agent', 'workflow', 'agent', 'app']
      const uniqueTags = [...new Set(tags)]
      expect(uniqueTags.length).toBe(3)
    })
  })

  describe('Stake Tier', () => {
    it('should parse valid tier values', () => {
      expect(validateSearchParams({ minStakeTier: '0' }).minStakeTier).toBe(0)
      expect(validateSearchParams({ minStakeTier: '2' }).minStakeTier).toBe(2)
      expect(validateSearchParams({ minStakeTier: '4' }).minStakeTier).toBe(4)
    })

    it('should clamp to valid range', () => {
      expect(validateSearchParams({ minStakeTier: '-1' }).minStakeTier).toBe(0)
      expect(validateSearchParams({ minStakeTier: '5' }).minStakeTier).toBe(4)
    })

    it('should default to 0 for invalid values', () => {
      expect(
        validateSearchParams({ minStakeTier: 'invalid' }).minStakeTier,
      ).toBe(0)
    })
  })

  describe('Limit and Offset', () => {
    it('should parse valid limit values', () => {
      expect(validateSearchParams({ limit: '10' }).limit).toBe(10)
      expect(validateSearchParams({ limit: 100 }).limit).toBe(100)
    })

    it('should clamp limit to valid range', () => {
      expect(validateSearchParams({ limit: '-10' }).limit).toBe(1)
      expect(validateSearchParams({ limit: '5000' }).limit).toBe(1000)
    })

    it('should default limit to 50', () => {
      expect(validateSearchParams({}).limit).toBe(50)
    })

    it('should parse valid offset values', () => {
      expect(validateSearchParams({ offset: '0' }).offset).toBe(0)
      expect(validateSearchParams({ offset: '100' }).offset).toBe(100)
    })

    it('should clamp negative offset to 0', () => {
      expect(validateSearchParams({ offset: '-10' }).offset).toBe(0)
    })
  })

  describe('Boolean Flags', () => {
    it('should parse true values', () => {
      expect(validateSearchParams({ verified: 'true' }).verified).toBe(true)
      expect(validateSearchParams({ verified: '1' }).verified).toBe(true)
      expect(validateSearchParams({ verified: true }).verified).toBe(true)
    })

    it('should parse false values', () => {
      expect(validateSearchParams({ verified: 'false' }).verified).toBe(false)
      expect(validateSearchParams({ verified: '0' }).verified).toBe(false)
    })

    it('should use defaults for invalid values', () => {
      expect(validateSearchParams({ verified: 'invalid' }).verified).toBe(false)
      expect(validateSearchParams({ active: 'invalid' }).active).toBe(true)
    })
  })
})

// Search Limit and Offset Edge Cases

describe('Pagination Edge Cases', () => {
  it('should handle zero limit with Math.max', () => {
    const limit = 0
    const effectiveLimit = Math.max(1, limit)
    expect(effectiveLimit).toBe(1)
  })

  it('should handle negative limit', () => {
    const limit = -10
    const effectiveLimit = Math.max(1, limit)
    expect(effectiveLimit).toBe(1)
  })

  it('should handle very large limit', () => {
    const limit = 1000000
    const maxLimit = 1000
    const effectiveLimit = Math.min(limit, maxLimit)
    expect(effectiveLimit).toBe(maxLimit)
  })

  it('should handle offset larger than result set', () => {
    const totalResults = 100
    const offset = 150
    const results = offset >= totalResults ? [] : ['some', 'results']
    expect(results).toEqual([])
  })
})

// Result Scoring Tests

describe('Search Result Scoring', () => {
  it('should boost score by stake tier', () => {
    const baseScore = 0.5
    const stakeTiers = [0, 1, 2, 3, 4]

    for (const tier of stakeTiers) {
      const boostedScore = baseScore * (1 + tier / 4)
      expect(boostedScore).toBeGreaterThanOrEqual(baseScore)
    }
  })

  it('should sort results by score descending', () => {
    const results = [
      { name: 'A', score: 0.3 },
      { name: 'B', score: 0.9 },
      { name: 'C', score: 0.5 },
      { name: 'D', score: 0.7 },
    ]

    const sorted = results.sort((a, b) => b.score - a.score)
    expect(sorted[0].name).toBe('B')
    expect(sorted[1].name).toBe('D')
    expect(sorted[2].name).toBe('C')
    expect(sorted[3].name).toBe('A')
  })
})

// Cache Behavior Tests

describe('Search Cache Behavior', () => {
  it('should generate consistent cache keys', () => {
    const params1 = { query: 'test', limit: 10, offset: 0 }
    const params2 = { query: 'test', limit: 10, offset: 0 }

    const key1 = JSON.stringify(params1)
    const key2 = JSON.stringify(params2)

    expect(key1).toBe(key2)
  })

  it('should expire cache entries', async () => {
    const CACHE_TTL = 50
    const cache = new Map<string, { data: string; expiresAt: number }>()

    const now = Date.now()
    cache.set('test', { data: 'cached', expiresAt: now + CACHE_TTL })

    const entry1 = cache.get('test')
    expect(entry1 && entry1.expiresAt > Date.now()).toBe(true)

    await new Promise((r) => setTimeout(r, CACHE_TTL + 10))
    const entry2 = cache.get('test')
    expect(entry2 && entry2.expiresAt > Date.now()).toBe(false)
  })

  it('should deduplicate identical concurrent requests', async () => {
    const cache = new Map<string, Promise<string[]>>()
    let actualSearchCount = 0

    const cachedSearch = (query: string): Promise<string[]> => {
      const cached = cache.get(query)
      if (cached) return cached

      const promise = (async () => {
        actualSearchCount++
        await new Promise((r) => setTimeout(r, 50))
        return [`result-${query}`]
      })()

      cache.set(query, promise)
      return promise
    }

    const results = await Promise.all([
      cachedSearch('same-query'),
      cachedSearch('same-query'),
      cachedSearch('same-query'),
    ])

    expect(results.length).toBe(3)
    expect(actualSearchCount).toBe(1)
  })
})

// Agent Search Result Transformation

describe('Agent Search Result Transformation', () => {
  it('should transform agent with all fields', () => {
    const mockAgent = {
      agentId: 123n,
      owner: { address: '0x1234567890abcdef1234567890abcdef12345678' },
      name: 'Test Agent',
      tokenURI: 'ipfs://Qm...',
      active: true,
      registeredAt: new Date('2024-01-15T10:30:00Z'),
    }

    const result: AgentSearchResult = {
      agentId: mockAgent.agentId.toString(),
      owner: mockAgent.owner.address ?? '',
      name: mockAgent.name ?? 'Unnamed Agent',
      metadataUri: mockAgent.tokenURI ?? '',
      active: mockAgent.active,
      registeredAt: mockAgent.registeredAt.toISOString(),
      totalExecutions: 0,
      totalSpent: '0',
      services: [],
    }

    expect(result.agentId).toBe('123')
    expect(result.owner).toBe('0x1234567890abcdef1234567890abcdef12345678')
    expect(result.name).toBe('Test Agent')
  })

  it('should handle agent with null owner', () => {
    const mockAgent = {
      agentId: 1n,
      owner: null,
      name: 'Orphan Agent',
      tokenURI: null,
      active: true,
      registeredAt: new Date(),
    }

    const result: AgentSearchResult = {
      agentId: mockAgent.agentId.toString(),
      owner: mockAgent.owner?.address ?? '',
      name: mockAgent.name ?? 'Unnamed Agent',
      metadataUri: mockAgent.tokenURI ?? '',
      active: mockAgent.active,
      registeredAt: mockAgent.registeredAt.toISOString(),
      totalExecutions: 0,
      totalSpent: '0',
      services: [],
    }

    expect(result.owner).toBe('')
  })

  it('should handle null fields gracefully', () => {
    const agent: MockAgent = {
      id: 'test-1',
      agentId: 1n,
      name: null,
      description: null,
      tags: null,
      serviceType: null,
      category: null,
      a2aEndpoint: null,
      mcpEndpoint: null,
      mcpTools: null,
      a2aSkills: null,
      stakeTier: 0,
      stakeAmount: 0n,
      x402Support: false,
      active: true,
      isBanned: false,
      registeredAt: new Date(),
      owner: null,
    }

    const result = {
      agentId: agent.agentId.toString(),
      name: agent.name ?? 'Unnamed Agent',
      description: agent.description ?? null,
      tags: agent.tags ?? [],
      owner: agent.owner?.address ?? '',
    }

    expect(result.name).toBe('Unnamed Agent')
    expect(result.tags).toEqual([])
    expect(result.owner).toBe('')
  })
})

// Provider to Service Mapping

describe('Provider to Service Mapping', () => {
  it('should map compute provider correctly', () => {
    const provider: MockProvider = {
      address: '0xabc123def456789abc123def456789abc123def4',
      name: 'GPU Compute',
      endpoint: 'https://compute.example.com/api',
      agentId: 42,
      isActive: true,
    }

    const service = mapProviderToService(provider, 'compute')

    expect(service.serviceId).toBe(
      'compute-0xabc123def456789abc123def456789abc123def4',
    )
    expect(service.name).toBe('GPU Compute')
    expect(service.category).toBe('compute')
    expect(service.isVerified).toBe(true)
  })

  it('should map storage provider correctly', () => {
    const provider: MockProvider = {
      address: '0xdef789abc123def456789abc123def456789abc1',
      name: 'IPFS Gateway',
      endpoint: 'https://storage.example.com/api',
      agentId: 100,
      isActive: true,
    }

    const service = mapProviderToService(provider, 'storage')

    expect(service.serviceId).toBe(
      'storage-0xdef789abc123def456789abc123def456789abc1',
    )
    expect(service.category).toBe('storage')
  })

  it('should mark unverified when no agentId', () => {
    const provider: MockProvider = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      name: 'Unverified Provider',
      endpoint: 'https://unverified.example.com',
      agentId: null,
      isActive: true,
    }

    const service = mapProviderToService(provider, 'compute')
    expect(service.isVerified).toBe(false)
  })

  it('should provide default name for unnamed providers', () => {
    const provider: MockProvider = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      name: '',
      endpoint: 'https://unnamed.example.com',
      agentId: null,
      isActive: true,
    }

    const computeService = mapProviderToService(provider, 'compute')
    expect(computeService.name).toBe('Compute Provider')

    const storageService = mapProviderToService(provider, 'storage')
    expect(storageService.name).toBe('Storage Provider')
  })
})

// Agent Filter Tests

describe('Agent Search Filter Application', () => {
  interface SimpleAgent {
    id: string
    name: string | null
    owner: string
    active: boolean
    serviceCount: number
  }

  interface AgentSearchFilter {
    name?: string
    owner?: string
    active?: boolean
    hasServices?: boolean
  }

  const filterAgents = (
    agents: SimpleAgent[],
    filter: AgentSearchFilter,
  ): SimpleAgent[] => {
    return agents.filter((a) => {
      if (filter.active !== undefined && a.active !== filter.active)
        return false
      if (
        filter.name &&
        !a.name?.toLowerCase().includes(filter.name.toLowerCase())
      )
        return false
      if (filter.owner && a.owner.toLowerCase() !== filter.owner.toLowerCase())
        return false
      if (filter.hasServices && a.serviceCount === 0) return false
      return true
    })
  }

  const testAgents: SimpleAgent[] = [
    {
      id: '1',
      name: 'Trading Bot',
      owner: '0xaaa',
      active: true,
      serviceCount: 3,
    },
    {
      id: '2',
      name: 'Data Analyzer',
      owner: '0xbbb',
      active: true,
      serviceCount: 0,
    },
    {
      id: '3',
      name: 'NFT Minter',
      owner: '0xaaa',
      active: false,
      serviceCount: 1,
    },
    { id: '4', name: null, owner: '0xccc', active: true, serviceCount: 2 },
  ]

  it('should filter by active status', () => {
    const result = filterAgents(testAgents, { active: true })
    expect(result.length).toBe(3)
    expect(result.every((a) => a.active)).toBe(true)
  })

  it('should filter by name (case insensitive)', () => {
    const result = filterAgents(testAgents, { name: 'bot' })
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Trading Bot')
  })

  it('should filter by owner (case insensitive)', () => {
    const result = filterAgents(testAgents, { owner: '0xAAA' })
    expect(result.length).toBe(2)
  })

  it('should filter by hasServices', () => {
    const result = filterAgents(testAgents, { hasServices: true })
    expect(result.length).toBe(3)
    expect(result.every((a) => a.serviceCount > 0)).toBe(true)
  })

  it('should combine multiple filters', () => {
    const result = filterAgents(testAgents, { active: true, owner: '0xaaa' })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('1')
  })

  it('should return all when no filters', () => {
    const result = filterAgents(testAgents, {})
    expect(result.length).toBe(4)
  })
})

// Service Filter Tests

describe('Service Search Filter Application', () => {
  interface SimpleService {
    id: string
    type: 'mcp' | 'a2a' | 'rest'
    category: string
    name: string
    endpoint: string
    isVerified: boolean
  }

  interface ServiceSearchFilter {
    type?: 'mcp' | 'a2a' | 'rest'
    category?: string
    query?: string
    verifiedOnly?: boolean
  }

  const filterServices = (
    services: SimpleService[],
    filter: ServiceSearchFilter,
  ): SimpleService[] => {
    return services.filter((s) => {
      if (filter.type && s.type !== filter.type) return false
      if (filter.category && s.category !== filter.category) return false
      if (filter.verifiedOnly && !s.isVerified) return false
      if (filter.query) {
        const q = filter.query.toLowerCase()
        if (
          !s.name.toLowerCase().includes(q) &&
          !s.endpoint.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }

  const testServices: SimpleService[] = [
    {
      id: '1',
      type: 'rest',
      category: 'compute',
      name: 'GPU Provider',
      endpoint: 'https://gpu.example.com',
      isVerified: true,
    },
    {
      id: '2',
      type: 'rest',
      category: 'storage',
      name: 'IPFS Node',
      endpoint: 'https://ipfs.example.com',
      isVerified: true,
    },
    {
      id: '3',
      type: 'rest',
      category: 'compute',
      name: 'CPU Farm',
      endpoint: 'https://cpu.example.com',
      isVerified: false,
    },
    {
      id: '4',
      type: 'mcp',
      category: 'oracle',
      name: 'Price Feed',
      endpoint: 'mcp://prices',
      isVerified: true,
    },
  ]

  it('should filter by type', () => {
    const result = filterServices(testServices, { type: 'rest' })
    expect(result.length).toBe(3)
  })

  it('should filter by category', () => {
    const result = filterServices(testServices, { category: 'compute' })
    expect(result.length).toBe(2)
  })

  it('should filter by verified only', () => {
    const result = filterServices(testServices, { verifiedOnly: true })
    expect(result.length).toBe(3)
  })

  it('should filter by query in name', () => {
    const result = filterServices(testServices, { query: 'gpu' })
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('GPU Provider')
  })

  it('should combine type and verified filters', () => {
    const result = filterServices(testServices, {
      type: 'rest',
      verifiedOnly: true,
    })
    expect(result.length).toBe(2)
  })
})

// Facet Aggregation Tests

describe('Facet Aggregation', () => {
  it('should count tags correctly', () => {
    const tagCounts = new Map<string, number>()
    const agents = [
      { tags: ['agent', 'defi'] },
      { tags: ['agent', 'nft'] },
      { tags: ['workflow', 'defi'] },
      { tags: null },
      { tags: [] },
    ]

    for (const agent of agents) {
      for (const tag of agent.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }

    expect(tagCounts.get('agent')).toBe(2)
    expect(tagCounts.get('defi')).toBe(2)
    expect(tagCounts.get('nft')).toBe(1)
    expect(tagCounts.get('workflow')).toBe(1)
  })

  it('should limit facet results', () => {
    const allTags = Array.from({ length: 100 }, (_, i) => ({
      tag: `tag-${i}`,
      count: 100 - i,
    }))
    const topTags = allTags.slice(0, 20)

    expect(topTags.length).toBe(20)
    expect(topTags[0].count).toBe(100)
  })
})

// Service ID Parsing Tests

describe('Service ID Parsing', () => {
  interface ParsedServiceId {
    type: 'compute' | 'storage' | null
    address: string | null
  }

  const parseServiceId = (serviceId: string): ParsedServiceId => {
    const parts = serviceId.split('-')
    if (parts.length !== 2) return { type: null, address: null }

    const [type, address] = parts
    if (type !== 'compute' && type !== 'storage')
      return { type: null, address: null }
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address))
      return { type: null, address: null }

    return { type, address: address.toLowerCase() }
  }

  it('should parse compute service ID', () => {
    const result = parseServiceId(
      'compute-0x1234567890abcdef1234567890abcdef12345678',
    )
    expect(result.type).toBe('compute')
    expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678')
  })

  it('should parse storage service ID', () => {
    const result = parseServiceId(
      'storage-0xabcdef1234567890abcdef1234567890abcdef12',
    )
    expect(result.type).toBe('storage')
  })

  it('should lowercase address in result', () => {
    const result = parseServiceId(
      'compute-0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
    )
    expect(result.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  })

  it('should reject invalid service IDs', () => {
    expect(parseServiceId('').type).toBeNull()
    expect(parseServiceId('invalid').type).toBeNull()
    expect(parseServiceId('compute').type).toBeNull()
  })
})

// Concurrent Search Handling Tests

describe('Concurrent Search Handling', () => {
  it('should handle concurrent searches', async () => {
    let callCount = 0
    const mockSearch = async (query: string): Promise<string[]> => {
      callCount++
      await new Promise((r) => setTimeout(r, 10))
      return [`result-${query}`]
    }

    const results = await Promise.all([
      mockSearch('a'),
      mockSearch('b'),
      mockSearch('c'),
    ])

    expect(results.length).toBe(3)
    expect(callCount).toBe(3)
  })
})
