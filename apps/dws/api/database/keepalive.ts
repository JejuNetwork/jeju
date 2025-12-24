/**
 * DWS Database Keepalive Service
 *
 * Monitors all registered database instances and manages their health:
 * - Tracks all app database connections
 * - Monitors CQL block producer and miner health
 * - Triggers re-provisioning when databases are unhealthy
 * - Provides centralized health reporting
 *
 * @example
 * ```typescript
 * import { startKeepaliveService, registerDatabase } from './keepalive'
 *
 * // Register an app's database
 * registerDatabase({
 *   appName: 'gateway',
 *   databaseId: 'gateway-db',
 *   endpoint: 'http://localhost:4041',
 * })
 *
 * // Start the service
 * await startKeepaliveService()
 * ```
 */

import { type CQLClient, getCQL } from '@jejunetwork/db'
import pino from 'pino'

const log = pino({
  name: 'dws-keepalive',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
})

// Types

export type ResourceStatus = 'healthy' | 'unhealthy' | 'recovering' | 'unknown'

export interface RegisteredDatabase {
  /** Unique identifier (appName:databaseId) */
  id: string
  /** Application name */
  appName: string
  /** Database ID in CQL */
  databaseId: string
  /** App health endpoint (optional) */
  healthEndpoint?: string
  /** Last known status */
  status: ResourceStatus
  /** Last health check timestamp */
  lastCheck: number
  /** Consecutive failure count */
  failures: number
  /** Last successful check */
  lastSuccess: number
  /** Total recovery attempts */
  recoveryAttempts: number
  /** Schema for re-provisioning (optional) */
  schema?: string[]
}

export interface KeepaliveConfig {
  /** Health check interval in ms (default: 30000) */
  checkInterval?: number
  /** Failure threshold before recovery (default: 3) */
  failureThreshold?: number
  /** Max recovery attempts (default: 5) */
  maxRecoveryAttempts?: number
  /** Recovery cooldown in ms (default: 60000) */
  recoveryCooldown?: number
  /** Callback on status change */
  onStatusChange?: (db: RegisteredDatabase, oldStatus: ResourceStatus) => void
}

export interface KeepaliveStats {
  running: boolean
  totalDatabases: number
  healthyDatabases: number
  unhealthyDatabases: number
  cqlHealthy: boolean
  lastCqlCheck: number
  databases: RegisteredDatabase[]
}

// State

const databases = new Map<string, RegisteredDatabase>()
let checkTimer: ReturnType<typeof setInterval> | null = null
let cqlClient: CQLClient | null = null
let lastCqlCheck = 0
let cqlHealthy = false
let running = false
let config: Required<KeepaliveConfig> = {
  checkInterval: 30000,
  failureThreshold: 3,
  maxRecoveryAttempts: 5,
  recoveryCooldown: 60000,
  onStatusChange: () => {},
}

// Registration

/**
 * Register a database for monitoring
 */
export function registerDatabase(params: {
  appName: string
  databaseId: string
  healthEndpoint?: string
  schema?: string[]
}): string {
  const id = `${params.appName}:${params.databaseId}`

  const existing = databases.get(id)
  if (existing) {
    // Update existing registration
    existing.healthEndpoint = params.healthEndpoint ?? existing.healthEndpoint
    existing.schema = params.schema ?? existing.schema
    log.info({ id }, 'Database registration updated')
    return id
  }

  const db: RegisteredDatabase = {
    id,
    appName: params.appName,
    databaseId: params.databaseId,
    healthEndpoint: params.healthEndpoint,
    status: 'unknown',
    lastCheck: 0,
    failures: 0,
    lastSuccess: 0,
    recoveryAttempts: 0,
    schema: params.schema,
  }

  databases.set(id, db)
  log.info({ id, appName: params.appName }, 'Database registered')

  return id
}

/**
 * Unregister a database
 */
export function unregisterDatabase(id: string): boolean {
  const removed = databases.delete(id)
  if (removed) {
    log.info({ id }, 'Database unregistered')
  }
  return removed
}

