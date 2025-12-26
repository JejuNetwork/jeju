/**
 * Entities Unit Tests
 *
 * Tests the entity helper functions.
 * Note: Testing createAccountFactory requires TypeORM initialization due to
 * circular dependencies in the generated models. Full testing of the factory
 * is done in integration tests where the TypeORM context is available.
 *
 * This test validates the relationId helper which doesn't require ORM setup.
 */

import { describe, expect, it } from 'bun:test'
import { relationId } from '../../api/utils/relation-id'

describe('relationId helper', () => {
  it('should create a relation reference with just id', () => {
    interface TestEntity {
      id: string
      name: string
    }
    const ref = relationId<TestEntity>('test-id')
    expect(ref.id).toBe('test-id')
  })

  it('should work with different id values', () => {
    interface Entity {
      id: string
    }
    const ref1 = relationId<Entity>('0x123')
    const ref2 = relationId<Entity>('abc-def-ghi')
    expect(ref1.id).toBe('0x123')
    expect(ref2.id).toBe('abc-def-ghi')
  })

  it('should work with ethereum addresses', () => {
    interface Account {
      id: string
      address: string
    }
    const address = '0x1234567890abcdef1234567890abcdef12345678'
    const ref = relationId<Account>(address)
    expect(ref.id).toBe(address)
  })

  it('should work with block hashes', () => {
    interface Block {
      id: string
      hash: string
      height: number
    }
    const hash =
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    const ref = relationId<Block>(hash)
    expect(ref.id).toBe(hash)
  })

  it('should work with uuids', () => {
    interface Event {
      id: string
      type: string
    }
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const ref = relationId<Event>(uuid)
    expect(ref.id).toBe(uuid)
  })

  it('should work with compound ids', () => {
    interface TokenBalance {
      id: string
      amount: bigint
    }
    const compoundId =
      '0x1234567890abcdef1234567890abcdef12345678-0xabcdef1234567890abcdef1234567890abcdef12'
    const ref = relationId<TokenBalance>(compoundId)
    expect(ref.id).toBe(compoundId)
  })
})

