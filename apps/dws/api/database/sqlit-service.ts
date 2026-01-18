/**
 * SQLit Service Integration
 *
 * Provides SQLit database connectivity for DWS.
 *
 * Modes of operation:
 * 1. K8s mode: Connect to sqlit-adapter K8s service
 * 2. External mode: Connect to configured SQLIT_URL
 * 3. Embedded mode: Run local Bun SQLite adapter (no Docker)
 *
 * No Docker dependency - works in serverless and K8s environments.
 */

import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  getSQLitBlockProducerUrl,
  getSQLitDataDir,
  isProductionEnv,
} from '@jejunetwork/config'
import type { Address } from 'viem'
import { z } from 'zod'

// Configuration
// K8s endpoint - can be overridden by SQLIT_BLOCK_PRODUCER_ENDPOINT env var
const K8S_SQLIT_ENDPOINT =
  process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT ||
  'http://sqlit-adapter.dws.svc.cluster.local:8546'
const DEFAULT_DATA_DIR = getSQLitDataDir()

// Runtime state
let sqlitEndpoint: string | null = null
const embeddedDatabases = new Map<string, Database>()
let initialized = false

/**
 * Detect if running in Kubernetes
 */
function isKubernetesEnvironment(): boolean {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST)
}

/**
 * Get the SQLit endpoint based on environment
 */
function resolveEndpoint(): string {
  // Check for explicit environment override first
  const envEndpoint =
    process.env.SQLIT_URL || process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT

  if (envEndpoint) {
    return envEndpoint
  }

  // K8s mode: use K8s service discovery
  if (isKubernetesEnvironment()) {
    // Check if the K8s service is reachable
    return K8S_SQLIT_ENDPOINT
  }

  // Get from config (network-aware)
  const configEndpoint = getSQLitBlockProducerUrl()

  // If config points to local, we'll use embedded mode
  if (
    configEndpoint.includes('127.0.0.1') ||
    configEndpoint.includes('localhost')
  ) {
    return `http://127.0.0.1:${process.env.SQLIT_PORT || '8546'}`
  }

  return configEndpoint
}

/**
 * Initialize embedded SQLite database for local development
 * Uses Bun's built-in SQLite - no external dependencies
 */
function getEmbeddedDatabase(dbid: string): Database {
  let db = embeddedDatabases.get(dbid)
  if (!db) {
    const dataDir = process.env.SQLIT_DATA_DIR || DEFAULT_DATA_DIR
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
    const dbPath = join(dataDir, `${dbid}.db`)
    db = new Database(dbPath, { create: true })
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    embeddedDatabases.set(dbid, db)
    console.log(`[SQLit] Created embedded database: ${dbPath}`)
  }
  return db
}

/**
 * Check if external SQLit endpoint is healthy
 */
