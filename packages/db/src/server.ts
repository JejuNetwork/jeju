/**
 * SQLit Server - SQLite-backed SQLit-compatible API
 *
 * Provides a local development server that mimics the SQLit HTTP API.
 * Used by `jeju dev`, `jeju test`, and `jeju start` when Docker is unavailable.
 *
 * Usage: bun run server
 */

import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cors } from '@elysiajs/cors'
import { getLocalhostHost, getSQLitPort } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'

const PORT = getSQLitPort()
const DATA_DIR =
  process.env.SQLIT_DATA_DIR ?? join(process.cwd(), '.data/sqlit')

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
  // Support both server formats (sql/params/databaseId) and Go adapter format (query/args/database)
  sql?: string
  query?: string
  params?: (string | number | boolean | null)[]
  args?: (string | number | boolean | null)[]
  databaseId?: string
  database?: string
  assoc?: boolean
}

function executeQuery(body: QueryBody): {
  success: boolean
  error?: string
  rows?: Record<string, unknown>[]
  rowCount?: number
  columns?: string[]
  rowsAffected?: number
  lastInsertId?: string
  txHash?: string
  gasUsed?: string
  executionTime: number
  blockHeight: number
} {
  const start = performance.now()
  
  // Support both formats: (databaseId/sql/params) and (database/query/args)
  const dbId = body.databaseId ?? body.database
  const db = dbId ? getOrCreateDatabase(dbId) : defaultDb

  const sqlStr = body.sql ?? body.query
  if (!sqlStr) {
    return {
      success: false,
      error: 'Missing sql or query parameter',
      executionTime: 0,
      blockHeight,
    }
  }
  
  const sql = sqlStr.trim()
  const params = body.params ?? body.args ?? []

  // Determine if this is a read query or a write query that returns rows
  const isRead = /^(SELECT|PRAGMA|EXPLAIN)/i.test(sql)
  const hasReturning = /RETURNING/i.test(sql)

  if (isRead || hasReturning) {
    const stmt = db.prepare(sql)
    const rows = stmt.all(...params) as Record<string, unknown>[]
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    // For INSERT/UPDATE/DELETE with RETURNING, also increment block height
    if (hasReturning && !isRead) {
      blockHeight++
    }

    return {
      success: true,
      rows,
      rowCount: rows.length,
      columns,
      executionTime: Math.round(performance.now() - start),
      blockHeight: blockHeight,
    }
  } else {
    const stmt = db.prepare(sql)
    const result = stmt.run(...params)
    blockHeight++ // Simulate block advancement on writes

    // Generate a pseudo-txHash for dev mode compatibility
    const pseudoTxHash = `0x${blockHeight.toString(16).padStart(64, '0')}`

    return {
      success: true,
      rowsAffected: result.changes,
      lastInsertId: String(result.lastInsertRowid),
      txHash: pseudoTxHash,
      gasUsed: '21000', // Standard gas for simple operations
      executionTime: Math.round(performance.now() - start),
      blockHeight: blockHeight,
    }
  }
}

