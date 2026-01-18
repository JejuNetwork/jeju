/**
 * Security Tests for Bazaar
 *
 * Tests security-critical functionality:
 * - Anvil key protection in deployment scripts (uses lib/secrets)
 * - GraphQL where clause injection prevention
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getDeployerKey } from '../../lib/secrets'

// Well-known Anvil account[0] key - public, safe for testing
const ANVIL_ACCOUNT_0_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Test the Anvil key protection logic (testing lib/secrets.ts)
describe('Anvil Key Protection', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Clear PRIVATE_KEY for clean test
    delete process.env.PRIVATE_KEY
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('allows Anvil key for localhost RPC on localnet', () => {
    process.env.JEJU_NETWORK = 'localnet'
    const key = getDeployerKey('http://localhost:8545')
    expect(key).toBe(ANVIL_ACCOUNT_0_KEY)
  })

  it('allows Anvil key for 127.0.0.1 RPC on localnet', () => {
    process.env.JEJU_NETWORK = 'localnet'
    const key = getDeployerKey('http://127.0.0.1:6546')
    expect(key).toBe(ANVIL_ACCOUNT_0_KEY)
  })

  it('throws for non-local RPC without env key', () => {
    process.env.JEJU_NETWORK = 'testnet'
    expect(() => getDeployerKey('https://sepolia.base.org')).toThrow()
  })

  it('throws for mainnet RPC without env key', () => {
    process.env.JEJU_NETWORK = 'mainnet'
    expect(() => getDeployerKey('https://mainnet.jejunetwork.org')).toThrow()
  })

  it('allows custom key for any RPC', () => {
    process.env.PRIVATE_KEY =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    process.env.JEJU_NETWORK = 'mainnet'
    const key = getDeployerKey('https://mainnet.jejunetwork.org')
    expect(key).toBe(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    )
  })

  it('prefers env key over Anvil key for local RPC', () => {
    const customKey =
      '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678'
    process.env.PRIVATE_KEY = customKey
    process.env.JEJU_NETWORK = 'localnet'
    expect(getDeployerKey('http://localhost:8545')).toBe(customKey)
  })

  it('throws when production build tries to use dev key', () => {
    process.env.NODE_ENV = 'production'
    process.env.JEJU_NETWORK = 'localnet'
    delete process.env.PRIVATE_KEY
    // Should throw even on localnet when NODE_ENV=production
    expect(() => getDeployerKey('http://localhost:8545')).toThrow()
  })
})

// Test the GraphQL where clause builder
describe('GraphQL Where Clause Builder', () => {
  type WhereCondition =
    | { field: string; op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte'; value: number }
    | { field: string; op: 'eq'; value: boolean }
    | { field: string; op: 'eq' | 'gte' | 'lte' | 'contains'; value: string }

  function buildWhereClause(conditions: WhereCondition[]): string {
    if (conditions.length === 0) return ''

    const parts = conditions.map((c) => {
      const key = `${c.field}_${c.op}`
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.field)) {
        throw new Error(`Invalid field name: ${c.field}`)
      }

      if (typeof c.value === 'number') {
        if (!Number.isFinite(c.value)) {
          throw new Error(`Invalid number value for ${c.field}`)
        }
        return `${key}: ${c.value}`
      }

      if (typeof c.value === 'boolean') {
        return `${key}: ${c.value}`
      }

      const escaped = c.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `${key}: "${escaped}"`
    })

    return `where: { ${parts.join(', ')} }`
  }

  it('builds empty clause for no conditions', () => {
    expect(buildWhereClause([])).toBe('')
  })

  it('builds simple number condition', () => {
    const result = buildWhereClause([
      { field: 'chainId', op: 'eq', value: 420691 },
    ])
    expect(result).toBe('where: { chainId_eq: 420691 }')
  })

  it('builds boolean condition', () => {
    const result = buildWhereClause([
      { field: 'verified', op: 'eq', value: true },
    ])
    expect(result).toBe('where: { verified_eq: true }')
  })

  it('builds string condition with proper quoting', () => {
    const result = buildWhereClause([
      { field: 'name', op: 'contains', value: 'test' },
    ])
    expect(result).toBe('where: { name_contains: "test" }')
  })

  it('escapes quotes in string values', () => {
    const result = buildWhereClause([
      { field: 'name', op: 'contains', value: 'test"injection' },
    ])
    expect(result).toBe('where: { name_contains: "test\\"injection" }')
  })

  it('escapes backslashes in string values', () => {
    const result = buildWhereClause([
      { field: 'name', op: 'contains', value: 'test\\path' },
    ])
    expect(result).toBe('where: { name_contains: "test\\\\path" }')
  })

  it('rejects invalid field names with special characters', () => {
    expect(() =>
      buildWhereClause([{ field: 'chain; DROP TABLE', op: 'eq', value: 1 }]),
    ).toThrow('Invalid field name')
  })

  it('rejects field names starting with number', () => {
    expect(() =>
      buildWhereClause([{ field: '123field', op: 'eq', value: 1 }]),
    ).toThrow('Invalid field name')
  })

  it('rejects field names with spaces', () => {
    expect(() =>
      buildWhereClause([{ field: 'my field', op: 'eq', value: 1 }]),
    ).toThrow('Invalid field name')
  })

  it('rejects NaN values', () => {
    expect(() =>
      buildWhereClause([{ field: 'price', op: 'gt', value: Number.NaN }]),
    ).toThrow('Invalid number value')
  })

  it('rejects Infinity values', () => {
    expect(() =>
      buildWhereClause([
        { field: 'price', op: 'gt', value: Number.POSITIVE_INFINITY },
      ]),
    ).toThrow('Invalid number value')
  })

  it('builds multiple conditions', () => {
    const result = buildWhereClause([
      { field: 'chainId', op: 'eq', value: 420691 },
      { field: 'verified', op: 'eq', value: true },
      { field: 'liquidityUSD', op: 'gte', value: '1000' },
    ])
    expect(result).toBe(
      'where: { chainId_eq: 420691, verified_eq: true, liquidityUSD_gte: "1000" }',
    )
  })

  it('prevents GraphQL injection via field names', () => {
    // Attempt to inject GraphQL syntax via field name
    expect(() =>
      buildWhereClause([{ field: 'id}, otherField: {id', op: 'eq', value: 1 }]),
    ).toThrow('Invalid field name')
  })

  it('handles comparison operators correctly', () => {
    expect(buildWhereClause([{ field: 'price', op: 'gt', value: 100 }])).toBe(
      'where: { price_gt: 100 }',
    )
    expect(buildWhereClause([{ field: 'price', op: 'lt', value: 100 }])).toBe(
      'where: { price_lt: 100 }',
    )
    expect(buildWhereClause([{ field: 'price', op: 'gte', value: 100 }])).toBe(
      'where: { price_gte: 100 }',
    )
    expect(buildWhereClause([{ field: 'price', op: 'lte', value: 100 }])).toBe(
      'where: { price_lte: 100 }',
    )
  })
})
