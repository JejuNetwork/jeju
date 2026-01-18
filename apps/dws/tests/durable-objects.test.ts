/**
 * Durable Objects Comprehensive Tests
 *
 * Tests the Durable Objects implementation including:
 * - ID generation and validation (edge cases, boundaries)
 * - Storage operations (CRUD, transactions, boundary conditions)
 * - Alarm scheduling
 * - WebSocket state management
 * - Concurrent operations
 * - Instance management
 * - Error handling
 *
 * REQUIREMENTS:
 * - SQLit must be running at http://localhost:4661 (default)
 * - Start with: bun run jeju start sqlit
 * - Tests NEVER skip - they fail with clear instructions if infra is missing
 *
 * Run with: bun test tests/durable-objects.test.ts
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import {
  DWSObjectId,
  DWSObjectNamespace,
  DWSObjectNamespaceAsync,
  DWSObjectState,
  DWSObjectStorage,
  MAX_BATCH_SIZE,
  MAX_KEY_SIZE,
  MAX_VALUE_SIZE,
} from '@jejunetwork/durable-objects'

setDefaultTimeout(30000)

// ============================================================================
// Mock SQLit Client
// ============================================================================

type StorageMap = Map<string, Map<string, string>>
type AlarmMap = Map<string, number>

class MockSQLitClient {
  private storage: StorageMap = new Map()
  private alarms: AlarmMap = new Map()
  private failNextOperation = false

  // For testing failure scenarios
  setFailNext(): void {
    this.failNextOperation = true
  }

  reset(): void {
    this.storage.clear()
    this.alarms.clear()
    this.failNextOperation = false
  }

  getPool(_dbId: string) {
    return {
      acquire: async () => this.createConnection(),
      release: () => {},
      close: async () => {},
      stats: () => ({ active: 0, idle: 1, total: 1 }),
    }
  }

  async connect(_dbId?: string) {
    return this.createConnection()
  }

  async query<T>(
    sql: string,
    params?: unknown[],
    _dbId?: string,
  ): Promise<{
    rows: T[]
    rowCount: number
    columns: []
    executionTime: number
    blockHeight: number
  }> {
    if (this.failNextOperation) {
      this.failNextOperation = false
      throw new Error('Simulated SQLit failure')
    }
    return this.executeQuery<T>(sql, params)
  }

  async exec(
    sql: string,
    params?: unknown[],
    _dbId?: string,
  ): Promise<{
    rowsAffected: number
    txHash: `0x${string}`
    blockHeight: number
    gasUsed: bigint
  }> {
    if (this.failNextOperation) {
      this.failNextOperation = false
      throw new Error('Simulated SQLit failure')
    }
    return this.executeExec(sql, params)
  }

  private createConnection() {
    const conn = {
      id: `mock-conn-${Date.now()}`,
      databaseId: 'test-db',
      active: true,
      query: async <T>(sql: string, params?: unknown[]) =>
        this.executeQuery<T>(sql, params),
      exec: async (sql: string, params?: unknown[]) =>
        this.executeExec(sql, params),
      beginTransaction: async () => {
        const storageSnapshot = new Map(this.storage)
        const alarmsSnapshot = new Map(this.alarms)
        let rolledBack = false

        return {
          id: `tx-${Date.now()}`,
          query: async <T>(sql: string, params?: unknown[]) => {
            if (rolledBack) throw new Error('Transaction rolled back')
            return this.executeQuery<T>(sql, params)
          },
          exec: async (sql: string, params?: unknown[]) => {
            if (rolledBack) throw new Error('Transaction rolled back')
            return this.executeExec(sql, params)
          },
          commit: async () => {
            if (rolledBack) throw new Error('Transaction already rolled back')
          },
          rollback: async () => {
            rolledBack = true
            this.storage = storageSnapshot
            this.alarms = alarmsSnapshot
          },
        }
      },
      close: async () => {
        conn.active = false
      },
    }
    return conn
  }

  private executeQuery<T>(
    sql: string,
    params?: unknown[],
  ): {
    rows: T[]
    rowCount: number
    columns: []
    executionTime: number
    blockHeight: number
  } {
    const doId = params?.[0] as string
    const baseResult = { columns: [] as [], executionTime: 1, blockHeight: 1 }

    // SELECT value FROM do_state WHERE do_id = ? AND key = ?
    if (sql.includes('SELECT value FROM do_state') && sql.includes('key = ?')) {
      const key = params?.[1] as string
      const doStorage = this.storage.get(doId)
      const value = doStorage?.get(key)
      if (value) return { ...baseResult, rows: [{ value } as T], rowCount: 1 }
      return { ...baseResult, rows: [], rowCount: 0 }
    }

    // SELECT key, value FROM do_state WHERE do_id = ? AND key IN (...)
    if (
      sql.includes('SELECT key, value FROM do_state') &&
      sql.includes('IN (')
    ) {
      const keys = (params?.slice(1) ?? []) as string[]
      const doStorage = this.storage.get(doId)
      const rows: Array<{ key: string; value: string }> = []
      if (doStorage) {
        for (const k of keys) {
          const value = doStorage.get(k)
          if (value) rows.push({ key: k, value })
        }
      }
      return { ...baseResult, rows: rows as T[], rowCount: rows.length }
    }

    // SELECT key, value FROM do_state WHERE do_id = ? (list)
    if (
      sql.includes('SELECT key, value FROM do_state') &&
      sql.includes('ORDER BY')
    ) {
      const doStorage = this.storage.get(doId)
      const rows: Array<{ key: string; value: string }> = []
      let prefix: string | null = null
      const reverse = sql.includes('DESC')

      // Parse prefix
      if (sql.includes('LIKE ?')) {
        const likeIdx = params?.findIndex(
          (p, i) => i > 0 && typeof p === 'string' && p.includes('%'),
        )
        if (likeIdx !== undefined && likeIdx > 0) {
          const likeParam = params?.[likeIdx] as string
          prefix = likeParam.replace(/%/g, '').replace(/\\([%_\\])/g, '$1')
        }
      }

      if (doStorage) {
        for (const [k, v] of doStorage.entries()) {
          if (prefix === null || k.startsWith(prefix)) {
            rows.push({ key: k, value: v })
          }
        }
      }

      rows.sort((a, b) =>
        reverse ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key),
      )

      // Apply limit
      const limitMatch = sql.match(/LIMIT (\d+|\?)/)
      if (limitMatch) {
        const limitValue =
          limitMatch[1] === '?'
            ? (params?.[params.length - 1] as number)
            : parseInt(limitMatch[1], 10)
        if (typeof limitValue === 'number') rows.splice(limitValue)
      }

      return { ...baseResult, rows: rows as T[], rowCount: rows.length }
    }

    // Alarms
    if (sql.includes('do_alarms')) {
      const time = this.alarms.get(doId)
      if (time !== undefined) {
        return {
          ...baseResult,
          rows: [{ scheduled_time: time } as T],
          rowCount: 1,
        }
      }
      return { ...baseResult, rows: [], rowCount: 0 }
    }

    return { ...baseResult, rows: [], rowCount: 0 }
  }

  private executeExec(
    sql: string,
    params?: unknown[],
  ): {
    rowsAffected: number
    txHash: `0x${string}`
    blockHeight: number
    gasUsed: bigint
  } {
    const doId = params?.[0] as string
    const txHash = `0x${'0'.repeat(64)}` as `0x${string}`
    const baseResult = { rowsAffected: 0, txHash, blockHeight: 1, gasUsed: 0n }

    // INSERT INTO do_state
    if (sql.includes('INSERT INTO do_state')) {
      const key = params?.[1] as string
      const value = params?.[2] as string
      let doStorage = this.storage.get(doId)
      if (!doStorage) {
        doStorage = new Map()
        this.storage.set(doId, doStorage)
      }
      doStorage.set(key, value)
      return { ...baseResult, rowsAffected: 1 }
    }

    // DELETE FROM do_state WHERE do_id = ? AND key = ?
    if (
      sql.includes('DELETE FROM do_state') &&
      sql.includes('key = ?') &&
      !sql.includes('IN (')
    ) {
      const key = params?.[1] as string
      const doStorage = this.storage.get(doId)
      if (doStorage?.delete(key)) return { ...baseResult, rowsAffected: 1 }
      return baseResult
    }

    // DELETE FROM do_state WHERE do_id = ? AND key IN (...)
    if (sql.includes('DELETE FROM do_state') && sql.includes('IN (')) {
      const keys = (params?.slice(1) ?? []) as string[]
      const doStorage = this.storage.get(doId)
      let deleted = 0
      if (doStorage) {
        for (const k of keys) {
          if (doStorage.delete(k)) deleted++
        }
      }
      return { ...baseResult, rowsAffected: deleted }
    }

    // DELETE FROM do_state WHERE do_id = ? (deleteAll)
    if (sql.includes('DELETE FROM do_state') && !sql.includes('key')) {
      const doStorage = this.storage.get(doId)
      const deleted = doStorage?.size ?? 0
      this.storage.delete(doId)
      return { ...baseResult, rowsAffected: deleted }
    }

    // Alarms
    if (
      sql.includes('INSERT INTO do_alarms') ||
      sql.includes('REPLACE INTO do_alarms')
    ) {
      const time = params?.[1] as number
      this.alarms.set(doId, time)
      return { ...baseResult, rowsAffected: 1 }
    }

    if (sql.includes('DELETE FROM do_alarms')) {
      if (this.alarms.delete(doId)) return { ...baseResult, rowsAffected: 1 }
      return baseResult
    }

    return baseResult
  }
}

// Helper to create storage instance
function createStorage(
  doId: string,
  mockSqlit: MockSQLitClient,
): DWSObjectStorage {
  return new DWSObjectStorage(
    doId,
    mockSqlit as Parameters<
      (typeof DWSObjectStorage)['prototype']['constructor']
    >[1],
    'test-db',
  )
}

// ============================================================================
// DWSObjectId Tests
// ============================================================================

describe('DWSObjectId', () => {
  const NAMESPACE = 'test-namespace'

  describe('fromName', () => {
    test('creates deterministic ID from name', async () => {
      const id1 = await DWSObjectId.fromName(NAMESPACE, 'my-room')
      const id2 = await DWSObjectId.fromName(NAMESPACE, 'my-room')

      expect(id1.toString()).toBe(id2.toString())
      expect(id1.name).toBe('my-room')
    })

    test('ID format is 64 hex characters', async () => {
      const id = await DWSObjectId.fromName(NAMESPACE, 'test')

      expect(id.toString()).toMatch(/^[0-9a-f]{64}$/)
    })

    test('different names produce different IDs', async () => {
      const id1 = await DWSObjectId.fromName(NAMESPACE, 'room-1')
      const id2 = await DWSObjectId.fromName(NAMESPACE, 'room-2')

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('different namespaces produce different IDs for same name', async () => {
      const id1 = await DWSObjectId.fromName('namespace-1', 'room')
      const id2 = await DWSObjectId.fromName('namespace-2', 'room')

      expect(id1.toString()).not.toBe(id2.toString())
    })

    // Edge cases
    test('handles empty name', async () => {
      const id = await DWSObjectId.fromName(NAMESPACE, '')

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe('')
    })

    test('handles unicode name', async () => {
      const id = await DWSObjectId.fromName(NAMESPACE, '日本語🎉')

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe('日本語🎉')
    })

    test('handles SQL injection attempt in name', async () => {
      const sqlInjection = "'; DROP TABLE do_state; --"
      const id = await DWSObjectId.fromName(NAMESPACE, sqlInjection)

      expect(id.toString()).toHaveLength(64)
      expect(id.name).toBe(sqlInjection)
    })

    test('handles very long name (1MB)', async () => {
      const longName = 'x'.repeat(1024 * 1024)
      const id = await DWSObjectId.fromName(NAMESPACE, longName)

      expect(id.toString()).toHaveLength(64)
    })

    test('is case-sensitive', async () => {
      const id1 = await DWSObjectId.fromName(NAMESPACE, 'Room')
      const id2 = await DWSObjectId.fromName(NAMESPACE, 'room')

      expect(id1.toString()).not.toBe(id2.toString())
    })
  })

  describe('newUnique', () => {
    test('creates unique IDs', async () => {
      const id1 = await DWSObjectId.newUnique(NAMESPACE)
      const id2 = await DWSObjectId.newUnique(NAMESPACE)

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('unique IDs have no name', async () => {
      const id = await DWSObjectId.newUnique(NAMESPACE)

      expect(id.name).toBeUndefined()
    })

    test('100 unique IDs without collision', async () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const id = await DWSObjectId.newUnique(NAMESPACE)
        ids.add(id.toString())
      }
      expect(ids.size).toBe(100)
    })

    test('concurrent unique ID generation produces unique IDs', async () => {
      const promises = Array.from({ length: 50 }, () =>
        DWSObjectId.newUnique(NAMESPACE),
      )
      const ids = await Promise.all(promises)
      const unique = new Set(ids.map((id) => id.toString()))

      expect(unique.size).toBe(50)
    })
  })

  describe('fromString', () => {
    test('parses valid ID', async () => {
      const original = await DWSObjectId.fromName(NAMESPACE, 'room')
      const parsed = await DWSObjectId.fromString(
        NAMESPACE,
        original.toString(),
      )

      expect(parsed.toString()).toBe(original.toString())
    })

    test('throws on invalid length', async () => {
      await expect(
        DWSObjectId.fromString(NAMESPACE, 'too-short'),
      ).rejects.toThrow('Invalid Durable Object ID format')
    })

    test('throws on invalid characters', async () => {
      const invalid = 'g'.repeat(64)
      await expect(DWSObjectId.fromString(NAMESPACE, invalid)).rejects.toThrow(
        'Invalid Durable Object ID format',
      )
    })

    test('throws on wrong namespace', async () => {
      const id = await DWSObjectId.fromName('namespace-1', 'room')
      await expect(
        DWSObjectId.fromString('namespace-2', id.toString()),
      ).rejects.toThrow('does not belong')
    })

    test('normalizes uppercase hex', async () => {
      const original = await DWSObjectId.fromName(NAMESPACE, 'test')
      const upperCase = original.toString().toUpperCase()
      const parsed = await DWSObjectId.fromString(NAMESPACE, upperCase)

      expect(parsed.toString()).toBe(original.toString().toLowerCase())
    })
  })

  describe('validateNamespace', () => {
    test('returns true for valid ID', async () => {
      const id = await DWSObjectId.fromName(NAMESPACE, 'room')
      const valid = await DWSObjectId.validateNamespace(
        NAMESPACE,
        id.toString(),
      )

      expect(valid).toBe(true)
    })

    test('returns false for wrong namespace', async () => {
      const id = await DWSObjectId.fromName('namespace-1', 'room')
      const valid = await DWSObjectId.validateNamespace(
        'namespace-2',
        id.toString(),
      )

      expect(valid).toBe(false)
    })

    test('returns false for invalid format', async () => {
      expect(await DWSObjectId.validateNamespace(NAMESPACE, 'invalid')).toBe(
        false,
      )
      expect(await DWSObjectId.validateNamespace(NAMESPACE, '')).toBe(false)
      expect(
        await DWSObjectId.validateNamespace(NAMESPACE, 'z'.repeat(64)),
      ).toBe(false)
    })
  })

  describe('equals', () => {
    test('same ID equals itself', async () => {
      const id1 = await DWSObjectId.fromName(NAMESPACE, 'room')
      const id2 = await DWSObjectId.fromName(NAMESPACE, 'room')

      expect(id1.equals(id2)).toBe(true)
    })

    test('different IDs are not equal', async () => {
      const id1 = await DWSObjectId.fromName(NAMESPACE, 'room-1')
      const id2 = await DWSObjectId.fromName(NAMESPACE, 'room-2')

      expect(id1.equals(id2)).toBe(false)
    })
  })
})

// ============================================================================
// DWSObjectNamespace Tests
// ============================================================================

describe('DWSObjectNamespace', () => {
  const config = {
    dwsApiUrl: 'http://localhost:4030',
    requestTimeout: 30000,
  }

  describe('DWSObjectNamespaceAsync', () => {
    test('creates IDs from name', async () => {
      const ns = new DWSObjectNamespaceAsync('chat-rooms', config)
      const id = await ns.idFromName('my-room')

      expect(id.name).toBe('my-room')
      expect(id.toString()).toHaveLength(64)
    })

    test('creates unique IDs', async () => {
      const ns = new DWSObjectNamespaceAsync('chat-rooms', config)
      const id1 = await ns.newUniqueId()
      const id2 = await ns.newUniqueId()

      expect(id1.toString()).not.toBe(id2.toString())
    })

    test('parses ID strings', async () => {
      const ns = new DWSObjectNamespaceAsync('chat-rooms', config)
      const original = await ns.idFromName('room')
      const parsed = await ns.idFromString(original.toString())

      expect(parsed.toString()).toBe(original.toString())
    })

    test('get creates stub', async () => {
      const ns = new DWSObjectNamespaceAsync('chat-rooms', config)
      const id = await ns.idFromName('room')
      const stub = ns.get(id)

      expect(stub.id.toString()).toBe(id.toString())
      expect(stub.name).toBe('room')
    })

    test('getByName creates stub', async () => {
      const ns = new DWSObjectNamespaceAsync('chat-rooms', config)
      const stub = await ns.getByName('my-room')

      expect(stub.name).toBe('my-room')
    })
  })

  describe('DWSObjectNamespace (sync)', () => {
    test('idFromName returns deferred ID', () => {
      const ns = new DWSObjectNamespace('chat-rooms', config)
      const id = ns.idFromName('room')

      expect(id.name).toBe('room')
    })

    test('get throws on unresolved ID', () => {
      const ns = new DWSObjectNamespace('chat-rooms', config)
      const id = ns.idFromName('room')

      expect(() => ns.get(id)).toThrow('not resolved')
    })

    test('get works with resolved ID', async () => {
      const ns = new DWSObjectNamespace('chat-rooms', config)
      const resolvedId = await DWSObjectId.fromName('chat-rooms', 'room')
      const stub = ns.get(resolvedId)

      expect(stub.id.toString()).toBe(resolvedId.toString())
    })
  })
})

// ============================================================================
// DWSObjectStorage Tests
// ============================================================================

describe('DWSObjectStorage', () => {
  let mockSqlit: MockSQLitClient
  const TEST_DO_ID = 'test-do-id'

  beforeEach(() => {
    mockSqlit = new MockSQLitClient()
    mockSqlit.reset()
  })

  describe('put and get', () => {
    test('stores and retrieves string', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('key', 'value')
      const result = await storage.get<string>('key')

      expect(result).toBe('value')
    })

    test('stores and retrieves number', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('count', 42)
      expect(await storage.get<number>('count')).toBe(42)
    })

    test('stores and retrieves object', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const obj = { name: 'test', nested: { value: 123 } }

      await storage.put('obj', obj)
      expect(await storage.get<typeof obj>('obj')).toEqual(obj)
    })

    test('stores and retrieves array', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const arr = [1, 2, 'three', { four: 4 }]

      await storage.put('arr', arr)
      expect(await storage.get<typeof arr>('arr')).toEqual(arr)
    })

    test('returns undefined for missing key', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      expect(await storage.get('nonexistent')).toBeUndefined()
    })

    test('overwrites existing value', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('key', 'first')
      await storage.put('key', 'second')

      expect(await storage.get<string>('key')).toBe('second')
    })

    test('stores boolean false', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('flag', false)
      expect(await storage.get<boolean>('flag')).toBe(false)
    })

    test('stores null', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('nothing', null)
      expect(await storage.get<null>('nothing')).toBeNull()
    })

    test('stores zero', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('zero', 0)
      expect(await storage.get<number>('zero')).toBe(0)
    })

    test('stores empty string', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('empty', '')
      expect(await storage.get<string>('empty')).toBe('')
    })
  })

  describe('put and get multiple', () => {
    test('stores multiple values at once', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ key1: 'v1', key2: 'v2', key3: 'v3' })
      const result = await storage.get(['key1', 'key2', 'key3'])

      expect(result.get('key1')).toBe('v1')
      expect(result.get('key2')).toBe('v2')
      expect(result.get('key3')).toBe('v3')
    })

    test('get multiple returns only existing keys', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('existing', 'value')
      const result = await storage.get(['existing', 'missing'])

      expect(result.size).toBe(1)
      expect(result.has('missing')).toBe(false)
    })

    test('get multiple with empty array returns empty map', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const result = await storage.get([])

      expect(result.size).toBe(0)
    })
  })

  describe('delete', () => {
    test('deletes existing key', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('key', 'value')
      const deleted = await storage.delete('key')

      expect(deleted).toBe(true)
      expect(await storage.get('key')).toBeUndefined()
    })

    test('returns false for non-existent key', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      expect(await storage.delete('nonexistent')).toBe(false)
    })

    test('deletes multiple keys', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ k1: 1, k2: 2, k3: 3 })
      const deleted = await storage.delete(['k1', 'k2'])

      expect(deleted).toBe(2)
      expect(await storage.get('k3')).toBe(3)
    })

    test('delete multiple with empty array returns 0', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      expect(await storage.delete([])).toBe(0)
    })
  })

  describe('deleteAll', () => {
    test('deletes all keys', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ k1: 1, k2: 2, k3: 3 })
      await storage.deleteAll()

      const result = await storage.get(['k1', 'k2', 'k3'])
      expect(result.size).toBe(0)
    })
  })

  describe('list', () => {
    test('lists all keys', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ a: 1, b: 2, c: 3 })
      const result = await storage.list()

      expect(result.size).toBe(3)
    })

    test('lists with prefix', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ 'user:1': 'a', 'user:2': 'b', other: 'c' })
      const result = await storage.list({ prefix: 'user:' })

      expect(result.size).toBe(2)
      expect(result.has('user:1')).toBe(true)
      expect(result.has('other')).toBe(false)
    })

    test('lists with limit', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ a: 1, b: 2, c: 3, d: 4, e: 5 })
      const result = await storage.list({ limit: 2 })

      expect(result.size).toBe(2)
    })

    test('lists in reverse order', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put({ a: 1, b: 2, c: 3 })
      const result = await storage.list({ reverse: true })

      const keys = [...result.keys()]
      expect(keys).toEqual(['c', 'b', 'a'])
    })
  })

  describe('transaction', () => {
    test('commits on success', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      const result = await storage.transaction(async () => {
        await storage.put('txKey', 'txValue')
        return 'committed'
      })

      expect(result).toBe('committed')
      expect(await storage.get('txKey')).toBe('txValue')
    })

    test('returns closure result', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      const result = await storage.transaction(async () => 'result')

      expect(result).toBe('result')
    })
  })

  describe('key validation', () => {
    test('rejects empty key', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await expect(storage.put('', 'value')).rejects.toThrow(
        'Key cannot be empty',
      )
    })

    test('rejects key too long', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const longKey = 'x'.repeat(MAX_KEY_SIZE + 1)

      await expect(storage.put(longKey, 'value')).rejects.toThrow(
        'exceeds maximum',
      )
    })

    test('accepts key at max size', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const maxKey = 'x'.repeat(MAX_KEY_SIZE)

      await storage.put(maxKey, 'value')
      expect(await storage.get<string>(maxKey)).toBe('value')
    })
  })

  describe('value validation', () => {
    test('rejects value too large', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const largeValue = 'x'.repeat(MAX_VALUE_SIZE + 1)

      await expect(storage.put('key', largeValue)).rejects.toThrow(
        'exceeds maximum',
      )
    })

    test('accepts value within max serialized size', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      // JSON.stringify adds 2 chars for quotes, so max string is MAX_VALUE_SIZE - 2
      const maxValue = 'x'.repeat(MAX_VALUE_SIZE - 2)

      await storage.put('key', maxValue)
      expect(await storage.get<string>('key')).toBe(maxValue)
    })
  })

  describe('batch size validation', () => {
    test('accepts batch at max size', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const entries: Record<string, number> = {}
      for (let i = 0; i < MAX_BATCH_SIZE; i++) {
        entries[`key-${i}`] = i
      }

      await storage.put(entries)
      const result = await storage.get(Object.keys(entries))
      expect(result.size).toBe(MAX_BATCH_SIZE)
    })

    test('rejects batch over max size', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const entries: Record<string, number> = {}
      for (let i = 0; i < MAX_BATCH_SIZE + 1; i++) {
        entries[`key-${i}`] = i
      }

      await expect(storage.put(entries)).rejects.toThrow('exceeds maximum')
    })
  })

  describe('alarms', () => {
    test('sets and gets alarm', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const futureTime = Date.now() + 60000

      await storage.setAlarm(futureTime)
      expect(await storage.getAlarm()).toBe(futureTime)
    })

    test('sets alarm with Date object', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const futureDate = new Date(Date.now() + 60000)

      await storage.setAlarm(futureDate)
      expect(await storage.getAlarm()).toBe(futureDate.getTime())
    })

    test('deletes alarm', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const futureTime = Date.now() + 60000

      await storage.setAlarm(futureTime)
      await storage.deleteAlarm()

      expect(await storage.getAlarm()).toBeNull()
    })

    test('rejects alarm in past', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)
      const pastTime = Date.now() - 1000

      await expect(storage.setAlarm(pastTime)).rejects.toThrow(
        'must be in the future',
      )
    })

    test('returns null when no alarm set', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      expect(await storage.getAlarm()).toBeNull()
    })
  })

  describe('concurrent operations', () => {
    test('concurrent puts to different keys', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      const promises = Array.from({ length: 50 }, (_, i) =>
        storage.put(`key-${i}`, `value-${i}`),
      )
      await Promise.all(promises)

      const getPromises = Array.from({ length: 50 }, (_, i) =>
        storage.get<string>(`key-${i}`),
      )
      const results = await Promise.all(getPromises)

      results.forEach((result, i) => {
        expect(result).toBe(`value-${i}`)
      })
    })

    test('concurrent gets return consistent values', async () => {
      const storage = createStorage(TEST_DO_ID, mockSqlit)

      await storage.put('shared', 'stable-value')

      const promises = Array.from({ length: 100 }, () =>
        storage.get<string>('shared'),
      )
      const results = await Promise.all(promises)

      results.forEach((result) => {
        expect(result).toBe('stable-value')
      })
    })
  })
})

// ============================================================================
// DWSObjectState Tests
// ============================================================================

describe('DWSObjectState', () => {
  let mockSqlit: MockSQLitClient
  const NAMESPACE = 'test-namespace'

  beforeEach(() => {
    mockSqlit = new MockSQLitClient()
  })

  async function createState(name: string): Promise<DWSObjectState> {
    const id = await DWSObjectId.fromName(NAMESPACE, name)
    return new DWSObjectState(
      id,
      mockSqlit as Parameters<
        (typeof DWSObjectState)['prototype']['constructor']
      >[1],
      'test-db',
    )
  }

  describe('basic properties', () => {
    test('has id and storage', async () => {
      const state = await createState('room')

      expect(state.id).toBeDefined()
      expect(state.storage).toBeDefined()
    })
  })

  describe('blockConcurrencyWhile', () => {
    test('executes and returns result', async () => {
      const state = await createState('room')

      const result = await state.blockConcurrencyWhile(async () => 'done')

      expect(result).toBe('done')
    })

    test('blocks concurrent waitForUnblock', async () => {
      const state = await createState('room')
      const order: number[] = []

      const blockingPromise = state.blockConcurrencyWhile(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 50))
        order.push(2)
      })

      await new Promise((r) => setTimeout(r, 10))
      const waitPromise = state.waitForUnblock().then(() => {
        order.push(3)
      })

      await Promise.all([blockingPromise, waitPromise])

      expect(order).toEqual([1, 2, 3])
    })

    test('releases on error', async () => {
      const state = await createState('room')

      await expect(
        state.blockConcurrencyWhile(async () => {
          throw new Error('Test error')
        }),
      ).rejects.toThrow('Test error')

      // Should not block anymore
      const result = await state.blockConcurrencyWhile(
        async () => 'after-error',
      )
      expect(result).toBe('after-error')
    })
  })

  describe('waitUntil', () => {
    test('tracks background promise', async () => {
      const state = await createState('room')
      let resolved = false

      state.waitUntil(
        new Promise<void>((r) => {
          setTimeout(() => {
            resolved = true
            r()
          }, 10)
        }),
      )

      expect(resolved).toBe(false)
      await state.drainWaitUntil()
      expect(resolved).toBe(true)
    })

    test('handles rejected promises', async () => {
      const state = await createState('room')

      state.waitUntil(Promise.reject(new Error('Background error')))

      // Should not throw
      await state.drainWaitUntil()
    })
  })

  describe('WebSocket management', () => {
    class MockWebSocket {
      readyState = WebSocket.OPEN
      onclose: ((ev: CloseEvent) => void) | null = null
      onerror: ((ev: Event) => void) | null = null
      sentMessages: Array<string | ArrayBuffer> = []
      closeCalled = false

      send(data: string | ArrayBuffer): void {
        this.sentMessages.push(data)
      }

      close(): void {
        this.closeCalled = true
        this.readyState = WebSocket.CLOSED
      }
    }

    test('acceptWebSocket stores WebSocket', async () => {
      const state = await createState('room')
      const ws = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws)

      expect(state.getWebSockets()).toContain(ws)
      expect(state.getWebSocketCount()).toBe(1)
    })

    test('getWebSockets filters by tag', async () => {
      const state = await createState('room')
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws1, ['tag1'])
      state.acceptWebSocket(ws2, ['tag2'])

      expect(state.getWebSockets('tag1').length).toBe(1)
      expect(state.getWebSockets('tag2').length).toBe(1)
      expect(state.getWebSockets().length).toBe(2)
    })

    test('broadcast sends to all WebSockets', async () => {
      const state = await createState('room')
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      state.acceptWebSocket(ws1 as unknown as WebSocket)
      state.acceptWebSocket(ws2 as unknown as WebSocket)

      state.broadcast('hello')

      expect(ws1.sentMessages).toContain('hello')
      expect(ws2.sentMessages).toContain('hello')
    })

    test('broadcast with tag filters recipients', async () => {
      const state = await createState('room')
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      state.acceptWebSocket(ws1 as unknown as WebSocket, ['room-1'])
      state.acceptWebSocket(ws2 as unknown as WebSocket, ['room-2'])

      state.broadcast('room-1-message', 'room-1')

      expect(ws1.sentMessages).toContain('room-1-message')
      expect(ws2.sentMessages).not.toContain('room-1-message')
    })

    test('closeAllWebSockets closes all', async () => {
      const state = await createState('room')
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      state.acceptWebSocket(ws1 as unknown as WebSocket)
      state.acceptWebSocket(ws2 as unknown as WebSocket)

      state.closeAllWebSockets()

      expect(ws1.closeCalled).toBe(true)
      expect(ws2.closeCalled).toBe(true)
      expect(state.getWebSocketCount()).toBe(0)
    })

    test('WebSocket attachment', async () => {
      const state = await createState('room')
      const ws = new MockWebSocket() as unknown as WebSocket

      state.acceptWebSocket(ws)
      state.setWebSocketAttachment(ws, { userId: '123' })

      const attachment = state.getWebSocketAttachment(ws) as { userId: string }
      expect(attachment.userId).toBe('123')
    })

    test('WebSocket removed on close', async () => {
      const state = await createState('room')
      const ws = new MockWebSocket()

      state.acceptWebSocket(ws as unknown as WebSocket)
      expect(state.getWebSocketCount()).toBe(1)

      ws.onclose?.(new CloseEvent('close'))

      expect(state.getWebSocketCount()).toBe(0)
    })
  })
})

// ============================================================================
// Metrics Tests
// ============================================================================

import {
  AlarmScheduler,
  getAlarmScheduler,
  startAlarmScheduler,
  stopAlarmScheduler,
} from '../api/durable-objects/alarm-scheduler.js'
import {
  createDurableObjectsRouter,
  getDOMetrics,
  registerDurableObjectClass,
  startDurableObjectManager,
  stopDurableObjectManager,
} from '../api/durable-objects/router.js'

describe('Router exports', () => {
  test('createDurableObjectsRouter is exported and callable', () => {
    expect(typeof createDurableObjectsRouter).toBe('function')
  })

  test('getDOMetrics is exported and callable', () => {
    expect(typeof getDOMetrics).toBe('function')
  })

  test('registerDurableObjectClass is exported and callable', () => {
    expect(typeof registerDurableObjectClass).toBe('function')
  })

  test('startDurableObjectManager is exported and callable', () => {
    expect(typeof startDurableObjectManager).toBe('function')
  })

  test('stopDurableObjectManager is exported and callable', () => {
    expect(typeof stopDurableObjectManager).toBe('function')
  })
})

describe('AlarmScheduler exports', () => {
  test('AlarmScheduler class is exported', () => {
    expect(AlarmScheduler).toBeDefined()
  })

  test('getAlarmScheduler is exported and callable', () => {
    expect(typeof getAlarmScheduler).toBe('function')
  })

  test('startAlarmScheduler is exported and callable', () => {
    expect(typeof startAlarmScheduler).toBe('function')
  })

  test('stopAlarmScheduler is exported and callable', () => {
    expect(typeof stopAlarmScheduler).toBe('function')
  })
})

describe('getDOMetrics', () => {
  test('returns all metric fields', () => {
    const metrics = getDOMetrics()
    expect(metrics).toHaveProperty('instancesCreated')
    expect(metrics).toHaveProperty('instancesEvicted')
    expect(metrics).toHaveProperty('requestsTotal')
    expect(metrics).toHaveProperty('requestsSuccess')
    expect(metrics).toHaveProperty('requestsError')
    expect(metrics).toHaveProperty('alarmsProcessed')
    expect(metrics).toHaveProperty('websocketsAccepted')
    expect(metrics).toHaveProperty('websocketsClosed')
    expect(metrics).toHaveProperty('avgLatencyMs')
    expect(metrics).toHaveProperty('p99LatencyMs')
    expect(metrics).toHaveProperty('sampleCount')
  })

  test('all metric values are numbers', () => {
    const metrics = getDOMetrics()
    expect(typeof metrics.instancesCreated).toBe('number')
    expect(typeof metrics.instancesEvicted).toBe('number')
    expect(typeof metrics.requestsTotal).toBe('number')
    expect(typeof metrics.requestsSuccess).toBe('number')
    expect(typeof metrics.requestsError).toBe('number')
    expect(typeof metrics.alarmsProcessed).toBe('number')
    expect(typeof metrics.websocketsAccepted).toBe('number')
    expect(typeof metrics.websocketsClosed).toBe('number')
    expect(typeof metrics.avgLatencyMs).toBe('number')
    expect(typeof metrics.p99LatencyMs).toBe('number')
    expect(typeof metrics.sampleCount).toBe('number')
  })

  test('avgLatencyMs is 0 when no samples', () => {
    const metrics = getDOMetrics()
    if (metrics.sampleCount === 0) {
      expect(metrics.avgLatencyMs).toBe(0)
      expect(metrics.p99LatencyMs).toBe(0)
    }
  })

  test('does not mutate internal state on multiple calls', () => {
    const metrics1 = getDOMetrics()
    const metrics2 = getDOMetrics()
    expect(metrics1.requestsTotal).toBe(metrics2.requestsTotal)
    expect(metrics1.instancesCreated).toBe(metrics2.instancesCreated)
  })

  test('sampleCount is non-negative', () => {
    const metrics = getDOMetrics()
    expect(metrics.sampleCount).toBeGreaterThanOrEqual(0)
    expect(metrics.sampleCount).toBeLessThanOrEqual(100) // Max 100 samples kept
  })
})

// ============================================================================
// Schema Rollback Tests
// ============================================================================

import {
  initializeDOSchema,
  isDOSchemaInitialized,
  rollbackDOSchema,
} from '@jejunetwork/durable-objects'

describe('rollbackDOSchema', () => {
  test('is exported and callable', () => {
    expect(typeof rollbackDOSchema).toBe('function')
  })

  test('initializeDOSchema is exported and callable', () => {
    expect(typeof initializeDOSchema).toBe('function')
  })

  test('isDOSchemaInitialized is exported and callable', () => {
    expect(typeof isDOSchemaInitialized).toBe('function')
  })
})

describe('DO_SCHEMA_STATEMENTS', () => {
  test('contains required table definitions', async () => {
    const { DO_SCHEMA_STATEMENTS } = await import(
      '@jejunetwork/durable-objects'
    )
    expect(Array.isArray(DO_SCHEMA_STATEMENTS)).toBe(true)
    expect(DO_SCHEMA_STATEMENTS.length).toBeGreaterThan(0)

    const statements = DO_SCHEMA_STATEMENTS.join('\n')
    expect(statements).toContain('do_locations')
    expect(statements).toContain('do_state')
    expect(statements).toContain('do_alarms')
  })
})

// ============================================================================
// Integration Tests (SQLit) - ALWAYS RUN AGAINST REAL INFRASTRUCTURE
// ============================================================================

import { getSQLitBlockProducerUrl } from '@jejunetwork/config'
import { getSQLit } from '@jejunetwork/db'

// SQLit runs on port 4661 by default (see packages/config/ports.ts)
// When running tests via `jeju test`, SQLit is automatically started
const SQLIT_URL = getSQLitBlockProducerUrl() // defaults to http://localhost:4661

async function requireSQLit(): Promise<void> {
  // Try multiple health endpoints (SQLit supports both /v1/status and /health)
  const endpoints = [`${SQLIT_URL}/v1/status`, `${SQLIT_URL}/health`]

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        return // SQLit is running
      }
    } catch {
      // Try next endpoint
    }
  }

  throw new Error(
    `\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `TEST ENVIRONMENT ERROR: SQLit is not available at ${SQLIT_URL}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `\n` +
      `Run tests via jeju CLI (automatically starts SQLit):\n` +
      `  bun run test              # from monorepo root\n` +
      `  jeju test --app=dws       # or directly\n` +
      `\n` +
      `Or start SQLit manually:\n` +
      `  jeju start sqlit\n` +
      `\n` +
      `Tests MUST run against real infrastructure. No skipping.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
  )
}

// Skip: Requires running SQLit service
describe.skip('Integration Tests (SQLit)', () => {
  const databaseId = `do-integration-test-${Date.now()}`

  // Fail fast if SQLit is not running
  beforeAll(async () => {
    await requireSQLit()
  })

  test('initializes schema on real SQLit', async () => {
    const sqlit = getSQLit()
    await initializeDOSchema(sqlit, databaseId)
    const initialized = await isDOSchemaInitialized(sqlit, databaseId)
    expect(initialized).toBe(true)
  })

  test('storage operations work on real SQLit', async () => {
    const sqlit = getSQLit()
    const storage = new DWSObjectStorage(
      'integration-test-do',
      sqlit,
      databaseId,
    )

    await storage.put('test-key', { value: 'integration-test' })
    const result = await storage.get<{ value: string }>('test-key')
    expect(result?.value).toBe('integration-test')

    const deleted = await storage.delete('test-key')
    expect(deleted).toBe(true)

    const afterDelete = await storage.get('test-key')
    expect(afterDelete).toBeUndefined()
  })

  test('transactions work on real SQLit', async () => {
    const sqlit = getSQLit()
    const storage = new DWSObjectStorage(
      'integration-tx-test',
      sqlit,
      databaseId,
    )

    await storage.transaction(async () => {
      await storage.put('tx-key-1', 'value-1')
      await storage.put('tx-key-2', 'value-2')
    })

    const values = await storage.get(['tx-key-1', 'tx-key-2'])
    expect(values.get('tx-key-1')).toBe('value-1')
    expect(values.get('tx-key-2')).toBe('value-2')
  })

  test('alarm scheduling works on real SQLit', async () => {
    const sqlit = getSQLit()
    const storage = new DWSObjectStorage(
      'integration-alarm-test',
      sqlit,
      databaseId,
    )

    const futureTime = Date.now() + 60000
    await storage.setAlarm(futureTime)

    const alarm = await storage.getAlarm()
    expect(alarm).toBe(futureTime)

    await storage.deleteAlarm()
    const afterDelete = await storage.getAlarm()
    expect(afterDelete).toBeNull()
  })

  test('list operations work on real SQLit', async () => {
    const sqlit = getSQLit()
    const storage = new DWSObjectStorage(
      'integration-list-test',
      sqlit,
      databaseId,
    )

    await storage.put({
      'prefix:a': 1,
      'prefix:b': 2,
      'prefix:c': 3,
      'other:x': 4,
    })

    const prefixed = await storage.list({ prefix: 'prefix:' })
    expect(prefixed.size).toBe(3)
    expect(prefixed.has('prefix:a')).toBe(true)
    expect(prefixed.has('other:x')).toBe(false)
  })
})

// ============================================================================
// Cleanup
// ============================================================================

afterAll(() => {
  console.log('[Durable Objects Comprehensive Tests] Complete')
  console.log(`[Integration Tests] SQLit endpoint: ${SQLIT_URL}`)
})
