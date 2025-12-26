import { describe, expect, it } from 'bun:test'
import {
  EndpointTypeSchema,
  ServiceCategorySchema,
  SearchParamsSchema,
  AgentSearchResultSchema,
  ProviderResultSchema,
  SearchResultSchema,
} from '../indexer'

describe('Indexer Types', () => {
  describe('EndpointTypeSchema', () => {
    it('validates all endpoint types', () => {
      const types = ['agent', 'provider', 'marketplace', 'defi', 'bridge']
      for (const type of types) {
        expect(EndpointTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('ServiceCategorySchema', () => {
    it('validates all service categories', () => {
      const categories = [
        'compute',
        'storage',
        'ai',
        'oracle',
        'vpn',
        'cdn',
        'messaging',
        'identity',
        'other',
      ]
      for (const category of categories) {
        expect(ServiceCategorySchema.parse(category)).toBe(category)
      }
    })
  })

  describe('SearchParamsSchema', () => {
    it('validates basic search params', () => {
      const params = {
        query: 'ai agent',
        limit: 10,
        offset: 0,
      }
      expect(() => SearchParamsSchema.parse(params)).not.toThrow()
    })

    it('validates search params with filters', () => {
      const params = {
        query: 'compute provider',
        limit: 20,
        offset: 10,
        endpointType: 'provider',
        category: 'compute',
        chainId: 1,
        minReputation: 80,
        isActive: true,
      }
      expect(() => SearchParamsSchema.parse(params)).not.toThrow()
    })

    it('validates search params with sorting', () => {
      const params = {
        query: 'storage',
        limit: 50,
        sortBy: 'reputation',
        sortOrder: 'desc',
      }
      expect(() => SearchParamsSchema.parse(params)).not.toThrow()
    })

    it('validates empty query', () => {
      const params = {
        query: '',
        limit: 10,
      }
      expect(() => SearchParamsSchema.parse(params)).not.toThrow()
    })
  })

  describe('AgentSearchResultSchema', () => {
    it('validates agent search result', () => {
      const result = {
        agentId: 12345n,
        name: 'Test Agent',
        description: 'A test AI agent for development',
        owner: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        capabilities: ['chat', 'code-generation', 'data-analysis'],
        reputation: 95,
        totalInteractions: 10000,
        isActive: true,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        endpoint: 'https://agent.example.com/api',
        metadata: {
          version: '1.0.0',
          model: 'gpt-4',
        },
      }
      expect(() => AgentSearchResultSchema.parse(result)).not.toThrow()
    })

    it('validates minimal agent search result', () => {
      const result = {
        agentId: 1n,
        name: 'Minimal Agent',
        owner: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        capabilities: [],
        reputation: 0,
        totalInteractions: 0,
        isActive: false,
        createdAt: Date.now(),
      }
      expect(() => AgentSearchResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('ProviderResultSchema', () => {
    it('validates provider result', () => {
      const result = {
        providerId: '0x1234567890123456789012345678901234567890',
        name: 'Test Provider',
        description: 'A compute provider',
        category: 'compute',
        chainId: 1,
        reputation: 90,
        totalJobs: 5000,
        successRate: 99.5,
        isActive: true,
        registeredAt: Date.now(),
        capabilities: ['gpu-compute', 'ml-training'],
        pricing: {
          pricePerHour: '1000000000000000',
          currency: 'ETH',
        },
        hardware: {
          gpuType: 'A100',
          gpuCount: 8,
          memory: '80GB',
        },
      }
      expect(() => ProviderResultSchema.parse(result)).not.toThrow()
    })

    it('validates minimal provider result', () => {
      const result = {
        providerId: '0x1234567890123456789012345678901234567890',
        name: 'Basic Provider',
        category: 'storage',
        chainId: 1,
        reputation: 50,
        totalJobs: 0,
        isActive: true,
        registeredAt: Date.now(),
      }
      expect(() => ProviderResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('SearchResultSchema', () => {
    it('validates search result with agents', () => {
      const result = {
        total: 100,
        offset: 0,
        limit: 10,
        results: [
          {
            type: 'agent',
            data: {
              agentId: 1n,
              name: 'Test Agent',
              owner: '0x1234567890123456789012345678901234567890',
              chainId: 1,
              capabilities: ['chat'],
              reputation: 85,
              totalInteractions: 1000,
              isActive: true,
              createdAt: Date.now(),
            },
          },
        ],
        searchTime: 50,
      }
      expect(() => SearchResultSchema.parse(result)).not.toThrow()
    })

    it('validates search result with providers', () => {
      const result = {
        total: 50,
        offset: 0,
        limit: 20,
        results: [
          {
            type: 'provider',
            data: {
              providerId: '0x1234567890123456789012345678901234567890',
              name: 'Test Provider',
              category: 'compute',
              chainId: 1,
              reputation: 90,
              totalJobs: 500,
              isActive: true,
              registeredAt: Date.now(),
            },
          },
        ],
        searchTime: 30,
      }
      expect(() => SearchResultSchema.parse(result)).not.toThrow()
    })

    it('validates empty search result', () => {
      const result = {
        total: 0,
        offset: 0,
        limit: 10,
        results: [],
        searchTime: 5,
      }
      expect(() => SearchResultSchema.parse(result)).not.toThrow()
    })

    it('validates mixed search results', () => {
      const result = {
        total: 2,
        offset: 0,
        limit: 10,
        results: [
          {
            type: 'agent',
            data: {
              agentId: 1n,
              name: 'Agent 1',
              owner: '0x1234567890123456789012345678901234567890',
              chainId: 1,
              capabilities: [],
              reputation: 80,
              totalInteractions: 100,
              isActive: true,
              createdAt: Date.now(),
            },
          },
          {
            type: 'provider',
            data: {
              providerId: '0x2345678901234567890123456789012345678901',
              name: 'Provider 1',
              category: 'ai',
              chainId: 1,
              reputation: 75,
              totalJobs: 50,
              isActive: true,
              registeredAt: Date.now(),
            },
          },
        ],
        searchTime: 25,
      }
      expect(() => SearchResultSchema.parse(result)).not.toThrow()
    })
  })
})

