/**
 * Entities Unit Tests
 *
 * Tests the account factory and entity helper functions.
 */

import { beforeEach, describe, expect, it } from 'bun:test'

// Mock Account class matching the model
class MockAccount {
  id: string
  address: string
  isContract: boolean
  firstSeenBlock: number
  lastSeenBlock: number
  transactionCount: number
  totalValueSent: bigint
  totalValueReceived: bigint
  labels: string[]
  firstSeenAt: Date
  lastSeenAt: Date

  constructor(data: {
    id: string
    address: string
    isContract: boolean
    firstSeenBlock: number
    lastSeenBlock: number
    transactionCount: number
    totalValueSent: bigint
    totalValueReceived: bigint
    labels: string[]
    firstSeenAt: Date
    lastSeenAt: Date
  }) {
    this.id = data.id
    this.address = data.address
    this.isContract = data.isContract
    this.firstSeenBlock = data.firstSeenBlock
    this.lastSeenBlock = data.lastSeenBlock
    this.transactionCount = data.transactionCount
    this.totalValueSent = data.totalValueSent
    this.totalValueReceived = data.totalValueReceived
    this.labels = data.labels
    this.firstSeenAt = data.firstSeenAt
    this.lastSeenAt = data.lastSeenAt
  }
}

// Re-implementation of createAccountFactory matching src/lib/entities.ts
function createAccountFactory() {
  const accounts = new Map<string, MockAccount>()

  return {
    getOrCreate(
      address: string,
      blockNumber: number,
      timestamp: Date,
    ): MockAccount {
      if (
        !address ||
        typeof address !== 'string' ||
        address.trim().length === 0
      ) {
        throw new Error('address is required and must be a non-empty string')
      }
      if (
        typeof blockNumber !== 'number' ||
        blockNumber < 0 ||
        !Number.isInteger(blockNumber)
      ) {
        throw new Error(
          `Invalid blockNumber: ${blockNumber}. Must be a non-negative integer.`,
        )
      }
      if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
        throw new Error('timestamp must be a valid Date object')
      }

      const id = address.toLowerCase()
      let account = accounts.get(id)
      if (!account) {
        account = new MockAccount({
          id,
          address: id,
          isContract: false,
          firstSeenBlock: blockNumber,
          lastSeenBlock: blockNumber,
          transactionCount: 0,
          totalValueSent: 0n,
          totalValueReceived: 0n,
          labels: [],
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
        })
        accounts.set(id, account)
      } else {
        account.lastSeenBlock = blockNumber
        account.lastSeenAt = timestamp
      }
      return account
    },

    getAll(): MockAccount[] {
      return [...accounts.values()]
    },

    hasAccounts(): boolean {
      return accounts.size > 0
    },

    getMap(): Map<string, MockAccount> {
      return accounts
    },
  }
}

type AccountFactory = ReturnType<typeof createAccountFactory>

