/**
 * Mock CQL Server for Local Development
 *
 * Provides a CQL-compatible HTTP API backed by SQLite.
 * Starts automatically when CQL is unavailable in localnet.
 *
 * Usage: bun run packages/db/src/mock-cql-server.ts
 */

import { Database } from 'bun:sqlite'
import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { parsePort, sanitizeRows } from './utils.js'

const DEFAULT_PORT = 4661
const DEFAULT_DATA_DIR = '.cql-data'
const PORT = parsePort(process.env.CQL_PORT, DEFAULT_PORT)
const DATA_DIR = process.env.CQL_DATA_DIR ?? DEFAULT_DATA_DIR

// Request validation schema
const CQLRequestSchema = z
  .object({
    database: z.string().optional(),
    database_id: z.string().optional(),
    type: z.enum(['query', 'exec']).optional(),
    query: z.string().optional(),
    sql: z.string().optional(),
    params: z
      .array(z.union([z.string(), z.number(), z.null(), z.boolean()]))
      .optional(),
  })
  .refine((data) => data.database ?? data.database_id, {
    message: 'Either database or database_id is required',
  })
  .refine((data) => data.sql ?? data.query, {
    message: 'Either sql or query is required',
  })

// Create database schema
const CreateDbSchema = z.object({
  database_id: z.string().min(1),
})

// Ensure data directory exists
await Bun.write(`${DATA_DIR}/.gitkeep`, '')

// Database instances per database ID
const databases = new Map<string, InstanceType<typeof Database>>()

function getDb(databaseId: string): InstanceType<typeof Database> {
  const existing = databases.get(databaseId)
  if (existing) {
    return existing
  }

  const dbPath = `${DATA_DIR}/${databaseId}.sqlite`
  const db = new Database(dbPath, { create: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA synchronous = NORMAL')
  databases.set(databaseId, db)
  console.log(`[CQL Mock] Created database: ${databaseId} at ${dbPath}`)
  return db
}

// Health check handler
function handleHealth() {
  return { status: 'healthy', mode: 'mock-sqlite' }
}

// Status handler
function handleStatus() {
  return {
    status: 'healthy',
    mode: 'mock-sqlite',
    blockHeight: 0,
    version: '1.0.0-mock',
  }
}

// Combined query/exec handler - CQL client sends both to same endpoint
function handleCQLQuery(rawBody: unknown, set: { status?: number | string }) {
  const parseResult = CQLRequestSchema.safeParse(rawBody)
  if (!parseResult.success) {
    set.status = 400
    return { success: false, error: parseResult.error.message }
  }

  const body = parseResult.data

  // Both are guaranteed by the refine validators
  const databaseId = (body.database ?? body.database_id) as string
  const sql = (body.sql ?? body.query) as string
  const params = body.params ?? []

  const isExec =
    body.type === 'exec' ||
    sql
      .trim()
      .toUpperCase()
      .match(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/)

  const db = getDb(databaseId)
  const start = performance.now()

  const stmt = db.prepare(sql)

  if (isExec) {
    const result = stmt.run(...params)
    const executionTime = Math.round(performance.now() - start)

    return {
      success: true,
      rowsAffected: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
      executionTime,
      blockHeight: 0,
    }
  } else {
    const rawRows = stmt.all(...params) as Record<string, unknown>[]
    // Sanitize rows to prevent prototype pollution attacks
    const rows = sanitizeRows(rawRows)
    const executionTime = Math.round(performance.now() - start)

    return {
      success: true,
      rows,
      rowCount: rows.length,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      executionTime,
      blockHeight: 0,
    }
  }
}

// Database info handler
function handleDbInfo(id: string) {
  const db = getDb(id)
  // Get table count
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[]

  return {
    databaseId: id,
    status: 'active',
    tables: tables.length,
    mode: 'mock-sqlite',
  }
}

// List databases handler
function handleListDbs() {
  const dbs = Array.from(databases.keys()).map((id) => ({
    databaseId: id,
    status: 'active',
  }))
  return { databases: dbs }
}

// Create database handler
function handleCreateDb(rawBody: unknown) {
  const body = CreateDbSchema.parse(rawBody)
  getDb(body.database_id)
  return { success: true, databaseId: body.database_id }
}

// SECURITY: Restrict CORS to localhost in mock server (dev only)
// This server should NEVER be exposed to the internet
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5173',
]

const app = new Elysia()
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        // Allow requests without origin (same-origin) or from allowed localhost origins
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          return true
        }
        console.warn(`[CQL Mock] Blocked CORS request from: ${origin}`)
        return false
      },
    }),
  )
  // Health check routes
  .get('/v1/health', handleHealth)
  .get('/api/v1/health', handleHealth)
  .get('/health', handleHealth)
  // Status routes
  .get('/v1/status', handleStatus)
  .get('/api/v1/status', handleStatus)
  // Query/exec routes
  .post('/v1/query', ({ body, set }) => handleCQLQuery(body, set))
  .post('/api/v1/query', ({ body, set }) => handleCQLQuery(body, set))
  .post('/v1/exec', ({ body, set }) => handleCQLQuery(body, set))
  .post('/api/v1/exec', ({ body, set }) => handleCQLQuery(body, set))
  // Database info routes
  .get('/v1/databases/:id', ({ params }) => handleDbInfo(params.id))
  .get('/api/v1/databases/:id', ({ params }) => handleDbInfo(params.id))
  // List databases routes
  .get('/v1/databases', handleListDbs)
  .get('/api/v1/databases', handleListDbs)
  // Create database routes
  .post('/v1/databases', ({ body }) => handleCreateDb(body))
  .post('/api/v1/databases', ({ body }) => handleCreateDb(body))

console.log(`
╔════════════════════════════════════════════════════════════╗
║              CQL Mock Server (SQLite Backend)              ║
╠════════════════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(51)}║
║  Data: ${DATA_DIR.padEnd(51)}║
║  Mode: Development (SQLite)                                ║
║                                                            ║
║  This provides a CQL-compatible API for local development. ║
║  Data persists in .cql-data/ directory.                    ║
╚════════════════════════════════════════════════════════════╝
`)

app.listen(PORT)

export { app }