async function checkEndpointHealth(endpoint: string): Promise<boolean> {
  try {
    // sqlit-adapter root endpoint returns {"success":true} when healthy
    const response = await fetch(`${endpoint}/`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const data = (await response.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

/**
 * Initialize SQLit service
 * No Docker provisioning - just detect and connect to available SQLit
 */
export async function ensureSQLitService(): Promise<{
  endpoint: string
  mode: string
}> {
  if (initialized && sqlitEndpoint) {
    return { endpoint: sqlitEndpoint, mode: getMode() }
  }

  const endpoint = resolveEndpoint()
  console.log(`[SQLit] Resolving SQLit endpoint: ${endpoint}`)

  // Try to connect to external endpoint first
  const isHealthy = await checkEndpointHealth(endpoint)

  if (isHealthy) {
    sqlitEndpoint = endpoint
    initialized = true
    console.log(`[SQLit] Connected to external SQLit: ${endpoint}`)
    return { endpoint, mode: 'external' }
  }

  // If K8s and not healthy, report error - don't fall back to embedded in production
  if (isKubernetesEnvironment() || isProductionEnv()) {
    throw new Error(
      `SQLit service unavailable at ${endpoint}. Ensure sqlit-adapter is deployed and healthy.`,
    )
  }

  // Local development: use embedded SQLite
  console.log(`[SQLit] External SQLit unavailable, using embedded mode`)
  sqlitEndpoint = 'embedded'
  initialized = true
  return { endpoint: 'embedded', mode: 'embedded' }
}

/**
 * Get current SQLit mode
 */
function getMode(): string {
  if (!initialized) return 'uninitialized'
  if (sqlitEndpoint === 'embedded') return 'embedded'
  if (isKubernetesEnvironment()) return 'kubernetes'
  return 'external'
}

/**
 * Get SQLit endpoint for clients
 */
export function getSQLitEndpoint(): string {
  if (sqlitEndpoint && sqlitEndpoint !== 'embedded') {
    return sqlitEndpoint
  }
  return resolveEndpoint()
}

/**
 * Execute a query against SQLit
 * Works with both external endpoint and embedded mode
 */
export async function sqlitQuery(
  database: string,
  query: string,
  args?: unknown[],
): Promise<{
  success: boolean
  status: string
  data: { rows: Record<string, unknown>[] } | null
}> {
  // Ensure service is initialized
  await ensureSQLitService()

  // Embedded mode
  if (sqlitEndpoint === 'embedded') {
    try {
      const db = getEmbeddedDatabase(database)
      const stmt = db.prepare(query)
      // Cast args to SQLite bindings - at runtime, values are validated by bun:sqlite
      const bindArgs = (args ?? []) as (
        | string
        | number
        | bigint
        | boolean
        | null
        | Uint8Array
      )[]
      const rows = stmt.all(...bindArgs) as Record<string, unknown>[]
      return {
        success: true,
        status: 'ok',
        data: { rows },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[SQLit] Query error: ${message}`)
      return { success: false, status: message, data: null }
    }
  }

  // External mode - proxy to endpoint
  const endpoint = getSQLitEndpoint()
  const response = await fetch(`${endpoint}/v1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database, query, args, assoc: true }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    return { success: false, status: await response.text(), data: null }
  }

  return await response.json()
}

/**
 * Execute a write operation against SQLit
 */
export async function sqlitExec(
  database: string,
  query: string,
  args?: unknown[],
): Promise<{
  success: boolean
  status: string
  data: { last_insert_id: number; affected_rows: number } | null
}> {
  // Ensure service is initialized
  await ensureSQLitService()

  // Embedded mode
  if (sqlitEndpoint === 'embedded') {
    try {
      const db = getEmbeddedDatabase(database)
      // db.run requires SQLQueryBindings array - filter and cast appropriately
      type SQLQueryBinding =
        | string
        | bigint
        | Uint8Array
        | number
        | boolean
        | null
      const bindings = (args ?? []).filter(
        (v): v is SQLQueryBinding =>
          v === null ||
          typeof v === 'string' ||
          typeof v === 'number' ||
          typeof v === 'bigint' ||
          typeof v === 'boolean' ||
          v instanceof Uint8Array,
      )
      const result = db.run(query, bindings)
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
      return { success: false, status: message, data: null }
    }
  }

  // External mode
  const endpoint = getSQLitEndpoint()
  const response = await fetch(`${endpoint}/v1/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database, query, args }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    return { success: false, status: await response.text(), data: null }
  }

  return await response.json()
}

/**
 * Create a new database
 */
export async function sqlitCreateDatabase(nodeCount = 1): Promise<{
  success: boolean
  status: string
  data: { database: string } | null
}> {
  await ensureSQLitService()

  // Generate a random database ID
  const randBytes = randomBytes(32)
  const dbID = createHash('sha256').update(randBytes).digest('hex')

  // Embedded mode - just create the database
  if (sqlitEndpoint === 'embedded') {
    getEmbeddedDatabase(dbID)
    console.log(`[SQLit] Created embedded database: ${dbID}`)
    return {
      success: true,
      status: 'created',
      data: { database: dbID },
    }
  }

  // External mode
  const endpoint = getSQLitEndpoint()
  const response = await fetch(
    `${endpoint}/v1/admin/create?node=${nodeCount}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    },
  )

  if (!response.ok) {
    return { success: false, status: await response.text(), data: null }
  }

  const CreateDatabaseResponseSchema = z.object({
    success: z.boolean(),
    status: z.string().optional(),
    data: z
      .object({
        database: z.string(),
      })
      .nullable()
      .optional(),
  })

  const parsed = CreateDatabaseResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    return {
      success: false,
      status: 'Invalid response from SQLit adapter',
      data: null,
    }
  }

  const result = parsed.data
  const databaseId = result.data?.database
  if (result.success && databaseId) {
    const initResult = await sqlitExec(
      databaseId,
      'CREATE TABLE IF NOT EXISTS __sqlit_init (id INTEGER PRIMARY KEY)',
      [],
    )
    if (!initResult.success) {
      return {
        success: false,
        status: `SQLit init failed: ${initResult.status}`,
        data: null,
      }
    }
  }

  return {
    success: result.success,
    status: result.status ?? 'ok',
    data: result.data ?? null,
  }
}

/**
 * Drop a database
 */
export async function sqlitDropDatabase(
  database: string,
): Promise<{ success: boolean; status: string }> {
  await ensureSQLitService()

  // Embedded mode
  if (sqlitEndpoint === 'embedded') {
    const db = embeddedDatabases.get(database)
    if (db) {
      db.close()
      embeddedDatabases.delete(database)
    }
    const dataDir = process.env.SQLIT_DATA_DIR || DEFAULT_DATA_DIR
    const dbPath = join(dataDir, `${database}.db`)
    if (existsSync(dbPath)) {
      rmSync(dbPath)
    }
    console.log(`[SQLit] Dropped embedded database: ${database}`)
    return { success: true, status: 'ok' }
  }

  // External mode
  const endpoint = getSQLitEndpoint()
  const response = await fetch(
    `${endpoint}/v1/admin/drop?database=${database}`,
    {
      method: 'DELETE',
      signal: AbortSignal.timeout(30000),
    },
  )

  if (!response.ok) {
    return { success: false, status: await response.text() }
  }

  return { success: true, status: 'ok' }
}

/**
 * Check if SQLit service is healthy
 */
export async function isSQLitHealthy(): Promise<boolean> {
  try {
    const { mode } = await ensureSQLitService()

    if (mode === 'embedded') {
      return true // Embedded is always "healthy"
    }

    const endpoint = getSQLitEndpoint()
    return await checkEndpointHealth(endpoint)
  } catch {
    return false
  }
}

/**
 * Get SQLit service status
 */
export function getSQLitStatus(): {
  running: boolean
  endpoint: string
  mode: string
  healthStatus: string
} {
  return {
    running: initialized,
    endpoint: getSQLitEndpoint(),
    mode: getMode(),
    healthStatus: initialized ? 'healthy' : 'unknown',
  }
}

/**
 * Get SQLit client port (for native protocol connections)
 */
export function getSQLitClientPort(): number {
  return 4661
}

/**
 * Provision a new database for an app
 */
export async function provisionAppDatabase(_params: {
  appName: string
  owner: Address
  schema?: string
}): Promise<{
  databaseId: string
  endpoint: string
  clientPort: number
}> {
  await ensureSQLitService()

  // Create the database
  const result = await sqlitCreateDatabase()
  if (!result.success || !result.data) {
    throw new Error(`Failed to create database: ${result.status}`)
  }

  return {
    databaseId: result.data.database,
    endpoint: getSQLitEndpoint(),
    clientPort: getSQLitClientPort(),
  }
}

/**
 * Get connection info for a database
 */
export function getDatabaseConnectionInfo(databaseId: string): {
  endpoint: string
  clientPort: number
  databaseId: string
  httpUrl: string
} {
  return {
    endpoint: getSQLitEndpoint(),
    clientPort: getSQLitClientPort(),
    databaseId,
    httpUrl: `${getSQLitEndpoint()}/v1`,
  }
}

/**
 * Close all embedded databases (for cleanup)
 */
export function closeEmbeddedDatabases(): void {
  for (const [id, db] of embeddedDatabases) {
    console.log(`[SQLit] Closing embedded database: ${id}`)
    db.close()
  }
  embeddedDatabases.clear()
}
