/**
 * Database Replica Router - Production Implementation
 *
 * Routes queries to primary or read replicas with:
 * - Real PostgreSQL connections via pg Pool
 * - Health monitoring with automatic failover
 * - Lag-aware routing (avoids stale replicas)
 * - Connection pooling per node
 * - Transaction support (always routes to primary)
 * - Query classification (read vs write)
 * - Prometheus metrics
 * - Circuit breaker per node
 */

import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import { z } from 'zod'
import type { SqlParam } from '../types'

// ============================================================================
// Configuration Schema
// ============================================================================

const DatabaseNodeConfigSchema = z.object({
  host: z.string(),
  port: z.number().default(5432),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  ssl: z.boolean().default(false),
  maxConnections: z.number().default(20),
  idleTimeoutMs: z.number().default(30000),
  connectionTimeoutMs: z.number().default(5000),
})

const ReplicaRouterConfigSchema = z.object({
  primary: DatabaseNodeConfigSchema,
  replicas: z.array(DatabaseNodeConfigSchema).default([]),
  maxReplicaLagMs: z.number().default(5000),
  healthCheckIntervalMs: z.number().default(10000),
  readPreference: z.enum(['primary', 'replica', 'nearest']).default('replica'),
  circuitBreakerThreshold: z.number().default(5),
  circuitBreakerResetMs: z.number().default(30000),
})

export type DatabaseNodeConfig = z.infer<typeof DatabaseNodeConfigSchema>
export type ReplicaRouterConfig = z.infer<typeof ReplicaRouterConfigSchema>

// ============================================================================
// Types
// ============================================================================

interface NodeState {
  pool: Pool
  config: DatabaseNodeConfig
  healthy: boolean
  lastCheck: number
  lagMs: number
  latencyMs: number
  failures: number
  circuitOpen: boolean
  circuitOpenedAt: number
}

interface QueryOptions {
  forceWritable?: boolean
  allowStale?: boolean
  timeout?: number
}

// ============================================================================
// Prometheus Metrics
// ============================================================================

const metricsRegistry = new Registry()

const dbQueriesTotal = new Counter({
  name: 'db_queries_total',
  help: 'Total database queries',
  labelNames: ['node', 'type', 'status'],
  registers: [metricsRegistry],
})

const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Query duration',
  labelNames: ['node', 'type'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
})

const dbConnectionsActive = new Gauge({
  name: 'db_connections_active',
  help: 'Active connections per node',
  labelNames: ['node'],
  registers: [metricsRegistry],
})

const dbNodeHealth = new Gauge({
  name: 'db_node_health',
  help: 'Node health status',
  labelNames: ['node'],
  registers: [metricsRegistry],
})

const dbReplicaLag = new Gauge({
  name: 'db_replica_lag_ms',
  help: 'Replica lag in milliseconds',
  labelNames: ['node'],
  registers: [metricsRegistry],
})

// ============================================================================
// Query Classification
// ============================================================================

const WRITE_PATTERNS = [
  /^\s*INSERT\s/i,
  /^\s*UPDATE\s/i,
  /^\s*DELETE\s/i,
  /^\s*CREATE\s/i,
  /^\s*ALTER\s/i,
  /^\s*DROP\s/i,
  /^\s*TRUNCATE\s/i,
  /^\s*GRANT\s/i,
  /^\s*REVOKE\s/i,
  /^\s*BEGIN\b/i,
  /^\s*COMMIT\b/i,
  /^\s*ROLLBACK\b/i,
  /^\s*SAVEPOINT\s/i,
  /^\s*LOCK\s/i,
  /FOR\s+UPDATE/i,
  /FOR\s+SHARE/i,
]

function isWriteQuery(sql: string): boolean {
  return WRITE_PATTERNS.some((pattern) => pattern.test(sql))
}

// ============================================================================
// Database Replica Router
// ============================================================================

export class DatabaseReplicaRouter {
  private config: ReplicaRouterConfig
  private primary: NodeState
  private replicas: NodeState[] = []
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private currentReplicaIndex = 0

  constructor(config: Partial<ReplicaRouterConfig>) {
    this.config = ReplicaRouterConfigSchema.parse({
      primary: config.primary,
      ...config,
    })

    // Initialize primary
    this.primary = this.createNodeState(this.config.primary, 'primary')

    // Initialize replicas
    for (const replicaConfig of this.config.replicas) {
      this.replicas.push(this.createNodeState(replicaConfig, 'replica'))
    }
  }

