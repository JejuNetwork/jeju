/**
 * Secure Database Provisioning for DWS
 *
 * Each app gets its own isolated SQLit database with:
 * - Unique database ID
 * - Owner-based access control
 * - Signed request authentication
 * - ACL enforcement for multi-tenant access
 */

import { type SQLitClient, getSQLit } from '@jejunetwork/db'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'
import { z } from 'zod'

// Types

interface ProvisionedDatabase {
  databaseId: string
  owner: Address
  appName: string
  createdAt: number
  status: 'active' | 'suspended' | 'deleted'
  accessKeys: DatabaseAccessKey[]
}

interface DatabaseAccessKey {
  keyId: string
  name: string
  permissions: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL')[]
  tables: string[] | '*'
  createdAt: number
  expiresAt?: number
  revokedAt?: number
}

import type { JSONValue } from '../shared/validation'

interface SignedRequest {
  /** The actual request payload */
  payload: {
    database: string
    type: 'query' | 'exec'
    sql: string
    params: JSONValue[]
    timestamp: number
  }
  /** Signature over the payload */
  signature: Hex
  /** Signer's address (must be owner or have ACL grant) */
  signer: Address
}

// Storage (using SQLit meta-database)

const META_DATABASE_ID = 'dws-database-registry'

let sqlitClient: SQLitClient | null = null

async function getSQLitClient(): Promise<SQLitClient> {
  if (!sqlitClient) {
    sqlitClient = getSQLit()
    await ensureMetaTables()
  }
  return sqlitClient
}

