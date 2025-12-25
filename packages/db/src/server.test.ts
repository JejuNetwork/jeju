/**
 * CQL Development Server Tests
 *
 * Tests for the SQLite-backed development server
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { rmSync } from 'node:fs'
import { Elysia } from 'elysia'

// Test data directory - isolated from real data
const TEST_DATA_DIR = './.test-cql-data'
const TEST_PORT = 4499

// Create a test server instance
function createTestServer() {
  const { Database: SqliteDatabase } = require('bun:sqlite')

  const databases = new Map<string, InstanceType<typeof SqliteDatabase>>()
  let blockHeight = 0

  function getDatabase(
    dbId: string,
  ): InstanceType<typeof SqliteDatabase> {
    let db = databases.get(dbId)
    if (!db) {
      const dbPath = `${TEST_DATA_DIR}/${dbId}.sqlite`
      db = new SqliteDatabase(dbPath)
      db.run('PRAGMA journal_mode = WAL')
      db.run('PRAGMA synchronous = NORMAL')
      databases.set(dbId, db)
    }
    return db
  }

  const app = new Elysia()
    .get('/health', () => ({
      status: 'ok',
      service: 'cql-dev',
    }))
    .get('/api/v1/status', () => {
      blockHeight++
      return {
        blockHeight,
        databases: databases.size,
        status: 'running',
      }
    })
    .post('/api/v1/query', ({ body, set }) => {
      const { database, type, sql, params = [] } = body as {
        database: string
        type: 'query' | 'exec'
        sql: string
        params?: (string | number | boolean | null)[]
      }

      if (!database || !sql) {
        set.status = 400
        return { error: 'Invalid request' }
      }

      blockHeight++
      const db = getDatabase(database)

      if (type === 'query') {
        const stmt = db.prepare(sql)
        const rows = stmt.all(...params) as Record<string, unknown>[]
        const columns = rows.length > 0 ? Object.keys(rows[0]) : []

        return {
          rows,
          rowCount: rows.length,
          columns,
          blockHeight,
        }
      }

      const stmt = db.prepare(sql)
      const result = stmt.run(...params)
      const txHash = `0x${Buffer.from(`${sql}:${blockHeight}`).toString('hex').slice(0, 64).padEnd(64, '0')}`

      return {
        rowsAffected: result.changes,
        lastInsertId: result.lastInsertRowid?.toString(),
        txHash,
        blockHeight,
        gasUsed: '0',
      }
    })
    .post('/api/v1/databases', ({ body, set }) => {
      const { owner } = body as { owner?: string }
      const dbId = `db-${crypto.randomUUID()}`
      getDatabase(dbId)

      set.status = 201
      return {
        id: dbId,
        createdAt: Date.now(),
        owner: owner ?? '0x0000000000000000000000000000000000000000',
        nodeCount: 1,
        consistencyMode: 'strong',
        status: 'running',
        blockHeight,
        sizeBytes: 0,
        monthlyCost: '0',
      }
    })
    .get('/api/v1/databases/:id', ({ params, set }) => {
      const db = databases.get(params.id)
      if (!db) {
        set.status = 404
        return { error: 'Database not found' }
      }
      return {
        id: params.id,
        createdAt: Date.now(),
        owner: '0x0000000000000000000000000000000000000000',
        nodeCount: 1,
        consistencyMode: 'strong',
        status: 'running',
        blockHeight,
        sizeBytes: 0,
        monthlyCost: '0',
      }
    })
    .get('/api/v1/plans', () => ({
      plans: [
        {
          id: 'free',
          name: 'Free Tier',
          nodeCount: 1,
          storageBytes: '1073741824',
          queriesPerMonth: '100000',
          pricePerMonth: '0',
          paymentToken: '0x0000000000000000000000000000000000000000',
        },
      ],
    }))
    .post('/api/v1/rentals', ({ body, set }) => {
      const { planId, schema } = body as { planId?: string; schema?: string }
      const dbId = `db-${crypto.randomUUID()}`
      const db = getDatabase(dbId)

      if (schema) {
        db.run(schema)
      }

      set.status = 201
      return {
        id: `rental-${crypto.randomUUID()}`,
        databaseId: dbId,
        renter: '0x0000000000000000000000000000000000000000',
        planId: planId ?? 'free',
        startedAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        autoRenew: false,
        paymentStatus: 'current',
      }
    })

  function cleanup() {
    for (const db of databases.values()) {
      db.close()
    }
    databases.clear()
  }

  return { app, cleanup, getDatabase }
}

describe('CQL Development Server', () => {
  let server: ReturnType<typeof createTestServer>
  let baseUrl: string

  beforeAll(async () => {
    // Ensure test directory exists
    await Bun.write(`${TEST_DATA_DIR}/.gitkeep`, '')

    server = createTestServer()
    server.app.listen(TEST_PORT)
    baseUrl = `http://localhost:${TEST_PORT}`
  })

  afterAll(() => {
    server.cleanup()
    // Clean up test data
    rmSync(TEST_DATA_DIR, { recursive: true, force: true })
  })

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const res = await fetch(`${baseUrl}/health`)
      const data = (await res.json()) as { status: string }

      expect(res.ok).toBe(true)
      expect(data.status).toBe('ok')
    })
  })

  describe('Status', () => {
    it('should return server status', async () => {
      const res = await fetch(`${baseUrl}/api/v1/status`)
      const data = (await res.json()) as { status: string; blockHeight: number }

      expect(res.ok).toBe(true)
      expect(data.status).toBe('running')
      expect(data.blockHeight).toBeGreaterThan(0)
    })

    it('should increment block height on each call', async () => {
      const res1 = await fetch(`${baseUrl}/api/v1/status`)
      const data1 = (await res1.json()) as { blockHeight: number }

      const res2 = await fetch(`${baseUrl}/api/v1/status`)
      const data2 = (await res2.json()) as { blockHeight: number }

      expect(data2.blockHeight).toBeGreaterThan(data1.blockHeight)
    })
  })

  describe('Query Execution', () => {
    const testDbId = 'test-query-db'

    it('should create a table', async () => {
      const res = await fetch(`${baseUrl}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: testDbId,
          type: 'exec',
          sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
        }),
      })

      expect(res.ok).toBe(true)
      const data = (await res.json()) as { rowsAffected: number }
      expect(data.rowsAffected).toBe(0)
    })

    it('should insert data', async () => {
      const res = await fetch(`${baseUrl}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: testDbId,
          type: 'exec',
          sql: 'INSERT INTO users (name, email) VALUES (?, ?)',
          params: ['Alice', 'alice@example.com'],
        }),
      })

      expect(res.ok).toBe(true)
      const data = (await res.json()) as { rowsAffected: number; lastInsertId: string }
      expect(data.rowsAffected).toBe(1)
      expect(data.lastInsertId).toBe('1')
    })

    it('should query data', async () => {
      const res = await fetch(`${baseUrl}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: testDbId,
          type: 'query',
          sql: 'SELECT * FROM users WHERE name = ?',
          params: ['Alice'],
        }),
      })

      expect(res.ok).toBe(true)
      const data = (await res.json()) as { rows: { id: number; name: string; email: string }[]; rowCount: number }
      expect(data.rowCount).toBe(1)
      expect(data.rows[0].name).toBe('Alice')
      expect(data.rows[0].email).toBe('alice@example.com')
    })

    it('should handle multiple inserts', async () => {
      for (let i = 2; i <= 5; i++) {
        await fetch(`${baseUrl}/api/v1/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            database: testDbId,
            type: 'exec',
            sql: 'INSERT INTO users (name, email) VALUES (?, ?)',
            params: [`User${i}`, `user${i}@example.com`],
          }),
        })
      }

      const res = await fetch(`${baseUrl}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: testDbId,
          type: 'query',
          sql: 'SELECT COUNT(*) as count FROM users',
        }),
      })

      const data = (await res.json()) as { rows: { count: number }[] }
      expect(data.rows[0].count).toBe(5)
    })

    it('should return error for invalid request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing database and sql
        }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('Database Management', () => {
    it('should create a database', async () => {
      const res = await fetch(`${baseUrl}/api/v1/databases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: '0x1234567890123456789012345678901234567890',
        }),
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as { id: string; status: string }
      expect(data.id).toMatch(/^db-/)
      expect(data.status).toBe('running')
    })

    it('should return 404 for non-existent database', async () => {
      const res = await fetch(`${baseUrl}/api/v1/databases/non-existent-db`)

      expect(res.status).toBe(404)
    })
  })

  describe('Rental Plans', () => {
    it('should list available plans', async () => {
      const res = await fetch(`${baseUrl}/api/v1/plans`)
      const data = (await res.json()) as { plans: { id: string; name: string }[] }

      expect(res.ok).toBe(true)
      expect(data.plans.length).toBeGreaterThan(0)
      expect(data.plans[0].id).toBe('free')
    })
  })

  describe('Rentals', () => {
    it('should create a rental with initial schema', async () => {
      const res = await fetch(`${baseUrl}/api/v1/rentals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'free',
          schema: 'CREATE TABLE test (id INTEGER PRIMARY KEY)',
        }),
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as { id: string; databaseId: string; paymentStatus: string }
      expect(data.id).toMatch(/^rental-/)
      expect(data.databaseId).toMatch(/^db-/)
      expect(data.paymentStatus).toBe('current')
    })
  })
})