  private createNodeState(
    config: DatabaseNodeConfig,
    _role: string,
  ): NodeState {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      // SECURITY: Always verify SSL certificates in production
      // Only disable in development with explicit DB_SSL_REJECT_UNAUTHORIZED=false
      ssl: config.ssl
        ? {
            rejectUnauthorized:
              process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
          }
        : false,
      max: config.maxConnections,
      idleTimeoutMillis: config.idleTimeoutMs,
      connectionTimeoutMillis: config.connectionTimeoutMs,
    }

    const pool = new Pool(poolConfig)

    // Track connection events
    pool.on('connect', () => {
      dbConnectionsActive.inc({ node: config.host })
    })

    pool.on('remove', () => {
      dbConnectionsActive.dec({ node: config.host })
    })

    pool.on('error', (err) => {
      console.error(`[DB] Pool error on ${config.host}:`, err.message)
    })

    return {
      pool,
      config,
      healthy: true,
      lastCheck: 0,
      lagMs: 0,
      latencyMs: 0,
      failures: 0,
      circuitOpen: false,
      circuitOpenedAt: 0,
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    // Initial health check
    await this.checkAllHealth()

    // Periodic health checks
    this.healthCheckInterval = setInterval(
      () => this.checkAllHealth(),
      this.config.healthCheckIntervalMs,
    )

    console.log(
      `[DB] Router started with 1 primary and ${this.replicas.length} replicas`,
    )
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    // Close all pools
    await this.primary.pool.end()
    for (const replica of this.replicas) {
      await replica.pool.end()
    }

    console.log('[DB] Router stopped')
  }

  // ============================================================================
  // Query Execution
  // ============================================================================

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: SqlParam[],
    options?: QueryOptions,
  ): Promise<QueryResult<T>> {
    const isWrite = isWriteQuery(sql)
    const node = this.selectNode(isWrite, options)
    const nodeHost = node.config.host
    const queryType = isWrite ? 'write' : 'read'

    const timer = dbQueryDuration.startTimer({
      node: nodeHost,
      type: queryType,
    })

    try {
      // Check circuit breaker
      if (node.circuitOpen) {
        if (
          Date.now() - node.circuitOpenedAt >
          this.config.circuitBreakerResetMs
        ) {
          node.circuitOpen = false
          node.failures = 0
        } else if (!isWrite) {
          // Try another replica
          const alternateNode = this.selectNode(false, {
            ...options,
            allowStale: true,
          })
          if (alternateNode !== node) {
            return this.query(sql, params, options)
          }
          throw new Error(`Circuit breaker open for ${nodeHost}`)
        } else {
          throw new Error(`Primary circuit breaker open`)
        }
      }

      const result = await node.pool.query<T>(sql, params)
      dbQueriesTotal.inc({ node: nodeHost, type: queryType, status: 'success' })

      // Reset failures on success
      node.failures = 0

      return result
    } catch (error) {
      dbQueriesTotal.inc({ node: nodeHost, type: queryType, status: 'error' })

      // Track failures for circuit breaker
      node.failures++
      if (node.failures >= this.config.circuitBreakerThreshold) {
        node.circuitOpen = true
        node.circuitOpenedAt = Date.now()
        console.warn(`[DB] Circuit breaker opened for ${nodeHost}`)
      }

      throw error
    } finally {
      timer()
    }
  }

  // ============================================================================
  // Transactions
  // ============================================================================

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    // Transactions always go to primary
    const client = await this.primary.pool.connect()

    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  // ============================================================================
  // Node Selection
  // ============================================================================

  private selectNode(isWrite: boolean, options?: QueryOptions): NodeState {
    // Writes always go to primary
    if (isWrite || options?.forceWritable) {
      return this.primary
    }

    // No replicas configured
    if (this.replicas.length === 0) {
      return this.primary
    }

    // Filter healthy replicas
    const healthyReplicas = this.replicas.filter((r) => {
      if (!r.healthy || r.circuitOpen) return false
      if (!options?.allowStale && r.lagMs > this.config.maxReplicaLagMs)
        return false
      return true
    })

    if (healthyReplicas.length === 0) {
      // Fall back to primary if no healthy replicas
      console.warn('[DB] No healthy replicas, using primary for read')
      return this.primary
    }

    // Select based on preference
    switch (this.config.readPreference) {
      case 'primary':
        return this.primary

      case 'nearest':
        // Select by lowest latency
        return healthyReplicas.reduce((best, current) =>
          current.latencyMs < best.latencyMs ? current : best,
        )
      default:
        // Round-robin among healthy replicas
        this.currentReplicaIndex =
          (this.currentReplicaIndex + 1) % healthyReplicas.length
        return healthyReplicas[this.currentReplicaIndex]
    }
  }

  // ============================================================================
  // Health Checks
  // ============================================================================

  private async checkAllHealth(): Promise<void> {
    await Promise.all([
      this.checkNodeHealth(this.primary, true),
      ...this.replicas.map((r) => this.checkNodeHealth(r, false)),
    ])
  }

  private async checkNodeHealth(
    node: NodeState,
    isPrimary: boolean,
  ): Promise<void> {
    const startTime = Date.now()

    try {
      const client = await node.pool.connect()

      try {
        // Check connectivity
        await client.query('SELECT 1')

        // Check replication lag for replicas
        if (!isPrimary) {
          const lagResult = await client.query<{ lag: string }>(
            `SELECT COALESCE(
              EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000,
              0
            )::bigint as lag`,
          )
          node.lagMs = parseInt(lagResult.rows[0]?.lag ?? '0', 10)
          dbReplicaLag.set({ node: node.config.host }, node.lagMs)
        }

        node.healthy = true
        node.latencyMs = Date.now() - startTime
        node.lastCheck = Date.now()

        dbNodeHealth.set({ node: node.config.host }, 1)
      } finally {
        client.release()
      }
    } catch (error) {
      node.healthy = false
      node.lastCheck = Date.now()
      dbNodeHealth.set({ node: node.config.host }, 0)

      console.error(`[DB] Health check failed for ${node.config.host}:`, error)
    }
  }

  // ============================================================================
  // Stats & Metrics
  // ============================================================================

  getStats(): {
    primary: { host: string; healthy: boolean; latencyMs: number }
    replicas: Array<{
      host: string
      healthy: boolean
      lagMs: number
      latencyMs: number
      circuitOpen: boolean
    }>
  } {
    return {
      primary: {
        host: this.primary.config.host,
        healthy: this.primary.healthy,
        latencyMs: this.primary.latencyMs,
      },
      replicas: this.replicas.map((r) => ({
        host: r.config.host,
        healthy: r.healthy,
        lagMs: r.lagMs,
        latencyMs: r.latencyMs,
        circuitOpen: r.circuitOpen,
      })),
    }
  }

  async getMetrics(): Promise<string> {
    return metricsRegistry.metrics()
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  async getPrimaryClient(): Promise<PoolClient> {
    return this.primary.pool.connect()
  }

  async getReplicaClient(): Promise<PoolClient> {
    const node = this.selectNode(false)
    return node.pool.connect()
  }

  isPrimaryHealthy(): boolean {
    return this.primary.healthy && !this.primary.circuitOpen
  }

  getHealthyReplicaCount(): number {
    return this.replicas.filter((r) => r.healthy && !r.circuitOpen).length
  }
}

