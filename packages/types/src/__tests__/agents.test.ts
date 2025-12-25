/**
 * @fileoverview Comprehensive tests for agents.ts
 *
 * Tests cover:
 * - GameNetworkInfoSchema: Game network info validation
 * - AgentCapabilitiesSchema: Agent capabilities validation
 * - Type inference correctness
 */

import { describe, expect, test } from 'bun:test'
import {
  type AgentCapabilities,
  AgentCapabilitiesSchema,
  type AgentDiscoveryProfile,
  type AgentDiscoveryQuery,
  type GameNetworkInfo,
  GameNetworkInfoSchema,
} from '../agents'

describe('GameNetworkInfoSchema', () => {
  test('accepts valid game network info', () => {
    const info: GameNetworkInfo = {
      chainId: 1,
      registryAddress: '0x1234567890123456789012345678901234567890',
    }

    const result = GameNetworkInfoSchema.safeParse(info)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.chainId).toBe(1)
      expect(result.data.registryAddress).toBe(
        '0x1234567890123456789012345678901234567890',
      )
    }
  })

  test('accepts full game network info with optional fields', () => {
    const info = {
      chainId: 42161,
      registryAddress: '0x1234567890123456789012345678901234567890',
      reputationAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      marketAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }

    const result = GameNetworkInfoSchema.safeParse(info)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reputationAddress).toBe(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      )
      expect(result.data.marketAddress).toBe(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      )
    }
  })

  test('accepts null for optional address fields', () => {
    const info = {
      chainId: 1,
      registryAddress: '0x1234567890123456789012345678901234567890',
      reputationAddress: null,
      marketAddress: null,
    }

    const result = GameNetworkInfoSchema.safeParse(info)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reputationAddress).toBeNull()
      expect(result.data.marketAddress).toBeNull()
    }
  })

  test('rejects non-positive chainId', () => {
    const info = {
      chainId: 0,
      registryAddress: '0x1234567890123456789012345678901234567890',
    }
    expect(GameNetworkInfoSchema.safeParse(info).success).toBe(false)

    const negativeInfo = {
      chainId: -1,
      registryAddress: '0x1234567890123456789012345678901234567890',
    }
    expect(GameNetworkInfoSchema.safeParse(negativeInfo).success).toBe(false)
  })

  test('rejects non-integer chainId', () => {
    const info = {
      chainId: 1.5,
      registryAddress: '0x1234567890123456789012345678901234567890',
    }
    expect(GameNetworkInfoSchema.safeParse(info).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    expect(GameNetworkInfoSchema.safeParse({}).success).toBe(false)
    expect(GameNetworkInfoSchema.safeParse({ chainId: 1 }).success).toBe(false)
    expect(
      GameNetworkInfoSchema.safeParse({
        registryAddress: '0x1234567890123456789012345678901234567890',
      }).success,
    ).toBe(false)
  })
})

