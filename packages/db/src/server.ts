/**
 * Local CQL Development Server
 *
 * SQLite-backed server implementing the CQL block producer API for local development.
 * This provides a real database instead of a mock.
 */

import { Database as SQLiteDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { parseBoolean, parsePort, sanitizeRows } from './utils.js'

// Request body schemas
const CreateDatabaseRequestSchema = z.object({
  nodeCount: z.number().int().positive().default(1),
  schema: z.string().default(''),
  owner: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default('0x0000000000000000000000000000000000000000'),
  paymentToken: z.string().optional(),
})

// Maximum rows returned per query to prevent DoS via unbounded result sets
const MAX_QUERY_ROWS = 10000

const QueryRequestSchema = z.object({
  database: z.string(),
  type: z.enum(['query', 'exec']),
  sql: z.string(),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
})

const ACLGrantRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  permissions: z.array(z.string()),
})

const ACLRevokeRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

interface DatabaseRecord {
  id: string
  owner: string
  schema: string
  nodeCount: number
  createdAt: number
  status: 'active' | 'suspended' | 'deleted'
}

interface CQLServerConfig {
  port: number
  dataDir: string
  debug?: boolean
}

export class CQLServer {
  private databases = new Map<string, SQLiteDatabase>()
  private registry: SQLiteDatabase
  private config: CQLServerConfig
  private blockHeight = 0
  private server?: ReturnType<typeof Bun.serve>

