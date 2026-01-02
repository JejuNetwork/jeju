/**
 * Simple SQLit HTTP Adapter
 *
 * Provides the same HTTP API as the full SQLit adapter but uses local SQLite3 for storage.
 * This is suitable for testnet/development where full decentralization isn't required.
 *
 * API Endpoints:
 * - POST /v1/query - Execute SELECT queries
 * - POST /v1/exec - Execute INSERT/UPDATE/DELETE queries
 * - GET /v1/status - Health check
 * - POST /v1/admin/create - Create a new database
 * - DELETE /v1/admin/drop - Drop a database
 */

import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Elysia } from 'elysia'

const PORT = parseInt(process.env.PORT ?? '8546', 10)

// Default data directory - use local directory for development
const DATA_DIR =
  process.env.DATA_DIR ??
  (process.env.NODE_ENV === 'production'
    ? '/data/sqlit/databases'
    : join(import.meta.dir, '..', '.data', 'databases'))

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// Database cache
const dbCache = new Map<string, Database>()

function getDatabase(dbid: string): Database {
  let db = dbCache.get(dbid)
  if (!db) {
    const dbPath = join(DATA_DIR, `${dbid}.db`)
    db = new Database(dbPath, { create: true })
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    dbCache.set(dbid, db)
  }
  return db
}

interface QueryRequest {
  database: string
  query: string
  assoc?: boolean
  args?: unknown[]
}

const app = new Elysia()
  // Health check
  .get('/v1/status', () => ({
    status: 'ok',
    success: true,
    data: {
      storage: 'sqlite3',
      databases: dbCache.size,
    },
  }))

  // Execute SELECT query
  .post('/v1/query', ({ body }) => {
    const req = body as QueryRequest
    if (!req.database || !req.query) {
      return {
        success: false,
        status: 'Missing database or query parameter',
        data: null,
      }
    }

    try {
      const db = getDatabase(req.database)
      const stmt = db.prepare(req.query)
      const rows = stmt.all(...(req.args ?? []))

      return {
        success: true,
        status: 'ok',
        data: {
          rows: rows as Record<string, unknown>[],
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[SQLit] Query error: ${message}`)
      return {
        success: false,
        status: message,
        data: null,
      }
    }
  })

  // Execute write query (INSERT, UPDATE, DELETE)
  .post('/v1/exec', ({ body }) => {
    const req = body as QueryRequest
    if (!req.database || !req.query) {
      return {
        success: false,
        status: 'Missing database or query parameter',
        data: null,
      }
    }

    try {
      const db = getDatabase(req.database)
      const result = db.run(req.query, ...(req.args ?? []))

      return {
        success: true,
        status: 'ok',
        data: {
          last_insert_id: Number(result.lastInsertRowid),
          affected_rows: result.changes,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[SQLit] Exec error: ${message}`)
      return {
        success: false,
        status: message,
        data: null,
      }
    }
  })

  // Create a new database
  .post('/v1/admin/create', ({ query }) => {
    const nodeCnt = parseInt(query.node ?? '1', 10)
    if (Number.isNaN(nodeCnt) || nodeCnt <= 0) {
      return {
        success: false,
        status: 'Invalid node count',
        data: null,
      }
    }

    // Generate a random database ID
    const randBytes = randomBytes(32)
    const dbID = createHash('sha256').update(randBytes).digest('hex')

    // Create the database
    const db = getDatabase(dbID)
    db.exec('SELECT 1') // Ensure it's created

    console.log(`[SQLit] Created database: ${dbID}`)

    return {
      success: true,
      status: 'created',
      data: {
        database: dbID,
      },
    }
  })

  // Drop a database
  .delete('/v1/admin/drop', ({ query }) => {
    const dbID = query.database
    if (!dbID) {
      return {
        success: false,
        status: 'Missing database parameter',
        data: null,
      }
    }

    // Close and remove from cache
    const db = dbCache.get(dbID)
    if (db) {
      db.close()
      dbCache.delete(dbID)
    }

    // Delete the file
    const dbPath = join(DATA_DIR, `${dbID}.db`)
    if (existsSync(dbPath)) {
      rmSync(dbPath)
    }

    console.log(`[SQLit] Dropped database: ${dbID}`)

    return {
      success: true,
      status: 'ok',
      data: {},
    }
  })

  .listen(PORT, () => {
    console.log(`[SQLit Adapter] Listening on port ${PORT}`)
    console.log(`[SQLit Adapter] Data directory: ${DATA_DIR}`)
    console.log(`[SQLit Adapter] Storage: sqlite3`)
  })

export { app }