/**
 * Get a registered database
 */
export function getRegisteredDatabase(
  id: string,
): RegisteredDatabase | undefined {
  return databases.get(id)
}

/**
 * Get all registered databases
 */
export function getAllDatabases(): RegisteredDatabase[] {
  return Array.from(databases.values())
}

// Health Checking

/**
 * Check CQL infrastructure health
 */
async function checkCQLHealth(): Promise<boolean> {
  if (!cqlClient) {
    cqlClient = getCQL()
  }

  lastCqlCheck = Date.now()
  cqlHealthy = await cqlClient.isHealthy()

  if (!cqlHealthy) {
    log.warn('CQL infrastructure unhealthy')
  }

  return cqlHealthy
}

/**
 * Check a specific database's health
 */
async function checkDatabaseHealth(db: RegisteredDatabase): Promise<boolean> {
  const oldStatus = db.status
  db.lastCheck = Date.now()

  // First check if CQL is healthy
  if (!cqlHealthy) {
    db.status = 'unhealthy'
    db.failures++
    emitStatusChange(db, oldStatus)
    return false
  }

  // Try to query the database
  const isHealthy = await testDatabaseConnection(db.databaseId)

  if (isHealthy) {
    db.status = 'healthy'
    db.failures = 0
    db.lastSuccess = Date.now()
    db.recoveryAttempts = 0

    if (oldStatus !== 'healthy') {
      log.info({ id: db.id }, 'Database is healthy')
      emitStatusChange(db, oldStatus)
    }

    return true
  }

  // Health check failed
  db.failures++
  log.warn({ id: db.id, failures: db.failures }, 'Database health check failed')

  if (db.failures >= config.failureThreshold) {
    db.status = 'unhealthy'
    emitStatusChange(db, oldStatus)

    // Trigger recovery if under limit
    if (db.recoveryAttempts < config.maxRecoveryAttempts) {
      recoverDatabase(db).catch((err) => {
        log.error({ id: db.id, error: err }, 'Recovery failed')
      })
    }
  }

  return false
}

/**
 * Test database connection with a simple query
 */
async function testDatabaseConnection(databaseId: string): Promise<boolean> {
  if (!cqlClient) return false

  const result = await cqlClient
    .query<{ result: number }>('SELECT 1 as result', [], databaseId)
    .catch(() => null)

  return result !== null && result.rows.length > 0
}

/**
 * Attempt to recover a database
 */
async function recoverDatabase(db: RegisteredDatabase): Promise<void> {
  if (db.status === 'recovering') return

  const oldStatus = db.status
  db.status = 'recovering'
  db.recoveryAttempts++
  emitStatusChange(db, oldStatus)

  log.info(
    { id: db.id, attempt: db.recoveryAttempts },
    'Attempting database recovery',
  )

  // Wait for cooldown
  await sleep(config.recoveryCooldown)

  // Try to re-provision schema if available
  if (db.schema && db.schema.length > 0) {
    await reprovisionDatabase(db)
  }

  // Test connection again
  const healthy = await testDatabaseConnection(db.databaseId)

  if (healthy) {
    db.status = 'healthy'
    db.failures = 0
    db.lastSuccess = Date.now()
    log.info({ id: db.id }, 'Database recovered successfully')
  } else {
    db.status = 'unhealthy'
    log.warn(
      { id: db.id, attempts: db.recoveryAttempts },
      'Recovery unsuccessful',
    )
  }

  emitStatusChange(db, 'recovering')
}

/**
 * Re-provision database schema
 */
async function reprovisionDatabase(db: RegisteredDatabase): Promise<void> {
  if (!cqlClient || !db.schema) return

  log.info({ id: db.id }, 'Re-provisioning database schema')

  for (const ddl of db.schema) {
    await cqlClient.exec(ddl, [], db.databaseId).catch((err) => {
      log.warn(
        { id: db.id, ddl: ddl.substring(0, 50), error: err },
        'Schema DDL warning',
      )
    })
  }

  log.info({ id: db.id, statements: db.schema.length }, 'Schema re-provisioned')
}

