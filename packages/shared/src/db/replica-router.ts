/**
 * Database Read Replica Router
 * 
 * Intelligently routes database queries to:
 * - Primary: All writes, transactions, and real-time reads
 * - Replicas: Read-heavy queries, analytics, background jobs
 * 
 * Features:
 * - Connection pooling per endpoint
 * - Health monitoring with automatic failover
 * - Lag-aware routing (skip replicas if too far behind)
 * - Query classification
 */

import { Pool, type PoolConfig, type QueryResult } from 'pg';

// ============================================================================
// Types
// ============================================================================

export interface ReplicaRouterConfig {
  primary: DatabaseEndpoint;
  replicas: DatabaseEndpoint[];
  maxLagSeconds: number;
  healthCheckIntervalMs: number;
  failoverEnabled: boolean;
  readFromPrimaryFallback: boolean;
  logQueries: boolean;
}

export interface DatabaseEndpoint {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
  region?: string;
  name?: string;
}

interface EndpointHealth {
  endpoint: DatabaseEndpoint;
  pool: Pool;
  healthy: boolean;
  lastCheck: number;
  lagSeconds: number;
  latencyMs: number;
  errors: number;
}

export interface QueryOptions {
  forceReplica?: boolean;
  forcePrimary?: boolean;
  timeout?: number;
  preferRegion?: string;
}

export interface RouterStats {
  primaryQueries: number;
  replicaQueries: number;
  failovers: number;
  avgPrimaryLatencyMs: number;
  avgReplicaLatencyMs: number;
  replicaLagSeconds: Record<string, number>;
}

// ============================================================================
// Query Classification
// ============================================================================

type QueryType = 'read' | 'write' | 'transaction';

function classifyQuery(sql: string): QueryType {
  const normalized = sql.trim().toUpperCase();
  
  // Explicit write operations
  if (
    normalized.startsWith('INSERT') ||
    normalized.startsWith('UPDATE') ||
    normalized.startsWith('DELETE') ||
    normalized.startsWith('CREATE') ||
    normalized.startsWith('ALTER') ||
    normalized.startsWith('DROP') ||
    normalized.startsWith('TRUNCATE') ||
    normalized.startsWith('GRANT') ||
    normalized.startsWith('REVOKE')
  ) {
    return 'write';
  }
  
  // Transactions
  if (
    normalized.startsWith('BEGIN') ||
    normalized.startsWith('COMMIT') ||
    normalized.startsWith('ROLLBACK') ||
    normalized.startsWith('SAVEPOINT')
  ) {
    return 'transaction';
  }
  
  // Everything else is a read
  return 'read';
}

// ============================================================================
// Replica Router
// ============================================================================

export class ReplicaRouter {
  private config: ReplicaRouterConfig;
  private primaryHealth: EndpointHealth | null = null;
  private replicaHealths: Map<string, EndpointHealth> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private stats: RouterStats = {
    primaryQueries: 0,
    replicaQueries: 0,
    failovers: 0,
    avgPrimaryLatencyMs: 0,
    avgReplicaLatencyMs: 0,
    replicaLagSeconds: {},
  };

  constructor(config: Partial<ReplicaRouterConfig>) {
    if (!config.primary) {
      throw new Error('Primary endpoint is required');
    }

    this.config = {
      primary: config.primary,
      replicas: config.replicas ?? [],
      maxLagSeconds: config.maxLagSeconds ?? 30,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 10000,
      failoverEnabled: config.failoverEnabled ?? true,
      readFromPrimaryFallback: config.readFromPrimaryFallback ?? true,
      logQueries: config.logQueries ?? false,
    };
  }

  async initialize(): Promise<void> {
    // Create pool for primary
    this.primaryHealth = await this.createEndpointHealth(this.config.primary, 'primary');

    // Create pools for replicas
    for (const replica of this.config.replicas) {
      const name = replica.name ?? `${replica.host}:${replica.port}`;
      const health = await this.createEndpointHealth(replica, name);
      this.replicaHealths.set(name, health);
    }

    // Start health checks
    this.healthCheckInterval = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs
    );

    // Initial health check
    await this.runHealthChecks();

