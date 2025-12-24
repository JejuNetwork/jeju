/**
 * CQL Development Server
 *
 * SQLite-backed server that implements the CQL protocol for local development.
 * Production uses the full CovenantSQL network, but this allows offline dev.
 */

import { Database as SqliteDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import pino from 'pino'
import { z } from 'zod'

const log = pino({
  name: 'cql-server',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
})

// Configuration

const PORT = Number(process.env.PORT ?? process.env.CQL_PORT ?? 4400)
const DATA_DIR = process.env.CQL_DATA_DIR ?? './.data/cql'

// Database Management

const databases = new Map<string, SqliteDatabase>()
let blockHeight = 0

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
    log.info({ dir: DATA_DIR }, 'Created data directory')
  }
}

function getDatabase(dbId: string): SqliteDatabase {
  let db = databases.get(dbId)
  if (!db) {
    ensureDataDir()
    const dbPath = join(DATA_DIR, `${dbId}.sqlite`)
    const isNew = !existsSync(dbPath)

    // Ensure the directory for the database file exists
    const dbDir = dirname(dbPath)
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    db = new SqliteDatabase(dbPath)
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA synchronous = NORMAL')
    databases.set(dbId, db)

    if (isNew) {
      log.info({ dbId, path: dbPath }, 'Created new database')
    } else {
      log.info({ dbId, path: dbPath }, 'Opened existing database')
    }
  }
  return db
}

function closeAllDatabases(): void {
  for (const [id, db] of databases) {
    db.close()
    log.info({ dbId: id }, 'Closed database')
  }
  databases.clear()
}

// Request Schemas

const QueryRequestSchema = z.object({
  database: z.string().min(1),
  type: z.enum(['query', 'exec']),
  sql: z.string().min(1),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  timestamp: z.number().optional(),
})

// Server

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({
    status: 'ok',
    service: 'cql-dev',
    port: PORT,
    databases: databases.size,
    blockHeight,
  }))
  .get('/api/v1/status', () => {
    blockHeight++
    return {
      blockHeight,
      databases: databases.size,
      status: 'running',
      type: 'sqlite-dev',
      nodeCount: 1,
    }
  })
  .post('/api/v1/query', ({ body, set }) => {
    const parsed = QueryRequestSchema.safeParse(body)
    if (!parsed.success) {
      set.status = 400
      return { error: 'Invalid request', details: parsed.error.issues }
    }

    const { database, type, sql, params = [] } = parsed.data
    const startTime = Date.now()
    blockHeight++

    const db = getDatabase(database)

    if (type === 'query') {
      const stmt = db.prepare(sql)
      const rows = stmt.all(...params) as Record<
        string,
        string | number | boolean | null
      >[]
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []

      return {
        rows,
        rowCount: rows.length,
        columns,
        blockHeight,
        executionTime: Date.now() - startTime,
      }
    }

    // exec
    const stmt = db.prepare(sql)
    const result = stmt.run(...params)

    // Generate a deterministic tx hash from sql + params + blockHeight
    const txHashInput = `${sql}:${JSON.stringify(params)}:${blockHeight}`
    const txHash = `0x${Buffer.from(txHashInput).toString('hex').slice(0, 64).padEnd(64, '0')}`

    return {
      rowsAffected: result.changes,
      lastInsertId: result.lastInsertRowid?.toString(),
      txHash,
      blockHeight,
      gasUsed: '0',
    }
  })
  // Database management (simplified for dev)
  .get('/api/v1/databases', () => ({
    databases: Array.from(databases.keys()).map((id) => ({
      id,
      createdAt: Date.now(),
      owner: '0x0000000000000000000000000000000000000000',
      nodeCount: 1,
      consistencyMode: 'strong',
      status: 'running',
      blockHeight,
      sizeBytes: 0,
      monthlyCost: '0',
    })),
  }))
  .post('/api/v1/databases', ({ body, set }) => {
    const bodyObj = body as { owner?: string }
    const dbId = `db-${crypto.randomUUID()}`
    getDatabase(dbId) // Create the database

    set.status = 201
    return {
      id: dbId,
      createdAt: Date.now(),
      owner: bodyObj.owner ?? '0x0000000000000000000000000000000000000000',
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
  // Rental plans (mock for dev)
  .get('/api/v1/plans', () => ({
    plans: [
      {
        id: 'free',
        name: 'Free Tier',
        nodeCount: 1,
        storageBytes: '1073741824', // 1GB
        queriesPerMonth: '100000',
        pricePerMonth: '0',
        paymentToken: '0x0000000000000000000000000000000000000000',
      },
      {
        id: 'basic',
        name: 'Basic',
        nodeCount: 3,
        storageBytes: '10737418240', // 10GB
        queriesPerMonth: '1000000',
        pricePerMonth: '10000000000000000000', // 10 tokens
        paymentToken: '0x0000000000000000000000000000000000000000',
      },
    ],
  }))
  // Create rental (creates a database)
  .post('/api/v1/rentals', ({ body, set }) => {
    const bodyObj = body as { planId?: string; schema?: string }
    const dbId = `db-${crypto.randomUUID()}`
    const db = getDatabase(dbId)

    // Execute initial schema if provided
    if (bodyObj.schema) {
      db.run(bodyObj.schema)
    }

    const rentalId = `rental-${crypto.randomUUID()}`
    const now = Date.now()

    set.status = 201
    return {
      id: rentalId,
      databaseId: dbId,
      renter: '0x0000000000000000000000000000000000000000',
      planId: bodyObj.planId ?? 'free',
      startedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
      autoRenew: false,
      paymentStatus: 'current',
    }
  })
  // Error handler
  .onError(({ error, set }) => {
    log.error({ error }, 'Request error')
    set.status = 500
    return {
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  })

// Lifecycle

const shutdown = () => {
  log.info('Shutting down CQL server...')
  closeAllDatabases()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Start server
ensureDataDir()
app.listen(PORT)
log.info({ port: PORT, dataDir: DATA_DIR }, 'CQL development server started')

export { app }
