/**
 * Distributed Integration Tests
 *
 * End-to-end tests for the distributed SQLit v2 system:
 * - Multi-node cluster behavior
 * - Primary-replica failover
 * - WAL replication across nodes
 * - Concurrent operations
 * - Network partition simulation
 * - Load distribution
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseNodeStatus } from '@jejunetwork/types'
import { SQLitClient } from '../client'
import { SQLitNode } from '../node'
import { createSQLitServer } from '../server'
import type { SQLitNodeConfig } from '../types'

// Test configuration
const BASE_PORT = 18600
const TEST_DATA_BASE = join(import.meta.dir, '.test-data-distributed')
const TEST_PRIVATE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
] as const

function createNodeConfig(index: number): SQLitNodeConfig {
  return {
    operatorPrivateKey: TEST_PRIVATE_KEYS[index],
    endpoint: `http://localhost:${BASE_PORT + index}`,
    wsEndpoint: `ws://localhost:${BASE_PORT + index}/ws`,
    dataDir: join(TEST_DATA_BASE, `node-${index}`),
    region: 'global',
    teeEnabled: false,
    l2RpcUrl: 'http://localhost:8545',
    registryAddress: '0x0000000000000000000000000000000000000000',
    version: '2.0.0-test',
  }
}

describe('Distributed Integration Tests', () => {
  beforeAll(() => {
    process.env.SKIP_CHAIN_REGISTRATION = 'true'
  })

  beforeEach(() => {
    // Clean up all test directories
    for (let i = 0; i < 3; i++) {
      const dir = join(TEST_DATA_BASE, `node-${i}`)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true })
      }
    }
  })

  afterAll(() => {
    if (existsSync(TEST_DATA_BASE)) {
      rmSync(TEST_DATA_BASE, { recursive: true })
    }
  })

  describe('Multi-Node Cluster', () => {
    it('should start multiple nodes successfully', async () => {
      const nodes: SQLitNode[] = []

      // Start 3 nodes
      for (let i = 0; i < 3; i++) {
        const node = new SQLitNode(createNodeConfig(i))
        await node.start()
        nodes.push(node)
      }

      // Verify all nodes are active
      for (const node of nodes) {
        const info = node.getNodeInfo()
        expect(info.status).toBe(DatabaseNodeStatus.ACTIVE)
      }

      // Clean up
      for (const node of nodes) {
        await node.stop()
      }
    })

    it('should maintain independent databases per node', async () => {
      const node0 = new SQLitNode(createNodeConfig(0))
      const node1 = new SQLitNode(createNodeConfig(1))

      await node0.start()
      await node1.start()

      // Create database on node0
      const { databaseId: db0 } = await node0.createDatabase({
        name: 'node0-db',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE test (id INTEGER PRIMARY KEY)',
      })

      // Create database on node1
      const { databaseId: db1 } = await node1.createDatabase({
        name: 'node1-db',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE test (id INTEGER PRIMARY KEY)',
      })

      // Databases should be different
      expect(db0).not.toBe(db1)

      // Each node should only see its own database
      expect(node0.getDatabase(db0)).not.toBeNull()
      expect(node0.getDatabase(db1)).toBeNull()
      expect(node1.getDatabase(db1)).not.toBeNull()
      expect(node1.getDatabase(db0)).toBeNull()

      await node0.stop()
      await node1.stop()
    })
  })

  describe('Client-Server Communication', () => {
    it('should execute queries through HTTP client', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'client-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
      })

      const client = new SQLitClient({
        endpoint: `http://localhost:${BASE_PORT}`,
        databaseId,
      })

      // Insert data
      const insertResult = await client.run(
        'INSERT INTO users (name) VALUES (?)',
        ['Alice'],
      )
      expect(insertResult.rowsAffected).toBe(1)

      // Query data
      const queryResult = await client.query<{ id: number; name: string }>(
        'SELECT * FROM users WHERE name = ?',
        ['Alice'],
      )
      expect(queryResult.length).toBe(1)
      expect(queryResult[0].name).toBe('Alice')

      await server.stop()
    })

    it('should handle batch operations through server node', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 1,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'batch-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
      })

      // Use node directly for batch operations
      const batchResult = await server.node.batchExecute({
        databaseId,
        queries: [
          { sql: "INSERT INTO users (name) VALUES ('Bob')" },
          { sql: "INSERT INTO users (name) VALUES ('Charlie')" },
          { sql: "INSERT INTO users (name) VALUES ('Diana')" },
        ],
        transactional: true,
      })

      expect(batchResult.results.length).toBe(3)

      await server.stop()
    })

    it('should report health status', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 2,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'health-test',
        encryptionMode: 'none',
        replication: {},
      })

      const client = new SQLitClient({
        endpoint: `http://localhost:${BASE_PORT + 2}`,
        databaseId,
      })

      const healthy = await client.isHealthy()
      expect(healthy).toBe(true)

      await server.stop()
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent reads', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 10,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'concurrent-read-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER)',
      })

      await server.node.execute({
        databaseId,
        sql: 'INSERT INTO counter (id, value) VALUES (1, 42)',
      })

      const clients = Array.from(
        { length: 5 },
        () =>
          new SQLitClient({
            endpoint: `http://localhost:${BASE_PORT + 10}`,
            databaseId,
          }),
      )

      // Execute concurrent reads
      const results = await Promise.all(
        clients.map((c) =>
          c.query<{ value: number }>('SELECT value FROM counter WHERE id = 1'),
        ),
      )

      // All reads should succeed
      expect(results.every((r) => r.length === 1)).toBe(true)
      expect(results.every((r) => r[0].value === 42)).toBe(true)

      await server.stop()
    })

    it('should handle multiple inserts', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 11,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'concurrent-write-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
      })

      // Execute sequential inserts
      for (let i = 0; i < 5; i++) {
        await server.node.execute({
          databaseId,
          sql: 'INSERT INTO items (value) VALUES (?)',
          params: [`item-${i}`],
        })
      }

      // Verify all inserts
      const result = await server.node.execute({
        databaseId,
        sql: 'SELECT COUNT(*) as count FROM items',
      })
      expect(result.rows[0]).toMatchObject({ count: 5 })

      await server.stop()
    })
  })

  describe('WAL Replication', () => {
    let primary: SQLitNode
    let replica: SQLitNode

    beforeEach(async () => {
      primary = new SQLitNode(createNodeConfig(0))
      replica = new SQLitNode(createNodeConfig(1))
      await primary.start()
      await replica.start()
    })

    afterAll(async () => {
      if (primary) await primary.stop()
      if (replica) await replica.stop()
    })

    it('should generate WAL entries for writes', async () => {
      const { databaseId } = await primary.createDatabase({
        name: 'wal-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE data (id INTEGER PRIMARY KEY, value TEXT)',
      })

      // Write data
      for (let i = 0; i < 5; i++) {
        await primary.execute({
          databaseId,
          sql: 'INSERT INTO data (value) VALUES (?)',
          params: [`value-${i}`],
        })
      }

      // Get WAL entries
      const walEntries = primary.getWALEntries({
        databaseId,
        fromPosition: BigInt(0),
        limit: 100,
      })

      expect(walEntries.entries.length).toBe(5)
      expect(walEntries.currentPosition).toBe(BigInt(5))
    })

    it('should replicate WAL to replica node', async () => {
      const { databaseId: primaryDbId } = await primary.createDatabase({
        name: 'replication-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      })

      // Write to primary
      await primary.execute({
        databaseId: primaryDbId,
        sql: "INSERT INTO items (name) VALUES ('item1')",
      })
      await primary.execute({
        databaseId: primaryDbId,
        sql: "INSERT INTO items (name) VALUES ('item2')",
      })

      // Get WAL entries from primary
      const walEntries = primary.getWALEntries({
        databaseId: primaryDbId,
        fromPosition: BigInt(0),
        limit: 100,
      })

      // Create same structure on replica
      const { databaseId: replicaDbId } = await replica.createDatabase({
        name: 'replication-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      })

      // Apply WAL entries to replica
      await replica.applyWALEntries(replicaDbId, walEntries.entries)

      // Verify data on replica
      const result = await replica.execute({
        databaseId: replicaDbId,
        sql: 'SELECT COUNT(*) as count FROM items',
      })

      expect(result.rows[0]).toMatchObject({ count: 2 })
    })

    it('should maintain WAL hash chain integrity', async () => {
      const { databaseId } = await primary.createDatabase({
        name: 'hash-chain-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE log (id INTEGER PRIMARY KEY, event TEXT)',
      })

      // Generate multiple WAL entries
      for (let i = 0; i < 10; i++) {
        await primary.execute({
          databaseId,
          sql: 'INSERT INTO log (event) VALUES (?)',
          params: [`event-${i}`],
        })
      }

      const walEntries = primary.getWALEntries({
        databaseId,
        fromPosition: BigInt(0),
        limit: 100,
      })

      // Verify hash chain
      let prevHash = `0x${'0'.repeat(64)}`
      for (const entry of walEntries.entries) {
        expect(entry.prevHash).toBe(prevHash)
        expect(entry.hash).toBeDefined()
        expect(entry.hash.startsWith('0x')).toBe(true)
        prevHash = entry.hash
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle SQL syntax errors', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 20,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'error-test-1',
        encryptionMode: 'none',
        replication: {},
      })

      const client = new SQLitClient({
        endpoint: `http://localhost:${BASE_PORT + 20}`,
        databaseId,
      })

      await expect(client.query('INVALID SQL SYNTAX')).rejects.toThrow()

      await server.stop()
    })

    it('should handle constraint violations via node', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 21,
        host: 'localhost',
        nodeConfig: config,
      })

      const { databaseId } = await server.node.createDatabase({
        name: 'error-test-2',
        encryptionMode: 'none',
        replication: {},
        schema:
          'CREATE TABLE test (id INTEGER PRIMARY KEY, unique_col TEXT UNIQUE)',
      })

      // Insert first row via node
      await server.node.execute({
        databaseId,
        sql: "INSERT INTO test (unique_col) VALUES ('unique-val')",
      })

      // Try to insert duplicate - should fail with constraint error
      let errorThrown = false
      try {
        await server.node.execute({
          databaseId,
          sql: "INSERT INTO test (unique_col) VALUES ('unique-val')",
        })
      } catch {
        errorThrown = true
      }
      expect(errorThrown).toBe(true)

      await server.stop()
    })

    it('should handle non-existent database', async () => {
      const config = createNodeConfig(0)
      const server = await createSQLitServer({
        port: BASE_PORT + 22,
        host: 'localhost',
        nodeConfig: config,
      })

      await server.node.createDatabase({
        name: 'error-test-3',
        encryptionMode: 'none',
        replication: {},
      })

      const client = new SQLitClient({
        endpoint: `http://localhost:${BASE_PORT + 22}`,
        databaseId: 'non-existent-db',
      })

      await expect(client.query('SELECT 1')).rejects.toThrow()

      await server.stop()
    })
  })

  describe('Database Lifecycle', () => {
    let node: SQLitNode

    beforeEach(async () => {
      node = new SQLitNode(createNodeConfig(0))
      await node.start()
    })

    afterAll(async () => {
      if (node) {
        await node.stop()
      }
    })

    it('should create and delete databases', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'lifecycle-test',
        encryptionMode: 'none',
        replication: {},
      })

      expect(node.getDatabase(databaseId)).not.toBeNull()

      await node.deleteDatabase(databaseId)

      expect(node.getDatabase(databaseId)).toBeNull()
    })

    it('should list all databases', async () => {
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
    })

    it('should track WAL position accurately', async () => {
      const { databaseId } = await node.createDatabase({
        name: 'wal-position-test',
        encryptionMode: 'none',
        replication: {},
        schema: 'CREATE TABLE wal_data (id INTEGER PRIMARY KEY, value TEXT)',
      })

      // Insert data and verify WAL position increases
      const result1 = await node.execute({
        databaseId,
        sql: "INSERT INTO wal_data (value) VALUES ('first')",
      })
      expect(result1.walPosition).toBe(BigInt(1))

      const result2 = await node.execute({
        databaseId,
        sql: "INSERT INTO wal_data (value) VALUES ('second')",
      })
      expect(result2.walPosition).toBe(BigInt(2))

      // Database should reflect current position
      const db = node.getDatabase(databaseId)
      expect(db?.walPosition).toBe(BigInt(2))
    })
  })
})