const app = new Elysia()
  .use(cors())
  // Health check endpoints
  .get('/health', () => ({
    success: true,
    status: 'healthy',
    mode: 'sqlite-compat',
    port: PORT,
  }))
  .get('/v1/health', () => ({
    success: true,
    status: 'healthy',
    mode: 'sqlite-compat',
  }))
  .get('/api/v1/health', () => ({
    success: true,
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
  // Query endpoint (read) - accepts both (sql/params/databaseId) and (query/args/database)
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
          txHash: '0x0',
          gasUsed: '0',
          rowsAffected: 0,
        }
      }
    },
    {
      body: t.Object({
        sql: t.Optional(t.String()),
        query: t.Optional(t.String()),
        params: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        args: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        databaseId: t.Optional(t.String()),
        database: t.Optional(t.String()),
        assoc: t.Optional(t.Boolean()),
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
        txHash: '0x0',
        gasUsed: '0',
        rowsAffected: 0,
      }
    }
  })
  // Exec endpoint (write) - accepts both (sql/params/databaseId) and (query/args/database)
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
          txHash: '0x0',
          gasUsed: '0',
          rowsAffected: 0,
        }
      }
    },
    {
      body: t.Object({
        sql: t.Optional(t.String()),
        query: t.Optional(t.String()),
        params: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        args: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        databaseId: t.Optional(t.String()),
        database: t.Optional(t.String()),
        assoc: t.Optional(t.Boolean()),
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
        txHash: '0x0',
        gasUsed: '0',
        rowsAffected: 0,
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
  // ============ V2 API (for sqlit v2 client compatibility) ============
  .post(
    '/v2/execute',
    ({ body }) => {
      try {
        const req = body as {
          databaseId: string
          sql: string
          params?: (string | number | boolean | null)[]
        }
        const db = getOrCreateDatabase(req.databaseId)
        const sql = req.sql.trim()
        const params = req.params ?? []
        const start = performance.now()

        // Determine if this is a read or write query
        const isRead = /^(SELECT|PRAGMA|EXPLAIN)/i.test(sql)
        const hasReturning = /RETURNING/i.test(sql)

        if (isRead || hasReturning) {
          const stmt = db.prepare(sql)
          const rows = stmt.all(...params) as Record<string, unknown>[]
          const columns = rows.length > 0 ? Object.keys(rows[0]) : []

          if (hasReturning && !isRead) {
            blockHeight++
          }

          return {
            success: true,
            rows,
            rowCount: rows.length,
            columns,
            rowsAffected: 0,
            lastInsertId: '0',
            walPosition: String(blockHeight),
            executionTime: Math.round(performance.now() - start),
          }
        } else {
          const stmt = db.prepare(sql)
          const result = stmt.run(...params)
          blockHeight++

          return {
            success: true,
            rows: [],
            rowCount: 0,
            columns: [],
            rowsAffected: result.changes,
            lastInsertId: String(result.lastInsertRowid),
            walPosition: String(blockHeight),
            executionTime: Math.round(performance.now() - start),
          }
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          rows: [],
          rowCount: 0,
          columns: [],
          rowsAffected: 0,
          lastInsertId: '0',
          walPosition: String(blockHeight),
        }
      }
    },
    {
      body: t.Object({
        databaseId: t.String(),
        sql: t.String(),
        params: t.Optional(
          t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
        ),
        queryType: t.Optional(t.String()),
        timeoutMs: t.Optional(t.Number()),
        sessionId: t.Optional(t.String()),
        requiredWalPosition: t.Optional(t.String()),
        signature: t.Optional(t.String()),
        timestamp: t.Optional(t.Number()),
      }),
    },
  )
  .post(
    '/v2/batch',
    ({ body }) => {
      try {
        const req = body as {
          databaseId: string
          queries: Array<{
            sql: string
            params?: (string | number | boolean | null)[]
          }>
          transactional: boolean
        }
        const db = getOrCreateDatabase(req.databaseId)
        const results: Array<{
          success: boolean
          rows: Record<string, unknown>[]
          rowCount: number
          columns: string[]
          rowsAffected: number
          lastInsertId: string
          walPosition: string
        }> = []

        // Use transaction if requested
        if (req.transactional) {
          db.exec('BEGIN')
        }

        try {
          for (const query of req.queries) {
            const sql = query.sql.trim()
            const params = query.params ?? []
            const isRead = /^(SELECT|PRAGMA|EXPLAIN)/i.test(sql)

            if (isRead) {
              const stmt = db.prepare(sql)
              const rows = stmt.all(...params) as Record<string, unknown>[]
              const columns = rows.length > 0 ? Object.keys(rows[0]) : []
              results.push({
                success: true,
                rows,
                rowCount: rows.length,
                columns,
                rowsAffected: 0,
                lastInsertId: '0',
                walPosition: String(blockHeight),
              })
            } else {
              const stmt = db.prepare(sql)
              const result = stmt.run(...params)
              blockHeight++
              results.push({
                success: true,
                rows: [],
                rowCount: 0,
                columns: [],
                rowsAffected: result.changes,
                lastInsertId: String(result.lastInsertRowid),
                walPosition: String(blockHeight),
              })
            }
          }

          if (req.transactional) {
            db.exec('COMMIT')
          }
        } catch (err) {
          if (req.transactional) {
            db.exec('ROLLBACK')
          }
          throw err
        }

        return {
          success: true,
          results,
          walPosition: String(blockHeight),
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          results: [],
          walPosition: String(blockHeight),
        }
      }
    },
    {
      body: t.Object({
        databaseId: t.String(),
        queries: t.Array(
          t.Object({
            sql: t.String(),
            params: t.Optional(
              t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
            ),
          }),
        ),
        transactional: t.Boolean(),
      }),
    },
  )
  .get('/v2/databases', () => ({
    success: true,
    databases: Array.from(databases.keys()).map((id) => ({
      databaseId: id,
      status: 'active',
      sizeBytes: '0',
      rowCount: '0',
      walPosition: String(blockHeight),
    })),
  }))
  .get('/v2/databases/:id', ({ params }) => {
    const db = databases.get(params.id)
    if (!db) {
      return { success: false, error: 'Database not found' }
    }
    return {
      success: true,
      database: {
        databaseId: params.id,
        status: 'active',
        sizeBytes: '0',
        rowCount: '0',
        walPosition: String(blockHeight),
      },
    }
  })
  .post(
    '/v2/databases',
    ({ body }) => {
      const req = body as { name: string; schema?: string }
      const id = req.name || crypto.randomUUID()
      const db = getOrCreateDatabase(id)

      // Execute schema if provided
      if (req.schema) {
        try {
          db.exec(req.schema)
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }

      return { success: true, databaseId: id }
    },
    {
      body: t.Object({
        name: t.String(),
        encryptionMode: t.Optional(t.String()),
        replication: t.Optional(t.Any()),
        schema: t.Optional(t.String()),
      }),
    },
  )

// Start server
app.listen(PORT, () => {
  const host = getLocalhostHost()
  console.log(`SQLit Server (SQLite-compat) running on http://${host}:${PORT}`)
  console.log(`  Data directory: ${DATA_DIR}`)
  console.log(`  Mode: local development`)
  console.log(`  Health: http://${host}:${PORT}/health`)
})

export { app }
