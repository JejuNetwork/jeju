/**
 * Database Manager
 *
 * Robust database connection management with:
 * - Automatic health monitoring
 * - Connection recovery with exponential backoff
 * - Schema provisioning/re-provisioning
 * - Circuit breaker integration
 *
 * @example
 * ```typescript
 * import { createDatabaseManager } from '@jejunetwork/db'
 *
 * const manager = createDatabaseManager({
 *   appName: 'my-app',
 *   databaseId: 'my-app-db',
 *   schema: [
 *     'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)',
 *   ],
 *   healthCheckInterval: 30000,
 *   onHealthChange: (healthy) => console.log('DB healthy:', healthy),
 * })
 *
 * await manager.start()
 * const client = manager.getClient()
 * ```
 */

import { getLogLevel } from '@jejunetwork/config'
import pino from 'pino'
import { getSQLit, resetSQLit, type SQLitClient } from './client.js'
import type {
  ExecResult,
  QueryParam,
  QueryResult,
  SQLitConfig,
  SQLitQueryable,
} from './types.js'

const log = pino({
  name: 'db-manager',
  level: getLogLevel(),
})

// Types

export type ManagerStatus =
  | 'connecting'
  | 'healthy'
  | 'unhealthy'
  | 'recovering'
  | 'stopped'

export interface DatabaseManagerConfig {
  /** Application name (used for logging and identification) */
  appName: string
  /** Database ID */
  databaseId: string
  /** SQLit configuration overrides */
  sqlitConfig?: Partial<SQLitConfig>
  /** Schema DDL statements to execute on initialization */
  schema?: string[]
  /** Index DDL statements to execute on initialization */
  indexes?: string[]
  /** Health check interval in ms (default: 30000) */
  healthCheckInterval?: number
  /** Max retry attempts for reconnection (default: 10) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseRetryDelay?: number
  /** Max delay for exponential backoff in ms (default: 60000) */
  maxRetryDelay?: number
  /** Callback when health status changes */
  onHealthChange?: (healthy: boolean, status: ManagerStatus) => void
  /** Callback when database is ready */
  onReady?: () => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Enable debug logging */
  debug?: boolean
}

export interface DatabaseManagerStats {
  status: ManagerStatus
  healthy: boolean
  lastHealthCheck: number
  consecutiveFailures: number
  totalReconnects: number
  uptime: number
  circuitState: 'open' | 'closed' | 'half-open'
}

// Database Manager Implementation

export class DatabaseManager implements SQLitQueryable {
  private config: Required<
    Omit<
      DatabaseManagerConfig,
      | 'sqlitConfig'
      | 'schema'
      | 'indexes'
      | 'onHealthChange'
      | 'onReady'
      | 'onError'
    >
  > &
    DatabaseManagerConfig
  private client: SQLitClient | null = null
  private status: ManagerStatus = 'stopped'
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private lastHealthCheck = 0
  private consecutiveFailures = 0
  private totalReconnects = 0
  private startTime = 0
  private initialized = false
  private reconnecting = false

  constructor(config: DatabaseManagerConfig) {
    this.config = {
      healthCheckInterval: 30000,
      maxRetries: 10,
      baseRetryDelay: 1000,
      maxRetryDelay: 60000,
      debug: false,
      ...config,
    }
  }

  /**
   * Start the database manager
   */
  async start(): Promise<void> {
    if (this.status !== 'stopped') {
      log.warn({ app: this.config.appName }, 'Database manager already started')
      return
    }

    this.startTime = Date.now()
    this.status = 'connecting'
    this.emitHealthChange(false)

    await this.connect()

    // Start health check loop
    this.healthCheckTimer = setInterval(
      () => this.healthCheck(),
      this.config.healthCheckInterval,
    )

    log.info({ app: this.config.appName }, 'Database manager started')
  }

