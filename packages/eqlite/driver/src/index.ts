/**
 * @jejunetwork/eqlite
 *
 * EQLite (EQLite) for Jeju Network - TypeScript Driver.
 *
 * Features:
 * - Connection pooling for efficient database access
 * - Native EQLite proxy API (/v1/query, /v1/exec)
 * - Node discovery from on-chain EQLite Registry
 * - Transaction support with savepoints
 * - Health checking and automatic reconnection
 *
 * @example
 * ```typescript
 * import { createConnection, createPool } from '@jejunetwork/eqlite'
 *
 * // Simple connection
 * const conn = await createConnection({
 *   endpoint: 'http://localhost:4661',
 *   dbid: 'my-database',
 * })
 *
 * const rows = await conn.query('SELECT * FROM users')
 *
 * // With connection pool
 * const pool = await createPool({
 *   endpoint: 'http://localhost:4661',
 *   dbid: 'my-database',
 *   minConnections: 2,
 *   maxConnections: 10,
 * })
 *
 * const users = await pool.query('SELECT * FROM users WHERE id = ?', [1])
 * ```
 *
 */

// Core connection
export { Connection } from './Connection'
export type { ConnectionConfig } from './ConnectionConfig'

// Connection pooling
export { ConnectionPool, createPool, type PoolConfig } from './ConnectionPool'

// Node discovery
export {
  createDiscovery,
  type DiscoveryConfig,
  EQLITE_REGISTRY_ABI,
  EQLiteDiscovery,
  type EQLiteNode,
} from './Discovery'

// Transactions
export {
  Transaction,
  type TransactionOptions,
  withTransaction,
} from './Transaction'

// Factory functions
import { Connection } from './Connection'
import type { ConnectionConfig } from './ConnectionConfig'

/**
 * Create a new connection instance
 */
export function createConnection(
  config: ConnectionConfig,
): Promise<Connection> {
  return new Connection(config).connect()
}