describe('AgentCapabilitiesSchema', () => {
  test('accepts minimal capabilities (empty)', () => {
    const caps = {}

    const result = AgentCapabilitiesSchema.safeParse(caps)
    expect(result.success).toBe(true)
    if (result.success) {
      // Check defaults are applied
      expect(result.data.strategies).toEqual([])
      expect(result.data.markets).toEqual([])
      expect(result.data.actions).toEqual([])
      expect(result.data.version).toBe('1.0.0')
      expect(result.data.skills).toEqual([])
      expect(result.data.domains).toEqual([])
    }
  })

  test('accepts full capabilities', () => {
    const caps: AgentCapabilities = {
      strategies: ['arbitrage', 'market-making'],
      markets: ['ETH-USD', 'BTC-USD'],
      actions: ['trade', 'stake', 'bridge'],
      version: '2.0.0',
      x402Support: true,
      platform: 'jeju',
      userType: 'trader',
      skills: ['trading', 'analysis'],
      domains: ['defi', 'gaming'],
      a2aEndpoint: 'https://agent.example.com/a2a',
      mcpEndpoint: 'https://agent.example.com/mcp',
    }

    const result = AgentCapabilitiesSchema.safeParse(caps)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.strategies).toEqual(['arbitrage', 'market-making'])
      expect(result.data.markets).toEqual(['ETH-USD', 'BTC-USD'])
      expect(result.data.version).toBe('2.0.0')
      expect(result.data.x402Support).toBe(true)
      expect(result.data.a2aEndpoint).toBe('https://agent.example.com/a2a')
    }
  })

  test('accepts capabilities with gameNetwork', () => {
    const caps = {
      gameNetwork: {
        chainId: 420690,
        registryAddress: '0x1234567890123456789012345678901234567890',
      },
    }

    const result = AgentCapabilitiesSchema.safeParse(caps)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.gameNetwork?.chainId).toBe(420690)
    }
  })

  test('accepts null for nullable string fields', () => {
    const caps = {
      platform: null,
      userType: null,
      a2aEndpoint: null,
      mcpEndpoint: null,
    }

    const result = AgentCapabilitiesSchema.safeParse(caps)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.platform).toBeNull()
      expect(result.data.userType).toBeNull()
    }
  })

  test('rejects invalid gameNetwork', () => {
    const caps = {
      gameNetwork: {
        chainId: 'invalid',
        registryAddress: '0x1234567890123456789012345678901234567890',
      },
    }
    expect(AgentCapabilitiesSchema.safeParse(caps).success).toBe(false)
  })

  test('rejects non-array strategies', () => {
    const caps = {
      strategies: 'not-an-array',
    }
    expect(AgentCapabilitiesSchema.safeParse(caps).success).toBe(false)
  })
})

describe('AgentDiscoveryProfile type', () => {
  test('type structure is correct', () => {
    const profile: AgentDiscoveryProfile = {
      agentId: 'agent-123',
      address: '0x1234567890123456789012345678901234567890',
      capabilities: {
        strategies: ['trading'],
        markets: ['ETH-USD'],
        actions: ['trade'],
        version: '1.0.0',
        skills: [],
        domains: [],
      },
      reputation: 95,
    }

    expect(profile.agentId).toBe('agent-123')
    expect(profile.address).toBe('0x1234567890123456789012345678901234567890')
    expect(profile.capabilities.strategies).toEqual(['trading'])
    expect(profile.reputation).toBe(95)
  })

  test('reputation is optional', () => {
    const profile: AgentDiscoveryProfile = {
      agentId: 'agent-456',
      address: '0x1234567890123456789012345678901234567890',
      capabilities: {
        strategies: [],
        markets: [],
        actions: [],
        version: '1.0.0',
        skills: [],
        domains: [],
      },
    }

    expect(profile.reputation).toBeUndefined()
  })
})

describe('AgentDiscoveryQuery type', () => {
  test('type structure is correct', () => {
    const query: AgentDiscoveryQuery = {
      strategies: 'arbitrage,market-making',
      markets: 'ETH-USD,BTC-USD',
      minReputation: 80,
      external: 'true',
    }

    expect(query.strategies).toBe('arbitrage,market-making')
    expect(query.markets).toBe('ETH-USD,BTC-USD')
    expect(query.minReputation).toBe(80)
    expect(query.external).toBe('true')
  })

  test('all fields are optional', () => {
    const emptyQuery: AgentDiscoveryQuery = {}
    expect(emptyQuery.strategies).toBeUndefined()
    expect(emptyQuery.markets).toBeUndefined()
    expect(emptyQuery.minReputation).toBeUndefined()
    expect(emptyQuery.external).toBeUndefined()
  })

  test('external field is constrained to true or false string', () => {
    const trueQuery: AgentDiscoveryQuery = { external: 'true' }
    const falseQuery: AgentDiscoveryQuery = { external: 'false' }

    expect(trueQuery.external).toBe('true')
    expect(falseQuery.external).toBe('false')
  })
})
