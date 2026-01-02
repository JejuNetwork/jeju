/**
 * SQLit Store Tests
 * Tests for the SQLit store adapter used by Subsquid processor
 */

import { beforeEach, describe, expect, test } from 'bun:test'

// Mock the SQLit client for unit testing
const mockSqlitClient = {
  queries: [] as { sql: string; params: unknown[] }[],
  execCalls: [] as { sql: string; params: unknown[] }[],
  mockData: new Map<string, unknown[]>(),

  query(sql: string, params: unknown[], _dbId: string) {
    this.queries.push({ sql, params })
    // Return mock data based on table name
    const tableMatch = sql.match(/FROM\s+"?(\w+)"?/i)
    const tableName = tableMatch?.[1] ?? ''
    return {
      rows: this.mockData.get(tableName) ?? [],
    }
  },

  exec(sql: string, params: unknown[], _dbId: string) {
    this.execCalls.push({ sql, params })
    return Promise.resolve()
  },

  reset() {
    this.queries = []
    this.execCalls = []
    this.mockData.clear()
  },
}

// Import types that should be exported
interface EntityBase {
  id: string
}

interface FindOptions {
  where?: Record<string, unknown>
  order?: Record<string, 'ASC' | 'DESC'>
  take?: number
}

// Mock the SQLit store class functionality for testing
class TestSQLitStore {
  private client = mockSqlitClient
  private databaseId: string
  private entities: Map<string, EntityBase[]> = new Map()

  constructor(databaseId: string) {
    this.databaseId = databaseId
  }

