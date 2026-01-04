/**
 * Tests for DWSObjectState
 *
 * Comprehensive tests covering:
 * - Concurrency control (blockConcurrencyWhile)
 * - Background tasks (waitUntil)
 * - WebSocket management
 * - WebSocket attachments and tags
 * - Broadcast functionality
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type {
  ExecResult,
  QueryParam,
  QueryResult,
  SQLitConnection,
  SQLitConnectionPool,
  SQLitTransaction,
} from '@jejunetwork/db'
import { DWSObjectId } from './id'
import { createDurableObjectState, DWSObjectState } from './state'

// Mock SQLitClient (minimal implementation for state tests)
class MockSQLitClient {
  getPool(_dbId: string): SQLitConnectionPool {
    return {
      acquire: async () => this.createConnection(),
      release: () => {},
      close: async () => {},
      stats: () => ({ active: 0, idle: 1, total: 1 }),
    }
  }

  async connect(_dbId?: string): Promise<SQLitConnection> {
    return this.createConnection()
  }

  async query<T>(
    _sql: string,
    _params?: QueryParam[],
  ): Promise<QueryResult<T>> {
    return {
      rows: [],
      rowCount: 0,
      columns: [],
      executionTime: 1,
      blockHeight: 1,
    }
  }

  async exec(_sql: string, _params?: QueryParam[]): Promise<ExecResult> {
    return {
      rowsAffected: 0,
      txHash: `0x${'0'.repeat(64)}` as `0x${string}`,
      blockHeight: 1,
      gasUsed: 0n,
    }
  }

  private createConnection(): SQLitConnection {
    const conn: SQLitConnection = {
      id: 'mock-conn',
      databaseId: 'test-db',
      active: true,
      query: async <T>() =>
        ({
          rows: [],
          rowCount: 0,
          columns: [],
          executionTime: 1,
          blockHeight: 1,
        }) as QueryResult<T>,
      exec: async () => ({
        rowsAffected: 0,
        txHash: `0x${'0'.repeat(64)}` as `0x${string}`,
        blockHeight: 1,
        gasUsed: 0n,
      }),
      beginTransaction: async (): Promise<SQLitTransaction> => ({
        id: 'tx-1',
        query: async <T>() =>
          ({
            rows: [],
            rowCount: 0,
            columns: [],
            executionTime: 1,
            blockHeight: 1,
          }) as QueryResult<T>,
        exec: async () => ({
          rowsAffected: 0,
          txHash: `0x${'0'.repeat(64)}` as `0x${string}`,
          blockHeight: 1,
          gasUsed: 0n,
        }),
        commit: async () => {},
        rollback: async () => {},
      }),
      close: async () => {
        conn.active = false
      },
    }
    return conn
  }
}

// Mock WebSocket
class MockWebSocket {
  readyState = WebSocket.OPEN
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  sentMessages: Array<string | ArrayBuffer> = []
  closeCalled = false
  closeCode?: number
  closeReason?: string

  send(data: string | ArrayBuffer): void {
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closeCalled = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = WebSocket.CLOSED
  }
}

describe('DWSObjectState', () => {
  let mockSqlit: MockSQLitClient
  let state: DWSObjectState
  let doId: DWSObjectId

  beforeEach(async () => {
    mockSqlit = new MockSQLitClient()
    doId = await DWSObjectId.fromName('test-ns', 'test-do')
    state = new DWSObjectState(
      doId,
      mockSqlit as ReturnType<typeof import('@jejunetwork/db').getSQLit>,
      'test-db',
    )
  })

  // ============================================================================
  // Basic Properties
  // ============================================================================

  describe('basic properties', () => {
    test('id is set correctly', () => {
      expect(state.id).toBe(doId)
    })

    test('storage is initialized', () => {
      expect(state.storage).toBeDefined()
    })
  })

  // ============================================================================
  // Concurrency Control - blockConcurrencyWhile
  // ============================================================================

  describe('blockConcurrencyWhile', () => {
    test('executes function and returns result', async () => {
      const result = await state.blockConcurrencyWhile(async () => {
        return 'test-result'
      })

      expect(result).toBe('test-result')
    })

    test('blocks concurrent requests during execution', async () => {
      const order: number[] = []

      // Start a blocking operation
      const blockingPromise = state.blockConcurrencyWhile(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 50))
        order.push(2)
        return 'blocked'
      })

      // Wait a bit then try to get in
      await new Promise((r) => setTimeout(r, 10))

      // This should wait for the blocking operation
      const waitPromise = state.waitForUnblock().then(() => {
        order.push(3)
      })

      await Promise.all([blockingPromise, waitPromise])

      // Blocking operation should complete before unblocked request proceeds
      expect(order).toEqual([1, 2, 3])
    })

    test('multiple concurrent waits are all released', async () => {
      const completedWaits: number[] = []

      const blockingPromise = state.blockConcurrencyWhile(async () => {
        await new Promise((r) => setTimeout(r, 50))
        return 'done'
      })

      // Start multiple waiters
      const waiters = Array.from({ length: 5 }, (_, i) =>
        state.waitForUnblock().then(() => {
          completedWaits.push(i)
        }),
      )

      await Promise.all([blockingPromise, ...waiters])

      expect(completedWaits.sort()).toEqual([0, 1, 2, 3, 4])
    })

    test('handles errors in blocking function', async () => {
      await expect(
        state.blockConcurrencyWhile(async () => {
          throw new Error('Test error')
        }),
      ).rejects.toThrow('Test error')

      // After error, should no longer be blocking
      const result = await state.blockConcurrencyWhile(
        async () => 'after-error',
      )
      expect(result).toBe('after-error')
    })

    test('sequential blocking operations work correctly', async () => {
      const results: string[] = []

      results.push(await state.blockConcurrencyWhile(async () => 'first'))
      results.push(await state.blockConcurrencyWhile(async () => 'second'))
      results.push(await state.blockConcurrencyWhile(async () => 'third'))

      expect(results).toEqual(['first', 'second', 'third'])
    })

    test('reentrant blockConcurrencyWhile from same context executes sequentially', async () => {
      const order: string[] = []

      await state.blockConcurrencyWhile(async () => {
        order.push('first-start')
        order.push('first-end')
      })

      await state.blockConcurrencyWhile(async () => {
        order.push('second-start')
        order.push('second-end')
      })

      expect(order).toEqual([
        'first-start',
        'first-end',
        'second-start',
        'second-end',
      ])
    })
  })

  // ============================================================================
  // Background Tasks - waitUntil
  // ============================================================================

  describe('waitUntil', () => {
    test('tracks background promise', async () => {
      let resolved = false
      const promise = new Promise<void>((r) => {
        setTimeout(() => {
          resolved = true
          r()
        }, 10)
      })

      state.waitUntil(promise)

      // Immediately after waitUntil, promise hasn't resolved
      expect(resolved).toBe(false)

      await state.drainWaitUntil()

      // After draining, promise should be resolved
      expect(resolved).toBe(true)
    })

    test('drainWaitUntil waits for all promises', async () => {
      const resolved: number[] = []

      for (let i = 0; i < 5; i++) {
        state.waitUntil(
          new Promise<void>((r) =>
            setTimeout(
              () => {
                resolved.push(i)
                r()
              },
              10 * (i + 1),
            ),
          ),
        )
      }

      await state.drainWaitUntil()

      expect(resolved.sort()).toEqual([0, 1, 2, 3, 4])
    })

    test('drainWaitUntil handles rejected promises', async () => {
      state.waitUntil(Promise.reject(new Error('Background error')))

      // Should not throw
      await state.drainWaitUntil()
    })

    test('drainWaitUntil clears the queue', async () => {
      let count = 0
      state.waitUntil(
        new Promise<void>((r) => {
          count++
          r()
        }),
      )

      await state.drainWaitUntil()
      expect(count).toBe(1)

      // Second drain should have nothing to wait for
      await state.drainWaitUntil()
    })

    test('empty drainWaitUntil returns immediately', async () => {
      const start = Date.now()
      await state.drainWaitUntil()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })
  })

  // ============================================================================
  // WebSocket Management
  // ============================================================================

  describe('WebSocket management', () => {
    test('acceptWebSocket stores WebSocket', () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws)

      const sockets = state.getWebSockets()
      expect(sockets).toContain(ws)
    })

    test('acceptWebSocket with tags', () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws, ['user:123', 'room:abc'])

      const userSockets = state.getWebSockets('user:123')
      expect(userSockets).toContain(ws)

      const roomSockets = state.getWebSockets('room:abc')
      expect(roomSockets).toContain(ws)

      const otherSockets = state.getWebSockets('other')
      expect(otherSockets).not.toContain(ws)
    })

    test('getWebSockets returns all without tag filter', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket
      const ws3 = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws1, ['tag1'])
      state.acceptWebSocket(ws2, ['tag2'])
      state.acceptWebSocket(ws3)

      const sockets = state.getWebSockets()
      expect(sockets.length).toBe(3)
    })

    test('getWebSockets filters by tag', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket
      const ws3 = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws1, ['shared', 'unique1'])
      state.acceptWebSocket(ws2, ['shared', 'unique2'])
      state.acceptWebSocket(ws3, ['unique3'])

      expect(state.getWebSockets('shared').length).toBe(2)
      expect(state.getWebSockets('unique1').length).toBe(1)
      expect(state.getWebSockets('unique3').length).toBe(1)
      expect(state.getWebSockets('nonexistent').length).toBe(0)
    })

    test('getWebSocketCount returns correct count', () => {
      expect(state.getWebSocketCount()).toBe(0)

      state.acceptWebSocket(new MockWebSocket() as unknown as WebSocket)
      expect(state.getWebSocketCount()).toBe(1)

      state.acceptWebSocket(new MockWebSocket() as unknown as WebSocket)
      expect(state.getWebSocketCount()).toBe(2)
    })

    test('WebSocket removed on close', () => {
      const ws = new MockWebSocket()

      state.acceptWebSocket(ws as unknown as WebSocket)
      expect(state.getWebSocketCount()).toBe(1)

      // Trigger close
      ws.onclose?.(new CloseEvent('close'))

      expect(state.getWebSocketCount()).toBe(0)
    })

    test('WebSocket removed on error', () => {
      const ws = new MockWebSocket()

      state.acceptWebSocket(ws as unknown as WebSocket)
      expect(state.getWebSocketCount()).toBe(1)

      // Trigger error
      ws.onerror?.(new Event('error'))

      expect(state.getWebSocketCount()).toBe(0)
    })

    test('original onclose/onerror handlers are preserved', () => {
      const ws = new MockWebSocket()
      let originalCloseCalled = false
      let originalErrorCalled = false

      ws.onclose = () => {
        originalCloseCalled = true
      }
      ws.onerror = () => {
        originalErrorCalled = true
      }

      state.acceptWebSocket(ws as unknown as WebSocket)

      ws.onclose?.(new CloseEvent('close'))
      expect(originalCloseCalled).toBe(true)

      // Reset for error test
      ws.onerror?.(new Event('error'))
      expect(originalErrorCalled).toBe(true)
    })
  })

  // ============================================================================
  // WebSocket Broadcast
  // ============================================================================

  describe('broadcast', () => {
    test('broadcasts to all WebSockets', () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()
      const ws3 = new MockWebSocket()

      state.acceptWebSocket(ws1 as unknown as WebSocket)
      state.acceptWebSocket(ws2 as unknown as WebSocket)
      state.acceptWebSocket(ws3 as unknown as WebSocket)

      state.broadcast('hello')

      expect(ws1.sentMessages).toContain('hello')
      expect(ws2.sentMessages).toContain('hello')
      expect(ws3.sentMessages).toContain('hello')
    })

    test('broadcasts only to WebSockets with matching tag', () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()
      const ws3 = new MockWebSocket()

      state.acceptWebSocket(ws1 as unknown as WebSocket, ['room:1'])
      state.acceptWebSocket(ws2 as unknown as WebSocket, ['room:1'])
      state.acceptWebSocket(ws3 as unknown as WebSocket, ['room:2'])

      state.broadcast('room1-message', 'room:1')

      expect(ws1.sentMessages).toContain('room1-message')
      expect(ws2.sentMessages).toContain('room1-message')
      expect(ws3.sentMessages).not.toContain('room1-message')
    })

    test('broadcast skips closed WebSockets', () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()
      ws2.readyState = WebSocket.CLOSED

      state.acceptWebSocket(ws1 as unknown as WebSocket)
      state.acceptWebSocket(ws2 as unknown as WebSocket)

      state.broadcast('hello')

      expect(ws1.sentMessages).toContain('hello')
      expect(ws2.sentMessages).not.toContain('hello')
    })

    test('broadcast with ArrayBuffer', () => {
      const ws = new MockWebSocket()
      state.acceptWebSocket(ws as unknown as WebSocket)

      const buffer = new ArrayBuffer(8)
      state.broadcast(buffer)

      expect(ws.sentMessages).toContain(buffer)
    })
  })

  // ============================================================================
  // closeAllWebSockets
  // ============================================================================

  describe('closeAllWebSockets', () => {
    test('closes all WebSockets', () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      state.acceptWebSocket(ws1 as unknown as WebSocket)
      state.acceptWebSocket(ws2 as unknown as WebSocket)

      state.closeAllWebSockets()

      expect(ws1.closeCalled).toBe(true)
      expect(ws2.closeCalled).toBe(true)
    })

    test('uses default close code and reason', () => {
      const ws = new MockWebSocket()
      state.acceptWebSocket(ws as unknown as WebSocket)

      state.closeAllWebSockets()

      expect(ws.closeCode).toBe(1000)
      expect(ws.closeReason).toBe('Durable Object evicted')
    })

    test('uses custom close code and reason', () => {
      const ws = new MockWebSocket()
      state.acceptWebSocket(ws as unknown as WebSocket)

      state.closeAllWebSockets(4000, 'Custom reason')

      expect(ws.closeCode).toBe(4000)
      expect(ws.closeReason).toBe('Custom reason')
    })

    test('clears WebSocket map', () => {
      state.acceptWebSocket(new MockWebSocket() as unknown as WebSocket)
      state.acceptWebSocket(new MockWebSocket() as unknown as WebSocket)

      expect(state.getWebSocketCount()).toBe(2)

      state.closeAllWebSockets()

      expect(state.getWebSocketCount()).toBe(0)
    })

    test('skips already closed WebSockets', () => {
      const ws = new MockWebSocket()
      ws.readyState = WebSocket.CLOSED

      state.acceptWebSocket(ws as unknown as WebSocket)
      state.closeAllWebSockets()

      expect(ws.closeCalled).toBe(false)
    })
  })

  // ============================================================================
  // WebSocket Attachments
  // ============================================================================

  describe('WebSocket attachments', () => {
    test('setWebSocketAttachment and getWebSocketAttachment', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      state.acceptWebSocket(ws)

      state.setWebSocketAttachment(ws, { userId: '123', session: 'abc' })

      const attachment = state.getWebSocketAttachment(ws) as {
        userId: string
        session: string
      }
      expect(attachment).toEqual({ userId: '123', session: 'abc' })
    })

    test('getWebSocketAttachment returns undefined for unknown WebSocket', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      // Not accepted

      const attachment = state.getWebSocketAttachment(ws)
      expect(attachment).toBeUndefined()
    })

    test('attachment can be updated', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      state.acceptWebSocket(ws)

      state.setWebSocketAttachment(ws, { v: 1 })
      expect(state.getWebSocketAttachment(ws)).toEqual({ v: 1 })

      state.setWebSocketAttachment(ws, { v: 2 })
      expect(state.getWebSocketAttachment(ws)).toEqual({ v: 2 })
    })

    test('each WebSocket has independent attachment', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws1)
      state.acceptWebSocket(ws2)

      state.setWebSocketAttachment(ws1, { id: 1 })
      state.setWebSocketAttachment(ws2, { id: 2 })

      expect(state.getWebSocketAttachment(ws1)).toEqual({ id: 1 })
      expect(state.getWebSocketAttachment(ws2)).toEqual({ id: 2 })
    })
  })

  // ============================================================================
  // WebSocket Tags
  // ============================================================================

  describe('WebSocket tags', () => {
    test('getWebSocketTags returns copy of tags', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      state.acceptWebSocket(ws, ['tag1', 'tag2'])

      const tags = state.getWebSocketTags(ws)

      expect(tags).toEqual(['tag1', 'tag2'])

      // Modifying returned array shouldn't affect internal state
      tags.push('tag3')
      expect(state.getWebSocketTags(ws)).toEqual(['tag1', 'tag2'])
    })

    test('getWebSocketTags returns empty array for unknown WebSocket', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      // Not accepted

      const tags = state.getWebSocketTags(ws)
      expect(tags).toEqual([])
    })

    test('getWebSocketTags for WebSocket with no tags', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      state.acceptWebSocket(ws)

      expect(state.getWebSocketTags(ws)).toEqual([])
    })
  })

  // ============================================================================
  // Hibernatable WebSocket Event Timeout
  // ============================================================================

  describe('hibernatable WebSocket timeout', () => {
    test('setHibernatableWebSocketEventTimeout sets timeout', () => {
      state.setHibernatableWebSocketEventTimeout(30000)

      expect(state.getWebSocketEventTimeout()).toBe(30000)
    })

    test('timeout can be cleared with undefined', () => {
      state.setHibernatableWebSocketEventTimeout(30000)
      state.setHibernatableWebSocketEventTimeout(undefined)

      expect(state.getWebSocketEventTimeout()).toBeUndefined()
    })

    test('initial timeout is undefined', () => {
      expect(state.getWebSocketEventTimeout()).toBeUndefined()
    })
  })

  // ============================================================================
  // createDurableObjectState factory
  // ============================================================================

  describe('createDurableObjectState', () => {
    test('creates state instance', async () => {
      const id = await DWSObjectId.fromName('ns', 'room')
      const createdState = createDurableObjectState(
        id,
        mockSqlit as ReturnType<typeof import('@jejunetwork/db').getSQLit>,
        'db',
      )

      expect(createdState).toBeInstanceOf(DWSObjectState)
      expect(createdState.id).toBe(id)
    })
  })
})
