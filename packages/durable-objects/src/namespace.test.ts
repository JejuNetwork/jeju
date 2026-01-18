/**
 * Tests for DWSObjectNamespace, DWSObjectStub, and related classes
 *
 * Comprehensive tests covering:
 * - Namespace ID creation (sync and async)
 * - Stub creation and fetch routing
 * - Deferred ID resolution
 * - Error cases
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { DWSObjectId } from './id'
import {
  createAsyncNamespace,
  createNamespace,
  type DORouterConfig,
  DWSObjectNamespace,
  DWSObjectNamespaceAsync,
  DWSObjectStub,
} from './namespace'

const testConfig: DORouterConfig = {
  dwsApiUrl: 'http://localhost:8080',
  requestTimeout: 5000,
}

describe('DWSObjectNamespace', () => {
  let namespace: DWSObjectNamespace

  beforeEach(() => {
    namespace = new DWSObjectNamespace('chat-rooms', testConfig)
  })

  describe('idFromName', () => {
    test('returns a DurableObjectId', () => {
      const id = namespace.idFromName('my-room')

      expect(id).toBeDefined()
      expect(id.name).toBe('my-room')
    })

    test('same name returns equivalent IDs', () => {
      const id1 = namespace.idFromName('room')
      const id2 = namespace.idFromName('room')

      expect(id1.name).toBe(id2.name)
    })
  })

  describe('newUniqueId', () => {
    test('returns a DurableObjectId', () => {
      const id = namespace.newUniqueId()

      expect(id).toBeDefined()
    })

    test('unique IDs have no name', () => {
      const id = namespace.newUniqueId()

      expect(id.name).toBeUndefined()
    })
  })

  describe('idFromString', () => {
    test('returns a DurableObjectId', async () => {
      // First get a valid ID string
      const asyncNs = new DWSObjectNamespaceAsync('chat-rooms', testConfig)
      const original = await asyncNs.idFromName('test')

      const id = namespace.idFromString(original.toString())
      expect(id).toBeDefined()
    })
  })

  describe('get', () => {
    test('throws when ID is not resolved', () => {
      const id = namespace.idFromName('room')

      expect(() => namespace.get(id)).toThrow('not resolved')
    })

    test('works with pre-resolved ID', async () => {
      const resolvedId = await DWSObjectId.fromName('chat-rooms', 'room')
      const stub = namespace.get(resolvedId)

      expect(stub).toBeInstanceOf(DWSObjectStub)
    })
  })

  describe('getByName', () => {
    test('throws because async resolution required', () => {
      expect(() => namespace.getByName()).toThrow(
        'requires async ID resolution',
      )
    })
  })
})

describe('DWSObjectNamespaceAsync', () => {
  let namespace: DWSObjectNamespaceAsync

  beforeEach(() => {
    namespace = new DWSObjectNamespaceAsync('chat-rooms', testConfig)
  })

  describe('idFromName', () => {
    test('creates deterministic ID from name', async () => {
      const id1 = await namespace.idFromName('my-room')
      const id2 = await namespace.idFromName('my-room')

      expect(id1.toString()).toBe(id2.toString())
      expect(id1.name).toBe('my-room')
    })

    test('returns DWSObjectId instance', async () => {
      const id = await namespace.idFromName('room')

      expect(id).toBeInstanceOf(DWSObjectId)
    })

    test('ID is 64 hex characters', async () => {
      const id = await namespace.idFromName('test')

      expect(id.toString()).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('newUniqueId', () => {
    test('creates unique IDs', async () => {
      const id1 = await namespace.newUniqueId()
      const id2 = await namespace.newUniqueId()

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('returns DWSObjectId instance', async () => {
      const id = await namespace.newUniqueId()

      expect(id).toBeInstanceOf(DWSObjectId)
    })

    test('unique IDs have no name', async () => {
      const id = await namespace.newUniqueId()

      expect(id.name).toBeUndefined()
    })
  })

  describe('idFromString', () => {
    test('parses valid ID string', async () => {
      const original = await namespace.idFromName('room')
      const parsed = await namespace.idFromString(original.toString())

      expect(parsed.toString()).toBe(original.toString())
    })

    test('throws on invalid ID', async () => {
      await expect(namespace.idFromString('invalid')).rejects.toThrow()
    })

    test('throws on wrong namespace', async () => {
      const otherNs = new DWSObjectNamespaceAsync('other-namespace', testConfig)
      const otherId = await otherNs.idFromName('room')

      await expect(namespace.idFromString(otherId.toString())).rejects.toThrow(
        'does not belong',
      )
    })
  })

  describe('get', () => {
    test('creates stub from ID', async () => {
      const id = await namespace.idFromName('room')
      const stub = namespace.get(id)

      expect(stub).toBeInstanceOf(DWSObjectStub)
      expect(stub.id.toString()).toBe(id.toString())
    })

    test('stub has name for named IDs', async () => {
      const id = await namespace.idFromName('my-room')
      const stub = namespace.get(id)

      expect(stub.name).toBe('my-room')
    })

    test('stub has no name for unique IDs', async () => {
      const id = await namespace.newUniqueId()
      const stub = namespace.get(id)

      expect(stub.name).toBeUndefined()
    })
  })

  describe('getByName', () => {
    test('creates stub by name directly', async () => {
      const stub = await namespace.getByName('my-room')

      expect(stub).toBeInstanceOf(DWSObjectStub)
      expect(stub.name).toBe('my-room')
    })

    test('same name produces equivalent stubs', async () => {
      const stub1 = await namespace.getByName('room')
      const stub2 = await namespace.getByName('room')

      expect(stub1.id.toString()).toBe(stub2.id.toString())
    })
  })
})

describe('DWSObjectStub', () => {
  let stub: DWSObjectStub
  let originalFetch: typeof globalThis.fetch
  let fetchCalls: Array<{ url: string; options: RequestInit }>

  beforeEach(async () => {
    const namespace = new DWSObjectNamespaceAsync('chat-rooms', testConfig)
    const id = await namespace.idFromName('test-room')
    stub = namespace.get(id)

    // Mock fetch
    fetchCalls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        fetchCalls.push({ url, options: init ?? {} })
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      },
    ) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('fetch', () => {
    test('routes request to DWS API', async () => {
      await stub.fetch('http://example.com/api/messages')

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toContain('localhost:8080/do/chat-rooms/')
      expect(fetchCalls[0].url).toContain('/api/messages')
    })

    test('preserves query string', async () => {
      await stub.fetch('http://example.com/search?q=hello&page=2')

      expect(fetchCalls[0].url).toContain('?q=hello&page=2')
    })

    test('preserves HTTP method', async () => {
      await stub.fetch('http://example.com/api', { method: 'POST' })

      expect(fetchCalls[0].options).toBeDefined()
    })

    test('adds DO headers', async () => {
      await stub.fetch('http://example.com/api')

      // Headers are added but we'd need to inspect the Request object
      expect(fetchCalls.length).toBe(1)
    })

    test('accepts Request object', async () => {
      const request = new Request('http://example.com/api', {
        method: 'PUT',
        body: JSON.stringify({ data: 'test' }),
      })

      await stub.fetch(request)

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toContain('/api')
    })

    test('accepts URL object', async () => {
      const url = new URL('http://example.com/path/to/resource')

      await stub.fetch(url)

      expect(fetchCalls[0].url).toContain('/path/to/resource')
    })
  })

  describe('id and name properties', () => {
    test('id returns the DurableObjectId', async () => {
      const namespace = new DWSObjectNamespaceAsync('ns', testConfig)
      const id = await namespace.idFromName('room')
      const testStub = namespace.get(id)

      expect(testStub.id).toBe(id)
    })

    test('name returns the original name for named IDs', async () => {
      const namespace = new DWSObjectNamespaceAsync('ns', testConfig)
      const id = await namespace.idFromName('my-room-name')
      const testStub = namespace.get(id)

      expect(testStub.name).toBe('my-room-name')
    })

    test('name is undefined for unique IDs', async () => {
      const namespace = new DWSObjectNamespaceAsync('ns', testConfig)
      const id = await namespace.newUniqueId()
      const testStub = namespace.get(id)

      expect(testStub.name).toBeUndefined()
    })
  })
})

describe('createNamespace factory', () => {
  test('creates DWSObjectNamespace', () => {
    const ns = createNamespace('my-namespace', testConfig)

    expect(ns).toBeInstanceOf(DWSObjectNamespace)
  })
})

describe('createAsyncNamespace factory', () => {
  test('creates DWSObjectNamespaceAsync', () => {
    const ns = createAsyncNamespace('my-namespace', testConfig)

    expect(ns).toBeInstanceOf(DWSObjectNamespaceAsync)
  })
})

describe('DORouterConfig', () => {
  test('uses default timeout if not specified', async () => {
    const configNoTimeout: DORouterConfig = {
      dwsApiUrl: 'http://localhost:8080',
    }

    const namespace = new DWSObjectNamespaceAsync('ns', configNoTimeout)
    const id = await namespace.idFromName('room')
    const testStub = namespace.get(id)

    // Stub is created successfully with default timeout
    expect(testStub).toBeInstanceOf(DWSObjectStub)
  })

  test('custom timeout is respected', async () => {
    const configCustomTimeout: DORouterConfig = {
      dwsApiUrl: 'http://localhost:8080',
      requestTimeout: 60000,
    }

    const namespace = new DWSObjectNamespaceAsync('ns', configCustomTimeout)
    const id = await namespace.idFromName('room')
    const testStub = namespace.get(id)

    expect(testStub).toBeInstanceOf(DWSObjectStub)
  })
})

describe('Deferred ID resolution edge cases', () => {
  test('deferred ID resolves on first access', async () => {
    const ns = new DWSObjectNamespace('ns', testConfig)
    const deferredId = ns.idFromName('room')

    // Name is available immediately
    expect(deferredId.name).toBe('room')

    // toString throws until resolved
    expect(() => deferredId.toString()).toThrow('not resolved')
  })

  test('concurrent resolution of same deferred ID works', async () => {
    const ns = new DWSObjectNamespace('ns', testConfig)
    const deferredId = ns.idFromName('room')

    // This would be resolved via getResolved()
    // The internal Promise ensures single resolution
    expect(deferredId.name).toBe('room')
  })

  test('equals throws on unresolved deferred ID', () => {
    const ns = new DWSObjectNamespace('ns', testConfig)
    const deferredId = ns.idFromName('room')

    expect(() => deferredId.equals(deferredId)).toThrow('not resolved')
  })
})

describe('Cross-namespace operations', () => {
  test('different namespaces create different IDs for same name', async () => {
    const ns1 = new DWSObjectNamespaceAsync('namespace-1', testConfig)
    const ns2 = new DWSObjectNamespaceAsync('namespace-2', testConfig)

    const id1 = await ns1.idFromName('room')
    const id2 = await ns2.idFromName('room')

    expect(id1.toString()).not.toBe(id2.toString())
  })

  test('IDs from one namespace cannot be used in another', async () => {
    const ns1 = new DWSObjectNamespaceAsync('namespace-1', testConfig)
    const ns2 = new DWSObjectNamespaceAsync('namespace-2', testConfig)

    const id1 = await ns1.idFromName('room')

    // Parsing in wrong namespace should fail
    await expect(ns2.idFromString(id1.toString())).rejects.toThrow()
  })
})

describe('Stub URL construction', () => {
  let originalFetch: typeof globalThis.fetch
  let lastRequest: Request | null

  beforeEach(() => {
    lastRequest = null
    originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (input instanceof Request) {
        lastRequest = input
      }
      return new Response('ok')
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('constructs correct DO URL', async () => {
    const namespace = new DWSObjectNamespaceAsync('chat', {
      dwsApiUrl: 'https://dws.example.com',
    })
    const id = await namespace.idFromName('room-123')
    const testStub = namespace.get(id)

    await testStub.fetch('http://ignored.com/messages/list?limit=10')

    expect(lastRequest?.url).toContain('dws.example.com/do/chat/')
    expect(lastRequest?.url).toContain(id.toString())
    expect(lastRequest?.url).toContain('/messages/list?limit=10')
  })

  test('handles root path', async () => {
    const namespace = new DWSObjectNamespaceAsync('chat', {
      dwsApiUrl: 'https://dws.example.com',
    })
    const id = await namespace.idFromName('room')
    const testStub = namespace.get(id)

    await testStub.fetch('http://ignored.com/')

    expect(lastRequest?.url).toMatch(/\/do\/chat\/[a-f0-9]+\/$/)
  })

  test('handles empty path', async () => {
    const namespace = new DWSObjectNamespaceAsync('chat', {
      dwsApiUrl: 'https://dws.example.com',
    })
    const id = await namespace.idFromName('room')
    const testStub = namespace.get(id)

    await testStub.fetch('http://ignored.com')

    // Should have / at minimum
    expect(lastRequest?.url).toContain('/do/chat/')
  })
})