  constructor(config: CQLServerConfig) {
    this.config = config

    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true })
    }

    // Initialize registry database (tracks all databases)
    const registryPath = join(config.dataDir, '_registry.sqlite')
    this.registry = new SQLiteDatabase(registryPath)
    this.initRegistry()

    // Load existing databases
    this.loadDatabases()
  }

  private initRegistry(): void {
    this.registry.exec(`
      CREATE TABLE IF NOT EXISTS databases (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        schema TEXT,
        node_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      );
      
      CREATE TABLE IF NOT EXISTS acl (
        database_id TEXT NOT NULL,
        address TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (database_id, address)
      );
      
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        tx_count INTEGER DEFAULT 0,
        hash TEXT
      );
    `)

    // Get current block height - MAX returns null if no rows
    const result = this.registry
      .query('SELECT MAX(height) as height FROM blocks')
      .get() as { height: number | null } | null
    this.blockHeight = result?.height ?? 0

    // Add genesis block if needed
    if (this.blockHeight === 0) {
      this.registry.run(
        'INSERT OR IGNORE INTO blocks (height, timestamp, tx_count, hash) VALUES (?, ?, ?, ?)',
        [0, Date.now(), 0, `0x${'0'.repeat(64)}`],
      )
    }
  }

  private loadDatabases(): void {
    const dbs = this.registry
      .query('SELECT * FROM databases WHERE status = ?')
      .all('active') as DatabaseRecord[]
    for (const record of dbs) {
      this.openDatabase(record.id)
    }
  }

  private openDatabase(id: string): SQLiteDatabase {
    const existing = this.databases.get(id)
    if (existing) {
      return existing
    }
    const dbPath = join(this.config.dataDir, `${id}.sqlite`)
    const db = new SQLiteDatabase(dbPath)
    this.databases.set(id, db)
    return db
  }

  private addBlock(txCount: number = 1): number {
    const hash =
      '0x' +
      Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
    // Use atomic INSERT...SELECT to prevent race conditions
    // This ensures we always get the correct next height even under concurrent load
    this.registry.run(
      `INSERT INTO blocks (height, timestamp, tx_count, hash) 
       SELECT COALESCE(MAX(height), 0) + 1, ?, ?, ? FROM blocks`,
      [Date.now(), txCount, hash],
    )
    // Update cached height from database to ensure consistency
    const result = this.registry
      .query('SELECT MAX(height) as height FROM blocks')
      .get() as { height: number | null } | null
    this.blockHeight = result?.height ?? 0
    return this.blockHeight
  }

  start(): void {
    this.server = Bun.serve({
      port: this.config.port,

      fetch: async (req): Promise<Response> => {
        const url = new URL(req.url)
        const method = req.method

        // Health check
        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            type: 'sqlite',
            blockHeight: this.blockHeight,
            databases: this.databases.size,
            dataDir: this.config.dataDir,
          })
        }

        // Block producer status
        if (url.pathname === '/api/v1/status') {
          return Response.json({
            blockHeight: this.blockHeight,
            nodeCount: 1,
            status: 'running',
            type: 'sqlite-dev',
            databases: this.databases.size,
          })
        }

        // Query/Exec endpoint
        if (url.pathname === '/api/v1/query' && method === 'POST') {
          const rawBody = await req.json()
          const body = QueryRequestSchema.parse(rawBody)

          const { database: dbId, type, sql, params } = body

          // Get or create database
          let db = this.databases.get(dbId)
          if (!db) {
            // Auto-create database for development convenience
            db = this.openDatabase(dbId)
            this.registry.run(
              'INSERT OR IGNORE INTO databases (id, owner, created_at) VALUES (?, ?, ?)',
              [dbId, '0x0000000000000000000000000000000000000000', Date.now()],
            )
          }

          const startTime = Date.now()

          if (type === 'query') {
            const stmt = db.query(sql)
            const rawRows = params ? stmt.all(...params) : stmt.all()
            // Enforce row limit to prevent DoS via unbounded result sets
            const truncated = rawRows.length > MAX_QUERY_ROWS
            const limitedRows = truncated
              ? rawRows.slice(0, MAX_QUERY_ROWS)
              : rawRows
            // Sanitize rows to prevent prototype pollution attacks
            const rows = sanitizeRows(limitedRows as Record<string, unknown>[])
            const columns =
              rows.length > 0 ? Object.keys(rows[0] as object) : []

            return Response.json({
              rows,
              rowCount: rows.length,
              columns,
              executionTime: Date.now() - startTime,
              blockHeight: this.blockHeight,
              ...(truncated && { truncated: true, totalRows: rawRows.length }),
            })
          } else {
            const stmt = db.prepare(sql)
            const result = params ? stmt.run(...params) : stmt.run()
            const height = this.addBlock()
            const txHash =
              '0x' +
              Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
                'hex',
              )

            return Response.json({
              rowsAffected: result.changes,
              lastInsertId: result.lastInsertRowid?.toString(),
              txHash,
              blockHeight: height,
              gasUsed: '21000',
            })
          }
        }

        // Create database
        if (url.pathname === '/api/v1/databases' && method === 'POST') {
          const rawBody = await req.json()
          const body = CreateDatabaseRequestSchema.parse(rawBody)

          const id = `db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

          this.registry.run(
            'INSERT INTO databases (id, owner, schema, node_count, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, body.owner, body.schema, body.nodeCount, Date.now()],
          )

          const db = this.openDatabase(id)

          // Execute schema if provided - only allow safe DDL statements
          if (body.schema) {
            const statements = body.schema
              .split(';')
              .filter((s: string) => s.trim())
            // Allowed DDL patterns - only CREATE TABLE and CREATE INDEX
            const ALLOWED_DDL_PATTERN =
              /^\s*(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX))\s+/i
            // Dangerous patterns that should never be in schema
            const DANGEROUS_PATTERNS = [
              /\bDROP\b/i,
              /\bDELETE\b/i,
              /\bINSERT\b/i,
              /\bUPDATE\b/i,
              /\bTRUNCATE\b/i,
              /\bALTER\b/i,
              /\bEXEC\b/i,
              /\bATTACH\b/i,
              /\bDETACH\b/i,
              /\bPRAGMA\b/i,
              /\bVACUUM\b/i,
            ]

            for (const stmt of statements) {
              const trimmed = stmt.trim()
              if (!trimmed) continue

              // Verify it's a safe DDL statement
              if (!ALLOWED_DDL_PATTERN.test(trimmed)) {
                throw new Error(
                  `Schema must contain only CREATE TABLE or CREATE INDEX statements`,
                )
              }

              // Double-check for dangerous patterns that might be embedded
              for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(trimmed)) {
                  throw new Error(`Schema contains prohibited SQL keyword`)
                }
              }

              db.exec(trimmed)
            }
          }

          this.addBlock()

          return Response.json({
            id,
            owner: body.owner,
            nodeCount: body.nodeCount,
            status: 'active',
            createdAt: Date.now(),
          })
        }

        // List databases
        if (url.pathname === '/api/v1/databases' && method === 'GET') {
          const owner = url.searchParams.get('owner')
          let dbs: DatabaseRecord[]

          if (owner) {
            dbs = this.registry
              .query('SELECT * FROM databases WHERE owner = ? AND status = ?')
              .all(owner, 'active') as DatabaseRecord[]
          } else {
            dbs = this.registry
              .query('SELECT * FROM databases WHERE status = ?')
              .all('active') as DatabaseRecord[]
          }

          return Response.json({
            databases: dbs.map((d) => ({
              id: d.id,
              owner: d.owner,
              nodeCount: d.nodeCount,
              status: d.status,
              createdAt: d.createdAt,
            })),
          })
        }

        // Get database
        const dbMatch = url.pathname.match(/^\/api\/v1\/databases\/([^/]+)$/)
        if (dbMatch && method === 'GET') {
          const dbId = dbMatch[1]
          const db = this.registry
            .query('SELECT * FROM databases WHERE id = ?')
            .get(dbId) as DatabaseRecord | null

          if (!db) {
            return Response.json(
              { error: 'Database not found' },
              { status: 404 },
            )
          }

          return Response.json({
            id: db.id,
            owner: db.owner,
            nodeCount: db.nodeCount,
            status: db.status,
            createdAt: db.createdAt,
          })
        }

        // Delete database
        if (dbMatch && method === 'DELETE') {
          const dbId = dbMatch[1]
          this.registry.run('UPDATE databases SET status = ? WHERE id = ?', [
            'deleted',
            dbId,
          ])
          this.databases.get(dbId)?.close()
          this.databases.delete(dbId)
          this.addBlock()
          return new Response(null, { status: 204 })
        }

        // ACL - Grant
        const aclGrantMatch = url.pathname.match(
          /^\/api\/v1\/databases\/([^/]+)\/acl\/grant$/,
        )
        if (aclGrantMatch && method === 'POST') {
          const dbId = aclGrantMatch[1]
          const rawBody = await req.json()
          const body = ACLGrantRequestSchema.parse(rawBody)

          this.registry.run(
            'INSERT OR REPLACE INTO acl (database_id, address, permissions, created_at) VALUES (?, ?, ?, ?)',
            [dbId, body.address, JSON.stringify(body.permissions), Date.now()],
          )
          this.addBlock()

          return Response.json({ success: true })
        }

        // ACL - Revoke
        const aclRevokeMatch = url.pathname.match(
          /^\/api\/v1\/databases\/([^/]+)\/acl\/revoke$/,
        )
        if (aclRevokeMatch && method === 'POST') {
          const dbId = aclRevokeMatch[1]
          const rawBody = await req.json()
          const body = ACLRevokeRequestSchema.parse(rawBody)

          this.registry.run(
            'DELETE FROM acl WHERE database_id = ? AND address = ?',
            [dbId, body.address],
          )
          this.addBlock()

          return Response.json({ success: true })
        }

        // ACL - List
        const aclListMatch = url.pathname.match(
          /^\/api\/v1\/databases\/([^/]+)\/acl$/,
        )
        if (aclListMatch && method === 'GET') {
          const dbId = aclListMatch[1]
          const rules = this.registry
            .query(
              'SELECT address, permissions, created_at FROM acl WHERE database_id = ?',
            )
            .all(dbId) as {
            address: string
            permissions: string
            created_at: number
          }[]

          return Response.json({
            rules: rules.map((r) => ({
              address: r.address,
              permissions: JSON.parse(r.permissions),
              createdAt: r.created_at,
            })),
          })
        }

        // Plans (for rental)
        if (url.pathname === '/api/v1/plans' && method === 'GET') {
          return Response.json({
            plans: [
              {
                id: 'dev',
                name: 'Development',
                pricePerMonth: '0',
                nodeCount: 1,
                storage: '100MB',
              },
              {
                id: 'basic',
                name: 'Basic',
                pricePerMonth: '10',
                nodeCount: 3,
                storage: '1GB',
              },
              {
                id: 'pro',
                name: 'Professional',
                pricePerMonth: '50',
                nodeCount: 5,
                storage: '10GB',
              },
            ],
          })
        }

        // Metrics endpoint
        if (url.pathname === '/metrics') {
          const metrics = [
            '# HELP cql_block_height Current block height',
            '# TYPE cql_block_height gauge',
            `cql_block_height ${this.blockHeight}`,
            '# HELP cql_databases_total Total number of databases',
            '# TYPE cql_databases_total gauge',
            `cql_databases_total ${this.databases.size}`,
            '# HELP cql_queries_total Total queries executed',
            '# TYPE cql_queries_total counter',
            `cql_queries_total ${this.blockHeight * 10}`,
          ].join('\n')
          return new Response(metrics, {
            headers: { 'Content-Type': 'text/plain' },
          })
        }

        return Response.json({ error: 'Not found' }, { status: 404 })
      },
    })
  }

  stop(): void {
    this.server?.stop()
    this.registry.close()
    for (const db of this.databases.values()) {
      db.close()
    }
    this.databases.clear()
  }

  getBlockHeight(): number {
    return this.blockHeight
  }
}

const DEFAULT_SERVER_PORT = 4300
const DEFAULT_DATA_DIR = '.data/cql'

// Create and export server factory
export function createCQLServer(
  config: Partial<CQLServerConfig> = {},
): CQLServer {
  return new CQLServer({
    port: config.port ?? parsePort(process.env.CQL_PORT, DEFAULT_SERVER_PORT),
    dataDir: config.dataDir ?? process.env.CQL_DATA_DIR ?? DEFAULT_DATA_DIR,
    debug: config.debug ?? parseBoolean(process.env.CQL_DEBUG, false),
  })
}

// CLI entry point
if (import.meta.main) {
  const port = parsePort(
    process.env.PORT ?? process.env.CQL_PORT,
    DEFAULT_SERVER_PORT,
  )
  const dataDir = process.env.CQL_DATA_DIR ?? DEFAULT_DATA_DIR

  const server = createCQLServer({ port, dataDir, debug: true })
  server.start()

  process.on('SIGINT', () => {
    console.log('\n[CQL] Shutting down...')
    server.stop()
    process.exit(0)
  })
}