async function ensureMetaTables(): Promise<void> {
  if (!sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS provisioned_databases (
      database_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    )`,
    `CREATE TABLE IF NOT EXISTS database_access_keys (
      key_id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL,
      name TEXT NOT NULL,
      grantee TEXT NOT NULL,
      permissions TEXT NOT NULL,
      tables TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS database_acl (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL,
      grantee TEXT NOT NULL,
      table_name TEXT NOT NULL,
      permissions TEXT NOT NULL,
      condition TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_db_owner ON provisioned_databases(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_db_app ON provisioned_databases(app_name)`,
    `CREATE INDEX IF NOT EXISTS idx_keys_db ON database_access_keys(database_id)`,
    `CREATE INDEX IF NOT EXISTS idx_acl_db ON database_acl(database_id)`,
    `CREATE INDEX IF NOT EXISTS idx_acl_grantee ON database_acl(grantee)`,
  ]

  for (const sql of tables) {
    await sqlitClient.exec(sql, [], META_DATABASE_ID)
  }
}

// Request Validation

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Verify a signed SQLit request
 */
export async function verifySignedRequest(
  request: SignedRequest,
): Promise<{ valid: boolean; error?: string }> {
  // Check timestamp freshness
  const age = Date.now() - request.payload.timestamp
  if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
    return { valid: false, error: 'Request timestamp expired or in future' }
  }

  // Verify signature
  const message = JSON.stringify(request.payload)
  const isValid = await verifyMessage({
    address: request.signer,
    message,
    signature: request.signature,
  })

  if (!isValid) {
    return { valid: false, error: 'Invalid signature' }
  }

  // Check if signer has permission to access this database
  const hasAccess = await checkDatabaseAccess(
    request.payload.database,
    request.signer,
    request.payload.type === 'exec' ? 'write' : 'read',
  )

  if (!hasAccess) {
    return { valid: false, error: 'Access denied to database' }
  }

  return { valid: true }
}

/**
 * Check if an address has access to a database
 */
async function checkDatabaseAccess(
  databaseId: string,
  address: Address,
  accessType: 'read' | 'write',
): Promise<boolean> {
  const client = await getSQLitClient()

  // Check if user is owner
  const ownerResult = await client.query<{ owner: string }>(
    'SELECT owner FROM provisioned_databases WHERE database_id = ? AND status = ?',
    [databaseId, 'active'],
    META_DATABASE_ID,
  )

  if (ownerResult.rows.length > 0) {
    if (ownerResult.rows[0].owner.toLowerCase() === address.toLowerCase()) {
      return true // Owner has full access
    }
  }

  // Check ACL grants
  const aclResult = await client.query<{ permissions: string }>(
    'SELECT permissions FROM database_acl WHERE database_id = ? AND (grantee = ? OR grantee = ?)',
    [databaseId, address.toLowerCase(), '*'],
    META_DATABASE_ID,
  )

  if (aclResult.rows.length === 0) {
    return false
  }

  // Check if any grant provides the needed permission
  const requiredPermissions =
    accessType === 'write'
      ? ['INSERT', 'UPDATE', 'DELETE', 'ALL']
      : ['SELECT', 'ALL']

  const PermissionsSchema = z.array(z.string())
  for (const row of aclResult.rows) {
    const parseResult = PermissionsSchema.safeParse(JSON.parse(row.permissions))
    if (!parseResult.success) continue
    if (parseResult.data.some((p) => requiredPermissions.includes(p))) {
      return true
    }
  }

  return false
}

// Database Provisioning

const provisionRequestSchema = z.object({
  appName: z.string().min(1).max(64),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  timestamp: z.number().int().positive(),
  schema: z.string().optional(),
})

/**
 * Provision a new database for an app
 *
 * Note: SQLit databases are created on-demand when first accessed.
 * This function registers the database for ACL tracking.
 */
export async function provisionDatabase(params: {
  appName: string
  owner: Address
  schema?: string
}): Promise<ProvisionedDatabase> {
  const client = await getSQLitClient()

  // Generate unique database ID
  const databaseId = `${params.appName.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`

  // Register in meta database
  await client.exec(
    `INSERT INTO provisioned_databases (database_id, owner, app_name, created_at, status)
     VALUES (?, ?, ?, ?, ?)`,
    [
      databaseId,
      params.owner.toLowerCase(),
      params.appName,
      Date.now(),
      'active',
    ],
    META_DATABASE_ID,
  )

  // Grant owner full access
  await client.exec(
    `INSERT INTO database_acl (id, database_id, grantee, table_name, permissions, condition, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      databaseId,
      params.owner.toLowerCase(),
      '*',
      JSON.stringify(['ALL']),
      null,
      Date.now(),
    ],
    META_DATABASE_ID,
  )

  // If schema provided, create tables in the new database
  if (params.schema) {
    // Split schema into individual statements and execute each
    const statements = params.schema.split(';').filter((s) => s.trim())
    for (const stmt of statements) {
      await client.exec(stmt.trim(), [], databaseId)
    }
  }

  return {
    databaseId,
    owner: params.owner,
    appName: params.appName,
    createdAt: Date.now(),
    status: 'active',
    accessKeys: [],
  }
}

/**
 * Grant access to a database
 */
export async function grantDatabaseAccess(params: {
  databaseId: string
  grantee: Address
  tables: string[] | '*'
  permissions: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL')[]
  condition?: string
  requestedBy: Address
}): Promise<void> {
  // Verify requester is owner
  const client = await getSQLitClient()
  const ownerResult = await client.query<{ owner: string }>(
    'SELECT owner FROM provisioned_databases WHERE database_id = ?',
    [params.databaseId],
    META_DATABASE_ID,
  )

  if (ownerResult.rows.length === 0) {
    throw new Error('Database not found')
  }

  if (
    ownerResult.rows[0].owner.toLowerCase() !== params.requestedBy.toLowerCase()
  ) {
    throw new Error('Only database owner can grant access')
  }

  // Add ACL entry
  const tables = params.tables === '*' ? '*' : params.tables.join(',')
  await client.exec(
    `INSERT INTO database_acl (id, database_id, grantee, table_name, permissions, condition, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      params.databaseId,
      params.grantee.toLowerCase(),
      tables,
      JSON.stringify(params.permissions),
      params.condition ?? null,
      Date.now(),
    ],
    META_DATABASE_ID,
  )
}

/**
 * Revoke access from a database
 */
export async function revokeDatabaseAccess(params: {
  databaseId: string
  grantee: Address
  requestedBy: Address
}): Promise<void> {
  const client = await getSQLitClient()

  // Verify requester is owner
  const ownerResult = await client.query<{ owner: string }>(
    'SELECT owner FROM provisioned_databases WHERE database_id = ?',
    [params.databaseId],
    META_DATABASE_ID,
  )

  if (ownerResult.rows.length === 0) {
    throw new Error('Database not found')
  }

  if (
    ownerResult.rows[0].owner.toLowerCase() !== params.requestedBy.toLowerCase()
  ) {
    throw new Error('Only database owner can revoke access')
  }

  await client.exec(
    'DELETE FROM database_acl WHERE database_id = ? AND grantee = ?',
    [params.databaseId, params.grantee.toLowerCase()],
    META_DATABASE_ID,
  )
}

/**
 * List databases owned by an address
 */
export async function listDatabases(
  owner: Address,
): Promise<ProvisionedDatabase[]> {
  const client = await getSQLitClient()
  const result = await client.query<{
    database_id: string
    owner: string
    app_name: string
    created_at: number
    status: string
  }>(
    'SELECT * FROM provisioned_databases WHERE owner = ? AND status = ?',
    [owner.toLowerCase(), 'active'],
    META_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    databaseId: row.database_id,
    owner: row.owner as Address,
    appName: row.app_name,
    createdAt: row.created_at,
    status: row.status as 'active' | 'suspended' | 'deleted',
    accessKeys: [],
  }))
}

// Router

export function createDatabaseRouter() {
  return new Elysia({ prefix: '/database' })
    .post('/provision', async ({ body, set }) => {
      const parsed = provisionRequestSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { error: 'Invalid request', details: parsed.error.issues }
      }

      const { appName, owner, signature, timestamp } = parsed.data

      // Verify signature
      const message = JSON.stringify({ appName, owner, timestamp })
      const isValid = await verifyMessage({
        address: owner as Address,
        message,
        signature: signature as Hex,
      })

      if (!isValid) {
        set.status = 401
        return { error: 'Invalid signature' }
      }

      // Check timestamp
      if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) {
        set.status = 401
        return { error: 'Request expired' }
      }

      const db = await provisionDatabase({
        appName,
        owner: owner as Address,
        schema: parsed.data.schema,
      })

      return {
        success: true,
        database: db,
      }
    })

    .post('/grant', async ({ body, set }) => {
      const schema = z.object({
        databaseId: z.string(),
        grantee: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        tables: z.union([z.array(z.string()), z.literal('*')]),
        permissions: z.array(
          z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']),
        ),
        condition: z.string().optional(),
        owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
        timestamp: z.number().int().positive(),
      })

      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { error: 'Invalid request', details: parsed.error.issues }
      }

      const {
        databaseId,
        grantee,
        tables,
        permissions,
        condition,
        owner,
        signature,
        timestamp,
      } = parsed.data

      // Verify signature
      const message = JSON.stringify({
        databaseId,
        grantee,
        tables,
        permissions,
        condition,
        timestamp,
      })
      const isValid = await verifyMessage({
        address: owner as Address,
        message,
        signature: signature as Hex,
      })

      if (!isValid) {
        set.status = 401
        return { error: 'Invalid signature' }
      }

      await grantDatabaseAccess({
        databaseId,
        grantee: grantee as Address,
        tables,
        permissions,
        condition,
        requestedBy: owner as Address,
      })

      return { success: true }
    })

    .post('/revoke', async ({ body, set }) => {
      const schema = z.object({
        databaseId: z.string(),
        grantee: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
        timestamp: z.number().int().positive(),
      })

      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { error: 'Invalid request', details: parsed.error.issues }
      }

      const { databaseId, grantee, owner, signature, timestamp } = parsed.data

      // Verify signature
      const message = JSON.stringify({ databaseId, grantee, timestamp })
      const isValid = await verifyMessage({
        address: owner as Address,
        message,
        signature: signature as Hex,
      })

      if (!isValid) {
        set.status = 401
        return { error: 'Invalid signature' }
      }

      await revokeDatabaseAccess({
        databaseId,
        grantee: grantee as Address,
        requestedBy: owner as Address,
      })

      return { success: true }
    })

    .get('/list/:owner', async ({ params }) => {
      const databases = await listDatabases(params.owner as Address)
      return { databases }
    })

    .get('/health', () => ({
      service: 'dws-database-provisioning',
      status: 'healthy',
    }))
}