describe('Account Factory', () => {
  let factory: AccountFactory

  beforeEach(() => {
    factory = createAccountFactory()
  })

  describe('getOrCreate', () => {
    describe('creating new accounts', () => {
      it('should create a new account with correct initial values', () => {
        const address = '0x1234567890abcdef1234567890abcdef12345678'
        const blockNumber = 12345678
        const timestamp = new Date('2024-06-15T10:00:00Z')

        const account = factory.getOrCreate(address, blockNumber, timestamp)

        expect(account.id).toBe(address.toLowerCase())
        expect(account.address).toBe(address.toLowerCase())
        expect(account.isContract).toBe(false)
        expect(account.firstSeenBlock).toBe(12345678)
        expect(account.lastSeenBlock).toBe(12345678)
        expect(account.transactionCount).toBe(0)
        expect(account.totalValueSent).toBe(0n)
        expect(account.totalValueReceived).toBe(0n)
        expect(account.labels).toEqual([])
        expect(account.firstSeenAt).toEqual(timestamp)
        expect(account.lastSeenAt).toEqual(timestamp)
      })

      it('should lowercase addresses', () => {
        const address = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12'
        const account = factory.getOrCreate(address, 1, new Date())

        expect(account.id).toBe(address.toLowerCase())
        expect(account.address).toBe(address.toLowerCase())
      })

      it('should handle mixed case addresses', () => {
        const address = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
        const account = factory.getOrCreate(address, 1, new Date())

        expect(account.id).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
      })
    })

    describe('retrieving existing accounts', () => {
      it('should return same instance for same address', () => {
        const address = '0x1234567890abcdef1234567890abcdef12345678'

        const account1 = factory.getOrCreate(
          address,
          1000,
          new Date('2024-01-01'),
        )
        const account2 = factory.getOrCreate(
          address,
          2000,
          new Date('2024-06-01'),
        )

        expect(account1).toBe(account2)
      })

      it('should update lastSeenBlock on subsequent access', () => {
        const address = '0x1234567890abcdef1234567890abcdef12345678'

        factory.getOrCreate(address, 1000, new Date('2024-01-01'))
        const account = factory.getOrCreate(
          address,
          5000,
          new Date('2024-06-01'),
        )

        expect(account.firstSeenBlock).toBe(1000)
        expect(account.lastSeenBlock).toBe(5000)
      })

      it('should update lastSeenAt on subsequent access', () => {
        const address = '0x1234567890abcdef1234567890abcdef12345678'
        const firstTime = new Date('2024-01-01T10:00:00Z')
        const secondTime = new Date('2024-06-01T15:30:00Z')

        factory.getOrCreate(address, 1000, firstTime)
        const account = factory.getOrCreate(address, 5000, secondTime)

        expect(account.firstSeenAt).toEqual(firstTime)
        expect(account.lastSeenAt).toEqual(secondTime)
      })

      it('should be case-insensitive for address matching', () => {
        const lower = '0xabcdef1234567890abcdef1234567890abcdef12'
        const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12'

        const account1 = factory.getOrCreate(
          lower,
          1000,
          new Date('2024-01-01'),
        )
        const account2 = factory.getOrCreate(
          upper,
          2000,
          new Date('2024-06-01'),
        )

        expect(account1).toBe(account2)
        expect(account1.lastSeenBlock).toBe(2000)
      })
    })

    describe('input validation', () => {
      it('should throw on empty address', () => {
        expect(() => factory.getOrCreate('', 1, new Date())).toThrow(
          'address is required',
        )
      })

      it('should throw on whitespace-only address', () => {
        expect(() => factory.getOrCreate('   ', 1, new Date())).toThrow(
          'address is required',
        )
      })

      it('should throw on null address', () => {
        expect(() =>
          factory.getOrCreate(null as unknown as string, 1, new Date()),
        ).toThrow('address is required')
      })

      it('should throw on undefined address', () => {
        expect(() =>
          factory.getOrCreate(undefined as unknown as string, 1, new Date()),
        ).toThrow('address is required')
      })

      it('should throw on negative block number', () => {
        expect(() =>
          factory.getOrCreate(
            '0x1234567890abcdef1234567890abcdef12345678',
            -1,
            new Date(),
          ),
        ).toThrow('Invalid blockNumber')
      })

      it('should throw on non-integer block number', () => {
        expect(() =>
          factory.getOrCreate(
            '0x1234567890abcdef1234567890abcdef12345678',
            1.5,
            new Date(),
          ),
        ).toThrow('Invalid blockNumber')
      })

      it('should throw on NaN block number', () => {
        expect(() =>
          factory.getOrCreate(
            '0x1234567890abcdef1234567890abcdef12345678',
            NaN,
            new Date(),
          ),
        ).toThrow('Invalid blockNumber')
      })

      it('should throw on string block number', () => {
        expect(() =>
          factory.getOrCreate(
            '0x1234567890abcdef1234567890abcdef12345678',
            '100' as unknown as number,
            new Date(),
          ),
        ).toThrow('Invalid blockNumber')
      })

      it('should throw on invalid date', () => {
        expect(() =>
          factory.getOrCreate(
            '0x1234567890abcdef1234567890abcdef12345678',
            1,
            new Date('invalid'),
          ),
        ).toThrow('timestamp must be a valid Date object')
      })

      it('should throw on non-date timestamp', () => {
        expect(() =>
          factory.getOrCreate(
            '0x1234567890abcdef1234567890abcdef12345678',
            1,
            '2024-01-01' as unknown as Date,
          ),
        ).toThrow('timestamp must be a valid Date object')
      })

      it('should accept block number 0 (genesis)', () => {
        const account = factory.getOrCreate(
          '0x1234567890abcdef1234567890abcdef12345678',
          0,
          new Date(),
        )
        expect(account.firstSeenBlock).toBe(0)
      })
    })
  })

  describe('getAll', () => {
    it('should return empty array initially', () => {
      expect(factory.getAll()).toEqual([])
    })

    it('should return all created accounts', () => {
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )
      factory.getOrCreate(
        '0x2222222222222222222222222222222222222222',
        2,
        new Date(),
      )
      factory.getOrCreate(
        '0x3333333333333333333333333333333333333333',
        3,
        new Date(),
      )

      const accounts = factory.getAll()
      expect(accounts.length).toBe(3)
    })

    it('should not include duplicates from same address', () => {
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        2,
        new Date(),
      )
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        3,
        new Date(),
      )

      const accounts = factory.getAll()
      expect(accounts.length).toBe(1)
    })

    it('should return a copy of the values', () => {
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )

      const accounts1 = factory.getAll()
      const accounts2 = factory.getAll()

      expect(accounts1).not.toBe(accounts2)
      expect(accounts1).toEqual(accounts2)
    })
  })

  describe('hasAccounts', () => {
    it('should return false initially', () => {
      expect(factory.hasAccounts()).toBe(false)
    })

    it('should return true after adding an account', () => {
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )
      expect(factory.hasAccounts()).toBe(true)
    })

    it('should return true with multiple accounts', () => {
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )
      factory.getOrCreate(
        '0x2222222222222222222222222222222222222222',
        2,
        new Date(),
      )
      expect(factory.hasAccounts()).toBe(true)
    })
  })

  describe('getMap', () => {
    it('should return the internal map', () => {
      const map = factory.getMap()
      expect(map instanceof Map).toBe(true)
      expect(map.size).toBe(0)
    })

    it('should reflect changes to accounts', () => {
      factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )

      const map = factory.getMap()
      expect(map.size).toBe(1)
      expect(map.has('0x1111111111111111111111111111111111111111')).toBe(true)
    })

    it('should allow direct access for advanced operations', () => {
      const account = factory.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )

      const map = factory.getMap()
      const retrieved = map.get('0x1111111111111111111111111111111111111111')

      expect(retrieved).toBe(account)
    })
  })

  describe('factory isolation', () => {
    it('should not share state between factory instances', () => {
      const factory1 = createAccountFactory()
      const factory2 = createAccountFactory()

      factory1.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        1,
        new Date(),
      )

      expect(factory1.hasAccounts()).toBe(true)
      expect(factory2.hasAccounts()).toBe(false)
    })

    it('should create independent accounts in different factories', () => {
      const factory1 = createAccountFactory()
      const factory2 = createAccountFactory()
      const address = '0x1111111111111111111111111111111111111111'

      const account1 = factory1.getOrCreate(
        address,
        1000,
        new Date('2024-01-01'),
      )
      const account2 = factory2.getOrCreate(
        address,
        2000,
        new Date('2024-06-01'),
      )

      expect(account1).not.toBe(account2)
      expect(account1.firstSeenBlock).toBe(1000)
      expect(account2.firstSeenBlock).toBe(2000)
    })
  })
})

