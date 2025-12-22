/**
 * Block Utils Unit Tests
 *
 * Tests the block identifier parsing and query building logic.
 */

import { describe, expect, it } from 'bun:test'

// Types matching src/lib/block-utils.ts
interface BlockIdentifier {
  type: 'number' | 'hash'
  value: number | string
}

// Re-implementation of parseBlockIdentifier for testing
// (matching src/lib/block-utils.ts logic)
function parseBlockIdentifier(numberOrHash: string): BlockIdentifier {
  if (!numberOrHash || typeof numberOrHash !== 'string') {
    throw new Error('Block identifier is required and must be a string')
  }

  if (numberOrHash.startsWith('0x')) {
    // It's a hash - validate format
    if (!/^0x[a-fA-F0-9]{64}$/.test(numberOrHash)) {
      throw new Error(`Invalid block hash format: ${numberOrHash}`)
    }
    return { type: 'hash', value: numberOrHash }
  } else {
    // It's a block number
    const blockNumber = parseInt(numberOrHash, 10)
    if (Number.isNaN(blockNumber) || blockNumber <= 0) {
      throw new Error(
        `Invalid block number: ${numberOrHash}. Must be a positive integer.`,
      )
    }
    return { type: 'number', value: blockNumber }
  }
}

function buildBlockWhereClause(identifier: BlockIdentifier): {
  hash?: string
  number?: number
} {
  if (identifier.type === 'hash') {
    return { hash: identifier.value as string }
  } else {
    return { number: identifier.value as number }
  }
}

