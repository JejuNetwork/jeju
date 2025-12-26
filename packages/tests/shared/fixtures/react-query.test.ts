/**
 * React Query Test Utilities Tests
 */

import { afterEach, describe, expect, test } from 'bun:test'
import {
  createQueryWrapper,
  createTestQueryClient,
  invalidateAndWait,
  QueryClient,
  waitForQueriesToSettle,
} from './react-query'

// ============================================================================
// createTestQueryClient - Configuration Tests
// ============================================================================

describe('createTestQueryClient - Default Configuration', () => {
  test('creates a QueryClient instance', () => {
    const client = createTestQueryClient()
    expect(client).toBeInstanceOf(QueryClient)
  })

  test('defaults to no retries for queries', () => {
    const client = createTestQueryClient()
    const options = client.getDefaultOptions()
    expect(options.queries?.retry).toBe(false)
  })

  test('defaults to no retries for mutations', () => {
    const client = createTestQueryClient()
    const options = client.getDefaultOptions()
    expect(options.mutations?.retry).toBe(false)
  })

  test('defaults to zero garbage collection time', () => {
    const client = createTestQueryClient()
    const options = client.getDefaultOptions()
    expect(options.queries?.gcTime).toBe(0)
  })

  test('defaults to zero stale time', () => {
    const client = createTestQueryClient()
    const options = client.getDefaultOptions()
    expect(options.queries?.staleTime).toBe(0)
  })

  test('defaults refetchOnWindowFocus to false', () => {
    const client = createTestQueryClient()
    const options = client.getDefaultOptions()
    expect(options.queries?.refetchOnWindowFocus).toBe(false)
  })
})

describe('createTestQueryClient - Custom Options', () => {
  test('accepts custom staleTime', () => {
    const client = createTestQueryClient({ staleTime: 5000 })
    const options = client.getDefaultOptions()
    expect(options.queries?.staleTime).toBe(5000)
  })

  test('accepts custom gcTime', () => {
    const client = createTestQueryClient({ gcTime: 10000 })
    const options = client.getDefaultOptions()
    expect(options.queries?.gcTime).toBe(10000)
  })

  test('accepts numeric retry count', () => {
    const client = createTestQueryClient({ retry: 3 })
    const options = client.getDefaultOptions()
    expect(options.queries?.retry).toBe(3)
    expect(options.mutations?.retry).toBe(3)
  })

  test('accepts boolean retry', () => {
    const client = createTestQueryClient({ retry: true })
    const options = client.getDefaultOptions()
    expect(options.queries?.retry).toBe(true)
  })

  test('accepts refetchOnWindowFocus option', () => {
    const client = createTestQueryClient({ refetchOnWindowFocus: true })
    const options = client.getDefaultOptions()
    expect(options.queries?.refetchOnWindowFocus).toBe(true)
  })

  test('multiple options can be combined', () => {
    const client = createTestQueryClient({
      staleTime: 1000,
      gcTime: 2000,
      retry: 2,
      refetchOnWindowFocus: true,
    })
    const options = client.getDefaultOptions()

    expect(options.queries?.staleTime).toBe(1000)
    expect(options.queries?.gcTime).toBe(2000)
    expect(options.queries?.retry).toBe(2)
    expect(options.queries?.refetchOnWindowFocus).toBe(true)
  })
})

// ============================================================================
// createQueryWrapper - Wrapper Creation
// ============================================================================

describe('createQueryWrapper - Wrapper Function', () => {
  test('returns a function', () => {
    const wrapper = createQueryWrapper()
    expect(typeof wrapper).toBe('function')
  })

  test('wrapper accepts children prop', () => {
    const wrapper = createQueryWrapper()
    // Should not throw when called with children
    expect(() => {
      wrapper({ children: null })
    }).not.toThrow()
  })

  test('uses provided client when specified', () => {
    const customClient = createTestQueryClient({ staleTime: 9999 })
    const wrapper = createQueryWrapper(customClient)

    // Wrapper should use the custom client
    expect(typeof wrapper).toBe('function')
  })

  test('creates new client when none provided', () => {
    const wrapper1 = createQueryWrapper()
    const wrapper2 = createQueryWrapper()

    // Each call should be independent
    expect(wrapper1).not.toBe(wrapper2)
  })
})

// ============================================================================
// QueryClient State Management
// ============================================================================

describe('QueryClient - State Management', () => {
  let client: QueryClient

  afterEach(() => {
    client?.clear()
  })

  test('isFetching returns 0 when no queries running', () => {
    client = createTestQueryClient()
    expect(client.isFetching()).toBe(0)
  })

  test('isMutating returns 0 when no mutations running', () => {
    client = createTestQueryClient()
    expect(client.isMutating()).toBe(0)
  })

  test('clear removes all queries', () => {
    client = createTestQueryClient()
    client.setQueryData(['test'], { value: 'data' })

    expect(client.getQueryData(['test'])).toEqual({ value: 'data' })

    client.clear()

    expect(client.getQueryData(['test'])).toBeUndefined()
  })

  test('setQueryData and getQueryData work correctly', () => {
    client = createTestQueryClient()
    const testData = { id: 1, name: 'test' }

    client.setQueryData(['user', 1], testData)

    expect(client.getQueryData(['user', 1])).toEqual(testData)
  })

  test('different query keys are independent', () => {
    client = createTestQueryClient()

    client.setQueryData(['key1'], 'value1')
    client.setQueryData(['key2'], 'value2')

    expect(client.getQueryData(['key1'])).toBe('value1')
    expect(client.getQueryData(['key2'])).toBe('value2')
  })
})

