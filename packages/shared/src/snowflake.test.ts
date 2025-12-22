/**
 * Snowflake ID Generator Tests
 */

import { describe, expect, test } from 'bun:test'
import {
  generateSnowflakeId,
  isValidSnowflakeId,
  parseSnowflakeId,
  SnowflakeGenerator,
} from './snowflake'

describe('SnowflakeGenerator', () => {
  test('creates generator with default worker ID', () => {
    const generator = new SnowflakeGenerator()
    expect(generator).toBeInstanceOf(SnowflakeGenerator)
  })

  test('creates generator with custom worker ID', () => {
    const generator = new SnowflakeGenerator(123)
    expect(generator).toBeInstanceOf(SnowflakeGenerator)
  })

  test('throws for negative worker ID', () => {
    expect(() => new SnowflakeGenerator(-1)).toThrow()
  })

  test('throws for worker ID > 1023', () => {
    expect(() => new SnowflakeGenerator(1024)).toThrow()
  })

  test('generates unique IDs', async () => {
    const generator = new SnowflakeGenerator(1)
    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      ids.add(await generator.generate())
    }

    expect(ids.size).toBe(100)
  })

  test('generates IDs in increasing order', async () => {
    const generator = new SnowflakeGenerator(1)
    const ids: bigint[] = []

    for (let i = 0; i < 10; i++) {
      ids.push(BigInt(await generator.generate()))
    }

    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1])
    }
  })

  test('handles concurrent ID generation', async () => {
    const generator = new SnowflakeGenerator(1)
    const promises = Array(100)
      .fill(null)
      .map(() => generator.generate())
    const ids = await Promise.all(promises)

    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(100)
  })
})

describe('generateSnowflakeId', () => {
  test('generates valid ID string', async () => {
    const id = await generateSnowflakeId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  test('generates numeric string', async () => {
    const id = await generateSnowflakeId()
    expect(() => BigInt(id)).not.toThrow()
  })

  test('generates unique IDs across calls', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      ids.add(await generateSnowflakeId())
    }
    expect(ids.size).toBe(50)
  })
})

describe('parseSnowflakeId', () => {
  test('parses string ID', async () => {
    const id = await generateSnowflakeId()
    const parsed = parseSnowflakeId(id)

    expect(parsed).toHaveProperty('timestamp')
    expect(parsed).toHaveProperty('workerId')
    expect(parsed).toHaveProperty('sequence')
  })

  test('parses bigint ID', async () => {
    const id = BigInt(await generateSnowflakeId())
    const parsed = parseSnowflakeId(id)

    expect(parsed.timestamp).toBeInstanceOf(Date)
    expect(typeof parsed.workerId).toBe('number')
    expect(typeof parsed.sequence).toBe('number')
  })

  test('extracts correct worker ID', async () => {
    const generator = new SnowflakeGenerator(42)
    const id = await generator.generate()
    const parsed = parseSnowflakeId(id)

    expect(parsed.workerId).toBe(42)
  })

  test('timestamp is recent', async () => {
    const before = new Date()
    const id = await generateSnowflakeId()
    const after = new Date()
    const parsed = parseSnowflakeId(id)

    expect(parsed.timestamp.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    )
    expect(parsed.timestamp.getTime()).toBeLessThanOrEqual(
      after.getTime() + 1000,
    )
  })

  test('sequence is within valid range', async () => {
    const id = await generateSnowflakeId()
    const parsed = parseSnowflakeId(id)

    expect(parsed.sequence).toBeGreaterThanOrEqual(0)
    expect(parsed.sequence).toBeLessThanOrEqual(4095)
  })
})

describe('isValidSnowflakeId', () => {
  test('returns true for valid ID', async () => {
    const id = await generateSnowflakeId()
    expect(isValidSnowflakeId(id)).toBe(true)
  })

  test('returns true for manually created valid ID', () => {
    // A valid snowflake ID structure
    expect(isValidSnowflakeId('123456789012345678')).toBe(true)
  })

  test('returns false for negative numbers', () => {
    expect(isValidSnowflakeId('-1')).toBe(false)
  })

  test('returns false for numbers too large', () => {
    // 2^63 is too large
    expect(isValidSnowflakeId('9223372036854775808')).toBe(false)
  })

  test('handles edge case at max valid value', () => {
    // 2^63 - 1 should be valid
    const maxValid = '9223372036854775807'
    expect(isValidSnowflakeId(maxValid)).toBe(true)
  })
})

describe('ID structure', () => {
  test('different workers produce different IDs', async () => {
    const gen1 = new SnowflakeGenerator(1)
    const gen2 = new SnowflakeGenerator(2)

    const id1 = await gen1.generate()
    const id2 = await gen2.generate()

    expect(id1).not.toBe(id2)

    const parsed1 = parseSnowflakeId(id1)
    const parsed2 = parseSnowflakeId(id2)

    expect(parsed1.workerId).toBe(1)
    expect(parsed2.workerId).toBe(2)
  })

  test('IDs contain timestamp component', async () => {
    const before = Date.now()
    const id = await generateSnowflakeId()
    const after = Date.now()

    const parsed = parseSnowflakeId(id)
    const timestamp = parsed.timestamp.getTime()

    // Allow some tolerance
    expect(timestamp).toBeGreaterThanOrEqual(before - 1000)
    expect(timestamp).toBeLessThanOrEqual(after + 1000)
  })
})