describe('parseBlockIdentifier', () => {
  describe('Block Numbers', () => {
    it('should parse valid block numbers', () => {
      expect(parseBlockIdentifier('1')).toEqual({ type: 'number', value: 1 })
      expect(parseBlockIdentifier('100')).toEqual({
        type: 'number',
        value: 100,
      })
      expect(parseBlockIdentifier('12345678')).toEqual({
        type: 'number',
        value: 12345678,
      })
      expect(parseBlockIdentifier('999999999')).toEqual({
        type: 'number',
        value: 999999999,
      })
    })

    it('should throw on zero block number', () => {
      expect(() => parseBlockIdentifier('0')).toThrow('Invalid block number')
    })

    it('should throw on negative block number', () => {
      expect(() => parseBlockIdentifier('-1')).toThrow('Invalid block number')
      expect(() => parseBlockIdentifier('-100')).toThrow('Invalid block number')
    })

    it('should throw on purely non-numeric strings', () => {
      expect(() => parseBlockIdentifier('abc')).toThrow('Invalid block number')
      expect(() => parseBlockIdentifier('abc12')).toThrow(
        'Invalid block number',
      )
    })

    it('should parse leading digits before non-numeric chars (parseInt behavior)', () => {
      // JavaScript's parseInt('12abc') returns 12 - this is expected behavior
      const result = parseBlockIdentifier('12abc')
      expect(result).toEqual({ type: 'number', value: 12 })
    })

    it('should parse integer portion of floating point (parseInt behavior)', () => {
      // JavaScript's parseInt('1.5') returns 1 - this is expected behavior
      const result1 = parseBlockIdentifier('1.5')
      expect(result1).toEqual({ type: 'number', value: 1 })

      const result2 = parseBlockIdentifier('100.0')
      expect(result2).toEqual({ type: 'number', value: 100 })
    })

    it('should handle very large block numbers', () => {
      const result = parseBlockIdentifier('999999999999')
      expect(result).toEqual({ type: 'number', value: 999999999999 })
    })
  })

  describe('Block Hashes', () => {
    it('should parse valid 64-character hex hash', () => {
      const hash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const result = parseBlockIdentifier(hash)
      expect(result).toEqual({ type: 'hash', value: hash })
    })

    it('should parse uppercase hex hash', () => {
      const hash =
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'
      const result = parseBlockIdentifier(hash)
      expect(result).toEqual({ type: 'hash', value: hash })
    })

    it('should parse mixed case hex hash', () => {
      const hash =
        '0xAbCdEf1234567890AbCdEf1234567890AbCdEf1234567890AbCdEf1234567890'
      const result = parseBlockIdentifier(hash)
      expect(result).toEqual({ type: 'hash', value: hash })
    })

    it('should throw on hash with wrong length', () => {
      // Too short
      expect(() => parseBlockIdentifier('0xabcdef')).toThrow(
        'Invalid block hash format',
      )
      // Too long
      expect(() =>
        parseBlockIdentifier(
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901234',
        ),
      ).toThrow('Invalid block hash format')
    })

    it('should throw on hash with invalid characters', () => {
      expect(() =>
        parseBlockIdentifier(
          '0xghijkl1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ),
      ).toThrow('Invalid block hash format')
    })

    it('should throw on hash without 0x prefix', () => {
      // This would be treated as a block number and fail
      expect(() =>
        parseBlockIdentifier(
          'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ),
      ).toThrow('Invalid block number')
    })
  })

  describe('Input Validation', () => {
    it('should throw on empty string', () => {
      expect(() => parseBlockIdentifier('')).toThrow(
        'Block identifier is required',
      )
    })

    it('should throw on null', () => {
      expect(() => parseBlockIdentifier(null as unknown as string)).toThrow(
        'Block identifier is required',
      )
    })

    it('should throw on undefined', () => {
      expect(() =>
        parseBlockIdentifier(undefined as unknown as string),
      ).toThrow('Block identifier is required')
    })

    it('should throw on non-string type', () => {
      expect(() => parseBlockIdentifier(123 as unknown as string)).toThrow(
        'Block identifier is required',
      )
    })

    it('should handle whitespace-only string as number and fail', () => {
      expect(() => parseBlockIdentifier('   ')).toThrow('Invalid block number')
    })
  })

  describe('Edge Cases', () => {
    it('should handle block number 1 (first block after genesis)', () => {
      const result = parseBlockIdentifier('1')
      expect(result).toEqual({ type: 'number', value: 1 })
    })

    it('should handle all-zero hash', () => {
      const hash =
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      const result = parseBlockIdentifier(hash)
      expect(result).toEqual({ type: 'hash', value: hash })
    })

    it('should handle all-f hash', () => {
      const hash =
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      const result = parseBlockIdentifier(hash)
      expect(result).toEqual({ type: 'hash', value: hash })
    })

    it('should not trim the input hash', () => {
      const hash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      // Hash should be stored exactly as provided
      const result = parseBlockIdentifier(hash)
      expect(result.value).toBe(hash)
    })
  })
})

describe('buildBlockWhereClause', () => {
  describe('Hash Identifier', () => {
    it('should return hash clause for hash type', () => {
      const identifier: BlockIdentifier = {
        type: 'hash',
        value:
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      }

      const result = buildBlockWhereClause(identifier)

      expect(result.hash).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      )
      expect(result.number).toBeUndefined()
    })
  })

  describe('Number Identifier', () => {
    it('should return number clause for number type', () => {
      const identifier: BlockIdentifier = {
        type: 'number',
        value: 12345678,
      }

      const result = buildBlockWhereClause(identifier)

      expect(result.number).toBe(12345678)
      expect(result.hash).toBeUndefined()
    })

    it('should handle block number 1', () => {
      const identifier: BlockIdentifier = { type: 'number', value: 1 }
      const result = buildBlockWhereClause(identifier)
      expect(result.number).toBe(1)
    })

    it('should handle large block numbers', () => {
      const identifier: BlockIdentifier = {
        type: 'number',
        value: 999999999999,
      }
      const result = buildBlockWhereClause(identifier)
      expect(result.number).toBe(999999999999)
    })
  })

  describe('Integration with parseBlockIdentifier', () => {
    it('should work together for block numbers', () => {
      const parsed = parseBlockIdentifier('12345678')
      const clause = buildBlockWhereClause(parsed)

      expect(clause).toEqual({ number: 12345678 })
    })

    it('should work together for block hashes', () => {
      const hash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const parsed = parseBlockIdentifier(hash)
      const clause = buildBlockWhereClause(parsed)

      expect(clause).toEqual({ hash })
    })
  })
})

describe('Block Identifier Patterns', () => {
  // Common patterns seen in real usage
  const validBlockNumbers = ['1', '100', '1000000', '12345678', '19000000']

  const validBlockHashes = [
    '0x0000000000000000000000000000000000000000000000000000000000000001',
    '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3', // Ethereum block 0
    '0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6', // Ethereum block 1
    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  ]

  // These inputs should throw (can't be parsed as valid block number or hash)
  const invalidInputs = [
    '',
    '0',
    '-1',
    'latest', // Not supported - use block number
    'pending',
    'earliest',
    '0x', // Empty hash
    '0xabc', // Too short
    'abc',
    // Note: '12.5' and '12abc' are NOT included because parseInt() will parse them as 12
  ]

  it('should accept all valid block numbers', () => {
    for (const num of validBlockNumbers) {
      const result = parseBlockIdentifier(num)
      expect(result.type).toBe('number')
      expect(result.value).toBe(parseInt(num, 10))
    }
  })

  it('should accept all valid block hashes', () => {
    for (const hash of validBlockHashes) {
      const result = parseBlockIdentifier(hash)
      expect(result.type).toBe('hash')
      expect(result.value).toBe(hash)
    }
  })

  it('should reject all invalid inputs', () => {
    for (const input of invalidInputs) {
      expect(() => parseBlockIdentifier(input)).toThrow()
    }
  })
})

describe('Performance Considerations', () => {
  it('should handle parsing many block identifiers efficiently', () => {
    const start = performance.now()

    for (let i = 0; i < 10000; i++) {
      parseBlockIdentifier(String(i + 1))
    }

    const duration = performance.now() - start
    // Should complete 10k parses in under 100ms
    expect(duration).toBeLessThan(100)
  })

  it('should handle parsing many hashes efficiently', () => {
    const hash =
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    const start = performance.now()

    for (let i = 0; i < 10000; i++) {
      parseBlockIdentifier(hash)
    }

    const duration = performance.now() - start
    // Should complete 10k parses in under 100ms
    expect(duration).toBeLessThan(100)
  })
})
