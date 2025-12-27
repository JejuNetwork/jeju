/**
 * EQLite Server - SQLite-backed EQLite-compatible API
 *
 * Provides a local development server that mimics the EQLite HTTP API.
 * Used by `jeju dev`, `jeju test`, and `jeju start` when Docker is unavailable.
 *
 * Usage: bun run server
 */

import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'

const PORT = parseInt(process.env.EQLITE_PORT ?? process.env.PORT ?? '4661', 10)
const DATA_DIR = process.env.EQLITE_DATA_DIR ?? join(process.cwd(), '.data/eqlite')

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// Track databases by ID
const databases = new Map<string, Database>()
let blockHeight = 1

function getOrCreateDatabase(databaseId: string): Database {
  const existing = databases.get(databaseId)
  if (existing) return existing

  const dbPath = join(DATA_DIR, `${databaseId}.sqlite`)
  const dbDir = dirname(dbPath)
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  const db = new Database(dbPath, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  databases.set(databaseId, db)
  return db
}

// Default database for simple queries
const defaultDb = getOrCreateDatabase('default')

interface QueryBody {
  sql: string
  params?: (string | number | boolean | null)[]
  databaseId?: string
}

function executeQuery(body: QueryBody): {
  success: boolean
  error?: string
  rows?: Record<string, unknown>[]
  rowCount?: number
  columns?: string[]
  rowsAffected?: number
  lastInsertRowid?: number
  executionTime: number
  blockHeight: number
} {
  const start = performance.now()
  const db = body.databaseId ? getOrCreateDatabase(body.databaseId) : defaultDb

  const sql = body.sql.trim()
  const params = body.params ?? []

  // Determine if this is a read or write query
  const isRead = /^(SELECT|PRAGMA|EXPLAIN)/i.test(sql)

  if (isRead) {
    const stmt = db.prepare(sql)
    const rows = stmt.all(...params) as Record<string, unknown>[]
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    return {
      success: true,
      rows,
      rowCount: rows.length,
      columns,
      executionTime: performance.now() - start,
      blockHeight: blockHeight,
    }
  } else {
    const stmt = db.prepare(sql)
    const result = stmt.run(...params)
    blockHeight++ // Simulate block advancement on writes

    return {
      success: true,
      rowsAffected: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
      executionTime: performance.now() - start,
      blockHeight: blockHeight,
    }
  }
}

const app = new Elysia()
  .use(cors())
  // Health check endpoints
  .get('/health', () => ({
    status: 'healthy',
    mode: 'sqlite-compat',
    port: PORT,
  }))
  .get('/v1/health', () => ({
    status: 'healthy',
    mode: 'sqlite-compat',
  }))
  .get('/api/v1/health', () => ({
    status: 'healthy',
    mode: 'sqlite-compat',
  }))
  // Status endpoint
  .get('/v1/status', () => ({
    status: 'running',
    mode: 'sqlite-compat',
    blockHeight,
    version: '1.0.0-local',
    databases: databases.size,
  }))
  .get('/api/v1/status', () => ({
    status: 'running',
    mode: 'sqlite-compat',
    blockHeight,
    version: '1.0.0-local',
    databases: databases.size,
  }))
  // Query endpoint (read)
  .post(
    '/v1/query',
    ({ body }) => {
      try {
        return executeQuery(body as QueryBody)
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          executionTime: 0,
          blockHeight,
        }
      }
    },
    {
      body: t.Object({
        sql: t.String(),
        params: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        databaseId: t.Optional(t.String()),
      }),
    },
  )
  .post('/api/v1/query', ({ body }) => {
    try {
      return executeQuery(body as QueryBody)
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        executionTime: 0,
        blockHeight,
      }
    }
  })
  // Exec endpoint (write)
  .post(
    '/v1/exec',
    ({ body }) => {
      try {
        return executeQuery(body as QueryBody)
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          executionTime: 0,
          blockHeight,
        }
      }
    },
    {
      body: t.Object({
        sql: t.String(),
        params: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        databaseId: t.Optional(t.String()),
      }),
    },
  )
  .post('/api/v1/exec', ({ body }) => {
    try {
      return executeQuery(body as QueryBody)
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        executionTime: 0,
        blockHeight,
      }
    }
  })
  // Database management
  .get('/v1/databases', () => ({
    databases: Array.from(databases.keys()).map((id) => ({
      databaseId: id,
      status: 'active',
    })),
  }))
  .get('/api/v1/databases', () => ({
    databases: Array.from(databases.keys()).map((id) => ({
      databaseId: id,
      status: 'active',
    })),
  }))
  .post(
    '/v1/databases',
    ({ body }) => {
      const id =
        (body as { databaseId?: string }).databaseId ?? crypto.randomUUID()
      getOrCreateDatabase(id)
      return { success: true, databaseId: id }
    },
    {
      body: t.Object({
        databaseId: t.Optional(t.String()),
      }),
    },
  )
  .post('/api/v1/databases', ({ body }) => {
    const id =
      (body as { databaseId?: string }).databaseId ?? crypto.randomUUID()
    getOrCreateDatabase(id)
    return { success: true, databaseId: id }
  })
  .get(
    '/v1/databases/:id',
    ({ params }) => {
      const db = databases.get(params.id)
      if (!db) {
        return { error: 'Database not found', status: 404 }
      }
      const tables = db
        .prepare(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'",
        )
        .get() as { count: number }
      return {
        databaseId: params.id,
        status: 'active',
        tables: tables.count,
        mode: 'sqlite-compat',
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
  .get('/api/v1/databases/:id', ({ params }) => {
    const db = databases.get(params.id)
    if (!db) {
      return { error: 'Database not found', status: 404 }
    }
    const tables = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'")
      .get() as { count: number }
    return {
      databaseId: params.id,
      status: 'active',
      tables: tables.count,
      mode: 'sqlite-compat',
    }
  })

// Start server
app.listen(PORT, () => {
  console.log(`EQLite Server (SQLite-compat) running on http://localhost:${PORT}`)
  console.log(`  Data directory: ${DATA_DIR}`)
  console.log(`  Mode: local development`)
  console.log(`  Health: http://localhost:${PORT}/health`)
})

export { app }