    console.log(
      `[ReplicaRouter] Initialized with 1 primary and ${this.config.replicas.length} replicas`
    );
  }

  async close(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close all pools
    if (this.primaryHealth) {
      await this.primaryHealth.pool.end();
    }

    for (const health of this.replicaHealths.values()) {
      await health.pool.end();
    }

    console.log('[ReplicaRouter] Closed');
  }

  /**
   * Execute a query with automatic routing
   */
  async query<T extends QueryResult>(
    sql: string,
    params?: (string | number | boolean | null)[],
    options: QueryOptions = {}
  ): Promise<T> {
    const queryType = classifyQuery(sql);
    const startTime = Date.now();

    // Determine which pool to use
    let pool: Pool;
    let isReplica = false;

    if (options.forcePrimary || queryType === 'write' || queryType === 'transaction') {
      // Must use primary
      pool = this.getPrimaryPool();
    } else if (options.forceReplica) {
      // Force replica
      const replicaPool = this.getHealthyReplicaPool(options.preferRegion);
      if (replicaPool) {
        pool = replicaPool;
        isReplica = true;
      } else if (this.config.readFromPrimaryFallback) {
        pool = this.getPrimaryPool();
        this.stats.failovers++;
      } else {
        throw new Error('No healthy replicas available');
      }
    } else {
      // Read query - prefer replica
      const replicaPool = this.getHealthyReplicaPool(options.preferRegion);
      if (replicaPool) {
        pool = replicaPool;
        isReplica = true;
      } else {
        pool = this.getPrimaryPool();
      }
    }

    // Execute query
    try {
      const result = await pool.query(sql, params);
      const latencyMs = Date.now() - startTime;

      // Update stats
      if (isReplica) {
        this.stats.replicaQueries++;
        this.stats.avgReplicaLatencyMs = 
          (this.stats.avgReplicaLatencyMs * (this.stats.replicaQueries - 1) + latencyMs) / 
          this.stats.replicaQueries;
      } else {
        this.stats.primaryQueries++;
        this.stats.avgPrimaryLatencyMs = 
          (this.stats.avgPrimaryLatencyMs * (this.stats.primaryQueries - 1) + latencyMs) / 
          this.stats.primaryQueries;
      }

      if (this.config.logQueries) {
        console.log(
          `[ReplicaRouter] ${queryType} query on ${isReplica ? 'replica' : 'primary'}: ${latencyMs}ms`
        );
      }

      return result as T;
    } catch (error) {
      // Mark endpoint as potentially unhealthy
      const endpoint = isReplica ? 'replica' : 'primary';
      console.error(`[ReplicaRouter] Query failed on ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Execute within a transaction (always on primary)
   */
  async transaction<T>(
    fn: (client: { query: typeof this.query }) => Promise<T>
  ): Promise<T> {
    const pool = this.getPrimaryPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      
      const boundQuery = async <R extends QueryResult>(
        sql: string,
        params?: (string | number | boolean | null)[]
      ): Promise<R> => {
        return client.query(sql, params) as Promise<R>;
      };

      const result = await fn({ query: boundQuery });

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get connection stats
   */
  getStats(): RouterStats {
    return { ...this.stats };
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus(): {
    primary: { healthy: boolean; latencyMs: number };
    replicas: Array<{ name: string; healthy: boolean; lagSeconds: number; latencyMs: number }>;
  } {
    return {
      primary: {
        healthy: this.primaryHealth?.healthy ?? false,
        latencyMs: this.primaryHealth?.latencyMs ?? 0,
      },
      replicas: Array.from(this.replicaHealths.entries()).map(([name, health]) => ({
        name,
        healthy: health.healthy,
        lagSeconds: health.lagSeconds,
        latencyMs: health.latencyMs,
      })),
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async createEndpointHealth(
    endpoint: DatabaseEndpoint,
    name: string
  ): Promise<EndpointHealth> {
    const poolConfig: PoolConfig = {
      host: endpoint.host,
      port: endpoint.port,
      database: endpoint.database,
      user: endpoint.user,
      password: endpoint.password,
      max: endpoint.maxConnections ?? 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: endpoint.ssl ? { rejectUnauthorized: false } : undefined,
    };

    const pool = new Pool(poolConfig);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error(`[ReplicaRouter] Pool error (${name}):`, err.message);
    });

    return {
      endpoint,
      pool,
      healthy: true,
      lastCheck: 0,
      lagSeconds: 0,
      latencyMs: 0,
      errors: 0,
    };
  }

  private getPrimaryPool(): Pool {
    if (!this.primaryHealth || !this.primaryHealth.healthy) {
      if (!this.config.failoverEnabled) {
        throw new Error('Primary database is unhealthy');
      }

      // Try to promote a replica (not implemented - would need external coordination)
      throw new Error('Primary database is unhealthy and failover not configured');
    }

    return this.primaryHealth.pool;
  }

  private getHealthyReplicaPool(preferRegion?: string): Pool | null {
    // Filter healthy replicas with acceptable lag
    const healthy = Array.from(this.replicaHealths.values())
      .filter(h => h.healthy && h.lagSeconds <= this.config.maxLagSeconds);

    if (healthy.length === 0) {
      return null;
    }

    // Prefer region if specified
    if (preferRegion) {
      const regional = healthy.filter(h => h.endpoint.region === preferRegion);
      if (regional.length > 0) {
        // Pick the one with lowest latency
        regional.sort((a, b) => a.latencyMs - b.latencyMs);
        return regional[0].pool;
      }
    }

    // Pick the replica with lowest latency
    healthy.sort((a, b) => a.latencyMs - b.latencyMs);
    return healthy[0].pool;
  }

  private async runHealthChecks(): Promise<void> {
    // Check primary
    if (this.primaryHealth) {
      await this.checkEndpointHealth(this.primaryHealth, false);
    }

    // Check replicas
    await Promise.all(
      Array.from(this.replicaHealths.values()).map(health =>
        this.checkEndpointHealth(health, true)
      )
    );
  }

  private async checkEndpointHealth(
    health: EndpointHealth,
    isReplica: boolean
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Simple connectivity check
      await health.pool.query('SELECT 1');

      // For replicas, check replication lag
      if (isReplica) {
        const lagResult = await health.pool.query(`
          SELECT 
            CASE WHEN pg_is_in_recovery() 
              THEN EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))
              ELSE 0 
            END as lag_seconds
        `);
        
        health.lagSeconds = parseFloat(lagResult.rows[0]?.lag_seconds ?? '0');
        this.stats.replicaLagSeconds[health.endpoint.name ?? health.endpoint.host] = health.lagSeconds;
      }

      health.latencyMs = Date.now() - startTime;
      health.healthy = true;
      health.errors = 0;
      health.lastCheck = Date.now();
    } catch (error) {
      health.errors++;
      
      // Mark unhealthy after 3 consecutive errors
      if (health.errors >= 3) {
        health.healthy = false;
        console.warn(
          `[ReplicaRouter] Endpoint marked unhealthy: ${health.endpoint.host}`
        );
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalRouter: ReplicaRouter | null = null;

export async function getReplicaRouter(
  config?: Partial<ReplicaRouterConfig>
): Promise<ReplicaRouter> {
  if (!globalRouter) {
    globalRouter = new ReplicaRouter({
      primary: {
        host: process.env.DB_PRIMARY_HOST ?? 'localhost',
        port: parseInt(process.env.DB_PRIMARY_PORT ?? '5432'),
        database: process.env.DB_NAME ?? 'jeju',
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.DB_PASSWORD ?? '',
        ssl: process.env.DB_SSL === 'true',
      },
      replicas: parseReplicaEndpoints(process.env.DB_REPLICAS ?? ''),
      maxLagSeconds: parseInt(process.env.DB_MAX_LAG_SECONDS ?? '30'),
      ...config,
    });

    await globalRouter.initialize();
  }

  return globalRouter;
}

function parseReplicaEndpoints(replicasStr: string): DatabaseEndpoint[] {
  if (!replicasStr) return [];

  return replicasStr.split(',').map(endpoint => {
    const [hostPort, region] = endpoint.split('@');
    const [host, portStr] = hostPort.split(':');
    
    return {
      host,
      port: parseInt(portStr) || 5432,
      database: process.env.DB_NAME ?? 'jeju',
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      ssl: process.env.DB_SSL === 'true',
      region,
      name: hostPort,
    };
  });
}

export async function closeReplicaRouter(): Promise<void> {
  if (globalRouter) {
    await globalRouter.close();
    globalRouter = null;
  }
}