  /**
   * Stop the database manager
   */
  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }

    if (this.client) {
      await this.client.close()
      this.client = null
    }

    this.status = 'stopped'
    this.initialized = false
    log.info({ app: this.config.appName }, 'Database manager stopped')
  }

  /**
   * Get the SQLit client (throws if not healthy)
   */
  getClient(): SQLitClient {
    if (!this.client || this.status === 'unhealthy') {
      throw new Error(`Database not available (status: ${this.status})`)
    }
    return this.client
  }

  /**
   * Check if database is healthy
   */
  isHealthy(): boolean {
    return this.status === 'healthy'
  }

  /**
   * Get manager statistics
   */
  getStats(): DatabaseManagerStats {
    return {
      status: this.status,
      healthy: this.isHealthy(),
      lastHealthCheck: this.lastHealthCheck,
      consecutiveFailures: this.consecutiveFailures,
      totalReconnects: this.totalReconnects,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      circuitState: this.client?.getCircuitState().state ?? 'closed',
    }
  }

  /**
   * Execute a query (SQLitQueryable interface)
   */
  async query<T>(
    sql: string,
    params?: QueryParam[],
    dbId?: string,
  ): Promise<QueryResult<T>> {
    const client = this.getClient()
    return client.query<T>(sql, params, dbId ?? this.config.databaseId)
  }

  /**
   * Execute a statement (SQLitQueryable interface)
   */
  async exec(
    sql: string,
    params?: QueryParam[],
    dbId?: string,
  ): Promise<ExecResult> {
    const client = this.getClient()
    return client.exec(sql, params, dbId ?? this.config.databaseId)
  }

  /**
   * Force a health check
   */
  async forceHealthCheck(): Promise<boolean> {
    return this.healthCheck()
  }

  /**
   * Force reconnection
   */
  async reconnect(): Promise<void> {
    log.info({ app: this.config.appName }, 'Forcing reconnection')
    await this.recover()
  }

  // Private Methods

  private async connect(): Promise<void> {
    resetSQLit()

    this.client = getSQLit({
      databaseId: this.config.databaseId,
      timeout: 30000,
      debug: this.config.debug,
      ...this.config.sqlitConfig,
    })

    // Test connection
    const healthy = await this.client.isHealthy()
    if (!healthy) {
      this.status = 'unhealthy'
      this.emitHealthChange(false)
      throw new Error('Database connection failed - SQLit is not healthy')
    }

    // Initialize schema if not done
    if (!this.initialized) {
      await this.initializeSchema()
      this.initialized = true
    }

    this.status = 'healthy'
    this.consecutiveFailures = 0
    this.lastHealthCheck = Date.now()
    this.emitHealthChange(true)

    if (this.config.onReady) {
      this.config.onReady()
    }

    log.info({ app: this.config.appName }, 'Database connected and healthy')
  }

  private async initializeSchema(): Promise<void> {
    if (!this.client) return

    const { schema = [], indexes = [] } = this.config

    // Execute DDL statements
    for (const ddl of schema) {
      await this.client.exec(ddl, [], this.config.databaseId)
    }

    for (const idx of indexes) {
      await this.client.exec(idx, [], this.config.databaseId)
    }

    if (schema.length > 0 || indexes.length > 0) {
      log.info(
        {
          app: this.config.appName,
          tables: schema.length,
          indexes: indexes.length,
        },
        'Schema initialized',
      )
    }
  }

  private async healthCheck(): Promise<boolean> {
    if (!this.client || this.status === 'stopped' || this.reconnecting) {
      return false
    }

    this.lastHealthCheck = Date.now()

    const healthy = await this.client.isHealthy()

    if (healthy) {
      if (this.status !== 'healthy') {
        this.status = 'healthy'
        this.emitHealthChange(true)
        log.info({ app: this.config.appName }, 'Database recovered')
      }
      this.consecutiveFailures = 0
      return true
    }

    this.consecutiveFailures++
    log.warn(
      { app: this.config.appName, failures: this.consecutiveFailures },
      'Health check failed',
    )

    if (this.consecutiveFailures >= 3) {
      this.status = 'unhealthy'
      this.emitHealthChange(false)

      // Trigger recovery
      this.recover().catch((err) => {
        log.error({ app: this.config.appName, error: err }, 'Recovery failed')
        if (this.config.onError) {
          this.config.onError(
            err instanceof Error ? err : new Error(String(err)),
          )
        }
      })
    }

    return false
  }

  private async recover(): Promise<void> {
    if (this.reconnecting) return

    this.reconnecting = true
    this.status = 'recovering'
    this.emitHealthChange(false)

    log.info({ app: this.config.appName }, 'Starting recovery')

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      const delay = Math.min(
        this.config.baseRetryDelay * 2 ** (attempt - 1),
        this.config.maxRetryDelay,
      )

      log.info(
        {
          app: this.config.appName,
          attempt,
          maxRetries: this.config.maxRetries,
          delay,
        },
        'Recovery attempt',
      )

      await this.sleep(delay)

      // Reset the global client and try to reconnect
      resetSQLit()

      this.client = getSQLit({
        databaseId: this.config.databaseId,
        timeout: 30000,
        debug: this.config.debug,
        ...this.config.sqlitConfig,
      })

      const healthy = await this.client.isHealthy()

      if (healthy) {
        this.totalReconnects++
        this.consecutiveFailures = 0
        this.status = 'healthy'
        this.reconnecting = false
        this.emitHealthChange(true)

        // Re-run schema to ensure tables exist
        await this.initializeSchema()

        log.info(
          {
            app: this.config.appName,
            attempt,
            totalReconnects: this.totalReconnects,
          },
          'Recovery successful',
        )

        if (this.config.onReady) {
          this.config.onReady()
        }

        return
      }
    }

    // Recovery failed after all attempts
    this.reconnecting = false
    this.status = 'unhealthy'
    const error = new Error(
      `Recovery failed after ${this.config.maxRetries} attempts`,
    )

    log.error({ app: this.config.appName }, error.message)

    if (this.config.onError) {
      this.config.onError(error)
    }
  }

  private emitHealthChange(healthy: boolean): void {
    if (this.config.onHealthChange) {
      this.config.onHealthChange(healthy, this.status)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Factory Function

/**
 * Create a database manager instance
 */
export function createDatabaseManager(
  config: DatabaseManagerConfig,
): DatabaseManager {
  return new DatabaseManager(config)
}

// Singleton Pattern for Apps

const managers = new Map<string, DatabaseManager>()

/**
 * Get or create a database manager for an app
 */
export function getOrCreateManager(
  config: DatabaseManagerConfig,
): DatabaseManager {
  const key = `${config.appName}:${config.databaseId}`

  let manager = managers.get(key)
  if (!manager) {
    manager = createDatabaseManager(config)
    managers.set(key, manager)
  }

  return manager
}

/**
 * Get an existing manager by app name
 */
export function getManager(appName: string): DatabaseManager | undefined {
  for (const [key, manager] of managers) {
    if (key.startsWith(`${appName}:`)) {
      return manager
    }
  }
  return undefined
}

/**
 * Get all active managers
 */
export function getAllManagers(): Map<string, DatabaseManager> {
  return new Map(managers)
}

/**
 * Stop and remove all managers
 */
export async function shutdownAllManagers(): Promise<void> {
  const stopPromises = Array.from(managers.values()).map((m) => m.stop())
  await Promise.all(stopPromises)
  managers.clear()
}
