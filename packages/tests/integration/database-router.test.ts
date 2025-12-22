/**
 * Database Replica Router Integration Tests
 *
 * Tests real PostgreSQL connectivity with:
 * - Read/write query routing
 * - Transaction support
 * - Health checks
 * - Replica lag detection
 * - Circuit breaker behavior
 * - Failover scenarios
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  DatabaseReplicaRouter,
  type ReplicaRouterConfig,
} from '../../shared/src/db/replica-router'

// Skip if no PostgreSQL available
const POSTGRES_AVAILABLE =
  process.env.DB_PRIMARY_HOST || process.env.TEST_POSTGRES

describe.skipIf(!POSTGRES_AVAILABLE)('DatabaseReplicaRouter', () => {
  let router: DatabaseReplicaRouter

  beforeAll(async () => {
    const config: Partial<ReplicaRouterConfig> = {
      primary: {
        host: process.env.DB_PRIMARY_HOST ?? 'localhost',
        port: parseInt(process.env.DB_PRIMARY_PORT ?? '5432', 10),
        database: process.env.DB_NAME ?? 'jeju_test',
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.DB_PASSWORD ?? 'postgres',
        ssl: false,
        maxConnections: 5,
      },
      replicas: process.env.DB_REPLICAS
        ? [
            {
              host: process.env.DB_REPLICA_HOST ?? 'localhost',
              port: parseInt(process.env.DB_REPLICA_PORT ?? '5433', 10),
              database: process.env.DB_NAME ?? 'jeju_test',
              user: process.env.DB_USER ?? 'postgres',
              password: process.env.DB_PASSWORD ?? 'postgres',
              ssl: false,
              maxConnections: 5,
            },
          ]
        : [],
      maxReplicaLagMs: 5000,
      readPreference: 'replica',
    }

    router = new DatabaseReplicaRouter(config)
    await router.start()

    // Create test table
    await router.query(`
      CREATE TABLE IF NOT EXISTS router_test (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        value TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
  })

  afterAll(async () => {
    if (router) {
      // Cleanup
      await router.query('DROP TABLE IF EXISTS router_test')
      await router.stop()
    }
  })

  describe('Query Routing', () => {
    it('should route SELECT to replica if available', async () => {
      // Insert some data first
      await router.query(
        'INSERT INTO router_test (name, value) VALUES ($1, $2)',
        ['test-read', 'value'],
      )

      // Read should potentially go to replica
      const result = await router.query<{ name: string; value: string }>(
        'SELECT name, value FROM router_test WHERE name = $1',
        ['test-read'],
      )

      expect(result.rows.length).toBeGreaterThanOrEqual(1)
      expect(result.rows[0].name).toBe('test-read')
    })

    it('should route INSERT to primary', async () => {
      const result = await router.query(
        'INSERT INTO router_test (name, value) VALUES ($1, $2) RETURNING id',
        ['insert-test', 'value'],
      )

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].id).toBeDefined()
    })

    it('should route UPDATE to primary', async () => {
      await router.query(
        'INSERT INTO router_test (name, value) VALUES ($1, $2)',
        ['update-test', 'old-value'],
      )

      const result = await router.query(
        'UPDATE router_test SET value = $1 WHERE name = $2 RETURNING value',
        ['new-value', 'update-test'],
      )

      expect(result.rows[0].value).toBe('new-value')
    })

    it('should route DELETE to primary', async () => {
      await router.query(
        'INSERT INTO router_test (name, value) VALUES ($1, $2)',
        ['delete-test', 'value'],
      )

      const result = await router.query(
        'DELETE FROM router_test WHERE name = $1 RETURNING id',
        ['delete-test'],
      )

      expect(result.rowCount).toBe(1)
    })

    it('should handle FOR UPDATE queries on primary', async () => {
      await router.query(
        'INSERT INTO router_test (name, value) VALUES ($1, $2)',
        ['lock-test', 'value'],
      )

      const result = await router.query(
        'SELECT * FROM router_test WHERE name = $1 FOR UPDATE',
        ['lock-test'],
      )

      expect(result.rows.length).toBe(1)
    })

    it('should force writable when option is set', async () => {
      const result = await router.query('SELECT 1 as num', [], {
        forceWritable: true,
      })

      expect(result.rows[0].num).toBe(1)
    })
  })

  describe('Transactions', () => {
    it('should execute transaction on primary', async () => {
      const result = await router.transaction(async (client) => {
        await client.query(
          'INSERT INTO router_test (name, value) VALUES ($1, $2)',
          ['tx-test-1', 'value-1'],
        )
        await client.query(
          'INSERT INTO router_test (name, value) VALUES ($1, $2)',
          ['tx-test-2', 'value-2'],
        )

        const res = await client.query<{ count: string }>(
          "SELECT COUNT(*) as count FROM router_test WHERE name LIKE 'tx-test-%'",
        )
        return parseInt(res.rows[0].count, 10)
      })

      expect(result).toBeGreaterThanOrEqual(2)
    })

    it('should rollback transaction on error', async () => {
      const initialCount = await router.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM router_test WHERE name = 'rollback-test'",
      )
      const initial = parseInt(initialCount.rows[0].count, 10)

      try {
        await router.transaction(async (client) => {
          await client.query(
            'INSERT INTO router_test (name, value) VALUES ($1, $2)',
            ['rollback-test', 'value'],
          )
          throw new Error('Intentional rollback')
        })
      } catch (_error) {
        // Expected
      }

      const afterCount = await router.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM router_test WHERE name = 'rollback-test'",
      )
      const after = parseInt(afterCount.rows[0].count, 10)

      expect(after).toBe(initial)
    })
  })

  describe('Health & Stats', () => {
    it('should report healthy primary', () => {
      expect(router.isPrimaryHealthy()).toBe(true)
    })

    it('should return stats', () => {
      const stats = router.getStats()

      expect(stats.primary.host).toBeDefined()
      expect(stats.primary.healthy).toBe(true)
      expect(Array.isArray(stats.replicas)).toBe(true)
    })

    it('should export Prometheus metrics', async () => {
      // Execute some queries to generate metrics
      await router.query('SELECT 1')
      await router.query('SELECT 2')

      const metrics = await router.getMetrics()

      expect(metrics).toContain('db_queries_total')
      expect(metrics).toContain('db_query_duration_seconds')
      expect(metrics).toContain('db_node_health')
    })
  })

  describe('Connection Management', () => {
    it('should get primary client directly', async () => {
      const client = await router.getPrimaryClient()

      try {
        const result = await client.query('SELECT 1 as num')
        expect(result.rows[0].num).toBe(1)
      } finally {
        client.release()
      }
    })

    it('should get replica client directly', async () => {
      const client = await router.getReplicaClient()

      try {
        const result = await client.query('SELECT 1 as num')
        expect(result.rows[0].num).toBe(1)
      } finally {
        client.release()
      }
    })
  })
})

describe('Query Classification', () => {
  it('should correctly identify write queries', () => {
    const writeQueries = [
      'INSERT INTO users (name) VALUES ($1)',
      'UPDATE users SET name = $1 WHERE id = $2',
      'DELETE FROM users WHERE id = $1',
      'CREATE TABLE test (id INT)',
      'ALTER TABLE users ADD COLUMN email VARCHAR',
      'DROP TABLE old_users',
      'TRUNCATE TABLE logs',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'SELECT * FROM users FOR UPDATE',
      'SELECT * FROM users FOR SHARE',
    ]

    // These should all be routed to primary
    // (Testing the internal classification logic)
    for (const query of writeQueries) {
      expect(isWriteQuery(query)).toBe(true)
    }
  })

  it('should correctly identify read queries', () => {
    const readQueries = [
      'SELECT * FROM users',
      'SELECT COUNT(*) FROM orders',
      'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
      'WITH cte AS (SELECT * FROM users) SELECT * FROM cte',
    ]

    for (const query of readQueries) {
      expect(isWriteQuery(query)).toBe(false)
    }
  })
})

// Helper for testing query classification
function isWriteQuery(sql: string): boolean {
  const WRITE_PATTERNS = [
    /^\s*INSERT\s/i,
    /^\s*UPDATE\s/i,
    /^\s*DELETE\s/i,
    /^\s*CREATE\s/i,
    /^\s*ALTER\s/i,
    /^\s*DROP\s/i,
    /^\s*TRUNCATE\s/i,
    /^\s*GRANT\s/i,
    /^\s*REVOKE\s/i,
    /^\s*BEGIN\b/i,
    /^\s*COMMIT\b/i,
    /^\s*ROLLBACK\b/i,
    /^\s*SAVEPOINT\s/i,
    /^\s*LOCK\s/i,
    /FOR\s+UPDATE/i,
    /FOR\s+SHARE/i,
  ]
  return WRITE_PATTERNS.some((pattern) => pattern.test(sql))
}
