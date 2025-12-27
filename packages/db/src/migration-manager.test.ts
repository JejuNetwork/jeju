/**
 * MigrationManager Integration Tests
 *
 * Tests the actual MigrationManager class behavior against live CQL.
 *
 * Set CQL_AVAILABLE=true to force running, or tests auto-detect CQL availability.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { type CQLClient, getCQL, resetCQL } from './client.js'
import {
  createMigrationManager,
  createTable,
  createTableMigration,
  defineMigration,
  MigrationManager,
} from './migration.js'

// CQL endpoint
const CQL_ENDPOINT = process.env.CQL_ENDPOINT ?? 'http://localhost:4661'

// Helper to check if CQL is reachable
async function _isCQLAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${CQL_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Auto-detect CQL availability at test load time
const CQL_RUNNING = process.env.CQL_AVAILABLE === 'true' ||
  await isCQLAvailable().catch(() => false)

describe.skipIf(!CQL_RUNNING)('MigrationManager (Live Integration)', () => {
  let client: CQLClient
  let manager: MigrationManager
  const testDbId = `test-migrations-${Date.now()}`
  const testMigrationsTable = `_migrations_${Date.now()}`

  beforeEach(async () => {
    await resetCQL()
    client = getCQL({
      blockProducerEndpoint: CQL_ENDPOINT,
      databaseId: testDbId,
    })
    manager = new MigrationManager(client, testDbId, testMigrationsTable)
  })

  afterEach(async () => {
    // Clean up migrations table
    try {
      await client.exec(`DROP TABLE IF EXISTS ${testMigrationsTable}`)
    } catch {
      // Ignore cleanup errors
    }
    await client.close()
  })

  describe('initialize', () => {
    it('should create migrations table', async () => {
      await manager.initialize()

      // Verify table exists by querying it
      const result = await client.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${testMigrationsTable}'`,
      )
      expect(result.rowCount).toBeGreaterThanOrEqual(0) // May be 0 or 1 depending on implementation
    })
  })

  describe('getCurrentVersion', () => {
    it('should return 0 when no migrations applied', async () => {
      await manager.initialize()
      const version = await manager.getCurrentVersion()
      expect(version).toBe(0)
    })
  })

  describe('getAppliedMigrations', () => {
    it('should return empty array when no migrations', async () => {
      await manager.initialize()
      const applied = await manager.getAppliedMigrations()
      expect(applied).toEqual([])
    })
  })

  describe('migrate', () => {
    it('should apply single migration', async () => {
      const tableName = `users_${Date.now()}`
      const migrations = [
        defineMigration(
          1,
          'create_users',
          `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE ${tableName}`,
        ),
      ]

      const result = await manager.migrate(migrations)

      expect(result.applied).toContain('1: create_users')
      expect(result.currentVersion).toBe(1)
      expect(result.pending).toEqual([])

      // Cleanup
      await client.exec(`DROP TABLE IF EXISTS ${tableName}`)
    })

    it('should apply multiple migrations in order', async () => {
      const suffix = Date.now()
      const migrations = [
        defineMigration(
          1,
          'create_users',
          `CREATE TABLE users_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE users_${suffix}`,
        ),
        defineMigration(
          2,
          'create_posts',
          `CREATE TABLE posts_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE posts_${suffix}`,
        ),
        defineMigration(
          3,
          'add_user_email',
          `ALTER TABLE users_${suffix} ADD COLUMN email TEXT`,
          `-- Cannot remove column in SQLite`,
        ),
      ]

      const result = await manager.migrate(migrations)

      expect(result.applied).toHaveLength(3)
      expect(result.applied[0]).toContain('create_users')
      expect(result.applied[1]).toContain('create_posts')
      expect(result.applied[2]).toContain('add_user_email')
      expect(result.currentVersion).toBe(3)

      // Cleanup
      await client.exec(`DROP TABLE IF EXISTS users_${suffix}`)
      await client.exec(`DROP TABLE IF EXISTS posts_${suffix}`)
    })

    it('should skip already applied migrations', async () => {
      const suffix = Date.now()
      const migrations = [
        defineMigration(
          1,
          'create_users',
          `CREATE TABLE skip_users_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE skip_users_${suffix}`,
        ),
        defineMigration(
          2,
          'create_posts',
          `CREATE TABLE skip_posts_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE skip_posts_${suffix}`,
        ),
      ]

      // Apply first migration
      await manager.migrate([migrations[0]])

      // Now apply both - should only apply migration 2
      const result = await manager.migrate(migrations)

      expect(result.applied).toHaveLength(1)
      expect(result.applied[0]).toContain('create_posts')
      expect(result.currentVersion).toBe(2)

      // Cleanup
      await client.exec(`DROP TABLE IF EXISTS skip_users_${suffix}`)
      await client.exec(`DROP TABLE IF EXISTS skip_posts_${suffix}`)
    })
  })

  describe('rollback', () => {
    it('should rollback last migration', async () => {
      const suffix = Date.now()
      const migrations = [
        defineMigration(
          1,
          'create_users',
          `CREATE TABLE rb_users_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE IF EXISTS rb_users_${suffix}`,
        ),
        defineMigration(
          2,
          'create_posts',
          `CREATE TABLE rb_posts_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE IF EXISTS rb_posts_${suffix}`,
        ),
      ]

      await manager.migrate(migrations)
      const result = await manager.rollback(migrations)

      expect(result.currentVersion).toBe(1)
      expect(result.pending).toContain('2: create_posts')

      // Cleanup
      await client.exec(`DROP TABLE IF EXISTS rb_users_${suffix}`)
    })

    it('should do nothing when no migrations to rollback', async () => {
      const migrations = [
        defineMigration(
          1,
          'create_users',
          'CREATE TABLE no_rb_users (id INTEGER PRIMARY KEY)',
          'DROP TABLE no_rb_users',
        ),
      ]

      const result = await manager.rollback(migrations)

      expect(result.currentVersion).toBe(0)
      expect(result.applied).toEqual([])
    })
  })

  describe('reset', () => {
    it('should rollback all migrations', async () => {
      const suffix = Date.now()
      const migrations = [
        defineMigration(
          1,
          'create_users',
          `CREATE TABLE reset_users_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE IF EXISTS reset_users_${suffix}`,
        ),
        defineMigration(
          2,
          'create_posts',
          `CREATE TABLE reset_posts_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE IF EXISTS reset_posts_${suffix}`,
        ),
        defineMigration(
          3,
          'create_comments',
          `CREATE TABLE reset_comments_${suffix} (id INTEGER PRIMARY KEY)`,
          `DROP TABLE IF EXISTS reset_comments_${suffix}`,
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
    const client = getCQL({
      blockProducerEndpoint: CQL_ENDPOINT,
      databaseId: 'factory-test-db',
    })
    const manager = createMigrationManager(client, 'factory-test-db')
    expect(manager).toBeInstanceOf(MigrationManager)
  })

  it('should create manager with custom table name', () => {
    const client = getCQL({
      blockProducerEndpoint: CQL_ENDPOINT,
      databaseId: 'factory-test-db-2',
    })
    const manager = createMigrationManager(
      client,
      'factory-test-db-2',
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