  async save<E extends EntityBase>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const tableName = this.getTableName(e)
      if (!this.entities.has(tableName)) {
        this.entities.set(tableName, [])
      }
      this.entities.get(tableName)?.push(e)
    }
  }

  async insert<E extends EntityBase>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async upsert<E extends EntityBase>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async remove<E extends EntityBase>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const tableName = this.getTableName(e)
      await this.client.exec(
        `DELETE FROM "${tableName}" WHERE id = ?`,
        [e.id],
        this.databaseId,
      )
    }
  }

  async find<E extends EntityBase>(
    tableName: string,
    options?: FindOptions,
  ): Promise<E[]> {
    let sql = `SELECT * FROM "${tableName}"`
    const params: unknown[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    if (options?.order) {
      const orderClauses: string[] = []
      for (const [key, direction] of Object.entries(options.order)) {
        orderClauses.push(`"${key}" ${direction}`)
      }
      if (orderClauses.length > 0) {
        sql += ` ORDER BY ${orderClauses.join(', ')}`
      }
    }

    if (options?.take) {
      sql += ` LIMIT ${options.take}`
    }

    const result = this.client.query(sql, params, this.databaseId)
    return result.rows as E[]
  }

  async get<E extends EntityBase>(
    tableName: string,
    id: string,
  ): Promise<E | undefined> {
    const result = this.client.query(
      `SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`,
      [id],
      this.databaseId,
    )
    return result.rows[0] as E | undefined
  }

  async count(tableName: string, options?: FindOptions): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM "${tableName}"`
    const params: unknown[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    const result = this.client.query(sql, params, this.databaseId)
    const countRow = result.rows[0] as { count: number } | undefined
    return Number(countRow?.count ?? 0)
  }

  async flush(): Promise<void> {
    for (const [tableName, entities] of this.entities.entries()) {
      if (entities.length === 0) continue
      await this.batchUpsert(tableName, entities)
    }
    this.entities.clear()
  }

  private async batchUpsert(
    tableName: string,
    entities: EntityBase[],
  ): Promise<void> {
    if (entities.length === 0) return

    const firstEntity = entities[0] as Record<string, unknown>
    const columns = Object.keys(firstEntity).filter((k) => k !== 'constructor')

    const quotedColumns = columns.map((c) => `"${c}"`)
    const placeholders = columns.map(() => '?').join(', ')
    const values: unknown[] = []
    const valuesClauses: string[] = []

    for (const entity of entities) {
      const entityRecord = entity as Record<string, unknown>
      valuesClauses.push(`(${placeholders})`)
      for (const col of columns) {
        const value = entityRecord[col]
        if (value === null || value === undefined) {
          values.push(null)
        } else if (value instanceof Date) {
          values.push(value.toISOString())
        } else if (typeof value === 'bigint') {
          values.push(value.toString())
        } else if (typeof value === 'object') {
          values.push(JSON.stringify(value))
        } else {
          values.push(value)
        }
      }
    }

    const updateCols = columns.filter((c) => c !== 'id')
    const updateSet = updateCols
      .map((c) => `"${c}" = excluded."${c}"`)
      .join(', ')

    const sql = `
      INSERT INTO "${tableName}" (${quotedColumns.join(', ')})
      VALUES ${valuesClauses.join(', ')}
      ON CONFLICT (id) DO UPDATE SET ${updateSet}
    `.trim()

    await this.client.exec(sql, values, this.databaseId)
  }

  private getTableName(entity: EntityBase): string {
    const name = entity.constructor.name || 'unknown'
    return name
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase()
  }

  getPendingEntities(): Map<string, EntityBase[]> {
    return this.entities
  }
}

// Test entity classes
class TestEntity implements EntityBase {
  constructor(
    public id: string,
    public name: string,
    public value: number,
  ) {}
}

class AnotherEntity implements EntityBase {
  constructor(
    public id: string,
    public data: Record<string, unknown>,
  ) {}
}

describe('SQLit Store', () => {
  let store: TestSQLitStore

  beforeEach(() => {
    mockSqlitClient.reset()
    store = new TestSQLitStore('test-db')
  })

  describe('save', () => {
    test('saves a single entity', async () => {
      const entity = new TestEntity('1', 'Test', 100)
      await store.save(entity)

      const pending = store.getPendingEntities()
      expect(pending.has('test_entity')).toBe(true)
      expect(pending.get('test_entity')?.length).toBe(1)
    })

    test('saves multiple entities', async () => {
      const entities = [
        new TestEntity('1', 'Test 1', 100),
        new TestEntity('2', 'Test 2', 200),
      ]
      await store.save(entities)

      const pending = store.getPendingEntities()
      expect(pending.get('test_entity')?.length).toBe(2)
    })

    test('handles empty array', async () => {
      await store.save([])
      const pending = store.getPendingEntities()
      expect(pending.size).toBe(0)
    })

    test('groups entities by type', async () => {
      const testEntity = new TestEntity('1', 'Test', 100)
      const anotherEntity = new AnotherEntity('2', { key: 'value' })

      await store.save(testEntity)
      await store.save(anotherEntity)

      const pending = store.getPendingEntities()
      expect(pending.has('test_entity')).toBe(true)
      expect(pending.has('another_entity')).toBe(true)
    })
  })

  describe('insert', () => {
    test('delegates to save', async () => {
      const entity = new TestEntity('1', 'Test', 100)
      await store.insert(entity)

      const pending = store.getPendingEntities()
      expect(pending.has('test_entity')).toBe(true)
    })
  })

  describe('upsert', () => {
    test('delegates to save', async () => {
      const entity = new TestEntity('1', 'Test', 100)
      await store.upsert(entity)

      const pending = store.getPendingEntities()
      expect(pending.has('test_entity')).toBe(true)
    })
  })

  describe('remove', () => {
    test('executes DELETE statement', async () => {
      const entity = new TestEntity('1', 'Test', 100)
      await store.remove(entity)

      expect(mockSqlitClient.execCalls.length).toBe(1)
      expect(mockSqlitClient.execCalls[0].sql).toContain('DELETE FROM')
      expect(mockSqlitClient.execCalls[0].params).toContain('1')
    })

    test('removes multiple entities', async () => {
      const entities = [
        new TestEntity('1', 'Test 1', 100),
        new TestEntity('2', 'Test 2', 200),
      ]
      await store.remove(entities)

      expect(mockSqlitClient.execCalls.length).toBe(2)
    })

    test('handles empty array', async () => {
      await store.remove([])
      expect(mockSqlitClient.execCalls.length).toBe(0)
    })
  })

  describe('find', () => {
    test('executes SELECT statement', async () => {
      await store.find('test_entity')

      expect(mockSqlitClient.queries.length).toBe(1)
      expect(mockSqlitClient.queries[0].sql).toContain(
        'SELECT * FROM "test_entity"',
      )
    })

    test('applies where clause', async () => {
      await store.find('test_entity', {
        where: { name: 'Test', value: 100 },
      })

      const query = mockSqlitClient.queries[0]
      expect(query.sql).toContain('WHERE')
      expect(query.sql).toContain('"name" = ?')
      expect(query.sql).toContain('"value" = ?')
      expect(query.params).toContain('Test')
      expect(query.params).toContain(100)
    })

    test('applies order clause', async () => {
      await store.find('test_entity', {
        order: { name: 'ASC', value: 'DESC' },
      })

      const query = mockSqlitClient.queries[0]
      expect(query.sql).toContain('ORDER BY')
      expect(query.sql).toContain('"name" ASC')
      expect(query.sql).toContain('"value" DESC')
    })

    test('applies take/limit', async () => {
      await store.find('test_entity', { take: 10 })

      const query = mockSqlitClient.queries[0]
      expect(query.sql).toContain('LIMIT 10')
    })

    test('returns mock data', async () => {
      mockSqlitClient.mockData.set('test_entity', [
        { id: '1', name: 'Test', value: 100 },
      ])

      const results = await store.find<TestEntity>('test_entity')
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('1')
    })
  })

  describe('get', () => {
    test('executes SELECT with id', async () => {
      await store.get('test_entity', '1')

      const query = mockSqlitClient.queries[0]
      expect(query.sql).toContain('WHERE id = ?')
      expect(query.sql).toContain('LIMIT 1')
      expect(query.params).toContain('1')
    })

    test('returns undefined for missing entity', async () => {
      const result = await store.get('test_entity', 'nonexistent')
      expect(result).toBeUndefined()
    })

    test('returns entity when found', async () => {
      mockSqlitClient.mockData.set('test_entity', [
        { id: '1', name: 'Test', value: 100 },
      ])

      const result = await store.get<TestEntity>('test_entity', '1')
      expect(result?.id).toBe('1')
    })
  })

  describe('count', () => {
    test('executes COUNT query', async () => {
      mockSqlitClient.mockData.set('test_entity', [{ count: 5 }])

      const count = await store.count('test_entity')

      expect(mockSqlitClient.queries[0].sql).toContain('COUNT(*)')
      expect(count).toBe(5)
    })

    test('applies where clause', async () => {
      mockSqlitClient.mockData.set('test_entity', [{ count: 3 }])

      await store.count('test_entity', {
        where: { name: 'Test' },
      })

      const query = mockSqlitClient.queries[0]
      expect(query.sql).toContain('WHERE')
      expect(query.params).toContain('Test')
    })

    test('returns 0 for empty result', async () => {
      const count = await store.count('test_entity')
      expect(count).toBe(0)
    })
  })

  describe('flush', () => {
    test('executes batch upsert for all pending entities', async () => {
      await store.save(new TestEntity('1', 'Test 1', 100))
      await store.save(new TestEntity('2', 'Test 2', 200))
      await store.flush()

      expect(mockSqlitClient.execCalls.length).toBe(1)
      const exec = mockSqlitClient.execCalls[0]
      expect(exec.sql).toContain('INSERT INTO')
      expect(exec.sql).toContain('ON CONFLICT (id) DO UPDATE')
    })

    test('clears pending entities after flush', async () => {
      await store.save(new TestEntity('1', 'Test', 100))
      await store.flush()

      const pending = store.getPendingEntities()
      expect(pending.size).toBe(0)
    })

    test('handles Date values', async () => {
      const entity = {
        id: '1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        constructor: { name: 'DateEntity' },
      } as EntityBase

      await store.save(entity)
      await store.flush()

      const exec = mockSqlitClient.execCalls[0]
      expect(
        exec.params.some((p) => typeof p === 'string' && p.includes('2024')),
      ).toBe(true)
    })

    test('handles bigint values', async () => {
      const entity = {
        id: '1',
        amount: BigInt('1000000000000000000'),
        constructor: { name: 'BigIntEntity' },
      } as EntityBase

      await store.save(entity)
      await store.flush()

      const exec = mockSqlitClient.execCalls[0]
      expect(exec.params.some((p) => p === '1000000000000000000')).toBe(true)
    })

    test('handles object values as JSON', async () => {
      const entity = new AnotherEntity('1', { key: 'value', nested: { a: 1 } })

      await store.save(entity)
      await store.flush()

      const exec = mockSqlitClient.execCalls[0]
      expect(
        exec.params.some((p) => typeof p === 'string' && p.includes('"key"')),
      ).toBe(true)
    })

    test('handles null values', async () => {
      const entity = {
        id: '1',
        optionalField: null,
        constructor: { name: 'NullEntity' },
      } as EntityBase

      await store.save(entity)
      await store.flush()

      const exec = mockSqlitClient.execCalls[0]
      expect(exec.params.includes(null)).toBe(true)
    })
  })

  describe('table name conversion', () => {
    test('converts PascalCase to snake_case', async () => {
      class MyTestEntity implements EntityBase {
        constructor(public id: string) {}
      }

      const entity = new MyTestEntity('1')
      await store.save(entity)

      const pending = store.getPendingEntities()
      expect(pending.has('my_test_entity')).toBe(true)
    })

    test('handles acronyms', async () => {
      class HTTPResponse implements EntityBase {
        constructor(public id: string) {}
      }

      const entity = new HTTPResponse('1')
      await store.save(entity)

      const pending = store.getPendingEntities()
      expect(pending.has('http_response')).toBe(true)
    })
  })
})