/**
 * Run all health checks
 */
async function runHealthChecks(): Promise<void> {
  // Check CQL first
  await checkCQLHealth()

  // Check all registered databases
  const checkPromises = Array.from(databases.values()).map((db) =>
    checkDatabaseHealth(db).catch((err) => {
      log.error({ id: db.id, error: err }, 'Health check error')
      return false
    }),
  )

  await Promise.all(checkPromises)
}

// Service Control

/**
 * Start the keepalive service
 */
export async function startKeepaliveService(
  options?: KeepaliveConfig,
): Promise<void> {
  if (running) {
    log.warn('Keepalive service already running')
    return
  }

  config = {
    checkInterval: options?.checkInterval ?? 30000,
    failureThreshold: options?.failureThreshold ?? 3,
    maxRecoveryAttempts: options?.maxRecoveryAttempts ?? 5,
    recoveryCooldown: options?.recoveryCooldown ?? 60000,
    onStatusChange: options?.onStatusChange ?? (() => {}),
  }

  running = true
  cqlClient = getCQL()

  // Run initial health checks
  await runHealthChecks()

  // Start periodic checks
  checkTimer = setInterval(() => {
    runHealthChecks().catch((err) => {
      log.error({ error: err }, 'Health check loop error')
    })
  }, config.checkInterval)

  log.info(
    { interval: config.checkInterval, databases: databases.size },
    'Keepalive service started',
  )
}

/**
 * Stop the keepalive service
 */
export function stopKeepaliveService(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }

  running = false
  log.info('Keepalive service stopped')
}

/**
 * Get keepalive service statistics
 */
export function getKeepaliveStats(): KeepaliveStats {
  const allDbs = Array.from(databases.values())
  const healthyCount = allDbs.filter((db) => db.status === 'healthy').length
  const unhealthyCount = allDbs.filter((db) => db.status === 'unhealthy').length

  return {
    running,
    totalDatabases: allDbs.length,
    healthyDatabases: healthyCount,
    unhealthyDatabases: unhealthyCount,
    cqlHealthy,
    lastCqlCheck,
    databases: allDbs,
  }
}

/**
 * Force a health check cycle
 */
export async function forceHealthCheck(): Promise<KeepaliveStats> {
  await runHealthChecks()
  return getKeepaliveStats()
}

// Utilities

function emitStatusChange(
  db: RegisteredDatabase,
  oldStatus: ResourceStatus,
): void {
  if (db.status !== oldStatus) {
    config.onStatusChange(db, oldStatus)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// HTTP Routes

import { Elysia, t } from 'elysia'

export function createKeepaliveRouter() {
  return new Elysia({ prefix: '/keepalive' })
    .get('/health', () => ({
      service: 'dws-keepalive',
      status: running ? 'running' : 'stopped',
    }))

    .get('/stats', () => getKeepaliveStats())

    .post('/check', async () => {
      const stats = await forceHealthCheck()
      return { success: true, ...stats }
    })

    .post(
      '/register',
      async ({ body }) => {
        const id = registerDatabase({
          appName: body.appName,
          databaseId: body.databaseId,
          healthEndpoint: body.healthEndpoint,
          schema: body.schema,
        })
        return { success: true, id }
      },
      {
        body: t.Object({
          appName: t.String(),
          databaseId: t.String(),
          healthEndpoint: t.Optional(t.String()),
          schema: t.Optional(t.Array(t.String())),
        }),
      },
    )

    .delete(
      '/register/:id',
      ({ params }) => {
        const removed = unregisterDatabase(params.id)
        return { success: removed }
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      },
    )

    .get('/databases', () => ({
      databases: getAllDatabases(),
    }))

    .get(
      '/databases/:id',
      ({ params, set }) => {
        const db = getRegisteredDatabase(params.id)
        if (!db) {
          set.status = 404
          return { error: 'Database not found' }
        }
        return db
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      },
    )
}
