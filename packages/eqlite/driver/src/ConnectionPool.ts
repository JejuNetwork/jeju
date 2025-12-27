/**
 * Connection Pool for EQLite
 *
 * Manages a pool of connections for efficient database access.
 * Supports health checking, automatic reconnection, and load balancing.
 */

import { Connection } from "./Connection"
import type { ConnectionConfig } from "./ConnectionConfig"

export interface PoolConfig extends ConnectionConfig {
  /**
   * Minimum number of connections in the pool (default: 2)
   */
  minConnections?: number

  /**
   * Maximum number of connections in the pool (default: 10)
   */
  maxConnections?: number

  /**
   * Connection acquire timeout in milliseconds (default: 10000)
   */
  acquireTimeout?: number

  /**
   * Idle timeout before connection is released (default: 30000)
   */
  idleTimeout?: number

  /**
   * Health check interval in milliseconds (default: 30000)
   */
  healthCheckInterval?: number
}

interface PooledConnection {
  connection: Connection
  inUse: boolean
  lastUsed: number
  createdAt: number
}

export class ConnectionPool {
  private config: PoolConfig
  private connections: PooledConnection[] = []
  private waitQueue: Array<{
    resolve: (conn: Connection) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }> = []
  private healthCheckTimer?: ReturnType<typeof setInterval>
  private closed = false

  constructor(config: PoolConfig) {
    this.config = {
      minConnections: 2,
      maxConnections: 10,
      acquireTimeout: 10000,
      idleTimeout: 30000,
      healthCheckInterval: 30000,
      ...config,
    }
  }

  /**
   * Initialize the pool with minimum connections
   */
  async initialize(): Promise<void> {
    const minConn = this.config.minConnections ?? 2

    const initPromises: Promise<void>[] = []
    for (let i = 0; i < minConn; i++) {
      initPromises.push(this.createConnection())
    }

    await Promise.all(initPromises)

    // Start health check
    this.startHealthCheck()

    if (this.config.debug) {
      console.log(`[EQLite Pool] Initialized with ${this.connections.length} connections`)
    }
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<Connection> {
    if (this.closed) {
      throw new Error("Pool is closed")
    }

    // Find an available connection
    const available = this.connections.find((c) => !c.inUse && c.connection.isConnected)
    if (available) {
      available.inUse = true
      available.lastUsed = Date.now()
      return available.connection
    }

    // Create a new connection if under max
    const maxConn = this.config.maxConnections ?? 10
    if (this.connections.length < maxConn) {
      await this.createConnection()
      const newConn = this.connections[this.connections.length - 1]
      if (newConn) {
        newConn.inUse = true
        newConn.lastUsed = Date.now()
        return newConn.connection
      }
    }

    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve)
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1)
        }
        reject(new Error("Connection acquire timeout"))
      }, this.config.acquireTimeout)

      this.waitQueue.push({ resolve, reject, timeout })
    })
  }

  /**
   * Release a connection back to the pool
   */
  release(connection: Connection): void {
    const pooled = this.connections.find((c) => c.connection === connection)
    if (!pooled) {
      console.warn("[EQLite Pool] Releasing unknown connection")
      return
    }

    pooled.inUse = false
    pooled.lastUsed = Date.now()

    // Check if anyone is waiting
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()
      if (waiter) {
        clearTimeout(waiter.timeout)
        pooled.inUse = true
        pooled.lastUsed = Date.now()
        waiter.resolve(pooled.connection)
      }
    }
  }

  /**
   * Execute a query using a pooled connection
   */
  async query(sql: string, values?: unknown[]): Promise<Record<string, unknown>[] | null> {
    const conn = await this.acquire()
    try {
      return await conn.query(sql, values)
    } finally {
      this.release(conn)
    }
  }

  /**
   * Execute a write operation using a pooled connection
   */
  async exec(sql: string, values?: unknown[]): Promise<Record<string, unknown>[] | null> {
    const conn = await this.acquire()
    try {
      return await conn.exec(sql, values)
    } finally {
      this.release(conn)
    }
  }

  /**
   * Get pool statistics
   */
  stats(): {
    total: number
    active: number
    idle: number
    waiting: number
  } {
    const active = this.connections.filter((c) => c.inUse).length
    return {
      total: this.connections.length,
      active,
      idle: this.connections.length - active,
      waiting: this.waitQueue.length,
    }
  }

  /**
   * Close all connections and shut down the pool
   */
  async close(): Promise<void> {
    this.closed = true

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }

    // Reject all waiters
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout)
      waiter.reject(new Error("Pool is closing"))
    }
    this.waitQueue = []

    // Close all connections
    await Promise.all(
      this.connections.map((c) => c.connection.close())
    )
    this.connections = []

    if (this.config.debug) {
      console.log("[EQLite Pool] Closed")
    }
  }

  private async createConnection(): Promise<void> {
    const connection = new Connection(this.config)
    await connection.connect()

    this.connections.push({
      connection,
      inUse: false,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    })
  }

  private startHealthCheck(): void {
    const interval = this.config.healthCheckInterval ?? 30000
    const idleTimeout = this.config.idleTimeout ?? 30000
    const minConn = this.config.minConnections ?? 2

    this.healthCheckTimer = setInterval(async () => {
      if (this.closed) return

      const now = Date.now()

      // Check each connection
      for (let i = this.connections.length - 1; i >= 0; i--) {
        const pooled = this.connections[i]
        if (!pooled) continue

        // Skip in-use connections
        if (pooled.inUse) continue

        // Check if connection is healthy
        const healthy = await pooled.connection.isHealthy()
        if (!healthy) {
          if (this.config.debug) {
            console.log("[EQLite Pool] Removing unhealthy connection")
          }
          await pooled.connection.close()
          this.connections.splice(i, 1)
          continue
        }

        // Remove idle connections (but keep minimum)
        if (
          this.connections.length > minConn &&
          now - pooled.lastUsed > idleTimeout
        ) {
          if (this.config.debug) {
            console.log("[EQLite Pool] Removing idle connection")
          }
          await pooled.connection.close()
          this.connections.splice(i, 1)
        }
      }

      // Ensure minimum connections
      while (this.connections.length < minConn) {
        try {
          await this.createConnection()
        } catch (err) {
          console.error("[EQLite Pool] Failed to create connection:", err)
          break
        }
      }
    }, interval)
  }
}

/**
 * Create and initialize a connection pool
 */
export async function createPool(config: PoolConfig): Promise<ConnectionPool> {
  const pool = new ConnectionPool(config)
  await pool.initialize()
  return pool
}