// ============================================================================
// Factory
// ============================================================================

let instance: DatabaseReplicaRouter | null = null

export function getDatabaseRouter(
  config?: Partial<ReplicaRouterConfig>,
): DatabaseReplicaRouter {
  if (!instance) {
    instance = new DatabaseReplicaRouter({
      primary: {
        host: process.env.DB_PRIMARY_HOST ?? 'localhost',
        port: parseInt(process.env.DB_PRIMARY_PORT ?? '5432', 10),
        database: process.env.DB_NAME ?? 'jeju',
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.DB_PASSWORD ?? '',
        ssl: process.env.DB_SSL === 'true',
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
        idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? '30000', 10),
        connectionTimeoutMs: parseInt(
          process.env.DB_CONNECTION_TIMEOUT_MS ?? '5000',
          10,
        ),
      },
      replicas: parseReplicaConfig(process.env.DB_REPLICAS),
      maxReplicaLagMs: parseInt(
        process.env.DB_MAX_REPLICA_LAG_MS ?? '5000',
        10,
      ),
      readPreference:
        (process.env.DB_READ_PREFERENCE as 'primary' | 'replica' | 'nearest') ??
        'replica',
      ...config,
    })
  }
  return instance
}

function parseReplicaConfig(replicasStr?: string): DatabaseNodeConfig[] {
  if (!replicasStr) return []

  return replicasStr.split(',').map((hostPort) => {
    const [host, port] = hostPort.trim().split(':')
    return {
      host,
      port: parseInt(port ?? '5432', 10),
      database: process.env.DB_NAME ?? 'jeju',
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      ssl: process.env.DB_SSL === 'true',
      maxConnections: 20,
      idleTimeoutMs: 30000,
      connectionTimeoutMs: 5000,
    }
  })
}

export async function closeDatabaseRouter(): Promise<void> {
  if (instance) {
    await instance.stop()
    instance = null
  }
}
