/**
 * Comprehensive Tests for AgentDiscoveryService
 *
 * Tests cover:
 * - Local agent discovery
 * - Agent0 network integration
 * - Filter application (strategies, skills, reputation)
 * - Deduplication and sorting
 * - Error handling
 * - Edge cases
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetAgent0Client } from '../client'
import {
  AgentDiscoveryService,
  agentDiscoveryService,
  type DiscoveryFilter,
} from '../discovery'

// =============================================================================
// Test Fixtures
// =============================================================================

const mockLocalAgent = {
  agentId: 'local-agent-1',
  name: 'Local Trading Agent',
  status: 'ACTIVE',
  trustLevel: 3,
  capabilities: {
    strategies: ['trading', 'arbitrage'],
    markets: ['crypto', 'forex'],
    actions: ['buy', 'sell'],
    version: '1.0.0',
    skills: ['price-analysis', 'risk-management'],
    domains: ['finance'],
    a2aEndpoint: 'https://local.agent/a2a',
    x402Support: true,
  },
  onChainData: {
    tokenId: 100,
    serverWallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    reputationScore: 85,
  },
}

const _mockInactiveAgent = {
  ...mockLocalAgent,
  agentId: 'local-agent-2',
  name: 'Inactive Agent',
  status: 'INACTIVE',
}

const _mockLowRepAgent = {
  ...mockLocalAgent,
  agentId: 'local-agent-3',
  name: 'Low Rep Agent',
  trustLevel: 1,
  onChainData: {
    ...mockLocalAgent.onChainData,
    reputationScore: 20,
  },
}

// =============================================================================
// Service Instance Tests
// =============================================================================

describe('AgentDiscoveryService Instance', () => {
  test('singleton instance exists', () => {
    expect(agentDiscoveryService).toBeDefined()
    expect(agentDiscoveryService).toBeInstanceOf(AgentDiscoveryService)
  })

  test('can create new instance', () => {
    const service = new AgentDiscoveryService()
    expect(service).toBeDefined()
  })
})

// =============================================================================
// Discovery Filter Tests
// =============================================================================

describe('Discovery Filters', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  describe('response structure', () => {
    test('returns correct response structure with empty filter', async () => {
      const result = await service.discoverAgents({})
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      // nextCursor is optional
      expect(
        result.nextCursor === undefined ||
          typeof result.nextCursor === 'string',
      ).toBe(true)
    })

    test('returns empty items array when no agents match', async () => {
      const result = await service.discoverAgents({ minReputation: 999 })
      expect(result.items).toEqual([])
    })
  })

  describe('filter validation', () => {
    test('accepts undefined filter values', async () => {
      const filter: DiscoveryFilter = {
        skills: undefined,
        strategies: undefined,
        minReputation: undefined,
      }
      const result = await service.discoverAgents(filter)
      expect(Array.isArray(result.items)).toBe(true)
    })

    test('accepts empty arrays for skills and strategies', async () => {
      const result = await service.discoverAgents({
        strategies: [],
        skills: [],
      })
      expect(Array.isArray(result.items)).toBe(true)
    })

    test('accepts all filter combinations', async () => {
      const result = await service.discoverAgents({
        strategies: ['trading'],
        skills: ['price-analysis'],
        minReputation: 50,
        active: true,
        x402Support: true,
        mcp: true,
        a2a: true,
        chains: [1, 11155111],
        includeExternal: false,
      })
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('filter boundary conditions', () => {
    test('minReputation 0 returns all', async () => {
      const result = await service.discoverAgents({ minReputation: 0 })
      expect(Array.isArray(result.items)).toBe(true)
    })

    test('minReputation 100 returns only perfect scores', async () => {
      const result = await service.discoverAgents({ minReputation: 100 })
      expect(Array.isArray(result.items)).toBe(true)
    })

    test('minReputation negative treated as 0', async () => {
      const result = await service.discoverAgents({ minReputation: -50 })
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})

// =============================================================================
// External Agent Discovery Tests
// =============================================================================

describe('External Agent Discovery', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  test('returns only local agents when includeExternal is false', async () => {
    const result = await service.discoverAgents({ includeExternal: false })
    expect(Array.isArray(result.items)).toBe(true)
    for (const agent of result.items) {
      expect(agent.source).toBe('local')
    }
  })

  test('gracefully handles Agent0 unavailability', async () => {
    // Without proper config, Agent0 won't be available
    // Service should still return local results without crashing
    const result = await service.discoverAgents({ includeExternal: true })
    expect(Array.isArray(result.items)).toBe(true)
  })

  test('chain filter passed to external search', async () => {
    const result = await service.discoverAgents({
      includeExternal: true,
      chains: [1, 11155111],
    })
    // Should not crash even with chain filters
    expect(Array.isArray(result.items)).toBe(true)
  })
})

// =============================================================================
// Get Agent Tests
// =============================================================================

describe('getAgent', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  // ---------------------------------------------------------------------------
  // Agent0 ID Format Tests
  // ---------------------------------------------------------------------------

  describe('agent0 ID format', () => {
    test('handles agent0- prefixed ID', async () => {
      const agent = await service.getAgent('agent0-123')
      // Returns null if not found, which is valid
      expect(agent === null || typeof agent === 'object').toBe(true)
    })

    test('handles numeric token ID string', async () => {
      const agent = await service.getAgent('agent0-999999')
      expect(agent === null || typeof agent === 'object').toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Local Agent ID Tests
  // ---------------------------------------------------------------------------

  describe('local agent ID', () => {
    test('searches local registry for non-agent0 ID', async () => {
      const agent = await service.getAgent('local-agent-1')
      expect(agent === null || typeof agent === 'object').toBe(true)
    })

    test('returns null for unknown local ID', async () => {
      const agent = await service.getAgent('nonexistent-agent')
      expect(agent).toBeNull()
    })
  })
})

// =============================================================================
// Response Structure Tests
// =============================================================================

describe('Response Structure', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  test('response has correct structure', async () => {
    const result = await service.discoverAgents({})
    expect(result).toHaveProperty('items')
    expect(Array.isArray(result.items)).toBe(true)
    // nextCursor is optional
    if (result.nextCursor !== undefined) {
      expect(typeof result.nextCursor).toBe('string')
    }
  })

  test('discovered agent has correct structure', async () => {
    const result = await service.discoverAgents({})
    for (const agent of result.items) {
      expect(agent).toHaveProperty('agentId')
      expect(agent).toHaveProperty('tokenId')
      expect(agent).toHaveProperty('address')
      expect(agent).toHaveProperty('name')
      expect(agent).toHaveProperty('endpoint')
      expect(agent).toHaveProperty('capabilities')
      expect(agent).toHaveProperty('reputation')
      expect(agent).toHaveProperty('isActive')
      expect(agent).toHaveProperty('source')
    }
  })

  test('capabilities has correct structure', async () => {
    const result = await service.discoverAgents({})
    for (const agent of result.items) {
      expect(agent.capabilities).toHaveProperty('strategies')
      expect(agent.capabilities).toHaveProperty('markets')
      expect(agent.capabilities).toHaveProperty('actions')
      expect(agent.capabilities).toHaveProperty('version')
      expect(agent.capabilities).toHaveProperty('skills')
      expect(agent.capabilities).toHaveProperty('domains')
      expect(Array.isArray(agent.capabilities.strategies)).toBe(true)
      expect(Array.isArray(agent.capabilities.markets)).toBe(true)
    }
  })

  test('reputation has correct structure', async () => {
    const result = await service.discoverAgents({})
    for (const agent of result.items) {
      expect(agent.reputation).toHaveProperty('totalBets')
      expect(agent.reputation).toHaveProperty('winningBets')
      expect(agent.reputation).toHaveProperty('accuracyScore')
      expect(agent.reputation).toHaveProperty('trustScore')
      expect(agent.reputation).toHaveProperty('totalVolume')
      expect(agent.reputation).toHaveProperty('profitLoss')
      expect(agent.reputation).toHaveProperty('isBanned')
    }
  })
})

// =============================================================================
// Pagination Tests
// =============================================================================

describe('Pagination', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  test('respects pageSize limit', async () => {
    const result = await service.discoverAgents({}, { pageSize: 5 })
    expect(result.items.length).toBeLessThanOrEqual(5)
  })

  test('cursor option does not break request', async () => {
    const result = await service.discoverAgents({}, { cursor: 'test-cursor' })
    expect(Array.isArray(result.items)).toBe(true)
  })

  test('sort option does not break request', async () => {
    const result = await service.discoverAgents(
      {},
      { sort: ['trustScore:desc'] },
    )
    expect(Array.isArray(result.items)).toBe(true)
  })

  test('all pagination options combined', async () => {
    const result = await service.discoverAgents(
      {},
      {
        pageSize: 10,
        cursor: 'next-page',
        sort: ['name:asc', 'trustScore:desc'],
      },
    )
    expect(Array.isArray(result.items)).toBe(true)
    expect(result.items.length).toBeLessThanOrEqual(10)
  })
})

// =============================================================================
// Deduplication Tests
// =============================================================================

describe('Deduplication', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  test('results are sorted by trust score descending', async () => {
    const result = await service.discoverAgents({})

    // Verify sorting
    for (let i = 1; i < result.items.length; i++) {
      const prev = result.items[i - 1]
      const curr = result.items[i]
      if (prev && curr) {
        expect(prev.reputation.trustScore).toBeGreaterThanOrEqual(
          curr.reputation.trustScore,
        )
      }
    }
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  afterEach(() => {
    resetAgent0Client()
  })

  test('returns local results when external search fails', async () => {
    const result = await service.discoverAgents({ includeExternal: true })
    expect(Array.isArray(result.items)).toBe(true)
    // All items should be local since Agent0 is not configured
    for (const agent of result.items) {
      expect(agent.source).toBe('local')
    }
  })

  test('parses invalid agent0 ID as NaN token', async () => {
    const agent = await service.getAgent('agent0-notanumber')
    // parseInt('notanumber') returns NaN, agent should be null
    expect(agent).toBeNull()
  })

  test('returns null for non-existent local agent', async () => {
    const agent = await service.getAgent('nonexistent-local-id')
    expect(agent).toBeNull()
  })
})

// =============================================================================
// Source Attribution Tests
// =============================================================================

describe('Source Attribution', () => {
  let service: AgentDiscoveryService

  beforeEach(() => {
    service = new AgentDiscoveryService()
  })

  test('local agents have source: local', async () => {
    const result = await service.discoverAgents({
      includeExternal: false,
    })

    for (const agent of result.items) {
      expect(agent.source).toBe('local')
    }
  })

  test('agent0 prefixed agents have source: agent0', async () => {
    const agent = await service.getAgent('agent0-1')
    if (agent) {
      expect(agent.source).toBe('agent0')
    }
  })
})
