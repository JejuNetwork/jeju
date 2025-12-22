/**
 * Unit tests for node selection and filtering utilities
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import type { VPNNodeState, VPNServiceContext } from '../types'
import {
  calculateNodeLoad,
  filterNodesByCountry,
  filterNodesByStatus,
  findBestNode,
  getNodeById,
  getNodesByCountry,
  sortNodesByLoad,
  sortNodesByStatusAndLoad,
  validateCountryCode,
} from './nodes'

// Helper to create test node
function createTestNode(overrides: Partial<VPNNodeState> = {}): VPNNodeState {
  return {
    nodeId: 'node-1',
    operator: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    countryCode: 'US',
    region: 'us-east-1',
    endpoint: 'vpn1.jeju.network:51820',
    wireguardPubKey: 'abc123pubkey',
    status: 'online',
    activeConnections: 5,
    maxConnections: 100,
    latencyMs: 25,
    ...overrides,
  }
}

// Helper to create test context with nodes
function createTestContext(nodes: VPNNodeState[] = []): VPNServiceContext {
  const ctx: VPNServiceContext = {
    config: {
      publicUrl: 'https://vpn.jeju.network',
      port: 3000,
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      coordinatorUrl: 'https://coordinator.jeju.network',
      contracts: {
        vpnRegistry: '0x1234567890123456789012345678901234567890' as Address,
        vpnBilling: '0x2234567890123456789012345678901234567890' as Address,
        x402Facilitator:
          '0x3234567890123456789012345678901234567890' as Address,
      },
      paymentRecipient: '0x4234567890123456789012345678901234567890' as Address,
      pricing: {
        pricePerGB: '1000000000000000',
        pricePerHour: '100000000000000',
        pricePerRequest: '10000000000000',
        supportedTokens: [
          '0x5234567890123456789012345678901234567890' as Address,
        ],
      },
    },
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
  }
  for (const node of nodes) {
    ctx.nodes.set(node.nodeId, node)
  }
  return ctx
}

describe('validateCountryCode', () => {
  test('accepts valid uppercase 2-letter code', () => {
    expect(validateCountryCode('US')).toBe('US')
    expect(validateCountryCode('DE')).toBe('DE')
    expect(validateCountryCode('JP')).toBe('JP')
  })

  test('converts lowercase to uppercase', () => {
    expect(validateCountryCode('us')).toBe('US')
    expect(validateCountryCode('de')).toBe('DE')
  })

  test('converts mixed case to uppercase', () => {
    expect(validateCountryCode('uS')).toBe('US')
    expect(validateCountryCode('Us')).toBe('US')
  })

  test('throws on empty string', () => {
    expect(() => validateCountryCode('')).toThrow('Invalid country code')
  })

  test('throws on single character', () => {
    expect(() => validateCountryCode('U')).toThrow('Invalid country code')
  })

  test('throws on more than 2 characters', () => {
    expect(() => validateCountryCode('USA')).toThrow('Invalid country code')
  })

  test('throws on non-alpha characters', () => {
    expect(() => validateCountryCode('U1')).toThrow(
      'Invalid country code format',
    )
    expect(() => validateCountryCode('1U')).toThrow(
      'Invalid country code format',
    )
    expect(() => validateCountryCode('12')).toThrow(
      'Invalid country code format',
    )
  })
})

describe('filterNodesByCountry', () => {
  const nodes: VPNNodeState[] = [
    createTestNode({ nodeId: 'node-us-1', countryCode: 'US' }),
    createTestNode({ nodeId: 'node-us-2', countryCode: 'US' }),
    createTestNode({ nodeId: 'node-de-1', countryCode: 'DE' }),
    createTestNode({ nodeId: 'node-jp-1', countryCode: 'JP' }),
  ]

  test('filters by country code', () => {
    const result = filterNodesByCountry(nodes, 'US')
    expect(result.length).toBe(2)
    expect(result.every((n) => n.countryCode === 'US')).toBe(true)
  })

  test('handles case-insensitive country code', () => {
    const result = filterNodesByCountry(nodes, 'us')
    expect(result.length).toBe(2)
  })

  test('returns empty array when no nodes match', () => {
    const result = filterNodesByCountry(nodes, 'FR')
    expect(result.length).toBe(0)
  })

  test('throws on invalid country code', () => {
    expect(() => filterNodesByCountry(nodes, 'USA')).toThrow(
      'Invalid country code',
    )
  })
})

describe('filterNodesByStatus', () => {
  const nodes: VPNNodeState[] = [
    createTestNode({ nodeId: 'node-1', status: 'online' }),
    createTestNode({ nodeId: 'node-2', status: 'online' }),
    createTestNode({ nodeId: 'node-3', status: 'busy' }),
    createTestNode({ nodeId: 'node-4', status: 'offline' }),
  ]

  test('filters online nodes', () => {
    const result = filterNodesByStatus(nodes, 'online')
    expect(result.length).toBe(2)
    expect(result.every((n) => n.status === 'online')).toBe(true)
  })

  test('filters busy nodes', () => {
    const result = filterNodesByStatus(nodes, 'busy')
    expect(result.length).toBe(1)
    expect(result[0].status).toBe('busy')
  })

  test('filters offline nodes', () => {
    const result = filterNodesByStatus(nodes, 'offline')
    expect(result.length).toBe(1)
    expect(result[0].status).toBe('offline')
  })

  test('defaults to online filter', () => {
    const result = filterNodesByStatus(nodes)
    expect(result.length).toBe(2)
  })
})

describe('sortNodesByStatusAndLoad', () => {
  test('puts online nodes first', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'offline',
        status: 'offline',
        activeConnections: 0,
      }),
      createTestNode({
        nodeId: 'online',
        status: 'online',
        activeConnections: 50,
      }),
      createTestNode({ nodeId: 'busy', status: 'busy', activeConnections: 90 }),
    ]
    const result = sortNodesByStatusAndLoad(nodes)
    expect(result[0].nodeId).toBe('online')
  })

  test('sorts online nodes by active connections', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'high-load',
        status: 'online',
        activeConnections: 90,
      }),
      createTestNode({
        nodeId: 'low-load',
        status: 'online',
        activeConnections: 10,
      }),
      createTestNode({
        nodeId: 'mid-load',
        status: 'online',
        activeConnections: 50,
      }),
    ]
    const result = sortNodesByStatusAndLoad(nodes)
    expect(result[0].nodeId).toBe('low-load')
    expect(result[1].nodeId).toBe('mid-load')
    expect(result[2].nodeId).toBe('high-load')
  })

  test('does not mutate original array', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({ nodeId: 'b', activeConnections: 50 }),
      createTestNode({ nodeId: 'a', activeConnections: 10 }),
    ]
    const original = [...nodes]
    sortNodesByStatusAndLoad(nodes)
    expect(nodes[0].nodeId).toBe(original[0].nodeId)
  })
})

describe('sortNodesByLoad', () => {
  test('sorts by load percentage (lowest first)', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'high',
        activeConnections: 80,
        maxConnections: 100,
      }),
      createTestNode({
        nodeId: 'low',
        activeConnections: 10,
        maxConnections: 100,
      }),
      createTestNode({
        nodeId: 'mid',
        activeConnections: 50,
        maxConnections: 100,
      }),
    ]
    const result = sortNodesByLoad(nodes)
    expect(result[0].nodeId).toBe('low')
    expect(result[1].nodeId).toBe('mid')
    expect(result[2].nodeId).toBe('high')
  })

  test('handles different max connections', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'small-full',
        activeConnections: 10,
        maxConnections: 10,
      }), // 100%
      createTestNode({
        nodeId: 'big-half',
        activeConnections: 50,
        maxConnections: 100,
      }), // 50%
    ]
    const result = sortNodesByLoad(nodes)
    expect(result[0].nodeId).toBe('big-half')
    expect(result[1].nodeId).toBe('small-full')
  })

  test('throws on zero maxConnections', () => {
    // Need 2 nodes to trigger the sort comparator
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'bad',
        maxConnections: 0,
        activeConnections: 0,
      }),
      createTestNode({
        nodeId: 'good',
        maxConnections: 100,
        activeConnections: 50,
      }),
    ]
    expect(() => sortNodesByLoad(nodes)).toThrow(
      'Invalid node load calculation',
    )
  })
})

describe('calculateNodeLoad', () => {
  test('calculates load percentage correctly', () => {
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 50, maxConnections: 100 }),
      ),
    ).toBe(50)
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 25, maxConnections: 100 }),
      ),
    ).toBe(25)
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 75, maxConnections: 100 }),
      ),
    ).toBe(75)
  })

  test('returns 0 for empty node', () => {
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 0, maxConnections: 100 }),
      ),
    ).toBe(0)
  })

  test('returns 100 for full node', () => {
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 100, maxConnections: 100 }),
      ),
    ).toBe(100)
  })

  test('returns 100 for zero max connections', () => {
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 0, maxConnections: 0 }),
      ),
    ).toBe(100)
  })

  test('rounds to nearest integer', () => {
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 33, maxConnections: 100 }),
      ),
    ).toBe(33)
    expect(
      calculateNodeLoad(
        createTestNode({ activeConnections: 1, maxConnections: 3 }),
      ),
    ).toBe(33)
  })

  test('throws on invalid load (over 100%)', () => {
    expect(() =>
      calculateNodeLoad(
        createTestNode({ activeConnections: 150, maxConnections: 100 }),
      ),
    ).toThrow('Invalid load calculation')
  })
})

describe('findBestNode', () => {
  test('returns lowest load online node', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'high',
        status: 'online',
        activeConnections: 90,
        maxConnections: 100,
      }),
      createTestNode({
        nodeId: 'low',
        status: 'online',
        activeConnections: 10,
        maxConnections: 100,
      }),
    ]
    const ctx = createTestContext(nodes)
    const result = findBestNode(ctx)
    expect(result?.nodeId).toBe('low')
  })

  test('filters by country when provided', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'us-low',
        countryCode: 'US',
        activeConnections: 10,
        maxConnections: 100,
      }),
      createTestNode({
        nodeId: 'de-lower',
        countryCode: 'DE',
        activeConnections: 5,
        maxConnections: 100,
      }),
    ]
    const ctx = createTestContext(nodes)
    const result = findBestNode(ctx, 'US')
    expect(result?.nodeId).toBe('us-low')
  })

  test('ignores offline nodes', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({
        nodeId: 'offline-low',
        status: 'offline',
        activeConnections: 0,
        maxConnections: 100,
      }),
      createTestNode({
        nodeId: 'online-high',
        status: 'online',
        activeConnections: 90,
        maxConnections: 100,
      }),
    ]
    const ctx = createTestContext(nodes)
    const result = findBestNode(ctx)
    expect(result?.nodeId).toBe('online-high')
  })

  test('returns undefined when no nodes available', () => {
    const ctx = createTestContext([])
    const result = findBestNode(ctx)
    expect(result).toBeUndefined()
  })

  test('returns undefined when no online nodes', () => {
    const nodes: VPNNodeState[] = [createTestNode({ status: 'offline' })]
    const ctx = createTestContext(nodes)
    const result = findBestNode(ctx)
    expect(result).toBeUndefined()
  })
})

describe('getNodesByCountry', () => {
  test('groups nodes by country', () => {
    const nodes: VPNNodeState[] = [
      createTestNode({ nodeId: 'us-1', countryCode: 'US' }),
      createTestNode({ nodeId: 'us-2', countryCode: 'US' }),
      createTestNode({ nodeId: 'de-1', countryCode: 'DE' }),
    ]
    const ctx = createTestContext(nodes)
    const result = getNodesByCountry(ctx)

    expect(result.get('US')).toBe(2)
    expect(result.get('DE')).toBe(1)
  })

  test('returns empty map for no nodes', () => {
    const ctx = createTestContext([])
    const result = getNodesByCountry(ctx)
    expect(result.size).toBe(0)
  })
})

describe('getNodeById', () => {
  test('returns node by id', () => {
    const node = createTestNode({ nodeId: 'target-node' })
    const ctx = createTestContext([node])
    const result = getNodeById(ctx, 'target-node')
    expect(result.nodeId).toBe('target-node')
  })

  test('throws when node not found', () => {
    const ctx = createTestContext([])
    expect(() => getNodeById(ctx, 'missing-node')).toThrow(
      'Node not found: missing-node',
    )
  })
})
