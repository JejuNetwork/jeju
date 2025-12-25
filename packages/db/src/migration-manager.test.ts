/**
 * MigrationManager Integration Tests
 *
 * Tests the actual MigrationManager class behavior, not just helper functions.
 * Uses mocks to simulate CQL client behavior.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { CQLClient } from './client.js'
import {
  createMigrationManager,
  createTable,
  createTableMigration,
  defineMigration,
  MigrationManager,
} from './migration.js'
import type { ExecResult, QueryResult } from './types.js'

// Mock CQL client
function createMockClient() {
  const executedQueries: { sql: string; params: unknown[] }[] = []
  const migrationsTable: Array<{
    version: number
    name: string
    applied_at: string
  }> = []
  let currentVersion = 0

  const mockExec = mock(
    (
      sql: string,
      params: unknown[] = [],
      _dbId?: string,
    ): Promise<ExecResult> => {
      executedQueries.push({ sql, params })

      // Handle migration table creation
      if (sql.includes('CREATE TABLE IF NOT EXISTS _migrations')) {
        return Promise.resolve({
          rowsAffected: 0,
          txHash: '0x123' as `0x${string}`,
          blockHeight: 1,
          gasUsed: 0n,
        })
      }

      // Handle migration insert
      if (sql.includes('INSERT INTO _migrations')) {
        const version = params[0] as number
        const name = params[1] as string
        migrationsTable.push({
          version,
          name,
          applied_at: new Date().toISOString(),
        })
        currentVersion = Math.max(currentVersion, version)
        return Promise.resolve({
          rowsAffected: 1,
          txHash: '0x123' as `0x${string}`,
          blockHeight: 1,
          gasUsed: 0n,
        })
      }

      // Handle migration delete
      if (sql.includes('DELETE FROM _migrations')) {
        const version = params[0] as number
        const idx = migrationsTable.findIndex((m) => m.version === version)
        if (idx >= 0) {
          migrationsTable.splice(idx, 1)
          currentVersion = migrationsTable.reduce(
            (max, m) => Math.max(max, m.version),
            0,
          )
        }
        return Promise.resolve({
          rowsAffected: 1,
          txHash: '0x123' as `0x${string}`,
          blockHeight: 1,
          gasUsed: 0n,
        })
      }

      return Promise.resolve({
        rowsAffected: 0,
        txHash: '0x123' as `0x${string}`,
        blockHeight: 1,
        gasUsed: 0n,
      })
    },
  )

  const mockQuery = mock(
    <T>(
      sql: string,
      _params: unknown[] = [],
      _dbId?: string,
    ): Promise<QueryResult<T>> => {
      // Handle MAX(version) query
      if (sql.includes('MAX(version)')) {
        return Promise.resolve({
          rows: [{ version: currentVersion }] as T[],
          rowCount: 1,
          columns: [
            {
              name: 'version',
              type: 'INTEGER' as const,
              nullable: true,
              primaryKey: false,
              autoIncrement: false,
            },
          ],
          executionTime: 1,
          blockHeight: 1,
        })
      }

      // Handle SELECT from migrations
      if (sql.includes('FROM _migrations')) {
        return Promise.resolve({
          rows: migrationsTable as T[],
          rowCount: migrationsTable.length,
          columns: [],
          executionTime: 1,
          blockHeight: 1,
        })
      }

      return Promise.resolve({
        rows: [] as T[],
        rowCount: 0,
        columns: [],
        executionTime: 1,
        blockHeight: 1,
      })
    },
  )

  // Mock transaction
  const mockTx = {
    query: mockQuery,
    exec: mockExec,
    commit: mock(() => Promise.resolve()),
    rollback: mock(() => Promise.resolve()),
    id: 'tx-1',
  }

  const mockConn = {
    id: 'conn-1',
    databaseId: 'test-db',
    active: true,
    query: mockQuery,
    exec: mockExec,
    beginTransaction: mock(() => Promise.resolve(mockTx)),
    close: mock(() => Promise.resolve()),
  }

  const mockPool = {
    acquire: mock(() => Promise.resolve(mockConn)),
    release: mock(() => {}),
    close: mock(() => Promise.resolve()),
    stats: () => ({ active: 0, idle: 1, total: 1 }),
  }

  const client = {
    query: mockQuery,
    exec: mockExec,
    connect: mock(() => Promise.resolve(mockConn)),
    getPool: mock(() => mockPool),
    close: mock(() => Promise.resolve()),
  } as unknown as CQLClient

  return {
    client,
    executedQueries,
    migrationsTable,
    mockExec,
    mockQuery,
    mockTx,
    mockConn,
    reset: () => {
      executedQueries.length = 0
      migrationsTable.length = 0
      currentVersion = 0
      mockExec.mockClear()
      mockQuery.mockClear()
    },
  }
}

describe('MigrationManager', () => {
  let mockClient: ReturnType<typeof createMockClient>
  let manager: MigrationManager

  beforeEach(() => {
    mockClient = createMockClient()
    manager = new MigrationManager(mockClient.client, 'test-db')
  })

  afterEach(() => {
    mockClient.reset()
  })

  describe('initialize', () => {
    it('should create migrations table', async () => {
      await manager.initialize()

      expect(mockClient.mockExec).toHaveBeenCalled()
      const createTableCall = mockClient.executedQueries.find((q) =>
        q.sql.includes('CREATE TABLE IF NOT EXISTS _migrations'),
      )
      expect(createTableCall).toBeDefined()
    })
  })

  describe('getCurrentVersion', () => {
    it('should return 0 when no migrations applied', async () => {
      const version = await manager.getCurrentVersion()
      expect(version).toBe(0)
    })
  })

  describe('getAppliedMigrations', () => {
    it('should return empty array when no migrations', async () => {
      const applied = await manager.getAppliedMigrations()
      expect(applied).toEqual([])
    })
  })

  describe('migrate', () => {
    it('should apply single migration', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE users (id INTEGER PRIMARY KEY)',
          'DROP TABLE users',
        ),
      ]

      const result = await manager.migrate(migrations)

      expect(result.applied).toContain('1: create_users')
      expect(result.currentVersion).toBe(1)
      expect(result.pending).toEqual([])
    })

    it('should apply multiple migrations in order', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE users (id INTEGER PRIMARY KEY)',
          'DROP TABLE users',
        ),
        defineMigration(
          2,
          'create_posts',
          'CREATE TABLE posts (id INTEGER PRIMARY KEY)',
          'DROP TABLE posts',
        ),
        defineMigration(
          3,
          'add_user_email',
          'ALTER TABLE users ADD COLUMN email TEXT',
          'ALTER TABLE users DROP COLUMN email',
        ),
      ]

      const result = await manager.migrate(migrations)

      expect(result.applied).toHaveLength(3)
      expect(result.applied[0]).toContain('create_users')
      expect(result.applied[1]).toContain('create_posts')
      expect(result.applied[2]).toContain('add_user_email')
      expect(result.currentVersion).toBe(3)
    })

    it('should skip already applied migrations', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE users',
          'DROP TABLE users',
        ),
        defineMigration(
          2,
          'create_posts',
          'CREATE TABLE posts',
          'DROP TABLE posts',
        ),
      ]

      // Apply first migration
      await manager.migrate([migrations[0]])

      // Now apply both - should only apply migration 2
      const result = await manager.migrate(migrations)

      expect(result.applied).toHaveLength(1)
      expect(result.applied[0]).toContain('create_posts')
      expect(result.currentVersion).toBe(2)
    })

    it('should handle out-of-order migration definitions', async () => {
      const migrations = [
        defineMigration(3, 'third', 'CREATE TABLE third', 'DROP TABLE third'),
        defineMigration(1, 'first', 'CREATE TABLE first', 'DROP TABLE first'),
        defineMigration(
          2,
          'second',
          'CREATE TABLE second',
          'DROP TABLE second',
        ),
      ]

      const result = await manager.migrate(migrations)

      // Should apply in version order
      expect(result.currentVersion).toBe(3)
      expect(result.applied[0]).toContain('first')
      expect(result.applied[1]).toContain('second')
      expect(result.applied[2]).toContain('third')
    })
  })

  describe('rollback', () => {
    it('should rollback last migration', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE users',
          'DROP TABLE users',
        ),
        defineMigration(
          2,
          'create_posts',
          'CREATE TABLE posts',
          'DROP TABLE posts',
        ),
      ]

      await manager.migrate(migrations)
      const result = await manager.rollback(migrations)

      expect(result.currentVersion).toBe(1)
      expect(result.pending).toContain('2: create_posts')
    })

    it('should do nothing when no migrations to rollback', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE users',
          'DROP TABLE users',
        ),
      ]

      const result = await manager.rollback(migrations)

      expect(result.currentVersion).toBe(0)
      expect(result.applied).toEqual([])
    })
  })

  describe('reset', () => {
    it('should rollback all migrations', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE users',
          'DROP TABLE users',
        ),
        defineMigration(
          2,
          'create_posts',
          'CREATE TABLE posts',
          'DROP TABLE posts',
        ),
        defineMigration(
          3,
          'create_comments',
          'CREATE TABLE comments',
          'DROP TABLE comments',
        ),
      ]

      await manager.migrate(migrations)
      const result = await manager.reset(migrations)

      expect(result.currentVersion).toBe(0)
    })
  })
})

describe('createMigrationManager factory', () => {
  it('should create manager with default table name', () => {
    const mockClient = createMockClient()
    const manager = createMigrationManager(mockClient.client, 'test-db')
    expect(manager).toBeInstanceOf(MigrationManager)
  })

  it('should create manager with custom table name', () => {
    const mockClient = createMockClient()
    const manager = createMigrationManager(
      mockClient.client,
      'test-db',
      'custom_migrations',
    )
    expect(manager).toBeInstanceOf(MigrationManager)
  })
})

describe('createTableMigration', () => {
  it('should create migration with schema', () => {
    const migration = createTableMigration(1, 'create_users', {
      name: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'email', type: 'TEXT', nullable: false, unique: true },
        { name: 'name', type: 'TEXT' },
        { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      ],
      primaryKey: ['id'],
    })

    expect(migration.version).toBe(1)
    expect(migration.name).toBe('create_users')
    expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS users')
    expect(migration.up).toContain('id INTEGER NOT NULL')
    expect(migration.up).toContain('email TEXT NOT NULL UNIQUE')
    expect(migration.up).toContain('PRIMARY KEY (id)')
    expect(migration.down).toBe('DROP TABLE IF EXISTS users')
  })

  it('should handle foreign key references', () => {
    const migration = createTableMigration(2, 'create_posts', {
      name: 'posts',
      columns: [
        { name: 'id', type: 'INTEGER' },
        {
          name: 'user_id',
          type: 'INTEGER',
          references: { table: 'users', column: 'id' },
        },
        { name: 'title', type: 'TEXT', nullable: false },
      ],
      primaryKey: ['id'],
    })

    expect(migration.up).toContain('REFERENCES users(id)')
  })

  it('should handle composite primary keys', () => {
    const migration = createTableMigration(3, 'create_user_roles', {
      name: 'user_roles',
      columns: [
        { name: 'user_id', type: 'INTEGER' },
        { name: 'role_id', type: 'INTEGER' },
        { name: 'granted_at', type: 'TIMESTAMP' },
      ],
      primaryKey: ['user_id', 'role_id'],
    })

    expect(migration.up).toContain('PRIMARY KEY (user_id, role_id)')
  })

  it('should handle indexes', () => {
    const migration = createTableMigration(4, 'create_indexed_table', {
      name: 'indexed',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'searchable', type: 'TEXT' },
      ],
      primaryKey: ['id'],
      indexes: [
        { name: 'idx_searchable', columns: ['searchable'] },
        { name: 'idx_unique', columns: ['id', 'searchable'], unique: true },
      ],
    })

    // Indexes are not in the CREATE TABLE statement for this helper
    // They would need separate migrations
    expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS indexed')
  })
})

describe('createTable helper', () => {
  it('should create basic table', () => {
    const { up, down } = createTable('simple', [
      { name: 'id', type: 'INTEGER', primaryKey: true },
    ])

    expect(up).toBe('CREATE TABLE simple (\n  id INTEGER PRIMARY KEY\n)')
    expect(down).toBe('DROP TABLE IF EXISTS simple')
  })

  it('should handle all column options', () => {
    const { up } = createTable('full', [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'email', type: 'TEXT', notNull: true, unique: true },
      { name: 'status', type: 'TEXT', default: "'active'" },
      { name: 'created', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      {
        name: 'org_id',
        type: 'INTEGER',
        references: { table: 'orgs', column: 'id' },
      },
    ])

    expect(up).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(up).toContain('email TEXT NOT NULL UNIQUE')
    expect(up).toContain("status TEXT DEFAULT 'active'")
    expect(up).toContain('created TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
    expect(up).toContain('org_id INTEGER REFERENCES orgs(id)')
  })
})
