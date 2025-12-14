/**
 * @jeju/cql - CovenantSQL Integration for Jeju Network
 *
 * Decentralized SQL database with:
 * - BFT-Raft consensus for strong consistency
 * - Column-level ACL for privacy
 * - Multi-tenant database rental
 * - Standard SQL interface
 *
 * @example
 * ```typescript
 * import { getCQL, createRental } from '@jeju/cql';
 *
 * // Create a database rental
 * const cql = getCQL();
 * const rental = await cql.createRental({
 *   planId: 'basic',
 *   schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 * });
 *
 * // Query the database
 * const users = await cql.query<{ id: number; name: string }>(
 *   'SELECT * FROM users',
 *   [],
 *   rental.databaseId
 * );
 * ```
 */

// Client
export { CQLClient, CQLClient as CovenantSQLClient, getCQL, resetCQL } from './client.js';

// Migration
export {
  MigrationManager,
  createMigrationManager,
  defineMigration,
  createTable,
  addColumn,
  createIndex,
} from './migration.js';

// Types
export type {
  // Config
  CQLConfig,
  // Connection
  CQLConnection,
  CQLConnectionPool,
  CQLTransaction,
  // Query
  QueryParam,
  QueryResult,
  ExecResult,
  ColumnMeta,
  CQLDataType,
  // Database
  DatabaseConfig,
  DatabaseInfo,
  DatabaseStatus,
  // ACL
  ACLRule,
  ACLPermission,
  GrantRequest,
  RevokeRequest,
  // Rental
  RentalPlan,
  RentalInfo,
  CreateRentalRequest,
  // Migration
  Migration,
  MigrationResult,
  // Network
  BlockProducerInfo,
  MinerInfo,
  // Events
  CQLEvent,
} from './types.js';