describe('Account Factory Pattern Validation', () => {
  /**
   * These tests validate the logic patterns used in createAccountFactory
   * without importing the actual Account model (which requires TypeORM).
   * The actual factory is tested in integration tests.
   */

  interface AccountLike {
    id: string
    address: string
    firstSeenBlock: number
    lastSeenBlock: number
  }

  function createTestFactory() {
    const accounts = new Map<string, AccountLike>()
    return {
      getOrCreate(address: string, blockNumber: number): AccountLike {
        if (!address || address.trim().length === 0) {
          throw new Error('address is required and must be a non-empty string')
        }
        if (blockNumber < 0 || !Number.isInteger(blockNumber)) {
          throw new Error(
            `Invalid blockNumber: ${blockNumber}. Must be a non-negative integer.`,
          )
        }
        const id = address.toLowerCase()
        let account = accounts.get(id)
        if (!account) {
          account = {
            id,
            address: id,
            firstSeenBlock: blockNumber,
            lastSeenBlock: blockNumber,
          }
          accounts.set(id, account)
        } else {
          account.lastSeenBlock = blockNumber
        }
        return account
      },
      getAll(): AccountLike[] {
        return [...accounts.values()]
      },
      hasAccounts(): boolean {
        return accounts.size > 0
      },
    }
  }

  describe('address validation', () => {
    it('should throw on empty address', () => {
      const factory = createTestFactory()
      expect(() => factory.getOrCreate('', 1)).toThrow('address is required')
    })

    it('should throw on whitespace-only address', () => {
      const factory = createTestFactory()
      expect(() => factory.getOrCreate('   ', 1)).toThrow('address is required')
    })
  })

  describe('block number validation', () => {
    it('should throw on negative block number', () => {
      const factory = createTestFactory()
      expect(() =>
        factory.getOrCreate('0x1234567890abcdef1234567890abcdef12345678', -1),
      ).toThrow('Invalid blockNumber')
    })

    it('should throw on non-integer block number', () => {
      const factory = createTestFactory()
      expect(() =>
        factory.getOrCreate('0x1234567890abcdef1234567890abcdef12345678', 1.5),
      ).toThrow('Invalid blockNumber')
    })

    it('should throw on NaN block number', () => {
      const factory = createTestFactory()
      expect(() =>
        factory.getOrCreate('0x1234567890abcdef1234567890abcdef12345678', NaN),
      ).toThrow('Invalid blockNumber')
    })

    it('should accept block number 0 (genesis)', () => {
      const factory = createTestFactory()
      const account = factory.getOrCreate(
        '0x1234567890abcdef1234567890abcdef12345678',
        0,
      )
      expect(account.firstSeenBlock).toBe(0)
    })
  })

  describe('address normalization', () => {
    it('should lowercase addresses', () => {
      const factory = createTestFactory()
      const address = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12'
      const account = factory.getOrCreate(address, 1)
      expect(account.id).toBe(address.toLowerCase())
    })

    it('should be case-insensitive for matching', () => {
      const factory = createTestFactory()
      const lower = '0xabcdef1234567890abcdef1234567890abcdef12'
      const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12'

      const account1 = factory.getOrCreate(lower, 1000)
      const account2 = factory.getOrCreate(upper, 2000)

      expect(account1).toBe(account2)
      expect(account1.lastSeenBlock).toBe(2000)
    })
  })

  describe('factory behavior', () => {
    it('should return same instance for same address', () => {
      const factory = createTestFactory()
      const address = '0x1234567890abcdef1234567890abcdef12345678'

      const account1 = factory.getOrCreate(address, 1000)
      const account2 = factory.getOrCreate(address, 2000)

      expect(account1).toBe(account2)
    })

    it('should update lastSeenBlock on subsequent access', () => {
      const factory = createTestFactory()
      const address = '0x1234567890abcdef1234567890abcdef12345678'

      factory.getOrCreate(address, 1000)
      const account = factory.getOrCreate(address, 5000)

      expect(account.firstSeenBlock).toBe(1000)
      expect(account.lastSeenBlock).toBe(5000)
    })

    it('should track multiple accounts', () => {
      const factory = createTestFactory()
      factory.getOrCreate('0x1111111111111111111111111111111111111111', 1)
      factory.getOrCreate('0x2222222222222222222222222222222222222222', 2)
      factory.getOrCreate('0x3333333333333333333333333333333333333333', 3)

      expect(factory.getAll().length).toBe(3)
    })

    it('should not share state between instances', () => {
      const factory1 = createTestFactory()
      const factory2 = createTestFactory()

      factory1.getOrCreate('0x1111111111111111111111111111111111111111', 1)

      expect(factory1.hasAccounts()).toBe(true)
      expect(factory2.hasAccounts()).toBe(false)
    })
  })

  describe('performance characteristics', () => {
    it('should efficiently handle many unique accounts', () => {
      const factory = createTestFactory()
      const start = performance.now()

      for (let i = 0; i < 10000; i++) {
        const address = `0x${i.toString(16).padStart(40, '0')}`
        factory.getOrCreate(address, i)
      }

      const duration = performance.now() - start
      expect(factory.getAll().length).toBe(10000)
      expect(duration).toBeLessThan(1000)
    })

    it('should efficiently handle repeated access', () => {
      const factory = createTestFactory()
      const addresses = Array.from(
        { length: 100 },
        (_, i) => `0x${i.toString(16).padStart(40, '0')}`,
      )

      for (const addr of addresses) {
        factory.getOrCreate(addr, 1)
      }

      const start = performance.now()
      for (let i = 0; i < 100000; i++) {
        const addr = addresses[i % addresses.length]
        factory.getOrCreate(addr, i)
      }

      const duration = performance.now() - start
      expect(factory.getAll().length).toBe(100)
      expect(duration).toBeLessThan(500)
    })
  })
})
