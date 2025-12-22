/**
 * @jejunetwork/db - Database Integration for Jeju Network (Powered by CovenantSQL)
 *
 * Decentralized SQL database with:
 * - BFT-Raft consensus for strong consistency
 * - Column-level ACL for privacy
 * - Multi-tenant database rental
 * - Standard SQL interface
 *
 * @example
 * ```typescript
 * import { getDB, createRental } from '@jejunetwork/db';
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
export {
  CQLClient,
  CQLClient as CovenantSQLClient,
  getCQL,
  resetCQL,
} from './client.js'
// Migration
export {
  addColumn,
  createIndex,
  createMigrationManager,
  createTable,
  defineMigration,
  MigrationManager,
} from './migration.js'
// Server (for local development)
export { CQLServer, createCQLServer } from './server.js'
// Types
export type {
  ACLEventDetails,
  ACLPermission,
  // ACL
  ACLRule,
  // Network
  BlockProducerInfo,
  ColumnMeta,
  // Config
  CQLConfig,
  // Connection
  CQLConnection,
  CQLConnectionPool,
  CQLDataType,
  // Events
  CQLEvent,
  CQLEventDetails,
  CQLQueryable,
  CQLTransaction,
  CreateRentalRequest,
  // Database
  DatabaseConfig,
  DatabaseInfo,
  DatabaseStatus,
  ExecEventDetails,
  ExecResult,
  GrantRequest,
  // Migration
  Migration,
  MigrationEventDetails,
  MigrationResult,
  MinerInfo,
  QueryEventDetails,
  // Query
  QueryParam,
  QueryResult,
  RentalEventDetails,
  RentalInfo,
  // Rental
  RentalPlan,
  RevokeRequest,
} from './types.js'
// Utilities
export {
  parseBoolean,
  parsePort,
  parseTimeout,
  sanitizeObject,
  sanitizeRows,
  validateSQLDefault,
  validateSQLIdentifier,
  validateSQLIdentifiers,
} from './utils.js'