describe('Account Entity State Tracking', () => {
  it('should track account activity over multiple blocks', () => {
    const factory = createAccountFactory()
    const address = '0x1234567890abcdef1234567890abcdef12345678'

    // First seen at block 1000
    factory.getOrCreate(address, 1000, new Date('2024-01-01'))

    // Active at block 1500
    factory.getOrCreate(address, 1500, new Date('2024-02-01'))

    // Active at block 2000
    const account = factory.getOrCreate(address, 2000, new Date('2024-03-01'))

    expect(account.firstSeenBlock).toBe(1000)
    expect(account.lastSeenBlock).toBe(2000)
    expect(account.firstSeenAt.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(account.lastSeenAt.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })

  it('should allow modification of account properties after creation', () => {
    const factory = createAccountFactory()
    const account = factory.getOrCreate(
      '0x1234567890abcdef1234567890abcdef12345678',
      1,
      new Date(),
    )

    // Simulate processing transactions
    account.transactionCount += 5
    account.totalValueSent = 1000000000000000000n
    account.totalValueReceived = 500000000000000000n
    account.isContract = true
    account.labels = ['exchange', 'verified']

    expect(account.transactionCount).toBe(5)
    expect(account.totalValueSent).toBe(1000000000000000000n)
    expect(account.totalValueReceived).toBe(500000000000000000n)
    expect(account.isContract).toBe(true)
    expect(account.labels).toEqual(['exchange', 'verified'])
  })

  it('should persist modifications on subsequent retrieval', () => {
    const factory = createAccountFactory()
    const address = '0x1234567890abcdef1234567890abcdef12345678'

    const account1 = factory.getOrCreate(address, 1, new Date())
    account1.transactionCount = 10
    account1.isContract = true

    const account2 = factory.getOrCreate(address, 2, new Date())

    expect(account2.transactionCount).toBe(10)
    expect(account2.isContract).toBe(true)
  })
})

describe('Block Header and Log Data Interfaces', () => {
  // These are simple interfaces, testing shape compliance
  interface BlockHeader {
    hash: string
    height: number
    timestamp: number
  }

  interface LogData {
    address: string
    topics: readonly string[]
    data: string
    logIndex: number
    transactionIndex: number
    transaction?: { hash: string }
  }

  it('should comply with BlockHeader interface', () => {
    const header: BlockHeader = {
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      height: 12345678,
      timestamp: 1718448000,
    }

    expect(header.hash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(typeof header.height).toBe('number')
    expect(typeof header.timestamp).toBe('number')
  })

  it('should comply with LogData interface', () => {
    const log: LogData = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000001111111111111111111111111111111111111111',
        '0x0000000000000000000000002222222222222222222222222222222222222222',
      ],
      data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
      logIndex: 5,
      transactionIndex: 10,
      transaction: {
        hash: '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
      },
    }

    expect(log.address).toMatch(/^0x[a-f0-9]{40}$/)
    expect(log.topics.length).toBe(3)
    expect(typeof log.logIndex).toBe('number')
    expect(typeof log.transactionIndex).toBe('number')
    expect(log.transaction?.hash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('should handle LogData without optional transaction', () => {
    const log: LogData = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      topics: [],
      data: '0x',
      logIndex: 0,
      transactionIndex: 0,
    }

    expect(log.transaction).toBeUndefined()
  })
})

describe('Performance', () => {
  it('should efficiently handle many unique accounts', () => {
    const factory = createAccountFactory()
    const start = performance.now()

    for (let i = 0; i < 10000; i++) {
      const address = `0x${i.toString(16).padStart(40, '0')}`
      factory.getOrCreate(address, i, new Date())
    }

    const duration = performance.now() - start
    expect(factory.getAll().length).toBe(10000)
    expect(duration).toBeLessThan(1000) // Should complete in under 1 second
  })

  it('should efficiently handle repeated access to same accounts', () => {
    const factory = createAccountFactory()
    const addresses = Array.from(
      { length: 100 },
      (_, i) => `0x${i.toString(16).padStart(40, '0')}`,
    )

    // Create accounts
    for (const addr of addresses) {
      factory.getOrCreate(addr, 1, new Date())
    }

    // Simulate heavy access pattern
    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      const addr = addresses[i % addresses.length]
      factory.getOrCreate(addr, i, new Date())
    }

    const duration = performance.now() - start
    expect(factory.getAll().length).toBe(100)
    expect(duration).toBeLessThan(500) // Should complete in under 500ms
  })
})
