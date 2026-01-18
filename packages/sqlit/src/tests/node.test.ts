/**
 * SQLit v2 Node Tests
 *
 * Comprehensive tests covering:
 * - Node lifecycle
 * - Database operations (CRUD)
 * - WAL replication
 * - Event handling
 * - Error handling
 * - TEE capabilities
 * - Strong consistency
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SQLitNode } from '../node'
import type { SQLitNodeConfig } from '../types'
import { DatabaseNodeRole, DatabaseNodeStatus } from '../types'

const TEST_DATA_DIR = join(import.meta.dir, '.test-data')
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

function createTestConfig(
  overrides: Partial<SQLitNodeConfig> = {},
): SQLitNodeConfig {
  return {
    operatorPrivateKey: TEST_PRIVATE_KEY,
    endpoint: 'http://localhost:18546',
    wsEndpoint: 'ws://localhost:18546/ws',
    dataDir: TEST_DATA_DIR,
    region: 'global',
    teeEnabled: false,
    l2RpcUrl: 'http://localhost:6546',
    registryAddress: '0x0000000000000000000000000000000000000000',
    version: '2.0.0-test',
    ...overrides,
  }
}

describe('SQLitNode', () => {
  let node: SQLitNode

  beforeAll(() => {
    // Skip on-chain registration for unit tests
    process.env.SKIP_CHAIN_REGISTRATION = 'true'
  })

  beforeEach(() => {
    // Clean up test data directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  afterAll(() => {
    // Clean up
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  describe('Node Lifecycle', () => {
    it('should create a node with correct initial state', () => {
      node = new SQLitNode(createTestConfig())
      const info = node.getNodeInfo()

      expect(info.nodeId).toBeDefined()
      expect(info.operator).toBeDefined()
      expect(info.role).toBe(DatabaseNodeRole.PRIMARY)
      expect(info.status).toBe(DatabaseNodeStatus.PENDING)
      expect(info.endpoint).toBe('http://localhost:18546')
      expect(info.databaseCount).toBe(0)
    })

    it('should start and stop correctly', async () => {
      node = new SQLitNode(createTestConfig())

      await node.start()
      expect(node.getNodeInfo().status).toBe(DatabaseNodeStatus.ACTIVE)

      await node.stop()
      expect(node.getNodeInfo().status).toBe(DatabaseNodeStatus.EXITING)
    })
  })

  describe('Database Operations', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should create a database', async () => {
      const result = await node.createDatabase({
        name: 'test-db',
        encryptionMode: 'none',
        replication: { replicaCount: 0 },
      })

      expect(result.databaseId).toBeDefined()
      expect(result.connectionString).toContain(result.databaseId)
      expect(result.primaryNodeId).toBe(node.getNodeInfo().nodeId)

      // Verify database exists
      const db = node.getDatabase(result.databaseId)
      expect(db).toBeDefined()
      expect(db?.name).toBe('test-db')
    })

    it('should execute queries on created database', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'query-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
      })

      // Insert data
      const insertResult = await node.execute({
        databaseId,
        sql: 'INSERT INTO users (name) VALUES (?)',
        params: ['Alice'],
      })

      expect(insertResult.rowsAffected).toBe(1)
      expect(insertResult.lastInsertId).toBe(BigInt(1))

      // Query data
      const queryResult = await node.execute({
        databaseId,
        sql: 'SELECT * FROM users WHERE name = ?',
        params: ['Alice'],
      })

      expect(queryResult.rows.length).toBe(1)
      expect(queryResult.rows[0]).toMatchObject({ id: 1, name: 'Alice' })
      expect(queryResult.readOnly).toBe(true)
    })

    it('should execute batch queries', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'batch-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
      })

      const result = await node.batchExecute({
        databaseId,
        queries: [
          { sql: 'INSERT INTO items (value) VALUES (?)', params: ['a'] },
          { sql: 'INSERT INTO items (value) VALUES (?)', params: ['b'] },
          { sql: 'INSERT INTO items (value) VALUES (?)', params: ['c'] },
        ],
        transactional: true,
      })

      expect(result.results.length).toBe(3)
      expect(result.results.every((r) => r.rowsAffected === 1)).toBe(true)

      // Verify all items were inserted
      const queryResult = await node.execute({
        databaseId,
        sql: 'SELECT COUNT(*) as count FROM items',
      })
      expect(queryResult.rows[0]).toMatchObject({ count: 3 })
    })

    it('should delete a database', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'delete-test',
        encryptionMode: 'none',
        replication: {},
      })

      expect(node.getDatabase(databaseId)).toBeDefined()

      await node.deleteDatabase(databaseId)

      expect(node.getDatabase(databaseId)).toBeNull()
    })

    it('should list databases', async () => {
      await node.createDatabase({
        name: 'list-test-1',
        encryptionMode: 'none',
        replication: {},
      })

      await node.createDatabase({
        name: 'list-test-2',
        encryptionMode: 'none',
        replication: {},
      })

      const databases = node.listDatabases()
      expect(databases.length).toBe(2)
      expect(databases.some((d) => d.name === 'list-test-1')).toBe(true)
      expect(databases.some((d) => d.name === 'list-test-2')).toBe(true)
    })
  })

  describe('WAL Replication', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should record WAL entries for write queries', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'wal-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE data (id INTEGER PRIMARY KEY, value TEXT)',
      })

      // Execute multiple writes
      for (let i = 0; i < 5; i++) {
        await node.execute({
          databaseId,
          sql: 'INSERT INTO data (value) VALUES (?)',
          params: [`value-${i}`],
        })
      }

      // Get WAL entries
      const walResponse = node.getWALEntries({
        databaseId,
        fromPosition: BigInt(0),
        limit: 100,
      })

      expect(walResponse.entries.length).toBe(5)
      expect(walResponse.currentPosition).toBe(BigInt(5))

      // Verify hash chain integrity
      for (let i = 1; i < walResponse.entries.length; i++) {
        expect(walResponse.entries[i].prevHash).toBe(
          walResponse.entries[i - 1].hash,
        )
      }
    })

    it('should not record WAL entries for read queries', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'wal-read-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE data (id INTEGER PRIMARY KEY)',
      })

      // Execute read queries
      await node.execute({
        databaseId,
        sql: 'SELECT * FROM data',
      })

      await node.execute({
        databaseId,
        sql: 'SELECT COUNT(*) FROM data',
      })

      // Get WAL entries
      const walResponse = node.getWALEntries({
        databaseId,
        fromPosition: BigInt(0),
        limit: 100,
      })

      // Only the schema creation should be in WAL (if any), not the reads
      expect(
        walResponse.entries.every((e) => !e.sql.startsWith('SELECT')),
      ).toBe(true)
    })
  })

  describe('Event Handling', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should emit events for database operations', async () => {
      const events: Array<{ type: string; databaseId?: string }> = []

      node.onEvent((event) => {
        events.push({ type: event.type, databaseId: event.databaseId })
      })

      await node.start()

      const { databaseId } = await node.createDatabase({
        name: 'event-test',
        encryptionMode: 'none',
        replication: {},
      })

      await node.deleteDatabase(databaseId)
      await node.stop()

      expect(events.some((e) => e.type === 'node:registered')).toBe(true)
      expect(
        events.some(
          (e) => e.type === 'database:created' && e.databaseId === databaseId,
        ),
      ).toBe(true)
      expect(
        events.some(
          (e) => e.type === 'database:deleted' && e.databaseId === databaseId,
        ),
      ).toBe(true)
    })
  })

  describe('Error Handling', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should throw for non-existent database', async () => {
      // Set production mode to disable auto-provisioning
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        await expect(
          node.execute({
            databaseId: 'non-existent',
            sql: 'SELECT 1',
          }),
        ).rejects.toThrow('Database non-existent not found')
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('should throw for invalid SQL', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'error-test',
        encryptionMode: 'none',
        replication: {},
      })

      await expect(
        node.execute({
          databaseId,
          sql: 'INVALID SQL SYNTAX',
        }),
      ).rejects.toThrow()
    })
  })

  describe('Strong Consistency', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should track WAL position after writes', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'consistency-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
      })

      // Initial position
      const db1 = node.getDatabase(databaseId)
      expect(db1?.walPosition).toBe(BigInt(0))

      // After write
      await node.execute({
        databaseId,
        sql: 'INSERT INTO items (value) VALUES (?)',
        params: ['test'],
      })

      const db2 = node.getDatabase(databaseId)
      expect(db2?.walPosition).toBe(BigInt(1))
    })

    it('should return WAL position in query results', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'wal-position-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE data (id INTEGER PRIMARY KEY)',
      })

      const result1 = await node.execute({
        databaseId,
        sql: 'INSERT INTO data (id) VALUES (1)',
      })
      expect(result1.walPosition).toBe(BigInt(1))

      const result2 = await node.execute({
        databaseId,
        sql: 'INSERT INTO data (id) VALUES (2)',
      })
      expect(result2.walPosition).toBe(BigInt(2))
    })

    it('should reject queries requiring future WAL position', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'future-wal-test',
        encryptionMode: 'none',
        replication: {},
      })

      await expect(
        node.execute({
          databaseId,
          sql: 'SELECT 1',
          requiredWalPosition: BigInt(999),
        }),
      ).rejects.toThrow('Node is behind required WAL position')
    })
  })

  describe('TEE Capabilities', () => {
    it('should report TEE as disabled when not configured', async () => {
      node = new SQLitNode(createTestConfig({ teeEnabled: false }))
      expect(node.isTEEEnabled()).toBe(false)

      const caps = await node.getTEECapabilities()
      expect(caps).toBeNull()
    })

    it('should initialize TEE when enabled', async () => {
      // With simulated TEE
      process.env.SQLIT_TEE_PLATFORM = 'simulated'
      node = new SQLitNode(createTestConfig({ teeEnabled: true }))

      await node.start()
      expect(node.isTEEEnabled()).toBe(true)

      const caps = await node.getTEECapabilities()
      expect(caps).not.toBeNull()
      expect(caps?.platform).toBe('simulated')

      await node.stop()
      delete process.env.SQLIT_TEE_PLATFORM
    })
  })

  describe('Replication Status', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should return empty replication status for primary', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'repl-status-test',
        encryptionMode: 'none',
        replication: {},
      })

      const status = node.getReplicationStatus(databaseId)
      expect(status.size).toBe(0) // No replicas yet
    })

    it('should throw for replication status of non-existent database', () => {
      expect(() => node.getReplicationStatus('non-existent')).toThrow(
        'Database non-existent not found',
      )
    })
  })

  describe('Concurrent Operations', () => {
    beforeEach(async () => {
      node = new SQLitNode(createTestConfig())
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should handle concurrent reads', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'concurrent-read-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE data (id INTEGER PRIMARY KEY, value TEXT)',
      })

      // Insert some data
      await node.execute({
        databaseId,
        sql: "INSERT INTO data (value) VALUES ('test')",
      })

      // Concurrent reads
      const results = await Promise.all([
        node.execute({ databaseId, sql: 'SELECT * FROM data' }),
        node.execute({ databaseId, sql: 'SELECT * FROM data' }),
        node.execute({ databaseId, sql: 'SELECT * FROM data' }),
      ])

      expect(results.every((r) => r.rows.length === 1)).toBe(true)
    })

    it('should handle batch writes atomically', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'atomic-batch-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER)',
      })

      await node.execute({
        databaseId,
        sql: 'INSERT INTO counter (id, value) VALUES (1, 0)',
      })

      // Batch increment
      await node.batchExecute({
        databaseId,
        queries: [
          { sql: 'UPDATE counter SET value = value + 1 WHERE id = 1' },
          { sql: 'UPDATE counter SET value = value + 1 WHERE id = 1' },
          { sql: 'UPDATE counter SET value = value + 1 WHERE id = 1' },
        ],
        transactional: true,
      })

      const result = await node.execute({
        databaseId,
        sql: 'SELECT value FROM counter WHERE id = 1',
      })

      expect(result.rows[0]).toEqual({ value: 3 })
    })

    it('should rollback batch on error when transactional', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'rollback-test',
        encryptionMode: 'none',
        replication: {},
        schema:
          'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT UNIQUE)',
      })

      await node.execute({
        databaseId,
        sql: "INSERT INTO items (value) VALUES ('existing')",
      })

      // This batch should fail on duplicate and rollback
      await expect(
        node.batchExecute({
          databaseId,
          queries: [
            { sql: "INSERT INTO items (value) VALUES ('new1')" },
            { sql: "INSERT INTO items (value) VALUES ('existing')" }, // Duplicate - will fail
            { sql: "INSERT INTO items (value) VALUES ('new2')" },
          ],
          transactional: true,
        }),
      ).rejects.toThrow()

      // Verify rollback - only original item should exist
      const result = await node.execute({
        databaseId,
        sql: 'SELECT COUNT(*) as count FROM items',
      })
      expect(result.rows[0]).toEqual({ count: 1 })
    })
  })
})

// ============ Multi-Node Replication Tests ============

describe('Multi-Node Replication', () => {
  const PRIMARY_DATA_DIR = join(import.meta.dir, '.test-data-primary')
  const REPLICA_DATA_DIR = join(import.meta.dir, '.test-data-replica')
  const TEST_PRIVATE_KEY_2 =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const

  let primary: SQLitNode
  let replica: SQLitNode

  beforeAll(() => {
    process.env.SKIP_CHAIN_REGISTRATION = 'true'
  })

  beforeEach(() => {
    // Clean up test directories
    if (existsSync(PRIMARY_DATA_DIR)) {
      rmSync(PRIMARY_DATA_DIR, { recursive: true })
    }
    if (existsSync(REPLICA_DATA_DIR)) {
      rmSync(REPLICA_DATA_DIR, { recursive: true })
    }
  })

  afterAll(async () => {
    // Clean up
    if (primary) await primary.stop()
    if (replica) await replica.stop()
    if (existsSync(PRIMARY_DATA_DIR)) {
      rmSync(PRIMARY_DATA_DIR, { recursive: true })
    }
    if (existsSync(REPLICA_DATA_DIR)) {
      rmSync(REPLICA_DATA_DIR, { recursive: true })
    }
  })

  it('should create primary node with active status', async () => {
    primary = new SQLitNode({
      operatorPrivateKey: TEST_PRIVATE_KEY,
      endpoint: 'http://localhost:18546',
      wsEndpoint: 'ws://localhost:18546/ws',
      dataDir: PRIMARY_DATA_DIR,
      region: 'global',
      teeEnabled: false,
      l2RpcUrl: 'http://localhost:6546',
      registryAddress: '0x0000000000000000000000000000000000000000',
      version: '2.0.0-test',
    })

    await primary.start()
    const info = primary.getNodeInfo()

    expect(info.role).toBe(DatabaseNodeRole.PRIMARY)
    expect(info.status).toBe(DatabaseNodeStatus.ACTIVE)
    await primary.stop()
  })

  it('should generate WAL entries that can be synced to replica', async () => {
    primary = new SQLitNode({
      operatorPrivateKey: TEST_PRIVATE_KEY,
      endpoint: 'http://localhost:18546',
      wsEndpoint: 'ws://localhost:18546/ws',
      dataDir: PRIMARY_DATA_DIR,
      region: 'global',
      teeEnabled: false,
      l2RpcUrl: 'http://localhost:6546',
      registryAddress: '0x0000000000000000000000000000000000000000',
      version: '2.0.0-test',
    })

    await primary.start()

    // Create database and write data
    const { databaseId } = await primary.createDatabase({
      name: 'replication-test',
      encryptionMode: 'none',
      replication: { replicaCount: 1 },
      schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
    })

    // Write multiple entries
    for (let i = 1; i <= 10; i++) {
      await primary.execute({
        databaseId,
        sql: 'INSERT INTO users (name) VALUES (?)',
        params: [`User ${i}`],
      })
    }

    // Get WAL entries for sync
    const walEntries = primary.getWALEntries({
      databaseId,
      fromPosition: BigInt(0),
      limit: 100,
    })

    expect(walEntries.entries.length).toBe(10)
    expect(walEntries.currentPosition).toBe(BigInt(10))

    // Verify hash chain integrity
    let prevHash = `0x${'0'.repeat(64)}`
    for (const entry of walEntries.entries) {
      expect(entry.prevHash).toBe(prevHash)
      prevHash = entry.hash
    }

    await primary.stop()
  })

  it('should allow replica to apply WAL entries', async () => {
    primary = new SQLitNode({
      operatorPrivateKey: TEST_PRIVATE_KEY,
      endpoint: 'http://localhost:18546',
      wsEndpoint: 'ws://localhost:18546/ws',
      dataDir: PRIMARY_DATA_DIR,
      region: 'global',
      teeEnabled: false,
      l2RpcUrl: 'http://localhost:6546',
      registryAddress: '0x0000000000000000000000000000000000000000',
      version: '2.0.0-test',
    })

    replica = new SQLitNode({
      operatorPrivateKey: TEST_PRIVATE_KEY_2,
      endpoint: 'http://localhost:18547',
      wsEndpoint: 'ws://localhost:18547/ws',
      dataDir: REPLICA_DATA_DIR,
      region: 'global',
      teeEnabled: false,
      l2RpcUrl: 'http://localhost:6546',
      registryAddress: '0x0000000000000000000000000000000000000000',
      version: '2.0.0-test',
    })

    await primary.start()
    await replica.start()

    // Create database on primary
    const { databaseId } = await primary.createDatabase({
      name: 'sync-test',
      encryptionMode: 'none',
      replication: { replicaCount: 1 },
      schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
    })

    // Write data on primary
    await primary.execute({
      databaseId,
      sql: "INSERT INTO items (value) VALUES ('item1')",
    })
    await primary.execute({
      databaseId,
      sql: "INSERT INTO items (value) VALUES ('item2')",
    })

    // Get WAL entries from primary
    const walEntries = primary.getWALEntries({
      databaseId,
      fromPosition: BigInt(0),
      limit: 100,
    })

    // Create same database structure on replica
    const { databaseId: replicaDbId } = await replica.createDatabase({
      name: 'sync-test',
      encryptionMode: 'none',
      replication: { replicaCount: 0 },
      schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
    })

    // Apply WAL entries to replica
    await replica.applyWALEntries(replicaDbId, walEntries.entries)

    // Verify data on replica
    const replicaData = await replica.execute({
      databaseId: replicaDbId,
      sql: 'SELECT COUNT(*) as count FROM items',
    })

    expect(replicaData.rows[0]).toMatchObject({ count: 2 })

    // Verify WAL position synced
    const replicaDb = replica.getDatabase(replicaDbId)
    expect(replicaDb?.walPosition).toBe(BigInt(2))

    await primary.stop()
    await replica.stop()
  })
})

// ============ TEE Encryption Tests ============

describe('TEE Encryption', () => {
  let node: SQLitNode

  beforeAll(() => {
    process.env.SKIP_CHAIN_REGISTRATION = 'true'
  })

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  afterAll(async () => {
    if (node) {
      await node.stop()
    }
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
    delete process.env.SQLIT_TEE_PLATFORM
  })

  it('should create TEE-enabled node with simulated platform', async () => {
    process.env.SQLIT_TEE_PLATFORM = 'simulated'

    node = new SQLitNode({
      ...createTestConfig(),
      teeEnabled: true,
    })

    await node.start()

    expect(node.isTEEEnabled()).toBe(true)

    const caps = await node.getTEECapabilities()
    expect(caps).not.toBeNull()
    expect(caps?.platform).toBe('simulated')
    expect(caps?.encryptionEnabled).toBe(true)

    await node.stop()
  })

  it('should handle database with at_rest encryption mode', async () => {
    process.env.SQLIT_TEE_PLATFORM = 'simulated'

    node = new SQLitNode({
      ...createTestConfig(),
      teeEnabled: true,
    })

    await node.start()

    // Create database with at_rest encryption
    const { databaseId } = await node.createDatabase({
      name: 'encrypted-test',
      encryptionMode: 'at_rest',
      replication: {},
      schema: 'CREATE TABLE secrets (id INTEGER PRIMARY KEY, data TEXT)',
    })

    // Database should be created even with at_rest encryption
    const db = node.getDatabase(databaseId)
    expect(db).toBeDefined()
    expect(db?.encryptionMode).toBe('at_rest')

    // Should be able to write data
    const insertResult = await node.execute({
      databaseId,
      sql: "INSERT INTO secrets (data) VALUES ('secret value')",
    })
    expect(insertResult.rowsAffected).toBe(1)

    // Should be able to read data
    const queryResult = await node.execute({
      databaseId,
      sql: 'SELECT * FROM secrets',
    })
    expect(queryResult.rows.length).toBe(1)
    expect(queryResult.rows[0]).toMatchObject({ data: 'secret value' })

    await node.stop()
  })

  it('should handle database with tee_encrypted mode', async () => {
    process.env.SQLIT_TEE_PLATFORM = 'simulated'

    node = new SQLitNode({
      ...createTestConfig(),
      teeEnabled: true,
    })

    await node.start()

    // Create database with tee_encrypted mode
    const { databaseId } = await node.createDatabase({
      name: 'tee-encrypted-test',
      encryptionMode: 'tee_encrypted',
      replication: {},
      schema: 'CREATE TABLE secure_data (id INTEGER PRIMARY KEY, payload TEXT)',
    })

    // Database should be created
    const db = node.getDatabase(databaseId)
    expect(db).toBeDefined()
    expect(db?.encryptionMode).toBe('tee_encrypted')

    // Should work with TEE execution
    const insertResult = await node.execute({
      databaseId,
      sql: "INSERT INTO secure_data (payload) VALUES ('tee secured data')",
    })
    expect(insertResult.rowsAffected).toBe(1)

    // Try TEE-specific execution
    const teeResult = await node.executeInTEE(
      databaseId,
      'SELECT * FROM secure_data',
    )

    // In simulated mode, TEE returns a response but executedInTEE is false
    // because it's not actually running in a hardware TEE
    expect(teeResult).not.toBeNull()
    expect(teeResult?.executedInTEE).toBe(false) // Simulated mode doesn't actually execute in TEE

    await node.stop()
  })
})

// ============ Client SDK Integration Tests ============

describe('Client SDK Integration', () => {
  let node: SQLitNode

  beforeAll(() => {
    process.env.SKIP_CHAIN_REGISTRATION = 'true'
  })

  beforeEach(async () => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }

    node = new SQLitNode(createTestConfig())
    await node.start()
  })

  afterAll(async () => {
    if (node) {
      await node.stop()
    }
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  it('should support all query parameter types', async () => {
    const { databaseId } = await node.createDatabase({
      name: 'params-test',
      encryptionMode: 'none',
      replication: {},
      schema: `
        CREATE TABLE typed_data (
          id INTEGER PRIMARY KEY,
          str_val TEXT,
          int_val INTEGER,
          float_val REAL,
          bool_val INTEGER,
          null_val TEXT
        )
      `,
    })

    // Test different parameter types
    await node.execute({
      databaseId,
      sql: 'INSERT INTO typed_data (str_val, int_val, float_val, bool_val, null_val) VALUES (?, ?, ?, ?, ?)',
      params: ['hello', 42, 3.14, true, null],
    })

    const result = await node.execute({
      databaseId,
      sql: 'SELECT * FROM typed_data WHERE id = 1',
    })

    expect(result.rows[0]).toMatchObject({
      str_val: 'hello',
      int_val: 42,
      bool_val: 1, // SQLite stores boolean as integer
    })
    expect(result.rows[0]).toHaveProperty('null_val', null)
  })

  it('should handle large result sets', async () => {
    const { databaseId } = await node.createDatabase({
      name: 'large-dataset-test',
      encryptionMode: 'none',
      replication: {},
      schema: 'CREATE TABLE large_data (id INTEGER PRIMARY KEY, data TEXT)',
    })

    // Insert 1000 rows
    const batchSize = 100
    for (let batch = 0; batch < 10; batch++) {
      const queries = []
      for (let i = 0; i < batchSize; i++) {
        const id = batch * batchSize + i + 1
        queries.push({
          sql: 'INSERT INTO large_data (id, data) VALUES (?, ?)',
          params: [id, `data-${id}`],
        })
      }
      await node.batchExecute({
        databaseId,
        queries,
        transactional: true,
      })
    }

    // Query all rows
    const result = await node.execute({
      databaseId,
      sql: 'SELECT COUNT(*) as total FROM large_data',
    })

    expect(result.rows[0]).toMatchObject({ total: 1000 })
  })

  it('should handle complex SQL operations', async () => {
    const { databaseId } = await node.createDatabase({
      name: 'complex-sql-test',
      encryptionMode: 'none',
      replication: {},
      schema: `
        CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, created_at TEXT);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
      `,
    })

    // Insert test data
    await node.batchExecute({
      databaseId,
      queries: [
        { sql: "INSERT INTO customers (id, name) VALUES (1, 'Alice')" },
        { sql: "INSERT INTO customers (id, name) VALUES (2, 'Bob')" },
        {
          sql: "INSERT INTO orders (customer_id, amount, created_at) VALUES (1, 100.50, '2024-01-01')",
        },
        {
          sql: "INSERT INTO orders (customer_id, amount, created_at) VALUES (1, 200.25, '2024-01-02')",
        },
        {
          sql: "INSERT INTO orders (customer_id, amount, created_at) VALUES (2, 50.00, '2024-01-01')",
        },
      ],
      transactional: true,
    })

    // Complex query with JOIN and aggregation
    const result = await node.execute({
      databaseId,
      sql: `
        SELECT 
          c.name,
          COUNT(o.id) as order_count,
          SUM(o.amount) as total_amount
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        GROUP BY c.id
        ORDER BY total_amount DESC
      `,
    })

    expect(result.rows.length).toBe(2)
    expect(result.rows[0]).toMatchObject({
      name: 'Alice',
      order_count: 2,
      total_amount: 300.75,
    })
  })
})
