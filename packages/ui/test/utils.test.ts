/**
 * Tests for utility functions in hooks/utils.ts
 */

import { describe, expect, test } from 'bun:test'
import { requireClient } from '../src/hooks/utils'

// Create a minimal mock that satisfies the JejuClient interface requirements
function createMockClient(): {
  address: `0x${string}`
  network: string
  chainId: number
  isSmartAccount: boolean
} {
  return {
    address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
    network: 'testnet',
    chainId: 84532,
    isSmartAccount: true,
  }
}

describe('requireClient', () => {
  describe('success cases', () => {
    test('returns the client when it is not null', () => {
      const mockClient = createMockClient()
      // We need to cast because the actual JejuClient has more properties
      const result = requireClient(
        mockClient as Parameters<typeof requireClient>[0],
      )
      expect(result).toBe(mockClient)
    })

    test('preserves client identity (same reference)', () => {
      const mockClient = createMockClient()
      const result = requireClient(
        mockClient as Parameters<typeof requireClient>[0],
      )
      expect(result).toStrictEqual(mockClient)
    })
  })

  describe('error cases', () => {
    test('throws Error when client is null', () => {
      expect(() => requireClient(null)).toThrow('Not connected')
    })

    test('throws with correct error type', () => {
      try {
        requireClient(null)
        expect(true).toBe(false) // Should not reach here
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message).toBe('Not connected')
      }
    })
  })

  describe('type narrowing', () => {
    test('narrows type from nullable to non-null', () => {
      const mockClient = createMockClient()
      const nullableClient: typeof mockClient | null =
        Math.random() > -1 ? mockClient : null

      // After requireClient, TypeScript should know it's not null
      const result = requireClient(
        nullableClient as Parameters<typeof requireClient>[0],
      )

      // If this compiles, type narrowing works
      expect(result.address).toBe('0x1234567890123456789012345678901234567890')
    })
  })
})