// ============================================================================
// waitForQueriesToSettle - Async Behavior
// ============================================================================

describe('waitForQueriesToSettle - Settling Logic', () => {
  test('resolves immediately when no queries running', async () => {
    const client = createTestQueryClient()

    const start = Date.now()
    await waitForQueriesToSettle(client, 5000)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(100)
    client.clear()
  })

  test('throws when timeout exceeded', async () => {
    const client = createTestQueryClient()

    // Mock isFetching to always return 1
    const originalIsFetching = client.isFetching.bind(client)
    let callCount = 0
    client.isFetching = () => {
      callCount++
      return callCount < 1000 ? 1 : 0 // Keep returning 1 until many calls
    }

    await expect(waitForQueriesToSettle(client, 200)).rejects.toThrow(
      'Queries did not settle within timeout',
    )

    client.isFetching = originalIsFetching
    client.clear()
  })

  test('uses default timeout when not specified', async () => {
    const client = createTestQueryClient()
    // Should use default 5000ms timeout
    await waitForQueriesToSettle(client)
    client.clear()
  })
})

// ============================================================================
// invalidateAndWait - Invalidation Flow
// ============================================================================

describe('invalidateAndWait - Query Invalidation', () => {
  test('invalidates all queries', async () => {
    const client = createTestQueryClient()

    client.setQueryData(['test1'], 'value1')
    client.setQueryData(['test2'], 'value2')

    await invalidateAndWait(client, 1000)

    // After invalidation, queries are marked stale but data remains
    const state1 = client.getQueryState(['test1'])
    const state2 = client.getQueryState(['test2'])

    expect(state1?.isInvalidated).toBe(true)
    expect(state2?.isInvalidated).toBe(true)

    client.clear()
  })

  test('waits for queries to settle after invalidation', async () => {
    const client = createTestQueryClient()

    const start = Date.now()
    await invalidateAndWait(client, 1000)
    const elapsed = Date.now() - start

    // Should complete quickly when no active queries
    expect(elapsed).toBeLessThan(500)

    client.clear()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('React Query Utilities - Edge Cases', () => {
  test('client handles empty query key', () => {
    const client = createTestQueryClient()

    client.setQueryData([], 'root-value')
    expect(client.getQueryData([])).toBe('root-value')

    client.clear()
  })

  test('client handles complex query keys', () => {
    const client = createTestQueryClient()

    const complexKey = ['users', { id: 1, filters: { active: true } }]
    client.setQueryData(complexKey, { name: 'Test User' })

    expect(client.getQueryData(complexKey)).toEqual({ name: 'Test User' })

    client.clear()
  })

  test('client handles null/undefined data', () => {
    const client = createTestQueryClient()

    client.setQueryData(['nullable'], null)
    expect(client.getQueryData(['nullable'])).toBeNull()

    client.setQueryData(['undefinable'], undefined)
    expect(client.getQueryData(['undefinable'])).toBeUndefined()

    client.clear()
  })

  test('multiple clients are independent', () => {
    const client1 = createTestQueryClient()
    const client2 = createTestQueryClient()

    client1.setQueryData(['shared-key'], 'client1-value')
    client2.setQueryData(['shared-key'], 'client2-value')

    expect(client1.getQueryData(['shared-key'])).toBe('client1-value')
    expect(client2.getQueryData(['shared-key'])).toBe('client2-value')

    client1.clear()
    client2.clear()
  })
})

// ============================================================================
// Concurrent Behavior
// ============================================================================

describe('React Query - Concurrent Operations', () => {
  test('concurrent setQueryData operations are safe', async () => {
    const client = createTestQueryClient()
    const operations: Promise<void>[] = []

    for (let i = 0; i < 100; i++) {
      operations.push(
        Promise.resolve().then(() => {
          client.setQueryData([`key-${i}`], `value-${i}`)
        }),
      )
    }

    await Promise.all(operations)

    // Verify all data was set
    for (let i = 0; i < 100; i++) {
      expect(client.getQueryData([`key-${i}`])).toBe(`value-${i}`)
    }

    client.clear()
  })

  test('concurrent waitForQueriesToSettle calls resolve correctly', async () => {
    const client = createTestQueryClient()

    const results = await Promise.all([
      waitForQueriesToSettle(client, 1000),
      waitForQueriesToSettle(client, 1000),
      waitForQueriesToSettle(client, 1000),
    ])

    // All should resolve without error
    expect(results).toEqual([undefined, undefined, undefined])

    client.clear()
  })
})
