/**
 * Tests for DWSObjectId
 *
 * Comprehensive tests covering:
 * - Happy path operations
 * - Boundary conditions (empty strings, max lengths, special chars)
 * - Error handling (invalid inputs, wrong namespaces)
 * - Concurrent operations
 * - Cross-verification of ID structure
 */

import { describe, expect, test } from 'bun:test'
import { DWSObjectId } from './id'

describe('DWSObjectId', () => {
  // ============================================================================
  // fromName - Happy Path
  // ============================================================================

  describe('fromName', () => {
    test('creates deterministic ID from name', async () => {
      const id1 = await DWSObjectId.fromName('test-namespace', 'my-room')
      const id2 = await DWSObjectId.fromName('test-namespace', 'my-room')

      expect(id1.toString()).toBe(id2.toString())
      expect(id1.name).toBe('my-room')
    })

    test('different names produce different IDs', async () => {
      const id1 = await DWSObjectId.fromName('test-namespace', 'room-1')
      const id2 = await DWSObjectId.fromName('test-namespace', 'room-2')

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('different namespaces produce different IDs', async () => {
      const id1 = await DWSObjectId.fromName('namespace-1', 'same-name')
      const id2 = await DWSObjectId.fromName('namespace-2', 'same-name')

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('ID is 64 hex characters', async () => {
      const id = await DWSObjectId.fromName('test', 'name')

      expect(id.toString()).toMatch(/^[0-9a-f]{64}$/)
    })

    // Edge cases
    test('handles empty name string', async () => {
      const id = await DWSObjectId.fromName('namespace', '')

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe('')
    })

    test('handles empty namespace string', async () => {
      const id = await DWSObjectId.fromName('', 'name')

      expect(id.toString()).toHaveLength(64)
    })

    test('handles unicode characters in name', async () => {
      const id = await DWSObjectId.fromName('ns', '日本語テスト🎉')

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe('日本語テスト🎉')
    })

    test('handles unicode in namespace', async () => {
      const id = await DWSObjectId.fromName('名前空間', 'room')

      expect(id.toString()).toHaveLength(64)
    })

    test('handles special SQL characters in name', async () => {
      const sqlInjection = "'; DROP TABLE do_state; --"
      const id = await DWSObjectId.fromName('ns', sqlInjection)

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe(sqlInjection)
    })

    test('handles whitespace-only name', async () => {
      const id = await DWSObjectId.fromName('ns', '   ')

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe('   ')
    })

    test('handles very long name (1MB)', async () => {
      const longName = 'x'.repeat(1024 * 1024)
      const id = await DWSObjectId.fromName('ns', longName)

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe(longName)
    })

    test('IDs are case-sensitive for names', async () => {
      const id1 = await DWSObjectId.fromName('ns', 'Room')
      const id2 = await DWSObjectId.fromName('ns', 'room')

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('IDs are case-sensitive for namespaces', async () => {
      const id1 = await DWSObjectId.fromName('NS', 'room')
      const id2 = await DWSObjectId.fromName('ns', 'room')

      expect(id1.toString()).not.toBe(id2.toString())
    })
  })

  // ============================================================================
  // newUnique - Happy Path and Uniqueness
  // ============================================================================

  describe('newUnique', () => {
    test('creates unique IDs each time', async () => {
      const id1 = await DWSObjectId.newUnique('test-namespace')
      const id2 = await DWSObjectId.newUnique('test-namespace')

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('unique IDs have no name', async () => {
      const id = await DWSObjectId.newUnique('test-namespace')

      expect(id.name).toBeUndefined()
    })

    test('generates 100 unique IDs without collision', async () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const id = await DWSObjectId.newUnique('ns')
        ids.add(id.toString())
      }
      expect(ids.size).toBe(100)
    })

    test('unique IDs have same namespace prefix as named IDs', async () => {
      const uniqueId = await DWSObjectId.newUnique('my-namespace')
      const namedId = await DWSObjectId.fromName('my-namespace', 'test')

      // First 32 chars should be same (namespace prefix)
      expect(uniqueId.toString().slice(0, 32)).toBe(
        namedId.toString().slice(0, 32),
      )
    })

    test('concurrent unique ID generation produces unique IDs', async () => {
      const promises = Array.from({ length: 50 }, () =>
        DWSObjectId.newUnique('ns'),
      )
      const ids = await Promise.all(promises)
      const uniqueIds = new Set(ids.map((id) => id.toString()))

      expect(uniqueIds.size).toBe(50)
    })
  })

  // ============================================================================
  // fromString - Parsing and Validation
  // ============================================================================

  describe('fromString', () => {
    test('parses valid ID string', async () => {
      const original = await DWSObjectId.fromName('test-namespace', 'my-room')
      const parsed = await DWSObjectId.fromString(
        'test-namespace',
        original.toString(),
      )

      expect(parsed.toString()).toBe(original.toString())
    })

    test('parsed ID loses original name', async () => {
      const original = await DWSObjectId.fromName('test-namespace', 'my-room')
      const parsed = await DWSObjectId.fromString(
        'test-namespace',
        original.toString(),
      )

      // Name cannot be recovered from hash
      expect(parsed.name).toBeUndefined()
      expect(original.name).toBe('my-room')
    })

    test('throws on invalid length - too short', async () => {
      await expect(
        DWSObjectId.fromString('test-namespace', 'too-short'),
      ).rejects.toThrow('Invalid Durable Object ID format')
    })

    test('throws on invalid length - too long', async () => {
      await expect(
        DWSObjectId.fromString('test-namespace', 'a'.repeat(65)),
      ).rejects.toThrow('Invalid Durable Object ID format')
    })

    test('throws on invalid length - empty string', async () => {
      await expect(
        DWSObjectId.fromString('test-namespace', ''),
      ).rejects.toThrow('Invalid Durable Object ID format')
    })

    test('handles uppercase hex - normalizes to lowercase', async () => {
      // First get a valid ID, then uppercase it
      const original = await DWSObjectId.fromName('test-namespace', 'room')
      const upperCased = original.toString().toUpperCase()
      const parsed = await DWSObjectId.fromString('test-namespace', upperCased)

      expect(parsed.toString()).toBe(original.toString().toLowerCase())
    })

    test('throws on invalid characters - non-hex', async () => {
      const invalidId = 'g'.repeat(64)

      await expect(
        DWSObjectId.fromString('test-namespace', invalidId),
      ).rejects.toThrow('Invalid Durable Object ID format')
    })

    test('throws on invalid characters - spaces', async () => {
      const invalidId = 'a'.repeat(32) + ' '.repeat(32)

      await expect(
        DWSObjectId.fromString('test-namespace', invalidId),
      ).rejects.toThrow('Invalid Durable Object ID format')
    })

    test('throws on wrong namespace', async () => {
      const id = await DWSObjectId.fromName('namespace-1', 'my-room')

      await expect(
        DWSObjectId.fromString('namespace-2', id.toString()),
      ).rejects.toThrow('does not belong to namespace')
    })

    test('normalizes uppercase hex to lowercase', async () => {
      const original = await DWSObjectId.fromName('ns', 'test')
      const upperCase = original.toString().toUpperCase()
      const parsed = await DWSObjectId.fromString('ns', upperCase)

      expect(parsed.toString()).toBe(original.toString().toLowerCase())
    })
  })

  // ============================================================================
  // equals - Comparison
  // ============================================================================

  describe('equals', () => {
    test('returns true for same ID', async () => {
      const id1 = await DWSObjectId.fromName('test', 'room')
      const id2 = await DWSObjectId.fromName('test', 'room')

      expect(id1.equals(id2)).toBe(true)
    })

    test('returns false for different IDs', async () => {
      const id1 = await DWSObjectId.fromName('test', 'room-1')
      const id2 = await DWSObjectId.fromName('test', 'room-2')

      expect(id1.equals(id2)).toBe(false)
    })

    test('works with object implementing toString()', async () => {
      const id1 = await DWSObjectId.fromName('test', 'room')
      const mockId = {
        toString: () => id1.toString(),
      }

      // Should compare via toString()
      expect(id1.equals(mockId as DWSObjectId)).toBe(true)
    })

    test('unique ID equals itself', async () => {
      const id = await DWSObjectId.newUnique('ns')

      expect(id.equals(id)).toBe(true)
    })

    test('parsed ID equals original', async () => {
      const original = await DWSObjectId.fromName('ns', 'room')
      const parsed = await DWSObjectId.fromString('ns', original.toString())

      expect(original.equals(parsed)).toBe(true)
      expect(parsed.equals(original)).toBe(true)
    })
  })

  // ============================================================================
  // validateNamespace - Namespace Validation
  // ============================================================================

  describe('validateNamespace', () => {
    test('returns true for valid ID in namespace', async () => {
      const id = await DWSObjectId.fromName('test-namespace', 'my-room')
      const isValid = await DWSObjectId.validateNamespace(
        'test-namespace',
        id.toString(),
      )

      expect(isValid).toBe(true)
    })

    test('returns false for ID from different namespace', async () => {
      const id = await DWSObjectId.fromName('namespace-1', 'my-room')
      const isValid = await DWSObjectId.validateNamespace(
        'namespace-2',
        id.toString(),
      )

      expect(isValid).toBe(false)
    })

    test('returns false for invalid format - too short', async () => {
      const isValid = await DWSObjectId.validateNamespace('test', 'invalid')
      expect(isValid).toBe(false)
    })

    test('returns false for invalid format - non-hex', async () => {
      const isValid = await DWSObjectId.validateNamespace(
        'test',
        'z'.repeat(64),
      )
      expect(isValid).toBe(false)
    })

    test('returns false for empty string', async () => {
      const isValid = await DWSObjectId.validateNamespace('test', '')
      expect(isValid).toBe(false)
    })

    test('validates unique IDs correctly', async () => {
      const id = await DWSObjectId.newUnique('my-ns')
      const isValid = await DWSObjectId.validateNamespace(
        'my-ns',
        id.toString(),
      )

      expect(isValid).toBe(true)
    })
  })

  // ============================================================================
  // getInstanceId - Instance Extraction
  // ============================================================================

  describe('getInstanceId', () => {
    test('returns instance portion of ID (32 chars)', async () => {
      const id = await DWSObjectId.fromName('test', 'room')
      const instanceId = id.getInstanceId()

      expect(instanceId).toHaveLength(32)
      expect(instanceId).toMatch(/^[0-9a-f]{32}$/)
    })

    test('instance ID is the suffix portion', async () => {
      const id = await DWSObjectId.fromName('test', 'room')
      const fullId = id.toString()
      const instanceId = id.getInstanceId()

      expect(fullId.slice(32)).toBe(instanceId)
    })

    test('same name produces same instance ID', async () => {
      const id1 = await DWSObjectId.fromName('ns', 'room')
      const id2 = await DWSObjectId.fromName('ns', 'room')

      expect(id1.getInstanceId()).toBe(id2.getInstanceId())
    })

    test('different names produce different instance IDs', async () => {
      const id1 = await DWSObjectId.fromName('ns', 'room-1')
      const id2 = await DWSObjectId.fromName('ns', 'room-2')

      expect(id1.getInstanceId()).not.toBe(id2.getInstanceId())
    })
  })

  // ============================================================================
  // getStorageKey - Storage Key Generation
  // ============================================================================

  describe('getStorageKey', () => {
    test('returns namespace:id format', async () => {
      const id = await DWSObjectId.fromName('test-namespace', 'my-room')
      const storageKey = id.getStorageKey('test-namespace')

      expect(storageKey).toBe(`test-namespace:${id.toString()}`)
    })

    test('can use different namespace for storage key', async () => {
      const id = await DWSObjectId.fromName('ns-1', 'room')
      const storageKey = id.getStorageKey('different-ns')

      expect(storageKey).toBe(`different-ns:${id.toString()}`)
    })
  })

  // ============================================================================
  // Concurrent Operations
  // ============================================================================

  describe('concurrent operations', () => {
    test('concurrent fromName calls are deterministic', async () => {
      const promises = Array.from({ length: 100 }, () =>
        DWSObjectId.fromName('ns', 'same-name'),
      )
      const ids = await Promise.all(promises)

      const firstId = ids[0].toString()
      for (const id of ids) {
        expect(id.toString()).toBe(firstId)
      }
    })

    test('concurrent mixed operations work correctly', async () => {
      const operations = [
        DWSObjectId.fromName('ns', 'a'),
        DWSObjectId.newUnique('ns'),
        DWSObjectId.fromName('ns', 'b'),
        DWSObjectId.newUnique('ns'),
        DWSObjectId.fromName('ns', 'a'),
      ]

      const results = await Promise.all(operations)

      // Named IDs with same name should match
      expect(results[0].toString()).toBe(results[4].toString())
      // Unique IDs should differ
      expect(results[1].toString()).not.toBe(results[3].toString())
    })
  })

  // ============================================================================
  // ID Structure Verification
  // ============================================================================

  describe('ID structure verification', () => {
    test('namespace prefix is consistent across names', async () => {
      const id1 = await DWSObjectId.fromName('my-namespace', 'room-1')
      const id2 = await DWSObjectId.fromName('my-namespace', 'room-2')
      const id3 = await DWSObjectId.fromName(
        'my-namespace',
        'completely-different',
      )

      const prefix1 = id1.toString().slice(0, 32)
      const prefix2 = id2.toString().slice(0, 32)
      const prefix3 = id3.toString().slice(0, 32)

      expect(prefix1).toBe(prefix2)
      expect(prefix2).toBe(prefix3)
    })

    test('different namespaces have different prefixes', async () => {
      const id1 = await DWSObjectId.fromName('namespace-a', 'room')
      const id2 = await DWSObjectId.fromName('namespace-b', 'room')

      const prefix1 = id1.toString().slice(0, 32)
      const prefix2 = id2.toString().slice(0, 32)

      expect(prefix1).not.toBe(prefix2)
    })

    test('namespace prefix is cached', async () => {
      // Create multiple IDs rapidly - should use cached prefix
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        await DWSObjectId.fromName('cached-namespace', `room-${i}`)
      }
      const elapsed = performance.now() - start

      // Should be fast due to caching (< 1 second for 1000 IDs)
      expect(elapsed).toBeLessThan(1000)
    })
  })
})
